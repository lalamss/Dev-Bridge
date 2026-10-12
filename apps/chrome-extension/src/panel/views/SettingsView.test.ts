import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Settings status-reporting coverage (node runtime: source-shape guards).
 *
 * Pins the honest-reporting contract behind the screenshot fix:
 *   - instrumentation counts come from the agent registry (GET /identities),
 *     never from the live-DOM count, which only proves markers rendered;
 *   - a "connected" state with no registered dev-server URL is reported as
 *     unverified (the origin check was bypassed, not passed);
 *   - localhost and 127.0.0.1 compare equal (same dev server, either host);
 *   - Refresh refetches instead of reusing mount-time values;
 *   - recovery hints name an action that actually re-registers (edit + save),
 *     not a reload served from Vite's transform cache.
 */

const here = dirname(fileURLToPath(import.meta.url));
const settingsSrc = readFileSync(join(here, "SettingsView.tsx"), "utf8");
const appSrc = readFileSync(join(here, "..", "App.tsx"), "utf8");
const navSrc = readFileSync(join(here, "..", "navigation.ts"), "utf8");

describe("instrumentation source", () => {
  it("counts registered mappings from the agent, not DOM markers", () => {
    expect(settingsSrc).toMatch(/getIdentities\(\)/);
    expect(settingsSrc).toMatch(/identityCount/);
    // The DOM count is shown labeled as DOM markers only.
    expect(settingsSrc).toMatch(/identities in DOM/);
    const instrumentationRow = settingsSrc.slice(
      settingsSrc.indexOf('label="Instrumentation"'),
      settingsSrc.indexOf('label="Live state stream"'),
    );
    expect(instrumentationRow).toMatch(/identityCount/);
    expect(instrumentationRow).not.toMatch(/pageInfo/);
  });

  it("hints an action that actually re-registers instead of a cached reload", () => {
    expect(settingsSrc).toMatch(/edit and save a source file/);
    expect(settingsSrc).toMatch(/Refresh status/);
    expect(settingsSrc).not.toMatch(/reload the page so the build plugin re-sends them/);
  });
});

describe("origin-match honesty", () => {
  it("reports an unverified connection when no dev-server URL is registered", () => {
    expect(settingsSrc).toMatch(/origin match not verified/);
    expect(settingsSrc).toMatch(/agentProject\?\.devServerUrl/);
    expect(appSrc).toMatch(/normalizeLoopbackOrigin\(pageInfo\.origin\)/);
    expect(navSrc).toMatch(/normalizeLoopbackOrigin/);
  });

  it("keeps the four status checks independent", () => {
    for (const label of ["Local agent", "Connection", "Dev server URL", "Instrumentation", "Live state stream"]) {
      expect(settingsSrc).toContain(label);
    }
    expect(settingsSrc).toMatch(/originVerified/);
  });
});

describe("fresh refresh", () => {
  it("refetches registry counts on manual Refresh via a refresh token", () => {
    expect(settingsSrc).toMatch(/refreshToken/);
    expect(settingsSrc).toMatch(/\[agentReachable, refreshToken\]/);
    expect(appSrc).toMatch(/refreshToken=\{refreshTick\}/);
    expect(appSrc).toMatch(/setRefreshTick/);
  });
});
