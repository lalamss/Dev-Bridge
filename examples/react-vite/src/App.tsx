import { CheckoutButton } from "./components/CheckoutButton";

/**
 * Ordinary React app — no DevBridge-specific code needed here at all. Open
 * this page with `pnpm example`, load the unpacked chrome-extension, open
 * DevTools -> DevBridge, click "Start inspecting", then click the button
 * below (architecture doc section 59-60).
 */
export function App() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 40 }}>
      <h1>DevBridge example app</h1>
      <CheckoutButton amount={49.99} />
    </main>
  );
}
