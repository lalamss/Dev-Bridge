/**
 * Cross-platform asset copy — works on Windows and Unix.
 * Copies all static assets into dist/ after vite build.
 *
 * File locations:
 *   manifest.json  →  chrome-extension root
 *   devtools.html  →  src/devtools.html
 *   panel.html     →  src/panel/panel.html
 *   icons/         →  chrome-extension root
 *   vs/            →  node_modules/monaco-editor/min/vs   (vendored Monaco)
 *
 * Monaco is vendored rather than pulled from a CDN because Chrome applies
 * the extension's Content Security Policy to DevTools panel pages, and MV3
 * ships `script-src 'self'`. A remote <script src="https://cdnjs..."> in
 * panel.html is blocked outright, so the loader never runs and the editor
 * silently never mounts.
 *
 * Node's fs module only — no shell commands, so this behaves identically on
 * Windows (cmd/PowerShell) and Unix. Anything missing is reported as a
 * warning rather than throwing, so a partial build still produces a loadable
 * unpacked extension.
 */
const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "dist");
fs.mkdirSync(dist, { recursive: true });

const warnings = [];

/** Copy a single file, warning (not throwing) when the source is absent. */
function copyFile(src, dest, label) {
  if (!fs.existsSync(src)) {
    warnings.push(`${label} not found at ${src}`);
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`copied ${label}`);
  return true;
}

// ── Files at the extension root ──
copyFile(path.join(__dirname, "manifest.json"), path.join(dist, "manifest.json"), "manifest.json");

// ── devtools.html lives in src/ ──
copyFile(
  path.join(__dirname, "src", "devtools.html"),
  path.join(dist, "devtools.html"),
  "devtools.html",
);

// ── panel.html lives in src/panel/ ──
copyFile(
  path.join(__dirname, "src", "panel", "panel.html"),
  path.join(dist, "panel.html"),
  "panel.html",
);

// ── icons/ at the extension root ──
const iconsDir = path.join(__dirname, "icons");
if (fs.existsSync(iconsDir)) {
  const destIcons = path.join(dist, "icons");
  fs.mkdirSync(destIcons, { recursive: true });
  let count = 0;
  for (const f of fs.readdirSync(iconsDir)) {
    fs.copyFileSync(path.join(iconsDir, f), path.join(destIcons, f));
    count++;
  }
  console.log(`copied icons/ (${count} file${count === 1 ? "" : "s"})`);
} else {
  warnings.push(`icons/ not found at ${iconsDir}`);
}

// ── Monaco: node_modules/monaco-editor/min/vs → dist/vs ──
//
// Vite empties dist/ on every build (emptyOutDir: true), so this whole tree
// has to be re-copied every time. fs.cpSync with recursive handles nested
// directories without shelling out to `cp -r`.
const monacoSrc = path.join(__dirname, "node_modules", "monaco-editor", "min", "vs");
const monacoDest = path.join(dist, "vs");

if (fs.existsSync(monacoSrc)) {
  fs.cpSync(monacoSrc, monacoDest, { recursive: true });
  let files = 0;
  let bytes = 0;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        files++;
        bytes += fs.statSync(full).size;
      }
    }
  })(monacoDest);
  console.log(
    `copied vs/ (Monaco ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB)`,
  );

  // The AMD loader is the one file that must exist for the panel to boot.
  const loader = path.join(monacoDest, "loader.js");
  if (!fs.existsSync(loader)) {
    warnings.push("vs/loader.js missing — panel.html will fall back to a blank editor");
  }
  // Language services run as web workers; without this the editor mounts but
  // logs "Could not create web worker" and loses completion/validation.
  const worker = path.join(monacoDest, "base", "worker", "workerMain.js");
  if (!fs.existsSync(worker)) {
    warnings.push("vs/base/worker/workerMain.js missing — editor workers will fail to start");
  }
} else {
  warnings.push(
    `Monaco not installed at ${monacoSrc} — run: pnpm --filter @devbridge/chrome-extension add monaco-editor@0.44.0`,
  );
}

if (warnings.length) {
  console.warn("\nWarnings:");
  for (const w of warnings) console.warn(`  WARNING: ${w}`);
  console.warn("");
}

console.log("Assets copied to dist/");
