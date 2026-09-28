import { useCallback, useEffect, useRef, useState } from "react";

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

  // WS
  const wsRef = useRef<WebSocket | null>(null);

  // Panel ⇄ background port (DevTools panels can't use sendMessage)
  const { port, connected, send } = usePanelPort();

  // ── flash helper ──
  function flash(text: string, kind: "ok" | "err" | "warn" = "ok") {
    setFlashMsg({ text, kind });
    setTimeout(() => setFlashMsg(null), 3000);
  }

  // ── element selected (pushed down the port by the background worker) ──
  useEffect(() => {
    if (!port) return;
    const listener = (msg: any) => {
      if (msg?.type === "devbridge:element-selected" && msg.devId) {
        setDevId(msg.devId);
        setView("editor");
        setPatch(null);
        setCheckpoint(null);
        setSnapshot(null);
      }
      if (msg?.type === "devbridge:no-content-script") {
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
          flash(`No identity registered for ${devId} — the page hasn't sent its component map to the local agent yet.`, "warn");
          return;
        }
        if (!idRes.ok) throw new Error(`GET /identity -> ${idRes.status}`);
        const id: DevIdentity = await idRes.json();
        if (cancelled) return;
        setIdentity(id);

        const srcRes = await fetch(`${AGENT}/source?file=${encodeURIComponent(id.source.file)}`);
        if (!srcRes.ok) throw new Error(`GET /source -> ${srcRes.status}`);
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

  // ── live WS for state.changed ──
  useEffect(() => {
    const ws = new WebSocket(AGENT_WS);
    wsRef.current = ws;
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
    return () => ws.close();
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

    // Reveal the target line
    const line = identity?.source.start.line ?? 1;
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column: 1 });
  }, [source, view]);

  // ── Monaco: mount diff editor when we enter diff view ──
  useEffect(() => {
    if (view !== "diff" || !patch || !diffContainerRef.current) return;
    const monaco = window.monaco;
    if (!monaco) return;

    // Dispose previous diff editor
    if (diffEditorRef.current) { diffEditorRef.current.dispose(); diffEditorRef.current = null; }

    const originalModel = monaco.editor.createModel(source, inferLanguage(patch.file));
    const modifiedModel = monaco.editor.createModel(editorRef.current?.getValue() ?? source, inferLanguage(patch.file));

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

  // ── Create patch ──
  async function handleCreatePatch() {
    if (!identity || !editorRef.current) return;
    setBusy(true);
    try {
      const newContent = editorRef.current.getValue();
      const res = await fetch(`${AGENT}/patch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: identity.source.file,
          newContent,
          origin: "manual",
          devId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
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
      await fetch(`${AGENT}/patch/${patch.id}/approve`, { method: "POST" });
      const res = await fetch(`${AGENT}/patch/${patch.id}/apply`, { method: "POST" });
      if (res.status === 409) throw new Error("Conflict — file changed on disk since patch was created. Re-select the element to reload.");
      if (!res.ok) throw new Error(await res.text());
      const applied: SourcePatch = await res.json();
      setPatch(applied);

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
  }

  function locateElement(id: string) {
    send({ type: "devbridge:locate-element", devId: id });
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────

  if (!devId) {
    return (
      <div style={S.empty}>
        <div style={{ fontSize: 36 }}>🔍</div>
        <button
          style={{ ...S.primaryBtn, opacity: connected ? 1 : 0.5 }}
          onClick={() => toggleInspect(true)}
          disabled={!connected}
        >
          Start inspecting
        </button>
        <p style={{ color: C.muted, fontSize: 12, textAlign: "center" }}>
          Hover an element on the page and click it to open it in DevBridge.
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
          {identity?.component ?? devId}
        </div>
        <div style={S.filePill} title={identity?.source.file}>
          {identity?.source.file}:{identity?.source.start.line}
        </div>
        {liveTag && <span style={S.liveBadge}>LIVE</span>}
        <button
          style={S.ghostBtn}
          onClick={() => locateElement(devId)}
          title="Scroll to and flash this element in the page"
        >
          🎯
        </button>
        <button style={S.ghostBtn} onClick={() => { setDevId(null); toggleInspect(false); }}>✕</button>
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
          {window.monaco ? (
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
