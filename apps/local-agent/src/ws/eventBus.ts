import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { DevBridgeEvent, DevBridgeEventType } from "@devbridge/protocol";

/**
 * Two independent WS endpoints, matching the two directions of traffic in
 * the architecture doc:
 *
 *   /events  — agent -> DevTools panel / CLI (file.changed, patch.applied, ...)
 *   /runtime — browser app (adapter-react/runtimeHook.ts) -> agent
 *              (component.render, state.changed) which the agent re-broadcasts
 *              on /events so the panel can show live state.
 */
export class EventBus {
  private clients = new Set<WebSocket>();
  private wssEvents!: WebSocketServer;
  private wssRuntime!: WebSocketServer;

  attach(server: HttpServer, onRuntimeMessage: (raw: string) => void): void {
    this.wssEvents = new WebSocketServer({ noServer: true });
    this.wssRuntime = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";
      if (url.startsWith("/events")) {
        this.wssEvents.handleUpgrade(req, socket, head, (ws) => this.wssEvents.emit("connection", ws, req));
      } else if (url.startsWith("/runtime")) {
        this.wssRuntime.handleUpgrade(req, socket, head, (ws) => this.wssRuntime.emit("connection", ws, req));
      } else {
        socket.destroy();
      }
    });

    this.wssEvents.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
    });

    this.wssRuntime.on("connection", (ws) => {
      ws.on("message", (data) => onRuntimeMessage(data.toString()));
    });
  }

  broadcast<T>(type: DevBridgeEventType, payload: T): void {
    const event: DevBridgeEvent<T> = { type, timestamp: new Date().toISOString(), payload };
    const serialized = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(serialized);
    }
  }
}
