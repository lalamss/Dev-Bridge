/**
 * Centered DevBridge welcome screen (empty selection state).
 *
 * A single logo group — geometric D/bridge mark above the two-tone
 * wordmark, followed by the headline, supporting text, and one primary
 * action — centered both horizontally and vertically within the DevTools
 * panel content area (not the browser viewport). The button invokes the
 * existing element-inspection workflow via `onToggleInspect`; no second
 * inspection implementation lives here.
 */

import { S } from "../theme";
import { DevBridgeWelcomeMark } from "../components/branding";
import { PointCloudCanvas } from "../components/PointCloudCanvas";
import {
  WELCOME_CTA_LABEL,
  WELCOME_DESCRIPTION,
  WELCOME_HEADLINE,
  WELCOME_HELPER_CAPTION,
  WELCOME_WORDMARK_BRIDGE,
  WELCOME_WORDMARK_DEV,
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
      <PointCloudCanvas />
      <div style={S.welcomeGroup} data-testid="devbridge-welcome-group">
        <div style={S.welcomeLogoWrap}>
          <DevBridgeWelcomeMark size={80} />
        </div>
        <div style={S.welcomeWordmark} aria-label="DevBridge">
          <span style={S.welcomeWordmarkDev}>{WELCOME_WORDMARK_DEV}</span>
          <span style={S.welcomeWordmarkBridge}>{WELCOME_WORDMARK_BRIDGE}</span>
        </div>
        <h1 style={{ ...S.welcomeHeadline, margin: 0, marginTop: 18 }}>{WELCOME_HEADLINE}</h1>
        <p style={{ ...S.welcomeDescription, margin: 0, marginTop: 8 }}>{WELCOME_DESCRIPTION}</p>
        <button
          type="button"
          className="db-btn db-btn-primary db-welcome-cta"
          style={{ ...S.btn, ...S.btnPrimary, ...S.welcomeCta }}
          onClick={onToggleInspect}
          disabled={ctaDisabled}
          aria-label={inspecting ? "Stop inspecting" : WELCOME_CTA_LABEL}
          title={
            inspecting
              ? "Stop inspecting (or press Escape on the page)"
              : "Hover an element on the page and click it"
          }
        >
          {ctaLabel}
        </button>
        {inspecting && connected && (
          <p style={{ ...S.welcomeLiveHint, margin: 0, marginTop: 10 }}>
            Click a highlighted element on the page — or press Escape to cancel.
          </p>
        )}
        {!connected && (
          <p style={{ ...S.welcomeHint, margin: 0, marginTop: 10 }} role="alert">
            {invalidated
              ? "The extension was reloaded while DevTools was open — close and reopen DevTools to reconnect."
              : "Not connected to the background worker yet — reloading the DevBridge tab usually fixes it."}
          </p>
        )}
        {connected && !inspecting && (
          <p style={{ ...S.welcomeCaption, margin: 0, marginTop: 10 }}>{WELCOME_HELPER_CAPTION}</p>
        )}
      </div>
    </div>
  );
}
