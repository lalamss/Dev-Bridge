/**
 * Panel preferences with a safe persistence mechanism.
 *
 * Backed by chrome.storage.local (the "storage" permission is already in
 * manifest.json) when the extension context is valid; otherwise an
 * in-memory fallback so Settings toggles still work for the session without
 * throwing. Every preference here is wired to real behavior in App.tsx:
 *
 *   - autoLocateOnSelect: flash the selected element in the page on select.
 *   - autoPreviewCss: inject the CSS live-preview tag when a patch is
 *     proposed (CSS/SCSS files only).
 */

export interface PanelPreferences {
  autoLocateOnSelect: boolean;
  autoPreviewCss: boolean;
}

export const DEFAULT_PREFERENCES: PanelPreferences = {
  autoLocateOnSelect: false,
  autoPreviewCss: true,
};

export interface PrefsStore {
  load(): Promise<Partial<PanelPreferences>>;
  save(prefs: PanelPreferences): Promise<void>;
}

function getChrome(): any {
  return (globalThis as unknown as { chrome?: any }).chrome;
}

/** True while this document's extension context can still call chrome APIs. */
function contextValid(): boolean {
  try {
    return Boolean(getChrome()?.runtime?.id);
  } catch {
    return false;
  }
}

const memoryFallback: { prefs: PanelPreferences } = { prefs: { ...DEFAULT_PREFERENCES } };

export const chromeLocalPrefsStore: PrefsStore = {
  async load(): Promise<Partial<PanelPreferences>> {
    if (!contextValid()) return { ...memoryFallback.prefs };
    try {
      const stored = await getChrome().storage.local.get("devbridge.prefs");
      const raw = stored?.["devbridge.prefs"];
      if (raw && typeof raw === "object") {
        memoryFallback.prefs = sanitize(raw);
        return { ...memoryFallback.prefs };
      }
    } catch {
      /* fall through to the in-memory copy */
    }
    return { ...memoryFallback.prefs };
  },

  async save(prefs: PanelPreferences): Promise<void> {
    const clean = sanitize(prefs);
    memoryFallback.prefs = { ...clean };
    if (!contextValid()) return;
    try {
      await getChrome().storage.local.set({ "devbridge.prefs": clean });
    } catch {
      /* in-memory copy already updated — persistence is best-effort */
    }
  },
};

export function sanitize(raw: Partial<PanelPreferences>): PanelPreferences {
  return {
    autoLocateOnSelect: raw.autoLocateOnSelect === true,
    autoPreviewCss: raw.autoPreviewCss !== false,
  };
}

/** Test seam: an in-memory store with no chrome dependency. */
export function memoryPrefsStore(initial: PanelPreferences = DEFAULT_PREFERENCES): PrefsStore & { current: PanelPreferences } {
  const state = { current: sanitize(initial) };
  return {
    get current() {
      return state.current;
    },
    async load() {
      return { ...state.current };
    },
    async save(prefs: PanelPreferences) {
      state.current = sanitize(prefs);
    },
  };
}
