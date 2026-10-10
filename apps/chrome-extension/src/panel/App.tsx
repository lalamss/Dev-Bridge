import { useCallback, useEffect, useRef, useState } from "react";
import { identityMissingMessage, sourceFailureMessage } from "./sourceMessage";
import {
  isContextInvalidatedError,
  isExtensionContextValid,
  shouldRetryConnect,
} from "../extensionContext";
import { C, S, MONO_FONT } from "./theme";
import type {
  AgentProject,
  DevIdentity,
  GitCheckpoint,
  PageInfo,
  RuntimeMatch,
  SourcePatch,
  StateSnapshot,
} from "./theme";
import {
  AGENT_WS,
  approveAndApply,
  createCheckpoint,
  createPatch,
  getIdentities,
  getIdentity,
  getSource,
  getStateSnapshot,
  getProject,
  openInEditor,
  previewPatch,
  rejectPatch,
  rollbackCheckpoint,
} from "./api";
import type { EditorTab, PanelView } from "./navigation";
import { chromeLocalPrefsStore, DEFAULT_PREFERENCES, type PanelPreferences } from "./preferences";
import { Header } from "./components/Header";
import { NavRail } from "./components/NavRail";
import { InspectLanding } from "./views/InspectLanding";
import { ComponentsView } from "./views/ComponentsView";
import { FilesView } from "./views/FilesView";
import { SettingsView } from "./views/SettingsView";

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

const PANEL_PORT_PREFIX = "devbridge-panel-";
const RECONNECT_DELAY = 500;

function usePanelPort() {
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);
  const [connected, setConnected] = useState(false);
  // True once this document's extension context has died (extension
  // reloaded/updated/disabled while DevTools stayed open). The stale page
  // parks here instead of throwing "Extension context invalidated" uncaught
  // out of the reconnect timer — only reopening DevTools mints a fresh
  // context, so the hint says exactly that.
  const [invalidated, setInvalidated] = useState(false);

  useEffect(() => {
    let disposed = false;
    let current: chrome.runtime.Port | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const parkAsInvalidated = () => {
      current = null;
      setPort(null);
      setConnected(false);
      setInvalidated(true);
    };

    const connect = () => {
      if (disposed) return;
      if (!isExtensionContextValid()) {
        parkAsInvalidated();
        return;
      }
      let p: chrome.runtime.Port;
      try {
        const tabId = chrome.devtools.inspectedWindow.tabId;
        p = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });
      } catch (e) {
        // The context can die between the probe above and the call. Absorb
        // ONLY the invalidation signal; anything else still throws.
        if (isContextInvalidatedError(e)) {
          parkAsInvalidated();
          return;
        }
        throw e;
      }
      current = p;
      setPort(p);
      setConnected(true);
      setInvalidated(false);
      p.onDisconnect.addListener(() => {
        setConnected(false);
        // MV3 suspends idle service workers, so the port can drop at any
        // time — silently re-establish it rather than dead-ending the panel.
        // From a dead context the retry itself would throw uncaught, so park.
        if (shouldRetryConnect(disposed, isExtensionContextValid())) {
          retry = setTimeout(connect, RECONNECT_DELAY);
        } else if (!disposed) {
          parkAsInvalidated();
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (isExtensionContextValid()) {
        try {
          current?.disconnect();
        } catch (e) {
          if (!isContextInvalidatedError(e)) throw e;
        }
      }
    };
  }, []);

  const send = useCallback((message: Record<string, unknown>) => {
    if (!port || !isExtensionContextValid()) return;
    try {
      port.postMessage(message);
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        setConnected(false);
        setInvalidated(true);
        return;
      }
      throw e;
    }
  }, [port]);

  return { port, connected, invalidated, send };
}

// ─────────────────────────────────────────────────────────────
// Project connection (Phase 5): the agent's project vs this page —
//
// Connected requires ALL of: the agent answers, the page reports
// build-plugin identities, and — when the agent knows its dev-server
// origin — the page origin matches it. Identity resolution on selection
// is the final proof: a page that passes the origin check but resolves
// nothing is still treated as unconnected for source operations.
// ─────────────────────────────────────────────────────────────

