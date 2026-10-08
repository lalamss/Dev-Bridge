import { describe, expect, it } from "vitest";
import { ReactAdapter } from "./ReactAdapter";
import type { DevIdentity } from "@devbridge/protocol";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §C2/C4.
 *
 * Hover highlighting and element selection only work for elements carrying a
 * `data-dev-id`. These tests pin the transform contract the inspection
 * workflow depends on: host elements are tagged, custom components are not
 * (documented limitation — see below), component names are captured, and
 * re-transforming a file never creates phantom registry entries.
 */

const APP_TSX = `export function App() {
  return (
    <main>
      <h1>DevBridge example app</h1>
      <CheckoutButton amount={49.99} />
    </main>
  );
}
`;

function transform(file: string, code: string) {
  const adapter = new ReactAdapter();
  return adapter.transformSource({ file, code });
}

describe("devIdentityBabelPlugin", () => {
  it("tags every host JSX element with a data-dev-id", () => {
    const { code, identities } = transform("src/App.tsx", APP_TSX);
    // <main> + <h1>; <CheckoutButton> is a custom component, not a host.
    expect(identities).toHaveLength(2);
    expect(code).toContain('data-dev-id="dvi_');
    for (const identity of identities) {
      expect(identity.id).toMatch(/^dvi_[a-f0-9]+$/);
    }
  });

  it("does not tag custom (capitalized) components — host-only mapping", () => {
    const { code, identities } = transform("src/App.tsx", APP_TSX);
    expect(code).not.toMatch(/CheckoutButton[^>]*data-dev-id/);
    // DOCUMENTED LIMITATION (audit C4): DevBridge maps the host elements a
    // component renders, not component instances. Two instances of the same
    // component produce independent host-element ids; there is no mapping
    // from a live DOM node back to "the second <CheckoutButton>".
    expect(identities.every((i) => i.component === "App")).toBe(true);
  });

  it("records the lexically enclosing component and source location", () => {
    const { identities } = transform("src/App.tsx", APP_TSX);
    const h1 = identities.find((i) => i.source.start.line === 4);
    expect(h1?.component).toBe("App");
    expect(h1?.source.file).toBe("src/App.tsx");
    expect(h1?.parentId).not.toBeNull(); // nested inside <main>
  });

  it("links nested identities to their parent element", () => {
    const { identities } = transform("src/App.tsx", APP_TSX);
    const main = identities.find((i) => i.source.start.line === 3)!;
    const h1 = identities.find((i) => i.source.start.line === 4)!;
    expect(h1.parentId).toBe(main.id);
    expect(main.parentId).toBeNull();
  });

  it("is idempotent: re-transforming adds no attribute and no phantom identity", () => {
    const first = transform("src/App.tsx", APP_TSX);
    expect(first.identities).toHaveLength(2);
    const second = transform("src/App.tsx", first.code);
    // Already-tagged elements are recognized, not re-registered: the
    // re-transformed code is byte-identical and no registry record is emitted
    // for an id that is already in the DOM.
    expect(second.code).toBe(first.code);
    expect(second.identities).toHaveLength(0);
  });

  it("preserves a hand-written data-dev-id instead of inventing a second identity", () => {
    const code = `export function CheckoutButton() {
  return <button data-dev-id="dvi_a1b2c3d4e5f6">Checkout</button>;
}
`;
    const { code: out, identities }: { code: string; identities: DevIdentity[] } = transform(
      "src/components/CheckoutButton.tsx",
      code,
    );
    expect(identities).toHaveLength(0);
    expect(out).toContain('data-dev-id="dvi_a1b2c3d4e5f6"');
    expect(out.match(/data-dev-id/g)).toHaveLength(1);
  });

  it("supports sibling arrow-function components without stack drift", () => {
    const code = `export const A = () => <div><span>a</span></div>;
export const B = () => <div><span>b</span></div>;
`;
    const { identities } = transform("src/Siblings.tsx", code);
    const comps = new Set(identities.map((i) => i.component));
    expect(comps).toEqual(new Set(["A", "B"]));
  });
});
