/**
 * VS Code install dialog: the friendly face of "Open in VS Code" when no
 * usable installation is detected.
 *
 * Pure presentational component — all detection/launch decisions live in
 * App.tsx and the local agent. Buttons reuse the global .db-btn styles so
 * hover, focus, press, and disabled states stay consistent with the rest of
 * the panel. No raw PATH errors are ever rendered here.
 */

import { S } from "../theme";

export type VSCodeDialogStage = "checking" | "not-found" | "found" | "launching" | "failed";

export interface VSCodeDialogProps {
  stage: VSCodeDialogStage;
  /** Agent-provided reason (not-found after retry, or failed launch). */
  detail?: string;
  /** How VS Code was found (found stage only). */
  via?: string;
  /** Pending open target for context, e.g. "src/App.tsx:12:4". */
  pendingLabel?: string;
  onDownload: () => void;
  onCheckAgain: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

function viaLabel(via: string | undefined): string {
  switch (via) {
    case "PATH":
      return "on PATH";
    case "install-location":
      return "in its standard install location";
    case "windows-resolution":
      return "via Windows app registration";
    case "config":
      return "at its configured location";
    default:
      return "on this machine";
  }
}

export function VSCodeDialog({
  stage,
  detail,
  via,
  pendingLabel,
  onDownload,
  onCheckAgain,
  onContinue,
  onCancel,
}: VSCodeDialogProps) {
  const busy = stage === "checking" || stage === "launching";
  return (
    <div className="db-dialog-backdrop">
      <div className="db-dialog-card" role="dialog" aria-modal="true" aria-labelledby="db-vscode-dialog-title">
        {stage === "checking" && (
          <>
            <div className="db-dialog-title" id="db-vscode-dialog-title">Looking for Visual Studio Code…</div>
            <div className="db-dialog-text">Detecting your VS Code installation.</div>
          </>
        )}
        {stage === "launching" && (
          <>
            <div className="db-dialog-title" id="db-vscode-dialog-title">Opening in Visual Studio Code…</div>
            <div className="db-dialog-text">
              {pendingLabel ? `Opening ${pendingLabel}.` : "Starting VS Code."}
            </div>
          </>
        )}
        {stage === "not-found" && (
          <>
            <div className="db-dialog-title" id="db-vscode-dialog-title">Visual Studio Code not found</div>
            <div className="db-dialog-text">
              Install Visual Studio Code to open and edit your project files directly from DevBridge.
            </div>
            {detail && <div className="db-dialog-detail">{detail}</div>}
          </>
        )}
        {stage === "found" && (
          <>
            <div className="db-dialog-title" id="db-vscode-dialog-title">Visual Studio Code detected</div>
            <div className="db-dialog-text">
              {`Found ${viaLabel(via)}.`}
              {pendingLabel ? ` Continue opening ${pendingLabel}?` : " Continue?"}
            </div>
          </>
        )}
        {stage === "failed" && (
          <>
            <div className="db-dialog-title" id="db-vscode-dialog-title">Could not open in Visual Studio Code</div>
            <div className="db-dialog-text">
              {detail || "The launch did not complete. You can try again."}
            </div>
          </>
        )}
        <div className="db-dialog-actions">
          {(stage === "not-found" || stage === "failed") && (
            <button
              type="button"
              className="db-btn db-btn-primary"
              style={{ ...S.btn, ...S.btnPrimary }}
              onClick={onDownload}
              disabled={busy}
            >
              Download VS Code
            </button>
          )}
          {(stage === "not-found" || stage === "failed") && (
            <button
              type="button"
              className="db-btn"
              style={S.btn}
              onClick={onCheckAgain}
              disabled={busy}
              title="Re-run VS Code detection"
            >
              Check again
            </button>
          )}
          {stage === "found" && (
            <button
              type="button"
              className="db-btn db-btn-primary"
              style={{ ...S.btn, ...S.btnPrimary }}
              onClick={onContinue}
              disabled={busy}
              title={pendingLabel ? `Open ${pendingLabel} in VS Code` : "Open in VS Code"}
            >
              Open in VS Code
            </button>
          )}
          <button
            type="button"
            className="db-btn"
            style={S.btn}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
