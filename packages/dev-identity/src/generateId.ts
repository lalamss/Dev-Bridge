import { createHash } from "node:crypto";

/**
 * Deterministic-ish Dev Identity generation.
 *
 * We hash (file + start position + component name) so the same JSX element
 * gets the same dvi_* id across rebuilds as long as its location in the file
 * doesn't move — which keeps devtools state, comments, and AI permission
 * grants stable across small edits (see section 33: comments outlive line
 * number changes).
 */
export function generateDevId(file: string, line: number, column: number, componentName: string | null): string {
  const hash = createHash("sha1")
    .update(`${file}:${line}:${column}:${componentName ?? ""}`)
    .digest("hex")
    .slice(0, 8);
  return `dvi_${hash}`;
}
