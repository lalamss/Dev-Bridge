/**
 * Centered DevBridge welcome screen (empty selection state).
 *
 * A single logo group — gradient "D" mark above the two-tone wordmark with
 * the tagline directly underneath — centered both horizontally and
 * vertically within the DevTools panel content area (not the browser
 * viewport). One restrained primary action invokes the existing
 * element-inspection workflow via `onToggleInspect`; no second inspection
 * implementation lives here.
 */

import { S } from "../theme";
import { DevBridgeWelcomeMark } from "../components/branding";
import {
  WELCOME_WORDMARK_BRIDGE,
  WELCOME_WORDMARK_DEV,
  WELCOME_TAGLINE,
  inspectingCtaLabel,
  isInspectCtaDisabled,
} from "./welcome";

interface InspectLandingProps {
  inspecting: boolean;
  connected: boolean;
  invalidated: boolean;
  onToggleInspect: () => void;
}

export function InspectLanding({
  inspecting,
  connected,
  invalidated,
  onToggleInspect,
}: InspectLandingProps) {
  const ctaDisabled = isInspectCtaDisabled(connected);
  const ctaLabel = inspectingCtaLabel(inspecting);

  return (
    <div style={S.welcome} data-testid="devbridge-welcome">
      <div style={S.welcomeGroup} data-testid="devbridge-welcome-group">
        <div style={S.welcomeLogoWrap}>
          <DevBridgeWelcomeMark size={88} />
        </div>
        <div style={S.welcomeWordmark} aria-label="DevBridge">
          <span style={S.welcomeWordmarkDev}>{WELCOME_WORDMARK_DEV}</span>
          <span style={S.welcomeWordmarkBridge}>{WELCOME_WORDMARK_BRIDGE}</span>
        </div>
        <div style={S.welcomeTagline}>{WELCOME_TAGLINE}</div>
        <button
          type="button"
          className="db-btn db-btn-primary db-welcome-cta"
          style={{ ...S.btn, ...S.btnPrimary, ...S.welcomeCta }}
          onClick={onToggleInspect}
          disabled={ctaDisabled}
          aria-label={inspecting ? "Stop inspecting" : "Inspect a page"}
          title={
            inspecting
              ? "Stop inspecting (or press Escape on the page)"
              : "Hover an element on the page and click it"
          }
        >
          {ctaLabel}
        </button>
        {inspecting && connected && (
          <p style={S.welcomeLiveHint}>
            Click a highlighted element on the page — or press Escape to cancel.
          </p>
        )}
        {!connected && (
          <p style={S.welcomeHint} role="alert">
            {invalidated
              ? "The extension was reloaded while DevTools was open — close and reopen DevTools to reconnect."
              : "Not connected to the background worker yet — reloading the DevBridge tab usually fixes it."}
          </p>
        )}
      </div>
    </div>
  );
}

