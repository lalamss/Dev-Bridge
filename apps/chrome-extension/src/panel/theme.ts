import type { CSSProperties } from "react";

/**
 * DevBridge panel design tokens.
 *
 * Dark navy-charcoal surfaces, thin neutral borders, one restrained violet
 * accent (branding, selected navigation, primary actions), cyan for
 * source-related actions, green dots for genuine connected/live states only.
 */

// Mirrors @devbridge/protocol — inlined so the extension bundle keeps zero
// Node deps (see App.tsx header).
export type PatchStatus = "proposed" | "previewed" | "approved" | "applied" | "rejected" | "conflicted";
export type RiskLevel = "low" | "medium" | "high";

export interface SourceLocation { file: string; start: { line: number; column: number }; }
export interface DevIdentity { id: string; component: string | null; framework?: string; source: SourceLocation; parentId: string | null; }
export interface StateSnapshot { devId: string; props: Record<string, unknown>; state: Record<string, unknown>; context: Record<string, unknown>; timestamp: string; }
export interface SourcePatch { id: string; file: string; diff: string; status: PatchStatus; risk: RiskLevel; riskReasons: string[]; origin: string; }
export interface GitCheckpoint { sha: string; message: string; testsPassing: boolean | null; timestamp: string; }
export interface AgentProject {
  id: string;
  root: string;
  framework: "react" | "vue" | "svelte" | "angular" | "unknown";
  devServerUrl?: string;
}
export interface PageInfo {
  origin: string;
  url: string;
  instrumented: boolean;
  identityCount: number;
}
export interface RuntimeMatch { devId: string; instances: number; }
export interface ProjectFileList { files: string[]; truncated: boolean; }

export const C = {
  bg: "#16181d",
  bg2: "#1c1f26",
  rail: "#111318",
  card: "#1e2129",
  border: "#2a2e38",
  borderSoft: "#23262f",
  accent: "#9d8cff",
  accentDim: "#6d5ef0",
  cyan: "#67e8f9",
  cyanDim: "#0e7490",
  green: "#4ade80",
  amber: "#fbbf24",
  red: "#f87171",
  text: "#e4e4e7",
  muted: "#a1a1aa",
  dim: "#71717a",
};

export const UI_FONT = "Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif";
export const MONO_FONT = "'Cascadia Code', 'Fira Code', ui-monospace, monospace";
export const WELCOME_FONT = "Arial, Helvetica, sans-serif";
/** Deep navy-to-black gradient behind the centered welcome group (panel content area only). */
export const WELCOME_BACKGROUND =
  "radial-gradient(120% 90% at 50% 28%, #18223d 0%, #0b1120 48%, #04060c 100%)";

