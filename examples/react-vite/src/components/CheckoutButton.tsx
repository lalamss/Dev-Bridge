import { useEffect, useRef, useState } from "react";

/**
 * CheckoutButton — demo component for testing the DevBridge panel.
 *
 * In this standalone version the runtime bridge is inlined so the example
 * works without the workspace packages being pre-compiled. The full version
 * (with @devbridge/adapter-react/runtimeHook) is used once the monorepo
 * packages are built via `pnpm build`.
 *
 * data-dev-id is set manually here for testing — in a real app the Babel
 * plugin injects this automatically on every JSX host element.
 */

// ── Inline runtime bridge (no workspace import needed) ──────────────────────
const AGENT = "http://localhost:4577";
const AGENT_WS = "ws://localhost:4577/runtime";
let _ws: WebSocket | null = null;

function getSocket(): WebSocket | null {
  if (_ws && _ws.readyState === WebSocket.OPEN) return _ws;
  try {
    _ws = new WebSocket(AGENT_WS);
    _ws.onclose = () => { _ws = null; };
  } catch { _ws = null; }
  return _ws;
}

// Stable Dev Identity. The agent validates this against /^dvi_[a-f0-9]+$/,
// so it has to be hex — the Babel plugin would normally derive it from
// file + line, but here it is written by hand.
const DEV_ID = "dvi_a1b2c3d4e5f6";

const IDENTITY = {
  id: DEV_ID,
  framework: "react",
  component: "CheckoutButton",
  source: {
    file: "src/components/CheckoutButton.tsx",
    start: { line: 92, column: 5 },
    end: { line: 106, column: 6 },
  },
  parentId: null,
};

/**
 * Publish the component map to the agent. Without the Vite Babel plugin
 * nothing else registers this identity, so the panel's GET /identity/:id
 * would 404 and it couldn't show a name or a source location.
 */
function publishIdentity() {
  fetch(`${AGENT}/identity/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identities: [IDENTITY] }),
  }).catch(() => {
    // Agent isn't running — the example still works, the panel just warns.
  });
}

function reportState(devId: string, props: unknown, state: unknown, context: unknown = {}) {
  const ws = getSocket();
  if (!ws) return;
  const frame = JSON.stringify({
    type: "state.changed",
    devId,
    payload: { props, state, context },
    timestamp: new Date().toISOString(),
  });
  ws.addEventListener("open", () => ws.send(frame), { once: true });
  if (ws.readyState === WebSocket.OPEN) ws.send(frame);
}
// ─────────────────────────────────────────────────────────────────────────────

export function CheckoutButton({
  amount,
  productId = "prod_demo",
}: {
  amount: number;
  productId?: string;
}) {
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [orderCount, setOrderCount] = useState(0);

  // Register this component with the local agent on mount.
  useEffect(() => {
    publishIdentity();
  }, []);

  // Report live props + state to DevBridge on every render
  useEffect(() => {
    reportState(
      DEV_ID,
      { amount, productId },
      { loading, error, orderCount },
      { env: "development" },
    );
  });

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 1200));
      setOrderCount((n) => n + 1);
    } catch (e: any) {
      setError(e.message ?? "unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "inline-block" }}>
      {/* data-dev-id manually set here for testing — Babel plugin auto-injects this in real apps */}
      <button
        data-dev-id={DEV_ID}
        disabled={loading}
        onClick={handleCheckout}
        style={{
          background: loading ? "#4338ca" : error ? "#b91c1c" : "#2563eb",
          color: "white",
          padding: "10px 24px",
          borderRadius: 8,
          border: "none",
          fontSize: 16,
          cursor: loading ? "wait" : "pointer",
          transition: "background 0.2s",
        }}
      >
        {loading ? "Processing…" : error ? `Error: ${error}` : `Checkout — $${amount.toFixed(2)}`}
      </button>
      {orderCount > 0 && (
        <div style={{ marginTop: 8, color: "#22c55e", fontSize: 13 }}>
          ✅ {orderCount} order{orderCount > 1 ? "s" : ""} placed
        </div>
      )}
    </div>
  );
}
