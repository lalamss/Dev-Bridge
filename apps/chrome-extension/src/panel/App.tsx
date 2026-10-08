import { useCallback, useEffect, useRef, useState } from "react";
import { identityMissingMessage, sourceFailureMessage } from "./sourceMessage";

// ─────────────────────────────────────────────────────────────
// Types (mirrors @devbridge/protocol — inlined so the extension
// bundle has zero Node deps)
// ─────────────────────────────────────────────────────────────

const AGENT = "http://localhost:4577";
const AGENT_WS = "ws://localhost:4577/events";
const PANEL_PORT_PREFIX = "devbridge-panel-";
const RECONNECT_DELAY = 500;

type PatchStatus = "proposed" | "previewed" | "approved" | "applied" | "rejected" | "conflicted";
type RiskLevel   = "low" | "medium" | "high";

interface SourceLocation { file: string; start: { line: number; column: number }; }
interface DevIdentity    { id: string; component: string | null; source: SourceLocation; parentId: string | null; }
interface StateSnapshot  { devId: string; props: Record<string,unknown>; state: Record<string,unknown>; context: Record<string,unknown>; timestamp: string; }
interface SourcePatch    { id: string; file: string; diff: string; status: PatchStatus; risk: RiskLevel; riskReasons: string[]; origin: string; }
interface GitCheckpoint  { sha: string; message: string; testsPassing: boolean | null; timestamp: string; }

// ─────────────────────────────────────────────────────────────
// Transport
//
// DevTools panels cannot receive chrome.runtime.sendMessage(), and they
// cannot reach the content script through chrome.runtime either. The only
// supported path is a named Port that the background service worker keeps
// mapped to this tab id. The devtools page opens the first port with this
// name; the panel opens its own on mount so the worker forwards
// element-selected events to whichever document is currently listening.
// ─────────────────────────────────────────────────────────────

function usePanelPort() {
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let disposed = false;
    let current: chrome.runtime.Port | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      const tabId = chrome.devtools.inspectedWindow.tabId;
      const p = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
      current = p;
      setPort(p);
      setConnected(true);
      p.onDisconnect.addListener(() => {
        setConnected(false);
        // MV3 suspends idle service workers, so the port can drop at any
        // time — silently re-establish it rather than dead-ending the panel.
        if (!disposed) retry = setTimeout(connect, RECONNECT_DELAY);
      });
    };

    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      current?.disconnect();
    };
  }, []);

  const send = useCallback((message: Record<string, unknown>) => {
    port?.postMessage(message);
  }, [port]);

  return { port, connected, send };
}

