import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { ProjectManager } from "./ProjectManager";
import { StateStore } from "./StateStore";
import { originAllowlistFromEnv, isAllowedOrigin } from "./originPolicy";
import { EventBus } from "./ws/eventBus";
import { handleRuntimeFrame, runtimeErrorEnvelope } from "./ws/runtime";
import { projectRoutes } from "./routes/project";
import { sourceRoutes } from "./routes/source";
import { filesRoutes } from "./routes/files";
import { editorRoutes } from "./routes/editor";
import { patchRoutes } from "./routes/patch";
import { gitRoutes } from "./routes/git";
import { stateRoutes } from "./routes/state";

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

/**
 * Loopback only. `server.listen(port)` with no host binds every interface,
 * which put the project filesystem on the network (docs/audit/2026-10-05-audit.md,
 * S1). Override for a container that genuinely needs a wider bind — but pair it
 * with an explicit DEVBRIDGE_ALLOWED_ORIGINS, because the origin policy is the
 * only thing standing between a stray page and your source tree.
 */
const HOST = process.env.DEVBRIDGE_HOST ?? "127.0.0.1";
const PROJECT_ROOT = process.env.DEVBRIDGE_PROJECT_ROOT ?? process.cwd();

const ORIGIN_ALLOWLIST = originAllowlistFromEnv();
const isOriginAllowed = (origin: string | undefined): boolean =>
  isAllowedOrigin(origin, ORIGIN_ALLOWLIST);

const project = new ProjectManager(PROJECT_ROOT);
const states = new StateStore();
const events = new EventBus();

const app = express();
app.use(
  cors({
    // No `origin: "*"`. The agent can write to the developer's source files,
    // so only the extension, the inspected app's own origin, and non-browser
    // Node clients (CLI, Vite plugin — which send no Origin) may call it.
    origin(origin, callback) {
      callback(null, isOriginAllowed(origin));
    },
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["content-type"],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: "5mb" }));

app.use(projectRoutes(project, events));
app.use(sourceRoutes(project));
app.use(filesRoutes(project));
app.use(editorRoutes(project));
app.use(patchRoutes(project, events));
app.use(gitRoutes(project));
app.use(stateRoutes(states));  // ← new

// Liveness probe. Deliberately does not echo the project root: this endpoint is
// the one route a stranger can safely be told about, and a filesystem path is
// not part of that answer. `/project` remains the route that reports the root.
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = createServer(app);

/**
 * Runtime WS (browser app → agent): validate every frame (ws/runtime.ts),
 * persist valid state snapshots so GET /state/:devId can serve them
 * synchronously, and re-broadcast valid frames on the /events bus so the
 * panel sees live updates without polling. Rejected frames get a
 * content-free error reply on their own socket; nothing is broadcast and
 * nothing is ingested.
 */
events.attach(
  server,
  (raw, reply) => {
    const result = handleRuntimeFrame(raw);
    if (!result.ok) {
      reply(runtimeErrorEnvelope(result.code, result.detail));
      return;
    }
    if (result.snapshot) states.ingest(result.snapshot);
    events.broadcast(result.frame.type, { devId: result.frame.devId, ...result.frame.payload });
  },
  { isOriginAllowed },
);

server.listen(PORT, HOST, () => {
  console.log(`[DevBridge] local agent listening on http://${HOST}:${PORT}`);
  console.log(`[DevBridge] project root: ${PROJECT_ROOT}`);
  console.log(`[DevBridge] allowed origins: ${ORIGIN_ALLOWLIST.join(", ")}`);
});
