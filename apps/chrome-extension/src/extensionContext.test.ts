import { afterEach, describe, expect, it } from "vitest";
import {
  EXTENSION_CONTEXT_INVALIDATED,
  isContextInvalidatedError,
  isExtensionContextValid,
  shouldRetryConnect,
} from "./extensionContext";

/**
 * Regression coverage for the chrome://extensions Errors-page report
 * "Uncaught Error: Extension context invalidated." (stack: panel.js:40).
 *
 * Root cause: after an extension reload with DevTools still open, the stale
 * panel/devtools documents keep running with a dead context, and the
 * 500 ms port-reconnect timer (plus lazy `chrome.runtime.getURL` calls and
 * `port.postMessage` on user clicks) throws the invalidation error uncaught
 * out of async callbacks — once per trigger, hence the repeated occurrences.
 *
 * The lifecycle contract pinned here: a dead context must PARK (no chrome
 * call, no timer, "not connected" UI) and only the exact invalidation
 * message is ever absorbed.
 */

const GLOBAL = globalThis as unknown as { chrome?: unknown };
const REAL_CHROME = GLOBAL.chrome;

afterEach(() => {
  GLOBAL.chrome = REAL_CHROME;
});

function stubChrome(runtime: unknown): void {
  GLOBAL.chrome = { runtime };
}

describe("isExtensionContextValid", () => {
  it("is true while the extension context is alive", () => {
    stubChrome({ id: "devbridge-test-id" });
    expect(isExtensionContextValid()).toBe(true);
  });

  it("is false once the context is invalidated (runtime.id goes undefined)", () => {
    stubChrome({ id: undefined });
    expect(isExtensionContextValid()).toBe(false);
  });

  it("is false when there is no chrome object at all", () => {
    delete GLOBAL.chrome;
    expect(isExtensionContextValid()).toBe(false);
  });

  it("is false when runtime itself is missing", () => {
    stubChrome(undefined);
    expect(isExtensionContextValid()).toBe(false);
  });
});

describe("isContextInvalidatedError", () => {
  it("matches Chrome's exact error", () => {
    expect(isContextInvalidatedError(new Error(EXTENSION_CONTEXT_INVALIDATED))).toBe(true);
  });

  it("matches the wrapped form shown on the Errors page", () => {
    expect(isContextInvalidatedError(new Error(`Uncaught Error: ${EXTENSION_CONTEXT_INVALIDATED}.`))).toBe(true);
  });

  it("rejects every other error so real failures stay loud", () => {
    expect(isContextInvalidatedError(new Error("Attempting to use a disconnected port object"))).toBe(false);
    expect(isContextInvalidatedError(new Error("Could not establish connection"))).toBe(false);
    expect(isContextInvalidatedError(new TypeError("Extension context invalidated".toLowerCase()))).toBe(false);
    expect(isContextInvalidatedError("Extension context invalidated")).toBe(false);
    expect(isContextInvalidatedError(null)).toBe(false);
    expect(isContextInvalidatedError(undefined)).toBe(false);
  });
});

describe("shouldRetryConnect", () => {
  it("retries only for a live, undisposed document", () => {
    expect(shouldRetryConnect(false, true)).toBe(true);
    expect(shouldRetryConnect(true, true)).toBe(false);
    expect(shouldRetryConnect(false, false)).toBe(false);
    expect(shouldRetryConnect(true, false)).toBe(false);
  });

  it("parks the stale-page sequence: invalidated context schedules no retry", () => {
    // The documented reproduction: extension reloaded while DevTools is open.
    // The dead port fires onDisconnect; the decision below must be "park",
    // so no `chrome.runtime.connect` ever runs in the dead context and no
    // uncaught error reaches the Errors page.
    stubChrome({ id: undefined });
    const disposed = false;
    expect(shouldRetryConnect(disposed, isExtensionContextValid())).toBe(false);
  });

  it("keeps reconnecting across normal MV3 worker suspensions", () => {
    // Worker suspends are disconnects in a VALID context — healing must stay.
    stubChrome({ id: "devbridge-test-id" });
    expect(shouldRetryConnect(false, isExtensionContextValid())).toBe(true);
  });
});