// ─────────────────────────────────────────────────────────────
// View states for the panel
// ─────────────────────────────────────────────────────────────
type View = "editor" | "diff" | "applied";

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────
export function App() {
  // Selection
  const [devId, setDevId]       = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [identity, setIdentity] = useState<DevIdentity | null>(null);
  const [source, setSource]     = useState<string>("");          // original file content
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [liveTag, setLiveTag]   = useState(false);

  // Edit / patch flow
  const [view, setView]         = useState<View>("editor");
  const [patch, setPatch]       = useState<SourcePatch | null>(null);
  const [checkpoint, setCheckpoint] = useState<GitCheckpoint | null>(null);
  const [busy, setBusy]         = useState(false);
  const [flashMsg, setFlashMsg] = useState<{ text: string; kind: "ok" | "err" | "warn" } | null>(null);

  // Monaco
  const monacoContainerRef = useRef<HTMLDivElement>(null);
  const editorRef  = useRef<any>(null);  // monaco.editor.IStandaloneCodeEditor
  const modelRef   = useRef<any>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef    = useRef<any>(null);
  const diffModelsRef    = useRef<any[]>([]);

  // WS
  const wsRef = useRef<WebSocket | null>(null);

  // Panel ⇄ background port (DevTools panels can't use sendMessage)
  const { port, connected, send } = usePanelPort();

  // ── flash helper (audit X5: overlapping flashes raced — a stale timer
  // cleared a newer message early, and timers leaked on unmount) ──
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);
  function flash(text: string, kind: "ok" | "err" | "warn" = "ok") {
    setFlashMsg({ text, kind });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), 3000);
  }

  // The content script owns the real inspection state (it auto-stops on
  // click and cancels on Escape); the panel mirrors it instead of guessing
  // from its own button (audit C3). `inspectingRef` lets the reconnect
  // resync below push the latest intent without re-firing on every toggle.
  const [inspecting, setInspecting] = useState(false);
  const inspectingRef = useRef(inspecting);
  inspectingRef.current = inspecting;

  // Resync after a worker restart or reconnect: push the panel's intent so a
  // content script orphaned by a suspended worker heals instead of staying
  // stuck (or silently stopped) with nobody telling the user.
  const resyncedPorts = useRef(new Set<chrome.runtime.Port>());
  useEffect(() => {
    if (!port || !connected || resyncedPorts.current.has(port)) return;
    resyncedPorts.current.add(port);
    send({ type: "devbridge:set-inspecting", value: inspectingRef.current });
  }, [port, connected, send]);

  // ── element selected (pushed down the port by the background worker) ──
  useEffect(() => {
    if (!port) return;
    const listener = (msg: any) => {
      if (msg?.type === "devbridge:element-selected") {
        // Audit C5: a new selection resets EVERYTHING from the previous one.
        // The old code kept `identity`/`source`, so a missing identity showed
        // the previous element's file and line under the new devId.
        setDevId(msg.devId ?? null);
        setSelectedTag(typeof msg.tag === "string" ? msg.tag : null);
        setIdentity(null);
        setSource("");
        setView("editor");
        setPatch(null);
        setCheckpoint(null);
        setSnapshot(null);
        if (!msg.devId) {
          // Audit C4: only a DOM node was identified — explain instead of
          // fabricating a source location.
          flash(
            msg.tag
              ? `Selected <${msg.tag}> carries no DevBridge identity (no data-dev-id). Source mapping is unavailable for this element — it may be rendered by a path the build plugin did not instrument.`
              : `Selected element carries no DevBridge identity. Source mapping is unavailable.`,
            "warn",
          );
        }
      }
      if (msg?.type === "devbridge:inspecting-changed") {
        setInspecting(Boolean(msg.value));
      }
      if (msg?.type === "devbridge:no-content-script") {
        setInspecting(false);
        flash(
          `No DevBridge content script on this page (${msg.command}). Reload the tab and open it on http://localhost or http://127.0.0.1.`,
          "err",
        );
      }
    };
    port.onMessage.addListener(listener);
    return () => port.onMessage.removeListener(listener);
  }, [port]);

  // ── fetch identity + source ──
  useEffect(() => {
    if (!devId) return;
    let cancelled = false;
    (async () => {
      try {
        const idRes = await fetch(`${AGENT}/identity/${devId}`);
        if (idRes.status === 404) {
          flash(identityMissingMessage(devId), "warn");
          return;
        }
        if (!idRes.ok) throw new Error(`GET /identity -> ${idRes.status}`);
        const id: DevIdentity = await idRes.json();
        if (cancelled) return;
        setIdentity(id);

        const srcRes = await fetch(`${AGENT}/source?file=${encodeURIComponent(id.source.file)}`);
        // Batch 6: identity-hit + source-miss is the stale/wrong-root agent
        // signature (reproduced live) — diagnose it precisely instead of
        // claiming the agent is unreachable.
        if (!srcRes.ok) {
          flash(sourceFailureMessage(devId, id.source.file, srcRes.status), "warn");
          return;
        }
        const d = await srcRes.json();
        if (!cancelled) setSource(d.content ?? "");
      } catch {
        if (!cancelled) flash("Couldn't reach local agent — run devbridge start", "err");
      }
    })();
    return () => { cancelled = true; };
  }, [devId]);

  // ── fetch latest state snapshot ──
  useEffect(() => {
    if (!devId) return;
    fetch(`${AGENT}/state/${devId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setSnapshot(d))
      .catch(() => {});
  }, [devId]);

  // ── live WS for state.changed (audit X4: the old socket never
  // reconnected and never surfaced errors — after an agent restart, live
  // props/state silently stopped until devId changed) ──
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "offline">("connecting");
  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const open = () => {
      if (disposed) return;
      setLiveStatus(attempt === 0 ? "connecting" : "offline");
      let ws: WebSocket;
      try {
        ws = new WebSocket(AGENT_WS);
      } catch {
        scheduleRetry();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        if (!disposed) setLiveStatus("live");
      };
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as { type: string; payload: any };
          if (ev.type === "state.changed" && ev.payload.devId === devId) {
            setSnapshot({ devId: ev.payload.devId, props: ev.payload.props ?? {}, state: ev.payload.state ?? {}, context: ev.payload.context ?? {}, timestamp: ev.payload.timestamp ?? new Date().toISOString() });
            setLiveTag(true);
            setTimeout(() => setLiveTag(false), 800);
          }
          if (ev.type === "patch.applied") {
            flash("Patch applied and saved to disk ✅", "ok");
          }
        } catch {}
      };
      ws.onerror = () => {
        // onerror fires before onclose — onclose owns the retry.
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (disposed) return;
      setLiveStatus("offline");
      attempt += 1;
      const delay = Math.min(2000 * attempt, 10000);
      retry = setTimeout(open, delay);
    };

    open();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [devId]);

  // ── Monaco: mount editor when source arrives ──
  useEffect(() => {
    if (!source || !monacoContainerRef.current || view !== "editor") return;
    const monaco = window.monaco;
    if (!monaco) return;

    if (!editorRef.current) {
      const model = monaco.editor.createModel(source, inferLanguage(identity?.source.file ?? ""));
      modelRef.current = model;
      editorRef.current = monaco.editor.create(monacoContainerRef.current, {
        model,
        theme: "vs-dark",
        fontSize: 12,
        fontFamily: "'Cascadia Code', 'Fira Code', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: "on",
        folding: false,
        wordWrap: "on",
        padding: { top: 8, bottom: 8 },
        automaticLayout: true,
      });
    } else {
      // New file selected — update the model
      const lang = inferLanguage(identity?.source.file ?? "");
      monaco.editor.setModelLanguage(modelRef.current, lang);
      modelRef.current.setValue(source);
    }

    // Reveal the target line and column (audit P10). Babel columns are
    // 0-based; Monaco positions are 1-based.
    const line = identity?.source.start.line ?? 1;
    const column = (identity?.source.start.column ?? 0) + 1;
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column });
  }, [source, view]);

  // ── Monaco: dispose everything on unmount (audit P6 — leaked models) ──
  useEffect(() => () => {
    try {
      diffEditorRef.current?.dispose();
      for (const model of diffModelsRef.current) model.dispose();
      editorRef.current?.dispose();
      modelRef.current?.dispose();
    } catch {
      /* teardown must never throw */
    } finally {
      diffEditorRef.current = null;
      diffModelsRef.current = [];
      editorRef.current = null;
      modelRef.current = null;
    }
  }, []);

  // ── Monaco: mount diff editor when we enter diff view ──
  useEffect(() => {
    if (view !== "diff" || !patch || !diffContainerRef.current) return;
    const monaco = window.monaco;
    if (!monaco) return;

    // Dispose the previous diff editor AND its models (audit P6).
    // `editor.dispose()` alone keeps the models alive — each selection used
    // to leak two.
    if (diffEditorRef.current) { diffEditorRef.current.dispose(); diffEditorRef.current = null; }
    for (const model of diffModelsRef.current) {
      try { model.dispose(); } catch { /* already disposed */ }
    }
    diffModelsRef.current = [];

    const originalModel = monaco.editor.createModel(source, inferLanguage(patch.file));
    const modifiedModel = monaco.editor.createModel(editorRef.current?.getValue() ?? source, inferLanguage(patch.file));
    diffModelsRef.current = [originalModel, modifiedModel];

    diffEditorRef.current = monaco.editor.createDiffEditor(diffContainerRef.current, {
      theme: "vs-dark",
      fontSize: 12,
      fontFamily: "'Cascadia Code', 'Fira Code', monospace",
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderSideBySide: true,
      automaticLayout: true,
      padding: { top: 8, bottom: 8 },
    });
    diffEditorRef.current.setModel({ original: originalModel, modified: modifiedModel });
  }, [view, patch]);

  // ── Agent error mapping (Batch 3 §5). Every failure gets a distinct,
  // actionable message; success is shown only after the agent confirms the
  // write. `readAgentError` never surfaces absolute paths — the agent
  // sanitizes them server-side, and anything unparseable degrades to the
  // status-specific fallback below rather than raw HTML/text.
  async function readAgentError(res: Response, fallback: string): Promise<string> {
    try {
      const body = await res.json();
      if (body && typeof body.error === "string" && body.error.length > 0) return body.error;
    } catch {
      /* non-JSON error body — use the fallback */
    }
    return fallback;
  }

  function networkError(e: unknown): Error {
    if (e instanceof TypeError) {
      return new Error("Local agent unavailable — is `devbridge start` running on http://localhost:4577?");
    }
    return e as Error;
  }

  // ── Create patch ──
  async function handleCreatePatch() {
    // Audit P1: the old code silently returned here while the button stayed
    // enabled (source non-empty but the editor never mounted) — the click
    // did nothing with no explanation.
    if (!identity) {
      flash("No source identity for this element — select an instrumented element first.", "warn");
      return;
    }
    if (!editorRef.current) {
      flash("Editor unavailable — Monaco did not load. Reload the DevBridge tab and try again.", "err");
      return;
    }
    setBusy(true);
    try {
      const newContent = editorRef.current.getValue();
      let res: Response;
      try {
        res = await fetch(`${AGENT}/patch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: identity.source.file,
            newContent,
            origin: "manual",
            devId,
          }),
        });
      } catch (e) {
        throw networkError(e);
      }
      if (res.status === 403) throw new Error(await readAgentError(res, "Refused: this file is outside the authorized project root."));
      if (res.status === 400) throw new Error(await readAgentError(res, "Invalid patch request — the file or content was rejected by the agent."));
      if (!res.ok) throw new Error(await readAgentError(res, `Patch proposal failed (agent said ${res.status}).`));
      const p: SourcePatch = await res.json();
      setPatch(p);

      // Mark previewed
      await fetch(`${AGENT}/patch/${p.id}/preview`, { method: "POST" });

      // Inject CSS preview into running app via content script
      injectVisualPreview(identity.source.file, newContent);

      setView("diff");
    } catch (e: any) {
      flash(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  // ── Approve + Apply ──
  async function handleApprove() {
    if (!patch) return;
    setBusy(true);
    try {
      let approveRes: Response;
      try {
        approveRes = await fetch(`${AGENT}/patch/${patch.id}/approve`, { method: "POST" });
      } catch (e) {
        throw networkError(e);
      }
      // Audit P2: the old code neither awaited nor checked this — an approve
      // failure was invisible and /apply proceeded anyway. Stop here instead.
      if (approveRes.status === 404) throw new Error("Patch no longer exists on the agent (did it restart?). Re-select the element to propose again.");
      if (!approveRes.ok) throw new Error(await readAgentError(approveRes, `Approve failed (agent said ${approveRes.status}). Nothing was written.`));

      let res: Response;
      try {
        res = await fetch(`${AGENT}/patch/${patch.id}/apply`, { method: "POST" });
      } catch (e) {
        throw networkError(e);
      }
      if (res.status === 409) {
        let reason = "";
        try {
          const body = await res.json();
          reason = body?.reason === "deleted"
            ? "The source file was deleted after the preview — nothing was written. "
            : "The source file changed on disk since the preview — nothing was written. ";
        } catch {
          /* fall through with the generic conflict text */
        }
        throw new Error(`${reason}Re-select the element to reload and propose again.`);
      }
      if (res.status === 404) throw new Error("Patch no longer exists on the agent (did it restart?). Re-select the element to propose again.");
      if (res.status === 403) throw new Error(await readAgentError(res, "Refused: this file is outside the authorized project root. Nothing was written."));
      if (res.status === 500) throw new Error(await readAgentError(res, "The agent could not write the file (disk or permissions). Nothing was written."));
      if (!res.ok) throw new Error(await readAgentError(res, `Apply failed (agent said ${res.status}). Nothing was written.`));
      const applied: SourcePatch = await res.json();
      // Success is shown only on confirmation: the agent must report back an
      // applied patch, not just a 200.
      if (applied.status !== "applied") throw new Error("Agent returned without confirming the write — treating as failed. Nothing is assumed about the file.");
      setPatch(applied);

      // Audit P7: the CSS live-preview tag mirrored the proposal; now that
      // disk holds the applied content the tag would only go stale on the
      // next edit cycle, so remove it here (reject path already does).
      revertVisualPreview();

      // Git checkpoint
      const cpRes = await fetch(`${AGENT}/git/checkpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `edit ${identity?.source.file} via DevBridge`, testsPassing: null }),
      });
      if (cpRes.ok) setCheckpoint(await cpRes.json());

      setView("applied");
    } catch (e: any) {
      flash(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  // ── Reject ──
  async function handleReject() {
    if (!patch) return;
    await fetch(`${AGENT}/patch/${patch.id}/reject`, { method: "POST" });
    revertVisualPreview();
    setPatch(null);
    setView("editor");
    flash("Patch rejected — no changes written", "warn");
  }

  // ── Rollback ──
  async function handleRollback() {
    if (!checkpoint) return;
    setBusy(true);
    try {
      const res = await fetch(`${AGENT}/git/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: checkpoint.sha }),
      });
      if (!res.ok) throw new Error(await res.text());
      flash("Rolled back to previous commit ✅", "ok");
      setView("editor");
      setPatch(null);
      setCheckpoint(null);
    } catch (e: any) {
      flash(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  // ── Panel → background → content script (all via the named port) ──
  function injectVisualPreview(file: string, newContent: string) {
    if (!file.match(/\.(css|scss|module\.css)$/)) return;
    send({ type: "devbridge:preview-css", file, content: newContent });
  }
  function revertVisualPreview() {
    send({ type: "devbridge:revert-preview" });
  }

  function toggleInspect(v: boolean) {
    send({ type: "devbridge:set-inspecting", value: v });
    // The content script owns the real state and echoes
    // `devbridge:inspecting-changed`; this is only an optimistic hint so the
    // button responds instantly even before the echo arrives.
    setInspecting(v);
  }

  function locateElement(id: string) {
    send({ type: "devbridge:locate-element", devId: id });
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────

  // A selection exists even when the element carries no identity (devId
  // null + tag): the panel must show its "no mapping" explanation, not the
  // empty state — otherwise the warning flash has nowhere to render.
  const hasSelection = devId !== null || selectedTag !== null;

  if (!hasSelection) {
    return (
      <div style={S.empty}>
        <div style={{ fontSize: 36 }}>🔍</div>
        <button
          style={{ ...S.primaryBtn, opacity: connected ? 1 : 0.5 }}
          onClick={() => toggleInspect(!inspecting)}
          disabled={!connected}
          aria-label={inspecting ? "Stop inspecting" : "Start inspecting"}
          title={inspecting ? "Stop inspecting (or press Escape on the page)" : "Hover an element on the page and click it"}
        >
          {inspecting ? "Stop inspecting" : "Start inspecting"}
        </button>
        <p style={{ color: C.muted, fontSize: 12, textAlign: "center" }}>
          {inspecting
            ? "Click any highlighted element on the page — or press Escape to cancel."
            : "Hover an element on the page and click it to open it in DevBridge."}
        </p>
        {!connected && (
          <p style={{ color: "#fca5a5", fontSize: 11, textAlign: "center", maxWidth: 320 }}>
            Not connected to the background worker yet — reloading the DevBridge tab usually fixes it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={S.root}>

      {/* ── Top bar ── */}
      <div style={S.topBar}>
        <div style={S.componentName}>
          <span style={{ color: C.purple }}>⬡</span>{" "}
          {identity?.component ?? (devId ?? (selectedTag ? `<${selectedTag}> (no identity)` : "unknown"))}
        </div>
        <div style={S.filePill} title={identity?.source.file ?? "No source mapping for this element"}>
          {identity ? `${identity.source.file}:${identity.source.start.line}` : "no source"}
        </div>
        {liveTag && <span style={S.liveBadge}>LIVE</span>}
        <button
          style={{ ...S.ghostBtn, borderColor: inspecting ? C.purple : C.border }}
          onClick={() => toggleInspect(!inspecting)}
          title={inspecting ? "Stop inspecting (or press Escape on the page)" : "Inspect another element"}
          aria-label={inspecting ? "Stop inspecting" : "Inspect another element"}
        >
          {inspecting ? "■" : "🔍"}
        </button>
        <button
          style={S.ghostBtn}
          onClick={() => devId && locateElement(devId)}
          title={devId ? "Scroll to and flash this element in the page" : "No element to locate"}
          aria-label="Locate element in page"
          disabled={!devId}
        >
          🎯
        </button>
        <button
          style={S.ghostBtn}
          onClick={() => { setDevId(null); setSelectedTag(null); toggleInspect(false); }}
          title="Clear selection"
          aria-label="Clear selection"
        >
          ✕
        </button>
      </div>

      {/* ── Flash message ── */}
      {flashMsg && (
        <div style={{ ...S.flash, background: flashMsg.kind === "ok" ? "#14532d" : flashMsg.kind === "err" ? "#7f1d1d" : "#713f12" }}>
          {flashMsg.text}
        </div>
      )}

      {/* ── Tab strip ── */}
      <div style={S.tabStrip}>
        {(["editor","diff","applied"] as View[]).map(v => (
          <button
            key={v}
            style={{ ...S.tab, ...(view === v ? S.tabActive : {}) }}
            onClick={() => setView(v)}
            disabled={v === "diff" && !patch || v === "applied" && !checkpoint}
          >
            {v === "editor" ? "✏️ Edit" : v === "diff" ? "🔀 Diff" : "✅ Applied"}
          </button>
        ))}
      </div>

      {/* ══════════════ EDITOR VIEW ══════════════ */}
      {view === "editor" && (
        <div style={S.editorWrapper}>
          {!devId ? (
            <div style={S.monacoPlaceholder}>
              No DevBridge identity for this element.<br />
              <span style={{ fontSize: 11, color: C.muted }}>
                {selectedTag ? `<${selectedTag}> carries no data-dev-id, so there is no component or source file to show. ` : ""}
                Select an instrumented element, or press 🔍 to inspect again.
              </span>
            </div>
          ) : window.monaco ? (
            <div ref={monacoContainerRef} style={S.monacoContainer} />
          ) : (
            <div style={S.monacoPlaceholder}>
              Loading Monaco…<br />
              <span style={{ fontSize: 11, color: C.muted }}>
                Make sure panel.html includes the Monaco CDN loader script.
              </span>
            </div>
          )}
          <div style={S.editorFooter}>
            <RiskBadge patch={patch} />
            <div style={{ flex: 1 }} />
            <button
              style={{ ...S.primaryBtn, opacity: busy ? 0.6 : 1 }}
              onClick={handleCreatePatch}
              disabled={busy || !source}
            >
              {busy ? "…" : "Preview diff →"}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════ DIFF VIEW ══════════════ */}
      {view === "diff" && patch && (
        <div style={S.diffWrapper}>
          {/* Risk banner */}
          <RiskBanner patch={patch} />

          {/* Side-by-side Monaco diff */}
          <div ref={diffContainerRef} style={S.monacoContainer} />

          {/* Raw unified diff (collapsible) */}
          <details style={S.rawDiffDetails}>
            <summary style={{ cursor: "pointer", color: C.muted, fontSize: 11, padding: "6px 12px" }}>
              Raw unified diff
            </summary>
            <pre style={S.rawDiff}>{patch.diff}</pre>
          </details>

          {/* Action bar */}
          <div style={S.actionBar}>
            <button style={{ ...S.dangerBtn, opacity: busy ? 0.6 : 1 }} onClick={handleReject} disabled={busy}>
              ✕ Reject
            </button>
            <button
              style={{ ...S.primaryBtn, opacity: busy ? 0.6 : 1 }}
              onClick={handleApprove}
              disabled={busy}
            >
              {busy ? "Applying…" : "✓ Approve & Apply"}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════ APPLIED VIEW ══════════════ */}
      {view === "applied" && patch && (
        <div style={{ padding: 16 }}>
          <div style={S.appliedBanner}>
            <div style={{ fontSize: 28 }}>✅</div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Patch applied</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{patch.file} written to disk</div>
            </div>
          </div>

          {checkpoint && (
            <div style={S.checkpointCard}>
              <div style={{ color: C.muted, fontSize: 11, marginBottom: 6 }}>Git checkpoint</div>
              <div style={{ fontFamily: "monospace", fontSize: 12 }}>{checkpoint.sha.slice(0, 7)} — {checkpoint.message}</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{new Date(checkpoint.timestamp).toLocaleTimeString()}</div>
              <button
                style={{ ...S.dangerBtn, marginTop: 12, opacity: busy ? 0.6 : 1 }}
                onClick={handleRollback}
                disabled={busy}
              >
                {busy ? "Rolling back…" : "↩ Rollback this commit"}
              </button>
            </div>
          )}

          <button
            style={{ ...S.ghostBtn, marginTop: 16, display: "block", width: "100%" }}
            onClick={() => { setView("editor"); setPatch(null); setCheckpoint(null); }}
          >
            ← Back to editor
          </button>
        </div>
      )}

      {/* ══════════════ PROPS / STATE ══════════════ */}
      <div style={S.stateSection}>
        <div style={S.sectionHeader}>
          PROPS & STATE
          {liveTag && <span style={S.liveBadge}>LIVE</span>}
          {liveStatus === "offline" && (
            <span style={{ ...S.liveBadge, background: "#713f12" }} title="Local agent unreachable — retrying">
              OFFLINE
            </span>
          )}
        </div>
        {snapshot ? (
          <>
            <SnapshotTable label="Props"   data={snapshot.props}   color="#38bdf8" />
            <SnapshotTable label="State"   data={snapshot.state}   color="#a78bfa" />
            <SnapshotTable label="Context" data={snapshot.context} color="#34d399" />
            <div style={{ color: C.dim, fontSize: 10, marginTop: 4 }}>
              updated {new Date(snapshot.timestamp).toLocaleTimeString()}
            </div>
          </>
        ) : (
          <div style={{ color: C.muted, fontSize: 11 }}>
            Waiting for component to call <code style={S.ic}>reportState()</code>…
          </div>
        )}
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function RiskBadge({ patch }: { patch: SourcePatch | null }) {
  if (!patch) return null;
  const colors: Record<string, string> = { low: "#22c55e", medium: "#eab308", high: "#ef4444" };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: colors[patch.risk], fontFamily: "monospace" }}>
      {patch.risk.toUpperCase()} RISK
    </span>
  );
}

function RiskBanner({ patch }: { patch: SourcePatch }) {
  const bg: Record<string, string> = { low: "#14532d", medium: "#713f12", high: "#7f1d1d" };
  return (
    <div style={{ background: bg[patch.risk], padding: "8px 14px", fontSize: 12 }}>
      <span style={{ fontWeight: 700, marginRight: 8 }}>
        {patch.risk === "low" ? "✅" : patch.risk === "medium" ? "⚠️" : "🔴"} {patch.risk.toUpperCase()} RISK
      </span>
      {patch.riskReasons.join(" · ")}
    </div>
  );
}

function SnapshotTable({ label, data, color }: { label: string; data: Record<string,unknown>; color: string }) {
  const entries = Object.entries(data);
  if (!entries.length) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: C.muted, paddingRight: 10, fontSize: 11, whiteSpace: "nowrap", verticalAlign: "top", paddingBottom: 2 }}>{k}</td>
              <td style={{ color: C.text, fontSize: 11, wordBreak: "break-all", paddingBottom: 2 }}>{fmt(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function inferLanguage(file: string): string {
  if (file.endsWith(".tsx") || file.endsWith(".jsx")) return "typescriptreact";
  if (file.endsWith(".ts"))  return "typescript";
  if (file.endsWith(".js"))  return "javascript";
  if (file.endsWith(".css") || file.endsWith(".module.css")) return "css";
  if (file.endsWith(".scss")) return "scss";
  if (file.endsWith(".json")) return "json";
  return "plaintext";
}

function fmt(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ─────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────

const C = {
  bg:     "#0f172a",
  bg2:    "#1e293b",
  bg3:    "#273047",
  border: "#1e293b",
  purple: "#7c3aed",
  purpleL:"#a78bfa",
  text:   "#e2e8f0",
  muted:  "#94a3b8",
  dim:    "#475569",
};

const S: Record<string, React.CSSProperties> = {
  root:    { display: "flex", flexDirection: "column", height: "100vh", background: C.bg, color: C.text, fontFamily: "monospace", fontSize: 12, overflow: "hidden" },
  empty:   { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, height: "100vh", padding: 24 },

  topBar:  { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, background: C.bg2, flexShrink: 0 },
  componentName: { fontWeight: 700, color: C.purpleL, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  filePill:{ background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 7px", fontSize: 10, color: C.muted, whiteSpace: "nowrap" },

  tabStrip:{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.bg2, flexShrink: 0 },
  tab:     { flex: 1, padding: "7px 4px", border: "none", borderBottom: "2px solid transparent", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 11, fontFamily: "monospace" },
  tabActive:{ color: C.purpleL, borderBottomColor: C.purple, background: C.bg },

  editorWrapper: { display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" },
  monacoContainer: { flex: 1, minHeight: 0 },
  monacoPlaceholder: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: C.muted, fontSize: 13 },
  editorFooter: { display: "flex", alignItems: "center", padding: "8px 12px", borderTop: `1px solid ${C.border}`, background: C.bg2, gap: 8, flexShrink: 0 },

  diffWrapper: { display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" },
  rawDiffDetails: { background: C.bg, borderTop: `1px solid ${C.border}`, flexShrink: 0 },
  rawDiff: { padding: 12, overflowX: "auto", fontSize: 11, color: C.muted, lineHeight: 1.6, maxHeight: 160, overflowY: "auto" },
  actionBar: { display: "flex", gap: 8, padding: "10px 12px", borderTop: `1px solid ${C.border}`, background: C.bg2, justifyContent: "flex-end", flexShrink: 0 },

  appliedBanner: { display: "flex", gap: 12, alignItems: "center", background: "#14532d", borderRadius: 8, padding: 14, marginBottom: 14 },
  checkpointCard: { background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 },

  stateSection: { borderTop: `1px solid ${C.border}`, padding: "10px 12px", flexShrink: 0, maxHeight: 220, overflowY: "auto" },
  sectionHeader: { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: C.purple, fontSize: 10, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 },

  flash: { padding: "7px 14px", fontSize: 12, flexShrink: 0 },
  liveBadge: { background: "#22c55e", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em" },

  primaryBtn: { background: C.purple, color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 12, fontFamily: "monospace", fontWeight: 600 },
  dangerBtn:  { background: "#7f1d1d", color: "#fca5a5", border: "none", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 12, fontFamily: "monospace" },
  ghostBtn:   { background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontFamily: "monospace" },
  ic:         { background: C.bg3, padding: "1px 4px", borderRadius: 3, color: C.purpleL },
};
