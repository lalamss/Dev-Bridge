import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { ProjectManager } from "./ProjectManager";
import { StateStore } from "./StateStore";
import { EventBus } from "./ws/eventBus";
import { projectRoutes } from "./routes/project";
import { sourceRoutes } from "./routes/source";
import { patchRoutes } from "./routes/patch";
import { gitRoutes } from "./routes/git";
import { stateRoutes } from "./routes/state";
import type { StateSnapshot } from "@devbridge/protocol";

/**
 * Local Dev Agent — architecture doc sections 48-50.
 *
 * Both the Chrome extension's DevTools panel and the `devbridge` CLI talk to
 * this exact same HTTP + WebSocket surface.
 *
 * New in this version: StateStore + /state routes for the
 * Props/State/Context inspector (section 21-25).
 */

const PORT = Number(process.env.DEVBRIDGE_PORT ?? 4577);
const PROJECT_ROOT = process.env.DEVBRIDGE_PROJECT_ROOT ?? process.cwd();

const project = new ProjectManager(PROJECT_ROOT);
const states = new StateStore();
const events = new EventBus();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.use(projectRoutes(project, events));
app.use(sourceRoutes(project));
app.use(patchRoutes(project, events));
app.use(gitRoutes(project));
app.use(stateRoutes(states));  // ← new

app.get("/health", (_req, res) => res.json({ ok: true, root: PROJECT_ROOT }));

const server = createServer(app);

/**
 * Runtime WS (browser app → agent):
 *   - Parse the "state.changed" / "component.render" messages from runtimeHook.ts
 *   - Persist to StateStore so GET /state/:devId can serve them synchronously
 *   - Re-broadcast on the /events bus so the panel sees live updates without polling
 */
events.attach(server, (raw) => {
  try {
    const msg = JSON.parse(raw) as {
      type: string;
      devId: string;
      payload: Record<string, unknown>;
      timestamp?: string;
    };

    // Persist state snapshots
    if (msg.type === "state.changed" && msg.devId) {
      const snapshot: StateSnapshot = {
        devId: msg.devId,
        props: (msg.payload.props as Record<string, unknown>) ?? {},
        state: (msg.payload.state as Record<string, unknown>) ?? {},
        context: (msg.payload.context as Record<string, unknown>) ?? {},
        timestamp: msg.timestamp ?? new Date().toISOString(),
      };
      states.ingest(snapshot);
    }

    // Always re-broadcast so the panel's WS listener gets it live
    events.broadcast(msg.type as any, { devId: msg.devId, ...msg.payload });
  } catch {
    // Ignore malformed runtime messages rather than crashing the agent.
  }
});

server.listen(PORT, () => {
  console.log(`[DevBridge] local agent listening on http://localhost:${PORT}`);
  console.log(`[DevBridge] project root: ${PROJECT_ROOT}`);
});
