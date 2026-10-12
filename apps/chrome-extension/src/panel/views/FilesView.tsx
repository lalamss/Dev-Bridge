/**
 * Files view: project-relative source paths from GET /files.
 *
 * Search/filter, file selection with a short read-only preview (first
 * lines via the existing GET /source route), "Open in VS Code" at line 1,
 * and "View identities" which jumps to Components filtered by that file.
 * Paths stay project-relative end to end; /source and /editor/open
 * re-validate containment server-side.
 */

import { useEffect, useMemo, useState } from "react";
import { C, S } from "../theme";
import { getFiles, getSource } from "../api";

export function filterFiles(files: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  return files.filter((f) => f.toLowerCase().includes(q));
}

const PREVIEW_LINES = 60;

interface FilesViewProps {
  agentReachable: boolean;
  onOpenFile: (file: string, line: number, column: number) => void;
  onViewIdentities: (file: string) => void;
}

export function FilesView({ agentReachable, onOpenFile, onViewIdentities }: FilesViewProps) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!agentReachable) {
        setError("Local agent unreachable — run `devbridge start`.");
        return;
      }
      try {
        const list = await getFiles();
        if (!cancelled) {
          setFiles(list.files);
          setTruncated(list.truncated);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not load files.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentReachable]);

  const visible = useMemo(() => (files ? filterFiles(files, query).slice(0, 500) : []), [files, query]);

  async function handleSelect(file: string) {
    setSelected(file);
    setPreview(null);
    setPreviewError(null);
    try {
      const content = await getSource(file);
      const lines = content.split("\n").slice(0, PREVIEW_LINES);
      setPreview(lines.join("\n") + (content.split("\n").length > PREVIEW_LINES ? `\n… (${content.split("\n").length - PREVIEW_LINES} more lines)` : ""));
    } catch (e: any) {
      setPreviewError(e?.message ?? "Could not read this file.");
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
          placeholder="Filter files by path…"
          aria-label="Filter files"
        />
      </div>
      <div style={S.listBody} role="list" aria-label="Project files">
        {error && <div style={{ padding: "8px 12px", color: C.red, fontSize: 12 }}>{error}</div>}
        {!error && files === null && (
          <div style={{ padding: "8px 12px", color: C.muted, fontSize: 12 }}>Loading files…</div>
        )}
        {!error && files !== null && files.length === 0 && (
          <div style={{ padding: "8px 12px", color: C.muted, fontSize: 12 }}>
            No source files found under the project root.
          </div>
        )}
        {!error && files !== null && files.length > 0 && visible.length === 0 && (
          <div style={{ padding: "8px 12px", color: C.muted, fontSize: 12 }}>
            No files match “{query}”.
          </div>
        )}
        {visible.map((f) => (
          <button
            key={f}
            role="listitem"
            className={`db-row${f === selected ? " db-row-active" : ""}`}
            style={S.row}
            onClick={() => void handleSelect(f)}
            title={f}
            aria-label={`Preview ${f}`}
          >
            <span style={{ ...S.rowMeta, color: f === selected ? C.text : C.muted }}>{f}</span>
          </button>
        ))}
      </div>
      {files !== null && files.length > 0 && (
        <div style={{ padding: "6px 12px", borderTop: `1px solid ${C.borderSoft}`, color: C.dim, fontSize: 11, flexShrink: 0 }}>
          {visible.length} of {files.length} files{truncated ? " (agent truncated the listing)" : ""}
        </div>
      )}
      {selected && (
        <div style={S.preview} aria-label={`Preview of ${selected}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, whiteSpace: "normal" }}>
            <span style={{ ...S.ic }}>{selected}</span>
            <button
              className="db-btn db-btn-cyan"
              style={{ ...S.btn, ...S.btnCyan, fontSize: 11, padding: "2px 8px" }}
              onClick={() => onOpenFile(selected, 1, 0)}
              title={`Open ${selected} in VS Code`}
            >
              Open in VS Code
            </button>
            <button
              className="db-btn"
              style={{ ...S.btn, fontSize: 11, padding: "2px 8px" }}
              onClick={() => onViewIdentities(selected)}
              title={`Show component identities registered for ${selected}`}
            >
              View identities
            </button>
          </div>
          {previewError ? (
            <span style={{ color: C.red }}>{previewError}</span>
          ) : preview === null ? (
            <span>Loading preview…</span>
          ) : (
            preview
          )}
        </div>
      )}
    </div>
  );
}
