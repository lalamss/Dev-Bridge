import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/**
 * Plain React entry point for the example app.
 * DevBridge instrumentation is injected automatically by
 * devbridgePlugin() in vite.config.ts — no manual attributes here.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
