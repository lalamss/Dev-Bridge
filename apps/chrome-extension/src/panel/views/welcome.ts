/**
 * Welcome-screen contract (pure logic, no React/chrome imports).
 *
 * Keeps the centered empty state honest and testable in Node:
 *   - exact wordmark parts, tagline, and primary-action labels;
 *   - when the welcome screen shows (no devId AND no tag);
 *   - when the Inspect action is unavailable (no background-worker port).
 */

export const WELCOME_WORDMARK_DEV = "Dev";
export const WELCOME_WORDMARK_BRIDGE = "Bridge";
export const WELCOME_TAGLINE = "Browser to Source, Seamlessly";
export const WELCOME_CTA_LABEL = "Inspect a page";
export const WELCOME_STOP_LABEL = "Stop inspecting";

/** The welcome screen shows only when there is no selection at all. */
export function shouldShowWelcome(devId: string | null, selectedTag: string | null): boolean {
  return devId === null && selectedTag === null;
}

/** The Inspect action needs the background-worker port; otherwise it stays disabled. */
export function isInspectCtaDisabled(connected: boolean): boolean {
  return !connected;
}

export function inspectingCtaLabel(inspecting: boolean): string {
  return inspecting ? WELCOME_STOP_LABEL : WELCOME_CTA_LABEL;
}
