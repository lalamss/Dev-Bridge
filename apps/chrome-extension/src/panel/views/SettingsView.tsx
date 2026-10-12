/**
 * Settings view: real connection/project/instrumentation status plus the
 * supported preferences. Toggles persist via chrome.storage.local (with an
 * in-memory fallback) and each one drives actual behavior.
 */

import { useEffect, useState } from "react";
import { C, S, type AgentProject, type PageInfo } from "../theme";
import type { ConnectionState } from "../App";
import type { PanelPreferences } from "../preferences";
import { getIdentities } from "../api";
import { projectBasename } from "../components/Header";

interface SettingsViewProps {
  connection: ConnectionState;
  agentProject: AgentProject | null;
  agentReachable: boolean;
  pageInfo: PageInfo | null;
  liveStatus: "connecting" | "live" | "offline";
  prefs: PanelPreferences;
  onPrefsChange: (prefs: PanelPreferences) => void;
  onRefresh: () => void;
  /** Bumped by Refresh status so counts refetch instead of going stale. */
  refreshToken?: number;
}

function StatusLine({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? C.green : tone === "warn" ? C.amber : tone === "bad" ? C.red : C.text;
  return (
    <div style={S.settingRow}>
      <div style={{ flex: 1 }}>
        <div style={S.settingLabel}>{label}</div>
        <div style={{ ...S.settingDesc, color }}>{value}</div>
      </div>
    </div>
  );
}

export function SettingsView({
  connection,
  agentProject,
  agentReachable,
  pageInfo,
  liveStatus,
  prefs,
  onPrefsChange,
  onRefresh,
  refreshToken = 0,
}: SettingsViewProps) {
  const [identityCount, setIdentityCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!agentReachable) {
        setIdentityCount(null);
        return;
      }
      try {
        const list = await getIdentities();
        if (!cancelled) setIdentityCount(list.length);
      } catch {
        if (!cancelled) setIdentityCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // refreshToken refetches on manual Refresh; without it this view would
    // keep showing mount-time counts after the registry heals underneath.
  }, [agentReachable, refreshToken]);

  // "connected" with no registered dev-server URL means the origin check was
  // bypassed (nothing to compare against) — report it as unverified rather
  // than claiming a match. DOM identity counts likewise never prove that
  // source mappings were registered; only the agent registry count does.
  const originVerified = connection.kind === "connected" && !!agentProject?.devServerUrl;
  const connectionText =
    connection.kind === "connected" && !agentProject?.devServerUrl
    ? `Connected, but the dev server URL is not registered — origin match not verified. Start the app with the DevBridge Vite plugin, then Refresh status.`
    : connection.kind === "connected" ? `Connected — page origin matches the project dev server.`
    : connection.kind === "no-agent" ? "Local agent unreachable — run `devbridge start` in the project."
    : connection.kind === "unknown-page" ? "Waiting for page info — open the inspected tab on the dev server."
    : connection.kind === "uninstrumented" ? "This page reports no build-plugin identities."
    : `Page origin (${connection.actual || "unknown"}) does not match the project dev server (${connection.expected}). Source operations are disabled.`;

  return (
    <div style={S.settings}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Settings</span>
        <span style={{ flex: 1 }} />
        <button className="db-btn" style={S.btn} onClick={onRefresh} title="Re-check the local agent and page connection">
          Refresh status
        </button>
      </div>

      <StatusLine
        label="Local agent"
        value={agentReachable ? `Reachable at http://localhost:4577` : "Unreachable"}
        tone={agentReachable ? "ok" : "bad"}
      />
      <StatusLine
        label="Connection"
        value={connectionText}
        tone={connection.kind === "connected" ? (originVerified ? "ok" : "warn") : connection.kind === "mismatch" ? "warn" : "bad"}
      />
      <StatusLine
        label="Project"
        value={agentProject ? `${projectBasename(agentProject.root)} (${agentProject.root})` : "Unknown — agent unreachable."}
      />
      <StatusLine
        label="Framework"
        value={agentProject ? agentProject.framework : "Unknown"}
      />
      <StatusLine
        label="Dev server URL"
        value={agentProject?.devServerUrl ?? "Not reported — start the app with the DevBridge Vite plugin so it can register its origin."}
      />
      <StatusLine
        label="Instrumentation"
        value={
          identityCount === null
            ? "Unknown — agent unreachable."
            : identityCount === 0
              ? "No identities registered — edit and save a source file (or restart the dev server) so the build plugin re-sends them, then Refresh status."
              : `${identityCount} component identities registered.`
        }
        tone={identityCount === null || identityCount === 0 ? "warn" : "ok"}
      />
      <StatusLine
        label="Live state stream"
        value={liveStatus === "live" ? "Connected — props/state update live." : liveStatus === "connecting" ? "Connecting…" : "Offline — retrying in the background."}
        tone={liveStatus === "live" ? "ok" : liveStatus === "connecting" ? "warn" : "bad"}
      />
      {pageInfo && (
        <StatusLine
          label="Inspected page"
          value={`${pageInfo.url || pageInfo.origin} · ${pageInfo.identityCount} identities in DOM`}
        />
      )}

      <div style={{ fontWeight: 700, fontSize: 13, marginTop: 12, marginBottom: 2 }}>Preferences</div>
      <label style={{ ...S.settingRow, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={prefs.autoLocateOnSelect}
          onChange={(e) => onPrefsChange({ ...prefs, autoLocateOnSelect: e.target.checked })}
          aria-label="Highlight the selected element in the page automatically"
        />
        <div style={{ flex: 1 }}>
          <div style={S.settingLabel}>Highlight on select</div>
          <div style={S.settingDesc}>Automatically scroll to and flash the selected element in the page.</div>
        </div>
      </label>
      <label style={{ ...S.settingRow, cursor: "pointer", borderBottom: "none" }}>
        <input
          type="checkbox"
          checked={prefs.autoPreviewCss}
          onChange={(e) => onPrefsChange({ ...prefs, autoPreviewCss: e.target.checked })}
          aria-label="Preview CSS changes live before applying"
        />
        <div style={{ flex: 1 }}>
          <div style={S.settingLabel}>Live CSS preview</div>
          <div style={S.settingDesc}>Inject CSS/SCSS edits into the running page when a diff is previewed. Reverted on reject or apply.</div>
        </div>
      </label>
    </div>
  );
}
