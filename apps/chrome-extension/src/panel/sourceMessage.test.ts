import { describe, expect, it } from "vitest";
import { identityMissingMessage, sourceFailureMessage } from "./sourceMessage";

/**
 * Regression coverage for Batch 6: the panel must distinguish "no identity
 * registered" from "identity known but file unreadable" (wrong agent root).
 * The old code collapsed the second case into "Couldn't reach local agent",
 * which misdirects exactly the developer hitting a stale/wrong-root agent
 * (reproduced live: identity 200 + source 404 against an agent rooted at
 * `apps/local-agent` while inspecting the example app).
 */

describe("sourceMessage", () => {
  it("names the missing identity and the re-sync recovery", () => {
    const msg = identityMissingMessage("dvi_abc");
    expect(msg).toContain("dvi_abc");
    expect(msg).toContain("reload the page");
  });

  it("diagnoses a 404 as a probable project-root mismatch, not an outage", () => {
    const msg = sourceFailureMessage("dvi_bf4ae98f", "src/App.tsx", 404);
    expect(msg).toContain("dvi_bf4ae98f");
    expect(msg).toContain("src/App.tsx");
    expect(msg).toContain("DEVBRIDGE_PROJECT_ROOT");
    expect(msg).not.toMatch(/couldn't reach|unavailable/i);
  });

  it("keeps a generic read error for non-404 statuses", () => {
    const msg = sourceFailureMessage("dvi_x", "src/A.tsx", 500);
    expect(msg).toContain("src/A.tsx");
    expect(msg).toContain("500");
  });
});
