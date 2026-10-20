# Development

Read [Installation](../INSTALL.md) for the exact runtime and frozen setup, [Contributing](../CONTRIBUTING.md) for PR scope, and [AGENTS.md](../AGENTS.md) for safety rules. Normal `start`, `server` and `dev` commands all use the same foreground launcher. They are not separate API/HMR servers.

## Architecture and source owners

The root is one source-native application adopted from the pinned upstream tree, not the retired React Router frontend with an adapter.

| Area                                                  | Owner                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| React shell and selection                             | `src/App.tsx`, `src/main.tsx`                                                                                |
| Sidebar, Chat, composer, terminal, files and settings | `src/components/` and adjacent component CSS                                                                 |
| Shared styling, themes and settings                   | `src/styles.css`, `src/lib/`                                                                                 |
| HTTP/WebSocket server and source composition          | `server/index.ts`, `server/core/`                                                                            |
| Fork ingress/capability policy                        | `server/fork-policy.ts`                                                                                      |
| Native RPC and Node PTY                               | `server/herdr/`, `server/pty/`                                                                               |
| Conversation dispatch/readers                         | `server/conversation.ts`, provider modules including `server/letta.ts`                                       |
| Letta private index/parser and Stop witness           | `server/letta-store.ts`, `server/letta-parser.ts`, `server/letta-stop.ts`                                    |
| Pending/held input                                    | `server/pending-input.ts`, `src/lib/pendingMessages.ts`                                                      |
| Wire contracts                                        | `shared/protocol.ts`, generated Herdr types in `shared/`                                                     |
| Local bootstrap and private filesystem                | `scripts/bun-project.mjs`, `scripts/run-local.ts`, `scripts/private-filesystem.ts` and its PowerShell helper |
| PWA                                                   | `public/manifest.webmanifest`, `public/sw.js`                                                                |
| Source provenance                                     | `SOURCE_MANIFEST.json`, `scripts/verify-upstream.ts`                                                         |

Herdr owns native processes and sessions. Real Node owns `@lydell/node-pty`; do not import that native addon into Bun. Browser serialization exposes presentation tokens, not raw native session/state-label records. Put HTTP/WS changes in shared contracts and both consumers, with a focused regression test.

## Safe checks

Run from the repository root using the existing exact Bun bootstrap:

```sh
bun run typecheck
bun run test:unit
bun run source:verify
```

`typecheck` checks app/server and tools configurations. `test` and `test:unit` use the isolated unit runner, one worker with per-file processes. `source:verify` derives the pinned Git inventory independently and checks explicit changes, modes, notices and retired-owner exclusions. It needs the existing ignored pinned reference; do not silently clone or install dependencies to make a check work.

For a narrow unit regression, name the test files explicitly:

```sh
HERDR_TEST_MODE=unit bun scripts/bun-project.mjs test --preload ./scripts/test-herdr.ts scripts/docs-contracts.test.ts
```

On PowerShell set `$env:HERDR_TEST_MODE = "unit"` first, then run the same command without the inline assignment. Do not run bare `bun test`: `bunfig.toml` includes native preload and is not the safe unit entrypoint. Check results against the actual dirty candidate, not merely its unchanged HEAD revision.

A standalone `bun run build` writes normal `dist/`. Never run it over assets served by a live instance. With dependencies already installed, an isolated client check can use:

```sh
bun scripts/bun-project.mjs --bun vite build --outDir .agent-state/qa/client-build
```

Choose an owned output directory and keep private artifacts ignored. Tests, builds and source checks do not replace rendered verification, native proof or human acceptance.

## Native and browser boundaries

`bun run test:native` is an opt-in shell-only native fixture through the source disposable-config isolation. It refuses main/default targets, preserves real HOME and cleans up only receipt-owned resources. It does not start agents or authorize paid provider turns.

Broader integration, browser, SSH, remote-build and updater scripts are imported engineering tools, not routine setup steps. Some can create stand-in agents, install software, change remote hosts or exercise native input. Read the exact owner and obtain separate approval for a bounded disposable lane before executing them. Never feed a user's existing pane or infer permission from an old test receipt.

Run app/reference servers only in verified named visible project terminals. Do not clear browser storage, disturb the normal browser profile or launch hidden detached servers for convenience. Independent QA has a separately assigned owner; the implementation author cannot certify their own work as independent or human-approved.

## Generated source and formatting

Theme colors live in `src/styles.css`. Inspect `scripts/generate-themes.ts`, then use `bun run generate:themes --check` to detect drift. A deliberate regeneration updates the generated theme module, DESIGN's marked table, HTML theme-color and manifest colors. Do not edit generated copies by hand. Protocol generation similarly belongs to `scripts/generate-protocol-types.ts` and `bun run generate:types --check`.

Keep imported double-quote/semicolon style and component anatomy. New UI strings need the existing Korean, Japanese and Simplified Chinese entries with matching placeholders. Format only touched owners with already available tooling; do not install formatters or reformat the repository as incidental work.

## Provenance, references and publishing

The manifest records the source pin and exact approved promotion patches/additions; it cannot authorize its own changes. Update the independent verifier policy and focused fixtures when a new approved owner requires it. Do not replace exact entries with broad Markdown exemptions or rerun promotion for routine work. Licenses, notices, dependency patches and pinned upstream README blobs remain protected.

This page and the guides linked from the root README are current fork documentation. Other imported technical notes, website/demo tools and upstream-reference readmes are pinned reference material, not current deployment, release or support authority. Historical guides and release entries retain their original context. See [coverage](upstream-parity.md) before treating a source feature as verified.

Fork releases are source-only and require explicit publication authorization. Imported plugin manifests, remote bundles and release scripts do not define this fork's publishing process. Do not assume upstream workflows, review templates or nested agent-instruction files exist in this checkout. External CI run approval is distinct from review and merge protection; no enforced branch-protection setting is promised by these docs.
