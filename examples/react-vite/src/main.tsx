import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

/**
 * Plain React entry point for the example app.
 * The runtime bridge is initialised inside CheckoutButton directly
 * so we don't need any workspace package imports here.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
