/**
 * Origin policy — architecture doc section 52 (the trust boundary).
 *
 * The local agent reads and writes the developer's source files, so "who is
 * allowed to ask it to do that" is a security decision, not a CORS formality.
 * `cors()` with no configuration answers that question with "any page on the
 * internet", which turns every site the developer visits into a client of
 * their filesystem (demonstrated in docs/audit/2026-10-05-audit.md, S2/S3).
 *
 * Three kinds of client legitimately talk to the agent:
 *
 *   1. The DevTools panel / extension pages — origin `chrome-extension://<id>`.
 *      The id is derived from the unpacked extension's path, so it is stable
 *      per machine but unknown at authoring time; it can be pinned with
 *      DEVBRIDGE_EXTENSION_ID once you know it (chrome://extensions).
 *   2. The inspected app's own page and the Vite dev server serving it —
 *      origin `http://localhost:<port>` / `http://127.0.0.1:<port>`.
 *   3. Node clients with no browser in the loop: the CLI, and the Vite
 *      plugin's `fetch`. These send **no** Origin header at all.
 *
 * Anything else — a normal web page, a sandboxed iframe (`Origin: null`), a
 * page served from a real remote origin — is refused.
 *
 * A missing Origin is allowed on purpose: it is what a non-browser client
 * looks like, and every route that mutates state requires a JSON body, which
 * browsers can only send cross-origin after a successful preflight. Combined
 * with the loopback-only listener in index.ts, "no Origin" narrows to local
 * processes, which is the trust boundary the project chose (no capability
 * token — see the audit report, S2).
 */

const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

export interface OriginAllowlistOptions {
  /** Extra/complete origin list. Replaces the defaults entirely when provided. */
  configured?: string | string[] | undefined;
  /** Pin the extension id instead of accepting any well-formed one. */
  extensionId?: string | undefined;
}

/**
 * Build the list of accepted origins. Entries may end in `*` to allow a
 * prefix (used for `chrome-extension://*`, whose id is not known ahead of
 * time, and for loopback ports).
 */
export function buildOriginAllowlist(options: OriginAllowlistOptions = {}): string[] {
  const configured = toList(options.configured);
  for (const entry of configured) {
    if (entry === "*") {
      throw new Error(
        'DEVBRIDGE_ALLOWED_ORIGINS may not contain a bare "*" — that re-opens the agent to every web page. Use "chrome-extension://*" plus the loopback origins you need.',
      );
    }
  }
  if (configured.length > 0) return configured;

  const allowlist: string[] = [];
  if (options.extensionId) {
    if (!/^[a-p]{32}$/.test(options.extensionId)) {
      throw new Error(
        `DEVBRIDGE_EXTENSION_ID must be a 32-character Chrome extension id (a-p), got "${options.extensionId}".`,
      );
    }
    allowlist.push(`chrome-extension://${options.extensionId}`);
  } else {
    allowlist.push("chrome-extension://*");
  }
  allowlist.push("http://localhost:*", "http://127.0.0.1:*");
  return allowlist;
}

function toList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : value.split(",");
  return raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function matchesAllowlist(origin: string, allowlist: readonly string[]): boolean {
  for (const entry of allowlist) {
    if (entry.endsWith("*")) {
      if (origin.startsWith(entry.slice(0, -1))) return true;
    } else if (origin === entry) {
      return true;
    }
  }
  return false;
}

/**
 * True when a request carrying this Origin may talk to the agent.
 *
 * `undefined`/`""` means the client sent no Origin header — a Node client, or
 * a browser GET that never left an origin context. See the file header for why
 * that is accepted.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowlist: readonly string[],
): boolean {
  if (origin === undefined || origin === "") return true;
  // Sandboxed iframes and file:// pages report the literal string "null",
  // which would otherwise slip past a substring check.
  if (origin === "null") return false;
  if (origin.startsWith("chrome-extension://")) {
    // No web page can claim a chrome-extension:// origin, but an over-broad
    // allowlist entry should not be able to widen this into a free pass for
    // any origin at all — so the id shape is always enforced first.
    return CHROME_EXTENSION_ORIGIN.test(origin) && matchesAllowlist(origin, allowlist);
  }
  return matchesAllowlist(origin, allowlist);
}

/** Reads the allowlist from the environment once, at agent startup. */
export function originAllowlistFromEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return buildOriginAllowlist({
    configured: env.DEVBRIDGE_ALLOWED_ORIGINS,
    extensionId: env.DEVBRIDGE_EXTENSION_ID,
  });
}