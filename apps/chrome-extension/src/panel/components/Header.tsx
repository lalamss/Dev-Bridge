/**
 * Compact top header: logo + wordmark, subtitle, real connection status,
 * detected project/framework, dev-server URL, and secondary actions.
 * Everything shown comes from live state — nothing is fabricated.
 */

import { C, S, type AgentProject, type PageInfo } from "../theme";
import type { ConnectionState } from "../App";
import { DevBridgeMark } from "./branding";

interface HeaderProps {
  connection: ConnectionState;
  agentProject: AgentProject | null;
  agentReachable: boolean;
  pageInfo: PageInfo | null;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export function projectBasename(root: string): string {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

export function Header({ connection, agentProject, agentReachable, pageInfo, onRefresh, onOpenSettings }: HeaderProps) {
  const dotColor =
    connection.kind === "connected" ? C.green
    : connection.kind === "mismatch" ? C.amber
    : connection.kind === "no-agent" ? C.red
    : C.dim;

  const statusText =
    connection.kind === "connected" ? "Connected"
    : connection.kind === "no-agent" ? "Agent unreachable"
    : connection.kind === "unknown-page" ? "Waiting for page"
    : connection.kind === "uninstrumented" ? "Not instrumented"
    : "Origin mismatch";

  return (
    <div style={S.header}>
      <div style={S.brandBlock}>
        <DevBridgeMark />
        <span style={S.wordmark}>DevBridge</span>
        <span style={S.subtitle} className="db-hide-narrow">Browser to Source, Seamlessly.</span>
      </div>
      <div style={S.headerMeta}>
        <span style={{ ...S.statusDot, background: dotColor }} aria-hidden="true" />
        <span style={{ color: C.text }}>{statusText}</span>
        {agentReachable && agentProject && (
          <span
            style={{ overflow: "hidden", textOverflow: "ellipsis" }}
            title={`${agentProject.root}${agentProject.devServerUrl ? ` · ${agentProject.devServerUrl}` : ""}`}
          >
            {projectBasename(agentProject.root)} · {agentProject.framework}
            {agentProject.devServerUrl ? ` · ${agentProject.devServerUrl}` : ""}
            {pageInfo ? ` · ${pageInfo.identityCount} identities` : ""}
          </span>
        )}
        {!agentReachable && <span>run `devbridge start`, then refresh</span>}
      </div>
      <div style={S.headerBtns}>
        <button className="db-btn" style={S.btn} onClick={onRefresh} title="Re-check the local agent and page connection" aria-label="Refresh connection">
          Refresh
        </button>
        <button className="db-btn" style={S.btn} onClick={onOpenSettings} title="Open Settings" aria-label="Open Settings">
          Settings
        </button>
      </div>
    </div>
  );
}
