/**
 * Components view: real identity data from GET /identities.
 *
 * Name + type, source file + line, search/filter, select-to-inspect, and
 * per-component live-instance highlight with actual counts. Instance counts
 * come from real DOM queries via the content script — never guessed.
 */

import { useEffect, useMemo, useState } from "react";
import { C, S } from "../theme";
import { getIdentities } from "../api";

export interface ComponentsViewProps {
  agentReachable: boolean;
  selectedDevId: string | null;
  instanceCounts: Map<string, number>;
  onSelect: (devId: string) => void;
  onHighlight: (devId: string) => void;
  onCountVisible: (devIds: string[]) => void;
  initialFileFilter?: string | null;
}

export function filterIdentities<T extends { id: string; component: string | null; source: { file: string } }>(
  list: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (i) =>
      i.id.toLowerCase().includes(q) ||
      (i.component ?? "").toLowerCase().includes(q) ||
      i.source.file.toLowerCase().includes(q),
  );
}

export function ComponentsView({
  agentReachable,
  selectedDevId,
  instanceCounts,
  onSelect,
  onHighlight,
  onCountVisible,
  initialFileFilter,
}: ComponentsViewProps) {
  const [identities, setIdentities] = useState<Awaited<ReturnType<typeof getIdentities>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialFileFilter ?? "");
  const [highlighting, setHighlighting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!agentReachable) {
        setError("Local agent unreachable — run `devbridge start`.");
        return;
      }
      try {
        const list = await getIdentities();
        if (!cancelled) {
          setIdentities(list);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not load components.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentReachable]);

  useEffect(() => {
    if (initialFileFilter) setQuery(initialFileFilter);
  }, [initialFileFilter]);

  const visible = useMemo(
    () => (identities ? filterIdentities(identities, query) : []),
    [identities, query],
  );

  async function handleHighlight(devId: string) {
    setHighlighting(devId);
    try {
      onHighlight(devId);
    } finally {
      setHighlighting(null);
    }
  }

  return (
    <div style={S.listView}>
      <div style={S.searchBar}>
        <input
          className="db-search"
          style={S.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by component, id, or file…"
          aria-label="Filter components"
        />
      </div>
      <div style={S.listBody} role="list" aria-label="Components">
        {error && <div style={{ padding: "8px 12px", color: C.red, fontSize: 12 }}>{error}</div>}
        {!error && identities === null && (
          <div style={{ padding: "8px 12px", color: C.muted, fontSize: 12 }}>Loading components…</div>
        )}
        {!error && identities !== null && identities.length === 0 && (
          <div style={{ padding: "8px 12px", color: C.muted, fontSize: 12 }}>
            No component identities registered. Reload the page on the dev server so the build plugin re-sends them.
          </div>
        )}
        {!error && identities !== null && visible.length === 0 && identities.length > 0 && (
          <div style={{ padding: "8px 12px", color: C.muted, fontSize: 12 }}>
            No components match “{query}”.
          </div>
        )}
        {visible.map((i) => {
          const count = instanceCounts.get(i.id);
          const selected = i.id === selectedDevId;
          return (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 4, paddingRight: 8 }}>
              <button
                role="listitem"
                className="db-row"
                style={{ ...S.row, ...(selected ? S.rowActive : {}), flex: "1 1 auto", minWidth: 0 }}
                onClick={() => onSelect(i.id)}
                title={`Select ${i.component ?? i.id} in the Inspect workspace`}
                aria-label={`Select ${i.component ?? i.id}`}
              >
                <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: "left" }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i.component ?? "(unnamed)"}
                    {typeof count === "number" && (
                      <span style={{ ...S.ic, marginLeft: 8 }}>
                        {count === 0 ? "0 live" : `${count} live`}
                      </span>
                    )}
                  </span>
                  <span style={S.rowMeta}>
                    {i.id} · {i.source.file}:{i.source.start.line}
                  </span>
                </span>
              </button>
              <button
                className="db-btn"
                style={{ ...S.btn, fontSize: 11, padding: "2px 8px", flexShrink: 0 }}
                onClick={() => void handleHighlight(i.id)}
                title={`Highlight live instances of ${i.id}`}
                aria-label={`Highlight instances of ${i.id}`}
              >
                {highlighting === i.id ? "…" : "Highlight"}
              </button>
            </div>
          );
        })}
      </div>
      {identities !== null && identities.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: `1px solid ${C.borderSoft}`, color: C.dim, fontSize: 11, flexShrink: 0 }}>
          <span style={{ flex: 1 }}>
            {visible.length} of {identities.length} components · select one to open it in the Inspect workspace
          </span>
          <button
            className="db-btn"
            style={{ ...S.btn, fontSize: 11, padding: "2px 8px" }}
            onClick={() => onCountVisible(visible.map((i) => i.id))}
            title="Ask the page for live instance counts of the visible components"
          >
            Count live instances
          </button>
        </div>
      )}
    </div>
  );
}
