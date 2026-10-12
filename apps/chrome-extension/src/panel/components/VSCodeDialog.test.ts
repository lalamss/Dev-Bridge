import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Install-dialog coverage (node runtime: source-shape guards, no DOM).
 *
 * Pins the complete missing-VS Code workflow without a browser:
 *   - the dialog shows the exact title/message and the Download / Check
 *     again / Cancel actions (never a raw PATH error or user-built URL);
 *   - a found installation offers to continue the original open;
 *   - App.tsx routes a typed not-detected failure to the dialog, re-checks
 *     through the forced-refresh status endpoint, and reports success only
 *     after the agent confirms the OS launch;
 *   - dialog styling adds no hover/transition/animation rules that could
 *     disturb the existing micro-interaction system.
 */

const here = dirname(fileURLToPath(import.meta.url));
const panelDir = join(here, "..");
const panelHtml = readFileSync(join(panelDir, "panel.html"), "utf8");
const styleBlock = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
const dialogSrc = readFileSync(join(here, "VSCodeDialog.tsx"), "utf8");
const appSrc = readFileSync(join(panelDir, "App.tsx"), "utf8");
const apiSrc = readFileSync(join(panelDir, "api.ts"), "utf8");

describe("install dialog content", () => {
  it("shows the exact not-found title and message", () => {
    expect(dialogSrc).toMatch(/Visual Studio Code not found/);
    expect(dialogSrc).toMatch(/Install Visual Studio Code to open and edit your project files directly from DevBridge\./);
    expect(dialogSrc).not.toMatch(/not found on PATH/);
  });

  it("offers Download, Check again, and Cancel on the not-found stage", () => {
    expect(dialogSrc).toMatch(/Download VS Code/);
    expect(dialogSrc).toMatch(/onDownload/);
    expect(dialogSrc).toMatch(/Check again/);
    expect(dialogSrc).toMatch(/onCheckAgain/);
    expect(dialogSrc).toMatch(/Cancel/);
    expect(dialogSrc).toMatch(/onCancel/);
  });

  it("offers to continue the original open once detected", () => {
    expect(dialogSrc).toMatch(/Visual Studio Code detected/);
    expect(dialogSrc).toMatch(/onContinue/);
    expect(dialogSrc).toMatch(/Open in VS Code/);
  });

  it("is an accessible dialog that delegates side effects to props", () => {
    expect(dialogSrc).toMatch(/role="dialog"/);
    expect(dialogSrc).toMatch(/aria-modal="true"/);
    expect(dialogSrc).toMatch(/aria-labelledby/);
    expect(dialogSrc).not.toMatch(/window\.open/);
    expect(dialogSrc).not.toMatch(/chrome\.tabs/);
    expect(dialogSrc).not.toMatch(/https?:\/\//);
  });

  it("reuses global button styles and adds no competing interaction CSS", () => {
    expect(dialogSrc).toMatch(/db-btn db-btn-primary/);
    expect(dialogSrc).toMatch(/className="db-btn"/);
    const dialogRules = [...styleBlock.matchAll(/\.db-dialog[^{]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(dialogRules.length).toBeGreaterThan(0);
    for (const rule of dialogRules) {
      expect(rule).not.toMatch(/:hover/);
      expect(rule).not.toMatch(/transition\s*:/);
      expect(rule).not.toMatch(/animation\s*:/);
      expect(rule).not.toMatch(/cursor/);
    }
  });
});

describe("App open flow", () => {
  it("routes a typed not-detected failure to the dialog instead of a flash", () => {
    expect(appSrc).toMatch(/VSCodeNotDetectedError/);
    expect(appSrc).toMatch(/stage: "not-found"/);
    expect(appSrc).toMatch(/<VSCodeDialog/);
  });

  it("re-checks with a forced refresh and continues the pending open", () => {
    expect(appSrc).toMatch(/getVSCodeStatus\(true\)/);
    expect(appSrc).toMatch(/stage: "found"/);
    expect(appSrc).toMatch(/handleVSCodeContinue/);
    expect(appSrc).toMatch(/onCancel=\{closeVSCodeFlow\}/);
    expect(appSrc).toMatch(/openVSCodeDownloadPage\(\)/);
  });

  it("lands a failed continue on the dialog failed stage (retry keeps the pending file)", () => {
    const continueSection = appSrc.slice(
      appSrc.indexOf("async function handleVSCodeContinue"),
      appSrc.indexOf("function vscodeDialogStage"),
    );
    expect(continueSection).toMatch(/stage: "failed"/);
    expect(continueSection).toMatch(/stage: "not-found"/);
    expect(continueSection).not.toMatch(/flash\(e\.message/);
  });

  it("never shows the install dialog for a launch failure code", () => {
    expect(apiSrc).toMatch(/launch-failed/);
    // The client only raises the dialog error for missing installations.
    const mapping = apiSrc.slice(apiSrc.indexOf("res.status === 503"));
    expect(mapping).toMatch(/VSCodeNotDetectedError/);
  });

  it("reports success only after the agent confirms the launch", () => {
    const openSection = appSrc.slice(
      appSrc.indexOf("async function openFileInProject"),
      appSrc.indexOf("function closeVSCodeFlow"),
    );
    expect(openSection.indexOf("await openInEditor")).toBeGreaterThan(-1);
    expect(openSection.indexOf("Opened")).toBeGreaterThan(openSection.indexOf("await openInEditor"));
  });

  it("keeps busy feedback and existing open entry points", () => {
    expect(appSrc).toMatch(/setBusy\(true\)/);
    expect(appSrc).toMatch(/Looking for Visual Studio Code|stage: "working"/);
    expect(appSrc).toMatch(/onOpenFile=\{\(file, line, column\) => void openFileInProject\(file, line, column\)\}/);
  });
});

describe("client contract", () => {
  it("exposes the typed status, download action, and dialog error", () => {
    expect(apiSrc).toMatch(/VSCodeNotDetectedError/);
    expect(apiSrc).toMatch(/getVSCodeStatus/);
    expect(apiSrc).toMatch(/editor\/vscode/);
    expect(apiSrc).toMatch(/VSCODE_DOWNLOAD_URL/);
    expect(apiSrc).toMatch(/https:\/\/code\.visualstudio\.com\/download/);
  });
});
