/**
 * runtimeHook.ts — runtime bridge for Props/State/Context inspector.
 *
 * How it works:
 *   1. The Vite plugin auto-imports connectRuntimeBridge() and calls it once.
 *   2. Components call useDevBridgeReporter(devId) and pass their
 *      props/state/context on every render — zero Fiber introspection needed.
 *   3. Messages go over WebSocket to the local agent's /runtime endpoint.
 *   4. The agent stores the latest StateSnapshot per devId and serves it via
 *      GET /state/:devId — the DevTools panel polls/subscribes to this.
 */

export interface DevBridgeRuntimeMessage {
  type: "state.changed" | "component.render";
  devId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectRuntimeBridge(agentWsUrl = "ws://localhost:4577/runtime"): void {
  if (typeof window === "undefined") return;
  if (socket && socket.readyState === WebSocket.OPEN) return;

  socket = new WebSocket(agentWsUrl);

  socket.onopen = () => {
    console.debug("[DevBridge] runtime bridge connected");
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  socket.onclose = () => {
    socket = null;
    reconnectTimer = setTimeout(() => connectRuntimeBridge(agentWsUrl), 2000);
  };

  socket.onerror = () => {
    // onerror always fires before onclose — let onclose handle reconnect.
    socket = null;
  };
}

function send(msg: DevBridgeRuntimeMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try { socket.send(JSON.stringify(msg)); } catch { /* tab closing, ignore */ }
}

export function reportRender(
  devId: string,
  durationMs: number,
  reason: string,
): void {
  send({ type: "component.render", devId, payload: { durationMs, reason }, timestamp: new Date().toISOString() });
}

export function reportState(
  devId: string,
  props: unknown,
  state: unknown,
  context: unknown = {},
): void {
  send({
    type: "state.changed",
    devId,
    payload: { props, state, context },
    timestamp: new Date().toISOString(),
  });
}

/**
 * useDevBridgeReporter(devId)
 *
 * Drop into any component in development:
 *
 *   const { reportState } = useDevBridgeReporter("dvi_abc123");
 *   // call reportState(props, { loading }, {}) inside a useEffect that
 *   // re-runs whenever props/state change.
 *
 * The devId comes from the data-dev-id that the Babel plugin stamped on the
 * component's root DOM element — pass it via a ref or a constant.
 */
export function useDevBridgeReporter(devId: string) {
  return {
    reportState: (props: unknown, state: unknown, context: unknown = {}) =>
      reportState(devId, props, state, context),
    reportRender: (durationMs: number, reason = "state-changed") =>
      reportRender(devId, durationMs, reason),
  };
}