export type ConnectionState =
  | { kind: "no-agent" }
  | { kind: "unknown-page" }
  | { kind: "uninstrumented" }
  | { kind: "mismatch"; expected: string; actual: string }
  | { kind: "connected" };

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────
export function App() {
  // Navigation
  const [nav, setNav] = useState<PanelView>("inspect");
  const [componentsFileFilter, setComponentsFileFilter] = useState<string | null>(null);

  // Preferences (persisted via chrome.storage.local w/ memory fallback)
  const [prefs, setPrefs] = useState<PanelPreferences>(DEFAULT_PREFERENCES);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    let cancelled = false;
    chromeLocalPrefsStore.load().then((loaded) => {
      if (!cancelled) setPrefs((p) => ({ ...p, ...loaded }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  function updatePrefs(next: PanelPreferences) {
    setPrefs(next);
    void chromeLocalPrefsStore.save(next);
  }

  // Selection
  const [devId, setDevId]       = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [identity, setIdentity] = useState<DevIdentity | null>(null);
  const [source, setSource]     = useState<string>("");          // original file content
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [liveTag, setLiveTag]   = useState(false);

  // Edit / patch flow
  const [view, setView]         = useState<EditorTab>("editor");
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
  const { port, connected, invalidated, send } = usePanelPort();

  // ── Project connection (Phase 5): the agent's project vs this page ──
  const [agentProject, setAgentProject] = useState<AgentProject | null>(null);
  const [agentReachable, setAgentReachable] = useState(true);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);

  // The agent's project. Fetched on mount; the agent is single-project per
  // process, so this record IS the project identity the panel binds to.
  const fetchProject = useCallback(async () => {
    try {
      const info = await getProject();
      setAgentProject(info);
      setAgentReachable(true);
    } catch {
      setAgentProject(null);
      setAgentReachable(false);
    }
  }, []);

  useEffect(() => {
    void fetchProject();
  }, [fetchProject]);

  function refreshConnection() {
    void fetchProject();
    send({ type: "devbridge:get-page-info" });
  }

  // Ask the page for its facts whenever the port (re)connects. The panel —
  // never the page — decides what counts as connected.
  useEffect(() => {
    if (!port || !connected) return;
    send({ type: "devbridge:get-page-info" });
  }, [port, connected, send]);

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
  // Pending source -> browser lookups, keyed by requestId. Entries resolve
  // on the matching `devbridge:locate-result` or reject on timeout — a lost
  // reply must surface, never hang the UI.
  const locateSeq = useRef(0);
  const pendingLocate = useRef(
    new Map<string, { resolve: (m: RuntimeMatch[]) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>(),
  );
  useEffect(() => () => {
    for (const [, p] of pendingLocate.current) clearTimeout(p.timer);
    pendingLocate.current.clear();
  }, []);

  // Live instance counts, keyed by devId — filled by every locate-devids
  // round trip so Components and the workspace share real numbers.
  const [instanceCounts, setInstanceCounts] = useState<Map<string, number>>(new Map());

  function locateDevIds(devIds: string[]): Promise<RuntimeMatch[]> {
    const requestId = `loc-${(locateSeq.current += 1)}-${Date.now()}`;
    return new Promise<RuntimeMatch[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingLocate.current.delete(requestId);
        reject(new Error("No response from the page — is the tab still open on the dev server?"));
      }, 10000);
      pendingLocate.current.set(requestId, { resolve, reject, timer });
      send({ type: "devbridge:locate-devids", requestId, devIds });
    });
  }

  useEffect(() => {
    if (!port) return;
    const listener = (msg: any) => {
      if (msg?.type === "devbridge:element-selected") {
        resetSelection(msg.devId ?? null, typeof msg.tag === "string" ? msg.tag : null);
        if (!msg.devId) {
          // Audit C4: only a DOM node was identified — explain instead of
          // fabricating a source location.
          flash(
            msg.tag
              ? `Selected <${msg.tag}> carries no DevBridge identity (no data-dev-id). Source mapping is unavailable for this element — it may be rendered by a path the build plugin did not instrument.`
              : `Selected element carries no DevBridge identity. Source mapping is unavailable.`,
            "warn",
          );
        } else if (prefsRef.current.autoLocateOnSelect) {
          send({ type: "devbridge:locate-element", devId: msg.devId });
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
      if (msg?.type === "devbridge:page-info") {
        setPageInfo({
          origin: typeof msg.origin === "string" ? msg.origin : "",
          url: typeof msg.url === "string" ? msg.url : "",
          instrumented: Boolean(msg.instrumented),
          identityCount: typeof msg.identityCount === "number" ? msg.identityCount : 0,
        });
      }
      if (msg?.type === "devbridge:locate-result" && typeof msg.requestId === "string") {
        const pending = pendingLocate.current.get(msg.requestId);
        if (pending) {
          pendingLocate.current.delete(msg.requestId);
          clearTimeout(pending.timer);
          const matches: RuntimeMatch[] = Array.isArray(msg.matches)
            ? msg.matches
                .filter((m: any) => m && typeof m.devId === "string" && typeof m.instances === "number")
                .map((m: any) => ({ devId: m.devId, instances: m.instances }))
            : [];
          setInstanceCounts((prev) => {
            const next = new Map(prev);
            for (const m of matches) next.set(m.devId, m.instances);
            return next;
          });
          pending.resolve(matches);
        }
      }
    };
    port.onMessage.addListener(listener);
    return () => port.onMessage.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, send]);

  // Audit C5: a new selection resets EVERYTHING from the previous one. The
  // old code kept `identity`/`source`, so a missing identity showed the
  // previous element's file and line under the new devId.
  function resetSelection(nextDevId: string | null, tag: string | null) {
    setDevId(nextDevId);
    setSelectedTag(tag);
    setIdentity(null);
    setSource("");
    setView("editor");
    setPatch(null);
    setCheckpoint(null);
    setSnapshot(null);
    setLocateState({ status: "idle" });
  }

  // Selecting a component from the Components view shares the same state —
  // the workspace then resolves its real identity and source.
  function selectComponent(nextDevId: string) {
    resetSelection(nextDevId, null);
    setComponentsFileFilter(null);
    setNav("inspect");
  }

  // ── fetch identity + source ──
  useEffect(() => {
    if (!devId) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await getIdentity(devId);
        if (cancelled) return;
        if (!id) {
          flash(identityMissingMessage(devId), "warn");
          return;
        }
        setIdentity(id);

        try {
          const content = await getSource(id.source.file);
          if (!cancelled) setSource(content);
        } catch (e: any) {
          // Batch 6: identity-hit + source-miss is the stale/wrong-root agent
          // signature (reproduced live) — diagnose it precisely instead of
          // claiming the agent is unreachable.
          const status = /-> (\d+)/.exec(e?.message ?? "")?.[1];
          if (!cancelled) flash(sourceFailureMessage(devId, id.source.file, status ? Number(status) : 0), "warn");
          return;
        }
      } catch (e: any) {
        if (!cancelled) flash(e?.message ?? "Couldn't reach local agent — run devbridge start", "err");
      }
    })();
    return () => { cancelled = true; };
  }, [devId]);

  // ── fetch latest state snapshot ──
  useEffect(() => {
    if (!devId) return;
    getStateSnapshot(devId).then((d) => d && setSnapshot(d));
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
            flash("Patch applied and saved to disk.", "ok");
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
  }, [source, view, identity]);

  // The workspace unmounts visually when another nav view is active
  // (display:none keeps Monaco's DOM alive); relayout on return so the
  // editor repaints at the real size instead of staying collapsed.
  useEffect(() => {
    if (nav !== "inspect") return;
    const t = requestAnimationFrame(() => {
      try {
        editorRef.current?.layout();
        diffEditorRef.current?.layout();
      } catch {
        /* editor not mounted yet */
      }
    });
    return () => cancelAnimationFrame(t);
  }, [nav]);

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
  }, [view, patch, source]);

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
      const p = await createPatch({ file: identity.source.file, newContent, devId });
      setPatch(p);

      // Mark previewed
      await previewPatch(p.id);

      // Inject CSS preview into running app via content script
      if (prefsRef.current.autoPreviewCss) {
        injectVisualPreview(identity.source.file, newContent);
      }

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
      const applied = await approveAndApply(patch.id);
      setPatch(applied);

      // Audit P7: the CSS live-preview tag mirrored the proposal; now that
      // disk holds the applied content the tag would only go stale on the
      // next edit cycle, so remove it here (reject path already does).
      revertVisualPreview();

      // Git checkpoint
      const cp = await createCheckpoint(`edit ${identity?.source.file} via DevBridge`);
      if (cp) setCheckpoint(cp);

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
    await rejectPatch(patch.id);
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
      await rollbackCheckpoint(checkpoint.sha);
      flash("Rolled back to previous commit.", "ok");
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

  const connection: ConnectionState = (() => {
    if (!agentReachable || !agentProject) return { kind: "no-agent" };
    if (!pageInfo) return { kind: "unknown-page" };
    if (!pageInfo.instrumented) return { kind: "uninstrumented" };
    if (agentProject.devServerUrl) {
      let expected = "";
      try {
        expected = new URL(agentProject.devServerUrl).origin;
      } catch {
        expected = agentProject.devServerUrl;
      }
      if (pageInfo.origin !== expected) {
        return { kind: "mismatch", expected, actual: pageInfo.origin };
      }
    }
    return { kind: "connected" };
  })();

  // ── Browser -> source -> VS Code (Phase 3+7) ──
  async function handleOpenInEditor() {
    if (!identity || !agentProject) return;
    await openFileInProject(identity.source.file, identity.source.start.line, identity.source.start.column);
  }

  async function openFileInProject(file: string, line: number, column: number) {
    if (!agentProject) {
      flash("Local agent unreachable — run devbridge start", "err");
      return;
    }
    setBusy(true);
    try {
      await openInEditor({ projectId: agentProject.id, file, line, column });
      flash(`Opened ${file}:${line} in VS Code`, "ok");
    } catch (e: any) {
      flash(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  // ── Source -> browser (Phase 4): all live instances of this file ──
  const [locateState, setLocateState] = useState<
    | { status: "idle" }
    | { status: "searching" }
    | { status: "done"; total: number; matches: RuntimeMatch[] }
  >({ status: "idle" });

  async function handleLocateFile() {
    if (!identity || !agentProject) return;
    setLocateState({ status: "searching" });
    try {
      const list = await getIdentities(fetch, identity.source.file);
      const devIds = [...new Set(list.map((i) => i.id))].slice(0, 200);
      if (devIds.length === 0) {
        setLocateState({ status: "done", total: 0, matches: [] });
        return;
      }
      const matches = await locateDevIds(devIds);
      const total = matches.reduce((n, m) => n + m.instances, 0);
      setLocateState({ status: "done", total, matches });
      if (total === 0) {
        flash("No live instances of this file — is the route or component mounted?", "warn");
      }
    } catch (e: any) {
      setLocateState({ status: "idle" });
      flash(e.message, "err");
    }
  }

  async function countVisibleInstances(devIds: string[]) {
    if (devIds.length === 0) return;
    try {
      await locateDevIds(devIds.slice(0, 200));
    } catch (e: any) {
      flash(e.message, "err");
    }
  }

  function viewIdentitiesForFile(file: string) {
    setComponentsFileFilter(file);
    setNav("components");
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────

  // A selection exists even when the element carries no identity (devId
  // null + tag): the panel must show its "no mapping" explanation, not the
  // empty state — otherwise the warning flash has nowhere to render.
  const hasSelection = devId !== null || selectedTag !== null;

  const connStrip = (() => {
    const dot = (color: string) => (
      <span style={{ ...S.statusDot, background: color }} aria-hidden="true" />
    );
    switch (connection.kind) {
      case "connected":
        return (
          <div style={S.connStrip}>
            {dot(C.green)}
            <span>
              {pageInfo!.identityCount} identities on page
              {liveStatus === "live" ? " · live" : liveStatus === "offline" ? " · state stream offline" : ""}
            </span>
          </div>
        );
      case "no-agent":
        return <div style={S.connStrip}>{dot(C.red)}<span>Local agent unreachable — run `devbridge start`, then Refresh.</span></div>;
      case "unknown-page":
        return <div style={S.connStrip}>{dot(C.dim)}<span>Waiting for page info — open the inspected tab on the dev server…</span></div>;
      case "uninstrumented":
        return <div style={S.connStrip}>{dot(C.dim)}<span>This page is not connected to a DevBridge development project.</span></div>;
      case "mismatch":
        return (
          <div style={S.connStrip}>
            {dot(C.amber)}
            <span>
              Page ({connection.actual || "unknown origin"}) doesn&apos;t match dev server ({connection.expected}). Source operations disabled.
            </span>
          </div>
        );
    }
  })();

  const canUseSource = connection.kind === "connected" && !!identity;

  const frameworkOf = identity?.framework ?? agentProject?.framework ?? null;
  const lineCol = identity
    ? `${identity.source.file}:${identity.source.start.line}:${identity.source.start.column + 1}`
    : "no source mapping";

  return (
    <div style={S.root}>
      <NavRail active={nav} onNavigate={(v) => { setNav(v); if (v !== "components") setComponentsFileFilter(null); }} />
      <div style={S.main}>
        <Header
          connection={connection}
          agentProject={agentProject}
          agentReachable={agentReachable}
          pageInfo={pageInfo}
          onRefresh={refreshConnection}
          onOpenSettings={() => setNav("settings")}
        />
        {connStrip}

        {/* ── Flash message ── */}
        {flashMsg && (
          <div style={{ ...S.notice, borderLeft: `2px solid ${flashMsg.kind === "ok" ? C.accent : flashMsg.kind === "err" ? C.red : C.amber}` }}>
            {flashMsg.text}
          </div>
        )}

        {/* Inspect view stays mounted (display:none) when another nav view
            is active so Monaco's DOM survives the switch. */}
        <div style={{ display: nav === "inspect" ? "contents" : "none" }} aria-hidden={nav !== "inspect"}>
          {!hasSelection ? (
            <InspectLanding
              inspecting={inspecting}
              connected={connected}
              invalidated={invalidated}
              onToggleInspect={() => toggleInspect(!inspecting)}
            />
          ) : (
            <div style={{ ...S.listView }}>
              {/* ── Selection workspace header ── */}
              <div style={S.selBar}>
                <div style={S.selMeta}>
                  <div style={S.componentName}>
                    {identity?.component ?? (devId ?? (selectedTag ? `<${selectedTag}> (no identity)` : "unknown"))}
                    {frameworkOf && <span style={{ fontWeight: 400, color: C.muted }}> · {frameworkOf}</span>}
                    {liveTag && <span style={{ ...S.ic, marginLeft: 8 }}>live</span>}
                  </div>
                  <div style={S.filePath} title={identity?.source.file ?? "No source mapping for this element"}>
                    {lineCol}
                  </div>
                </div>
                <div style={S.actionsRow}>
                  <button
                    className="db-btn"
                    style={S.btn}
                    onClick={() => toggleInspect(!inspecting)}
                    title={inspecting ? "Stop inspecting (or press Escape on the page)" : "Inspect another element"}
                    aria-label={inspecting ? "Stop inspecting" : "Inspect another element"}
                  >
                    {inspecting ? "Stop" : "Inspect"}
                  </button>
                  <button
                    className="db-btn"
                    style={S.btn}
                    onClick={() => devId && locateElement(devId)}
                    title={devId ? "Scroll to and highlight this element in the page" : "No element to locate"}
                    aria-label="Highlight element in page"
                    disabled={!devId}
                  >
                    Highlight
                  </button>
                  <button
                    className="db-btn db-btn-cyan"
                    style={{ ...S.btn, ...S.btnCyan, opacity: canUseSource && !busy ? 1 : 0.5 }}
                    onClick={() => void handleLocateFile()}
                    title={canUseSource ? "Find every live instance rendered from this file" : "Available on a connected project"}
                    aria-label="Locate instances in browser"
                    disabled={!canUseSource || locateState.status === "searching"}
                  >
                    {locateState.status === "searching" ? "Locating…" : "Locate"}
                  </button>
                  <button
                    className="db-btn db-btn-cyan"
                    style={{ ...S.btn, ...S.btnCyan, opacity: canUseSource && !busy ? 1 : 0.5 }}
                    onClick={() => void handleOpenInEditor()}
                    title={canUseSource ? `Open ${identity!.source.file}:${identity!.source.start.line} in VS Code` : "Select an instrumented element on a connected project to open it in VS Code"}
                    aria-label="Open source in VS Code"
                    disabled={!canUseSource || busy}
                  >
                    Open in VS Code
                  </button>
                  <button
                    className="db-btn"
                    style={S.btn}
                    onClick={() => { resetSelection(null, null); toggleInspect(false); }}
                    title="Clear selection"
                    aria-label="Clear selection"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* ── Tab strip ── */}
              <div style={S.tabStrip} role="tablist" aria-label="Source views">
                {(["editor", "diff", "applied"] as EditorTab[]).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    className="db-tab"
                    style={{ ...S.tab, ...(view === v ? S.tabActive : {}) }}
                    onClick={() => setView(v)}
                    disabled={(v === "diff" && !patch) || (v === "applied" && !checkpoint)}
                  >
                    {v === "editor" ? "Edit" : v === "diff" ? "Diff" : "Applied"}
                  </button>
                ))}
              </div>

              {/* ══════════════ EDITOR VIEW ══════════════ */}
              {view === "editor" && (
                <div style={S.editorWrapper}>
                  {!devId ? (
                    <div style={S.monacoPlaceholder}>
                      No DevBridge identity for this element.
                      <span style={{ fontSize: 11, color: C.muted }}>
                        {selectedTag ? `<${selectedTag}> carries no data-dev-id, so there is no component or source file to show. ` : ""}
                        Select an instrumented element, or press Inspect to try again.
                      </span>
                    </div>
                  ) : window.monaco ? (
                    <div ref={monacoContainerRef} style={S.monacoContainer} />
                  ) : (
                    <div style={S.monacoPlaceholder}>
                      Loading editor…
                      <span style={{ fontSize: 11, color: C.muted }}>
                        Make sure panel.html includes the Monaco loader script.
                      </span>
                    </div>
                  )}
                  <div style={S.editorFooter}>
                    <RiskBadge patch={patch} />
                    <div style={{ flex: 1 }} />
                    <button
                      className="db-btn db-btn-primary"
                      style={{ ...S.btn, ...S.btnPrimary, opacity: busy ? 0.6 : 1 }}
                      onClick={() => void handleCreatePatch()}
                      disabled={busy || !source}
                    >
                      {busy ? "Working…" : "Preview diff"}
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
                    <summary className="db-summary" style={{ cursor: "pointer", color: C.muted, fontSize: 11, padding: "6px 12px" }}>
                      Raw unified diff
                    </summary>
                    <pre style={S.rawDiff}>{patch.diff}</pre>
                  </details>

                  {/* Action bar */}
                  <div style={S.actionBar}>
                    <button className="db-btn" style={{ ...S.btn, ...S.btnDanger, opacity: busy ? 0.6 : 1 }} onClick={() => void handleReject()} disabled={busy}>
                      Reject
                    </button>
                    <button
                      className="db-btn db-btn-primary"
                      style={{ ...S.btn, ...S.btnPrimary, opacity: busy ? 0.6 : 1 }}
                      onClick={() => void handleApprove()}
                      disabled={busy}
                    >
                      {busy ? "Applying…" : "Approve and apply"}
                    </button>
                  </div>
                </div>
              )}

              {/* ══════════════ APPLIED VIEW ══════════════ */}
              {view === "applied" && patch && (
                <div style={{ padding: 16, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6 }}>
                    <div style={{ fontWeight: 600 }}>Patch applied</div>
                    <span style={{ ...S.ic }}>{patch.status}</span>
                  </div>
                  <div style={{ color: C.muted, fontSize: 12, fontFamily: MONO_FONT, marginBottom: 12 }}>{patch.file} written to disk</div>

                  {checkpoint && (
                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                      <div style={{ color: C.muted, fontSize: 11, marginBottom: 4 }}>Git checkpoint</div>
                      <div style={{ fontFamily: MONO_FONT, fontSize: 12 }}>{checkpoint.sha.slice(0, 7)} — {checkpoint.message}</div>
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{new Date(checkpoint.timestamp).toLocaleTimeString()}</div>
                      <button
                        className="db-btn"
                        style={{ ...S.btn, marginTop: 10, opacity: busy ? 0.6 : 1 }}
                        onClick={() => void handleRollback()}
                        disabled={busy}
                      >
                        {busy ? "Rolling back…" : "Roll back this commit"}
                      </button>
                    </div>
                  )}

                  <button
                    className="db-btn"
                    style={{ ...S.btn, marginTop: 16 }}
                    onClick={() => { setView("editor"); setPatch(null); setCheckpoint(null); }}
                  >
                    Back to editor
                  </button>
                </div>
              )}

              {/* ══════════════ LOWER SECTIONS ══════════════ */}
              <div style={S.lowerSections}>
                <details style={S.disclosure} open={locateState.status === "done" && locateState.total > 0}>
                  <summary className="db-summary" style={S.disclosureSummary}>
                    Component instances
                    {locateState.status === "done" && (
                      <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 8 }}>
                        {locateState.total === 0
                          ? "— 0 live"
                          : `— ${locateState.total} live`}
                      </span>
                    )}
                  </summary>
                  <div style={S.disclosureBody}>
                    {locateState.status === "done" && locateState.total > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {locateState.matches
                          .filter((m) => m.instances > 0)
                          .map((m) => (
                            <div key={m.devId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                              <code style={S.ic}>{m.devId}</code>
                              <span style={{ color: C.muted }}>× {m.instances}</span>
                              <button
                                className="db-btn"
                                style={{ ...S.btn, padding: "2px 8px", fontSize: 11 }}
                                onClick={() => locateElement(m.devId)}
                                title={`Scroll to an instance of ${m.devId}`}
                              >
                                Highlight
                              </button>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div style={{ color: C.muted, fontSize: 11 }}>
                        {locateState.status === "searching"
                          ? "Searching the page…"
                          : "Press Locate above to count live instances of this file."}
                      </div>
                    )}
                  </div>
                </details>

                <details style={{ ...S.disclosure, borderBottom: "none" }} open>
                  <summary className="db-summary" style={S.disclosureSummary}>
                    Props &amp; state
                    {liveTag && <span style={{ ...S.ic, marginLeft: 8 }}>live</span>}
                    {liveStatus === "offline" && (
                      <span style={{ ...S.ic, marginLeft: 8 }} title="Local agent unreachable — retrying">
                        offline
                      </span>
                    )}
                  </summary>
                  <div style={S.disclosureBody}>
                    {snapshot ? (
                      <>
                        <SnapshotTable label="Props"   data={snapshot.props} />
                        <SnapshotTable label="State"   data={snapshot.state} />
                        <SnapshotTable label="Context" data={snapshot.context} />
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
                </details>
              </div>
            </div>
          )}
        </div>

        {nav === "components" && (
          <ComponentsView
            agentReachable={agentReachable}
            selectedDevId={devId}
            instanceCounts={instanceCounts}
            onSelect={selectComponent}
            onHighlight={locateElement}
            onCountVisible={(ids) => void countVisibleInstances(ids)}
            initialFileFilter={componentsFileFilter}
          />
        )}

        {nav === "files" && (
          <FilesView
            agentReachable={agentReachable && connection.kind === "connected"}
            onOpenFile={(file, line, column) => void openFileInProject(file, line, column)}
            onViewIdentities={viewIdentitiesForFile}
          />
        )}

        {nav === "settings" && (
          <SettingsView
            connection={connection}
            agentProject={agentProject}
            agentReachable={agentReachable}
            pageInfo={pageInfo}
            liveStatus={liveStatus}
            prefs={prefs}
            onPrefsChange={updatePrefs}
            onRefresh={refreshConnection}
          />
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
  return (
    <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO_FONT }}>
      risk: {patch.risk}
    </span>
  );
}

function RiskBanner({ patch }: { patch: SourcePatch }) {
  const edge: Record<string, string> = { low: C.accent, medium: C.amber, high: C.red };
  return (
    <div style={{ borderLeft: `2px solid ${edge[patch.risk] ?? C.border}`, padding: "6px 12px", fontSize: 12, background: C.bg2, color: C.text }}>
      <span style={{ fontWeight: 600, marginRight: 8 }}>
        {patch.risk} risk
      </span>
      <span style={{ color: C.muted }}>{patch.riskReasons.join(" · ")}</span>
    </div>
  );
}

function SnapshotTable({ label, data }: { label: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (!entries.length) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: C.muted, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: C.muted, paddingRight: 10, fontSize: 11, whiteSpace: "nowrap", verticalAlign: "top", paddingBottom: 2, fontFamily: MONO_FONT }}>{k}</td>
              <td style={{ color: C.text, fontSize: 11, wordBreak: "break-all", paddingBottom: 2, fontFamily: MONO_FONT }}>{fmt(v)}</td>
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
