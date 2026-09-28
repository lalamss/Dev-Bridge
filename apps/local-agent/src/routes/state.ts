/**
 * state.ts — Props/State/Context inspector routes.
 *
 * The runtime bridge (adapters/react/runtimeHook.ts) pushes
 * "state.changed" messages over the /runtime WebSocket. The EventBus in
 * index.ts re-broadcasts them on /events AND calls project.states.ingest()
 * so this HTTP route can serve the latest snapshot synchronously.
 *
 * Routes:
 *   GET  /state/:devId          — latest snapshot for one element
 *   GET  /state/:devId/history  — all snapshots (most recent first)
 *   DELETE /state/:devId        — clear stored snapshots for a devId
 */

import { Router } from "express";
import type { StateSnapshot } from "@devbridge/protocol";
import type { StateStore } from "../StateStore";

export function stateRoutes(states: StateStore): Router {
  const router = Router();

  // Latest snapshot — panel polls this whenever devId changes.
  router.get("/state/:devId", (req, res) => {
    const snapshot = states.latest(req.params.devId);
    if (!snapshot) return res.status(404).json({ error: "no state snapshot yet for this element" });
    res.json(snapshot);
  });

  // Full history — useful for debugging re-render chains.
  router.get("/state/:devId/history", (req, res) => {
    res.json(states.history(req.params.devId));
  });

  // Let the panel clear stale snapshots when a new element is selected.
  router.delete("/state/:devId", (req, res) => {
    states.clear(req.params.devId);
    res.status(204).end();
  });

  return router;
}