export const S: Record<string, CSSProperties> = {
  root: { display: "flex", flexDirection: "row", height: "100vh", background: C.bg, color: C.text, fontFamily: UI_FONT, fontSize: 12, lineHeight: 1.5, overflow: "hidden" },
  main: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" },

  // ── Header ──
  header: { display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", minHeight: 44, flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.bg2, overflow: "hidden" },
  brandBlock: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  wordmark: { fontWeight: 700, fontSize: 13, letterSpacing: "0.01em", color: C.text, whiteSpace: "nowrap" as const },
  subtitle: { fontSize: 11, color: C.muted, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" },
  headerMeta: { display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", minWidth: 0, overflow: "hidden", fontSize: 11, color: C.muted, whiteSpace: "nowrap" as const },
  headerBtns: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },

  // ── Nav rail ──
  rail: { display: "flex", flexDirection: "column", width: 60, flexShrink: 0, background: C.rail, borderRight: `1px solid ${C.border}`, padding: "8px 0", gap: 2, alignItems: "stretch" },
  railBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 2px", margin: "0 4px", border: "none", borderLeft: "2px solid transparent", borderRadius: 6, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 10, fontFamily: UI_FONT },
  railBtnActive: { color: C.text, background: C.card, borderLeftColor: C.accent },

  // ── Thin connection strip ──
  connStrip: { display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", minHeight: 26, fontSize: 11, flexShrink: 0, borderBottom: `1px solid ${C.borderSoft}`, background: C.bg, color: C.muted, overflow: "hidden", whiteSpace: "nowrap" as const, textOverflow: "ellipsis" },
  statusDot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block", flexShrink: 0 },

  // ── Selection workspace ──
  selBar: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.borderSoft}`, flexShrink: 0, flexWrap: "wrap" as const },
  selMeta: { flex: "1 1 180px", minWidth: 0 },
  componentName: { fontWeight: 600, color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  filePath: { fontFamily: MONO_FONT, fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  actionsRow: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" as const },

  tabStrip: { display: "flex", gap: 2, borderBottom: `1px solid ${C.borderSoft}`, background: C.bg, flexShrink: 0, padding: "0 8px" },
  tab: { padding: "7px 12px", border: "none", borderBottom: "2px solid transparent", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 12, fontFamily: UI_FONT },
  tabActive: { color: C.text, borderBottomColor: C.accent },

  editorWrapper: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 200, overflow: "hidden" },
  monacoContainer: { flex: 1, minHeight: 0 },
  monacoPlaceholder: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6, color: C.muted, fontSize: 12, padding: 20, textAlign: "center" as const },
  editorFooter: { display: "flex", alignItems: "center", padding: "6px 12px", borderTop: `1px solid ${C.borderSoft}`, background: C.bg2, gap: 8, flexShrink: 0 },

  lowerSections: { flexShrink: 0, borderTop: `1px solid ${C.borderSoft}`, background: C.bg, maxHeight: "38%", overflowY: "auto" as const },
  disclosure: { borderBottom: `1px solid ${C.borderSoft}` },
  disclosureSummary: { cursor: "pointer", color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const, padding: "7px 12px", listStyle: "none" },
  disclosureBody: { padding: "0 12px 10px 12px" },

  diffWrapper: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 200, overflow: "hidden" },
  rawDiffDetails: { background: C.bg, borderTop: `1px solid ${C.borderSoft}`, flexShrink: 0 },
  rawDiff: { padding: 12, overflowX: "auto", fontFamily: MONO_FONT, fontSize: 11, color: C.muted, lineHeight: 1.6, maxHeight: 160, overflowY: "auto" as const },
  actionBar: { display: "flex", gap: 8, padding: "8px 12px", borderTop: `1px solid ${C.borderSoft}`, background: C.bg2, justifyContent: "flex-end", flexShrink: 0 },

  notice: { padding: "6px 12px", fontSize: 12, flexShrink: 0, borderBottom: `1px solid ${C.borderSoft}`, background: C.bg2, color: C.text },

  // ── Landing ──
  landing: { flex: "1 1 auto", overflowY: "auto" as const, padding: "24px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" as const },
  landingTitle: { fontSize: 16, fontWeight: 700, color: C.text },
  landingText: { fontSize: 12, color: C.muted, maxWidth: 440 },
  // ── Centered welcome (empty selection) ──
  // The welcome screen occupies only the panel content area below the
  // header + connection strip (it is flex:1 inside S.main) and centers its
  // single logo group both horizontally and vertically.
  welcome: {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "32px 20px",
    background: WELCOME_BACKGROUND,
  },
  welcomeGroup: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    width: "min(440px, 100%)",
    maxWidth: 440,
    margin: "0 auto",
  },
  welcomeLogoWrap: { display: "flex", justifyContent: "center", width: "100%" },
  welcomeWordmark: {
    fontFamily: WELCOME_FONT,
    fontSize: "clamp(28px, 6vw, 40px)",
    lineHeight: 1.15,
    letterSpacing: "0.01em",
    marginTop: 14,
    whiteSpace: "nowrap" as const,
    maxWidth: "100%",
  },
  welcomeWordmarkDev: { color: "#f3f4f6", fontWeight: 400 },
  welcomeWordmarkBridge: {
    fontWeight: 700,
    color: C.accent,
    background: "linear-gradient(90deg, #a78bfa 0%, #818cf8 55%, #60a5fa 100%)",
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  } as CSSProperties,
  welcomeTagline: {
    fontFamily: WELCOME_FONT,
    fontSize: 14,
    lineHeight: 1.5,
    color: "#9aa0ae",
    marginTop: 8,
    maxWidth: 400,
  },
  welcomeCta: {
    marginTop: 26,
    padding: "8px 28px",
    borderRadius: 6,
    fontWeight: 600,
    fontFamily: WELCOME_FONT,
  },
  welcomeHint: { fontFamily: WELCOME_FONT, fontSize: 12, color: C.muted, marginTop: 12, maxWidth: 400, lineHeight: 1.5 },
  welcomeLiveHint: { fontFamily: WELCOME_FONT, fontSize: 12, color: "#9aa0ae", marginTop: 12, maxWidth: 400, lineHeight: 1.5 },
  cards: { display: "flex", flexWrap: "wrap" as const, gap: 8, justifyContent: "center", marginTop: 12, maxWidth: 560 },
  card: { width: 160, textAlign: "left" as const, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 },
  cardTitle: { fontSize: 12, fontWeight: 600, color: C.text },
  cardDesc: { fontSize: 11, color: C.muted, flex: 1 },

  // ── List views ──
  listView: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, overflow: "hidden" },
  searchBar: { display: "flex", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.borderSoft}`, flexShrink: 0 },
  searchInput: { flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontSize: 12, fontFamily: UI_FONT, padding: "5px 10px" },
  listBody: { flex: "1 1 auto", overflowY: "auto" as const, padding: "4px 0" },
  row: { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left" as const, background: "transparent", border: "none", borderLeft: "2px solid transparent", color: C.text, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontFamily: UI_FONT },
  rowActive: { background: C.card, borderLeftColor: C.accent },
  rowMeta: { fontFamily: MONO_FONT, fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  preview: { borderTop: `1px solid ${C.borderSoft}`, background: C.bg2, padding: "8px 12px", maxHeight: "45%", overflowY: "auto" as const, flexShrink: 0, fontFamily: MONO_FONT, fontSize: 11, color: C.muted, whiteSpace: "pre" as const },

  // ── Settings ──
  settings: { flex: "1 1 auto", overflowY: "auto" as const, padding: "12px" },
  settingRow: { display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.borderSoft}` },
  settingLabel: { fontWeight: 600, color: C.text, fontSize: 12 },
  settingDesc: { color: C.muted, fontSize: 11 },

  btn: { background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12, fontFamily: UI_FONT, lineHeight: 1.4, whiteSpace: "nowrap" as const },
  btnPrimary: { background: C.accentDim, borderColor: C.accentDim, color: "#fff" },
  btnCyan: { background: "transparent", borderColor: C.cyanDim, color: C.cyan },
  btnDanger: { background: "transparent", color: C.text, border: `1px solid ${C.border}` },
  ic: { background: C.card, padding: "1px 5px", borderRadius: 3, color: C.text, fontFamily: MONO_FONT, fontSize: 11 },
};
