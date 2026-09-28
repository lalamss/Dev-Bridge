# DevBridge

> A bidirectional browser-to-code development workspace that connects every
> visible UI element to its source, design tokens, state, accessibility,
> runtime behavior, network activity, backend code, tests, Git history, and
> performance data.

This repo is the **V1 vertical slice** the architecture doc calls out in
section 70-71 — the smallest thing that proves the central idea end to end:

```
React + Vite → Build Plugin → Dev Identity → Chrome Extension →
DOM Selection → Source Mapping → Monaco (stubbed) → Patch → Diff →
Preview → Apply → Git
```

Everything is structured so the later layers (state, network, a11y,
performance, AI, collaboration) slot in without touching the core — see
"What's stubbed" below.

## Monorepo layout

```
devbridge/
├── packages/
│   ├── protocol/          shared types + zod schemas — the wire format
│   │                       every other package and the browser<->agent
│   │                       boundary speaks (doc §6, §51, §55)
│   ├── dev-identity/       DevIdentityRegistry — the "universal correlation
│   │                       key" (doc §6-7)
│   ├── source-mapper/      file hashing + range extraction, used for the
│   │                       "hash matches?" conflict check (doc §54)
│   ├── patch-engine/       propose → preview → apply lifecycle + risk
│   │                       assessment (doc §13, §39, §54)
│   ├── git-manager/        checkpoints, last-known-good, reversible
│   │                       rollback (doc §40)
│   └── framework-core/     the FrameworkAdapter interface every framework
│                           plugs into (doc §5)
├── adapters/
│   └── react/               ReactAdapter: Babel transform that injects
│                            data-dev-id + a minimal runtime bridge (doc §21-22)
├── plugins/
│   └── vite/                 the one-line app integration point (doc §4)
├── apps/
│   ├── local-agent/          Express + WS server — the security boundary
│   │                         between the browser and the filesystem (doc §52-54)
│   ├── chrome-extension/     MV3 extension: content script (DOM select/
│   │                         overlay), DevTools panel (inspector UI) (doc §8-11)
│   └── cli/                   `devbridge status/diff/preview/apply/rollback`,
│                              talks to the exact same agent protocol as the
│                              panel (doc §47-48)
└── examples/
    └── react-vite/            a plain React app to test the whole pipeline
                                against — one plugin line, no other changes
```

## Running it

```bash
pnpm install

# 1. Start the local agent against the example app
DEVBRIDGE_PROJECT_ROOT=$(pwd)/examples/react-vite pnpm agent

# 2. In another terminal, start the example app's dev server
pnpm example

# 3. Build the extension and load apps/chrome-extension/dist as an
#    unpacked extension in Chrome (chrome://extensions -> Developer mode)
pnpm --filter @devbridge/chrome-extension build

# 4. Open http://127.0.0.1:5173, open Chrome DevTools -> "DevBridge" panel,
#    click "Start inspecting", click the checkout button.
```

The CLI works against the same agent:

```bash
pnpm cli status
pnpm cli diff
```

## The core idea, in code

Everything hangs off `DevIdentity.id` (`packages/protocol/src/types.ts`),
generated deterministically from `(file, line, column, component)` in
`packages/dev-identity/src/generateId.ts`. The Babel plugin in
`adapters/react/src/babelPlugin.ts` stamps that id onto the rendered DOM
element as `data-dev-id` and reports it to the local agent's
`DevIdentityRegistry`. From there, every other subsystem — source, design
tokens, a11y, state, network, Git — looks things up by that same id (doc §68).

## What's implemented vs. stubbed

| Layer (doc §3)                    | Status |
|------------------------------------|--------|
| 1. Build Intelligence              | ✅ Vite plugin + Babel Dev Identity injection |
| 2. Dev Identity                    | ✅ Registry, stable ids, line-drift remapping |
| 3. Browser Runtime                 | ✅ Content script: hover, select, overlay, Source→DOM |
| 4. Development Workspace           | 🟡 Source fetch + preview wired; Monaco itself not embedded yet |
| 5. Design & Accessibility          | 🟡 Types + protocol defined (doc §15-19); no token/axe-core engine yet |
| 6. State & Data Intelligence       | 🟡 Runtime WS bridge + protocol defined; render/state UI not built |
| 7. Runtime & Backend Intelligence  | ⬜ Not started (doc §28-29) |
| 8. Change Safety & Git             | ✅ Checkpoints, last-green, reversible rollback |
| 9. Collaboration & Session System  | ⬜ Not started (doc §30-35) |
| 10. AI + Ecosystem                 | 🟡 `AIPermissions` enforced server-side in `SecurityManager`; no model call wired in |

The patch engine (`packages/patch-engine`) and security boundary
(`apps/local-agent/src/SecurityManager.ts`) are deliberately the most
finished pieces — doc §52-54 treats filesystem safety as non-negotiable, so
that's where this scaffold puts the most rigor: every write path re-checks
the file hash and re-validates the path is inside the authorized project
root before touching disk.

## Next steps toward V1.5 (doc §72)

- `packages/design-tokens`: parse Tailwind config / CSS custom properties,
  round-trip token edits back to their source file (doc §16)
- `packages/accessibility`: wrap axe-core, surface issues keyed by `devId`
- Embed Monaco in the DevTools panel and wire `PatchEngine.create()` to it
- `apps/local-agent`: a `/test` route that shells out to the project's
  registered test command only (already gated by `SecurityManager.assertCommandAllowed`)
