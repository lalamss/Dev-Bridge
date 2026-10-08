import { describe, expect, it } from "vitest";
import { buildOriginAllowlist, isAllowedOrigin } from "./originPolicy";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §S3/S4.
 *
 * The agent used to answer `cors()` with `Access-Control-Allow-Origin: *` and
 * to accept any WebSocket upgrade, which let a page on any origin drive
 * POST /patch -> /approve -> /apply and overwrite project source. These tests
 * pin the policy that replaces that.
 */

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const ALLOWLIST = buildOriginAllowlist();

describe("isAllowedOrigin", () => {
  it("refuses a normal public web page", () => {
    expect(isAllowedOrigin("https://evil.example", ALLOWLIST)).toBe(false);
    expect(isAllowedOrigin("http://evil.example:8080", ALLOWLIST)).toBe(false);
  });

  it("refuses a page on a remote origin that merely ends in localhost", () => {
    expect(isAllowedOrigin("http://evil.example/localhost", ALLOWLIST)).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.example", ALLOWLIST)).toBe(false);
  });

  it("refuses the opaque origin a sandboxed iframe or file:// page sends", () => {
    expect(isAllowedOrigin("null", ALLOWLIST)).toBe(false);
  });

  it("refuses a loopback origin on https, which the dev server never serves", () => {
    expect(isAllowedOrigin("https://localhost:5173", ALLOWLIST)).toBe(false);
  });

  it("accepts the DevTools panel's extension origin", () => {
    expect(isAllowedOrigin(`chrome-extension://${EXT_ID}`, ALLOWLIST)).toBe(true);
  });

  it("refuses a malformed chrome-extension origin even when the prefix is allowed", () => {
    expect(isAllowedOrigin("chrome-extension://not-a-real-id", ALLOWLIST)).toBe(false);
    expect(isAllowedOrigin("chrome-extension://", ALLOWLIST)).toBe(false);
  });

  it("accepts the inspected app's own loopback origin on any port", () => {
    expect(isAllowedOrigin("http://127.0.0.1:5173", ALLOWLIST)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", ALLOWLIST)).toBe(true);
  });

  it("accepts a request with no Origin — that is the CLI and the Vite plugin", () => {
    expect(isAllowedOrigin(undefined, ALLOWLIST)).toBe(true);
    expect(isAllowedOrigin("", ALLOWLIST)).toBe(true);
  });
});

describe("buildOriginAllowlist", () => {
  it("rejects a bare wildcard, which would re-open the agent to every page", () => {
    expect(() => buildOriginAllowlist({ configured: "*" })).toThrow(/bare "\*"/);
  });

  it("honours an explicit list instead of the defaults", () => {
    const allowlist = buildOriginAllowlist({ configured: "http://localhost:5173, " });
    expect(allowlist).toEqual(["http://localhost:5173"]);
    expect(isAllowedOrigin("http://localhost:5173", allowlist)).toBe(true);
    expect(isAllowedOrigin(`chrome-extension://${EXT_ID}`, allowlist)).toBe(false);
  });

  it("pins the extension id when one is supplied", () => {
    const allowlist = buildOriginAllowlist({ extensionId: EXT_ID });
    expect(isAllowedOrigin(`chrome-extension://${EXT_ID}`, allowlist)).toBe(true);
    expect(
      isAllowedOrigin("chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba", allowlist),
    ).toBe(false);
  });

  it("refuses a malformed pinned extension id rather than silently ignoring it", () => {
    expect(() => buildOriginAllowlist({ extensionId: "nope" })).toThrow(/32-character/);
  });
});