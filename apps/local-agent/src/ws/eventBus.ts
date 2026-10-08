import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { MAX_WS_FRAME_BYTES, type DevBridgeEvent, type DevBridgeEventType } from "@devbridge/protocol";

/**
 * Two independent WS endpoints, matching the two directions of traffic in
 * the architecture doc:
 *
 *   /events  — agent -> DevTools panel / CLI (file.changed, patch.applied, ...)
 *   /runtime — browser app (adapter-react/runtimeHook.ts) -> agent
 *              (component.render, state.changed) which the agent re-broadcasts
 *              on /events so the panel can show live state.
 */
export interface EventBusAttachOptions {
  /**
   * Gate for the HTTP `Origin` header on the upgrade request. Defaults to
   * allowing everything, which is only appropriate for callers that have their
   * own gate — the local agent passes the same origin policy it applies to its
   * HTTP routes (docs/audit/2026-10-05-audit.md, S4).
   */
  isOriginAllowed?: (origin: string | undefined) => boolean;
  /**
   * Per-message cap for /runtime frames. A frame beyond this closes THAT
   * socket with code 1009 (RFC 6455) — healthy clients are untouched. The
   * application-level validator (ws/runtime.ts) additionally rejects
   * overweight-but-under-cap frames without closing anything.
   */
  runtimeMaxPayload?: number;
}

/** Inbound runtime bytes plus a best-effort reply channel to the sender. */
export type RuntimeMessageHandler = (raw: string, reply: (message: string) => void) => void;

export class EventBus {
  private clients = new Set<WebSocket>();
  private wssEvents!: WebSocketServer;
  private wssRuntime!: WebSocketServer;

  attach(
    server: HttpServer,
    onRuntimeMessage: RuntimeMessageHandler,
    options: EventBusAttachOptions = {},
  ): void {
    const isOriginAllowed = options.isOriginAllowed ?? (() => true);
    const runtimeMaxPayload = options.runtimeMaxPayload ?? MAX_WS_FRAME_BYTES;
    this.wssEvents = new WebSocketServer({ noServer: true });
    this.wssRuntime = new WebSocketServer({ noServer: true, maxPayload: runtimeMaxPayload });

    server.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";
      if (!url.startsWith("/events") && !url.startsWith("/runtime")) {
        socket.destroy();
        return;
      }
      // A browser always sends Origin on a WebSocket handshake. Without this
      // check any page the developer visits could subscribe to /events (reading
      // every broadcast) or post forged runtime frames to /runtime.
      if (!isOriginAllowed(req.headers.origin)) {
        socket.destroy();
        return;
      }
      const target = url.startsWith("/events") ? this.wssEvents : this.wssRuntime;
      target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
    });

    this.wssEvents.on("connection", (ws) => {
      this.clients.add(ws);
      // Protocol-level failures (e.g. a >maxPayload frame) surface as
      // 'error' AND a close; without this noop the EventEmitter throws and
      // takes down the process (Batch 3 §3: invalid frames must not crash
      // the server). Cleanup still happens on 'close'.
      ws.on("error", () => {});
      ws.on("close", () => this.clients.delete(ws));
    });

    this.wssRuntime.on("connection", (ws) => {
      ws.on("error", () => {});
      // A throwing or slow receiver must never take down unrelated clients:
      // each frame is independent, and send failures drop only that socket.
      ws.on("message", (data) => {
        const reply = (message: string): void => {
          try {
            if (ws.readyState === ws.OPEN) ws.send(message);
          } catch {
            /* sender already gone — nothing to tell */
          }
        };
        try {
          onRuntimeMessage(data.toString(), reply);
        } catch {
          // A buggy handler must not kill the connection, let alone the
          // process. The frame is dropped; the socket stays usable.
        }
      });
    });
  }

  broadcast<T>(type: DevBridgeEventType, payload: T): void {
    const event: DevBridgeEvent<T> = { type, timestamp: new Date().toISOString(), payload };
    const serialized = JSON.stringify(event);
    for (const client of [...this.clients]) {
      try {
        if (client.readyState === client.OPEN) client.send(serialized);
        else this.clients.delete(client);
      } catch {
        // One dead socket must not starve the remaining subscribers.
        this.clients.delete(client);
      }
    }
  }
}
