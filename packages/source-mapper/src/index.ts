import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SourceLocation } from "@devbridge/protocol";

/** Hash used to detect concurrent/out-of-band file edits (section 54: "Hash matches?"). */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashFile(absPath: string): string {
  return hashContent(readFileSync(absPath, "utf-8"));
}

/** Extract the exact text range for a SourceLocation out of a file's contents. */
export function extractRange(content: string, loc: SourceLocation): string {
  const lines = content.split("\n");
  if (loc.start.line === loc.end.line) {
    return lines[loc.start.line - 1].slice(loc.start.column, loc.end.column);
  }
  const parts: string[] = [];
  for (let line = loc.start.line; line <= loc.end.line; line++) {
    const text = lines[line - 1] ?? "";
    if (line === loc.start.line) parts.push(text.slice(loc.start.column));
    else if (line === loc.end.line) parts.push(text.slice(0, loc.end.column));
    else parts.push(text);
  }
  return parts.join("\n");
}

/** Number of lines a replacement adds/removes relative to the original range — used to remap Dev Identities (section 33). */
export function lineDelta(loc: SourceLocation, replacement: string): number {
  const originalLines = loc.end.line - loc.start.line + 1;
  const newLines = replacement.split("\n").length;
  return newLines - originalLines;
}
