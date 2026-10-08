import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { EventBus } from "./eventBus";

/**
 * Socket-level regression coverage for Batch 3 §3: invalid frames never
 * crash the server, never reach healthy clients, and never close unrelated
 * sockets. Only the offending frame is dropped (with a structured error
 * back to its own sender); only a protocol-level oversize frame closes its
 * own socket per RFC 6455.
 */

let server: Server;
let bus: EventBus;
let url = "";
let received: { type: string; payload: unknown }[];

function connect(path: string, origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}${path}`, { headers: origin ? { Origin: origin } : {} });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

beforeEach(async () => {
  bus = new EventBus();
  received = [];
  server = createServer();
  bus.attach(
    server,
    (raw, reply) => {
      // Minimal harness mirror of the agent wiring: only re-broadcast what a
      // validator would accept (frames shaped like the real valid frame).
      try {
        const msg = JSON.parse(raw) as { type: string };
        if (msg.type === "state.changed" || msg.type === "component.render") {
          received.push(msg as { type: string; payload: unknown });
          bus.broadcast(msg.type as "state.changed", {});
        } else {
          reply(JSON.stringify({ type: "devbridge:error", code: "invalid-frame" }));
        }
      } catch {
        reply(JSON.stringify({ type: "devbridge:error", code: "invalid-json" }));
      }
    },
    { isOriginAllowed: (origin) => origin !== "https://evil.example", runtimeMaxPayload: 1024 },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  url = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("EventBus runtime isolation", () => {
  it("rejects evil origins at upgrade", async () => {
    await expect(connect("/runtime", "https://evil.example")).rejects.toThrow();
  });

  it("bad frames get an error reply, never reach subscribers, socket survives", async () => {
    const runtime = await connect("/runtime");
    const events = await connect("/events");
    const eventsMessages: string[] = [];
    events.on("message", (d) => eventsMessages.push(d.toString()));
    const reply = nextMessage(runtime);

    runtime.send("{broken json");
    expect(JSON.parse(await reply)).toMatchObject({ type: "devbridge:error", code: "invalid-json" });

    runtime.send(JSON.stringify({ type: "nope.unknown" }));
    expect(JSON.parse(await nextMessage(runtime))).toMatchObject({
      type: "devbridge:error",
      code: "invalid-frame",
    });

    // The socket is still usable, and subscribers saw nothing of the garbage.
    runtime.send(JSON.stringify({ type: "state.changed", devId: "dvi_x", payload: {} }));
    expect(JSON.parse(await nextMessage(events)).type).toBe("state.changed");
    expect(eventsMessages).toHaveLength(1);

    runtime.close();
    events.close();
  });

  it("an oversized frame closes only its own socket (1009); others unaffected", async () => {
    const offender = await connect("/runtime");
    const healthy = await connect("/events");
    const closed = new Promise<number>((resolve) => {
      offender.once("close", (code) => resolve(code));
    });
    const healthyMessages: string[] = [];
    healthy.on("message", (d) => healthyMessages.push(d.toString()));

    offender.send("x".repeat(2048)); // over the 1024 test cap
    expect(await closed).toBe(1009);

    bus.broadcast("state.changed", { hello: 1 });
    expect(JSON.parse(await nextMessage(healthy)).type).toBe("state.changed");
    healthy.close();
  });

  it("a dead subscriber never starves the living (broadcast isolation)", async () => {
    const dying = await connect("/events");
    const living = await connect("/events");
    dying.terminate(); // simulate a hard-dropped client still in the set
    await new Promise((r) => setTimeout(r, 50));
    bus.broadcast("state.changed", { n: 1 });
    expect(JSON.parse(await nextMessage(living)).type).toBe("state.changed");
    living.close();
  });

  it("a burst of garbage followed by a valid frame still works", async () => {
    const runtime = await connect("/runtime");
    // Persistent listener attached BEFORE sending: replies may arrive before
    // a per-message `once` could be attached (loopback is fast), which would
    // shift one-shot waiters and hang the last one.
    const replies: string[] = [];
    runtime.on("message", (d) => replies.push(d.toString()));
    for (let i = 0; i < 20; i++) runtime.send(`garbage-${i} {{{`);
    await vi.waitFor(() => expect(replies).toHaveLength(20), { timeout: 5000 });
    expect(replies.map((r) => JSON.parse(r).type)).toEqual(
      Array(20).fill("devbridge:error"),
    );
    runtime.send(JSON.stringify({ type: "state.changed", devId: "dvi_x", payload: {} }));
    // The valid frame is processed asynchronously — wait for the effect,
    // then close the socket so afterEach's server.close() can complete.
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0), { timeout: 5000 });
    runtime.close();
  });
});
