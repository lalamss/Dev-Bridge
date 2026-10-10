/**
 * Extension-context lifecycle guards.
 *
 * When the extension is reloaded, updated, or disabled while a DevTools
 * document (the devtools page or the DevBridge panel) is still open, that
 * document keeps running with an INVALIDATED context: every subsequent
 * `chrome.*` call throws synchronously
 * `Error("Extension context invalidated")`. Fired from a retry timer, a
 * Monaco worker callback, or a click handler, that throw surfaces as an
 * uncaught error on chrome://extensions (stack: panel.js) — even though
 * DevBridge itself is otherwise healthy and source inspection keeps working
 * for already-loaded documents.
 *
 * The canonical probe is `chrome.runtime.id`: reading it never throws, and
 * it is `undefined` once the context is dead. Stale documents park in their
 * existing "not connected" UI instead of throwing. Only the exact
 * invalidation message is absorbed — every other error still propagates, so
 * real failures stay loud.
 */

export const EXTENSION_CONTEXT_INVALIDATED = "Extension context invalidated";

function getChrome(): typeof chrome | undefined {
  return (globalThis as unknown as { chrome?: typeof chrome }).chrome;
}

/** True while this document's extension context can still call chrome APIs. */
export function isExtensionContextValid(): boolean {
  const c = getChrome();
  try {
    return !!c?.runtime?.id;
  } catch {
    return false;
  }
}

/** True only for Chrome's extension-context-invalidated error — nothing else. */
export function isContextInvalidatedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(EXTENSION_CONTEXT_INVALIDATED);
}

/**
 * Should a disconnected DevTools document schedule another
 * `chrome.runtime.connect` attempt? Retrying from a dead context throws an
 * uncaught error out of the timer callback; parking lets the stale page sit
 * quietly in its "not connected" state until DevTools is reopened, which is
 * the only thing that mints a fresh context.
 */
export function shouldRetryConnect(disposed: boolean, contextValid: boolean): boolean {
  return !disposed && contextValid;
}
