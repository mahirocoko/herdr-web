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

## Pi subagent observer

`server/pi-subagents.ts` owns parent-scoped child discovery and live-count projection. `server/pi-subagent-routes.ts` owns the GET-only child view; it revalidates the current pane binding after the read. The existing Pi transcript reader supplies bounded branch-aware pages. Browser references are hashes scoped to the parent file, never client-selected native paths. `src/components/PiSubagents.tsx` owns inline call cards and the read-only drill-down, held above virtualized Chat rows by the pane. A single visible Pi pane poll refreshes the cards every two seconds, pausing when the pane/page is hidden; failed reads remove live authority rather than keeping stale running paint. Chat splits its work at the original subagent calls so cards stay visible outside folded blocks. Detail pages reuse the Markdown renderer and code surfaces with structured expandable tool arguments/results.

The installed `@gotgenes/pi-subagents` contract persists terminal `subagents:record` entries but keeps current running/queued/resumed states in its in-process service. `scripts/pi-subagents-extension.ts` is an **optional, explicitly loaded** Pi observer for that gap. It reads the version-1 exact-SessionManager owner registry used by the currently patched package; it never falls back to the legacy process-global service. Other Pi subagent packages or incompatible registry versions are not certified. The observer registers no tools and never sends messages, starts agents, steers or aborts work.

Where an already-configured [mahiro-pi](https://github.com/mahirocoko/mahiro-pi) worker-activity resource from a revision containing the observer command provides `/mh-herdr-web-observer start | stop | status`, prefer that session-only producer. Loading source is not enabling it: start must be explicit after any separately approved reload, and shutdown/reload requires a new start. No Web build installs or enables that resource. Do not run both producers. Both use the same private v1 wire and must target this checkout's runtime root. Pi owns lifecycle production and its resource configuration; Web owns receipt validation, inline Chat placement, activity presentation and read-only child rendering. A generic Pi install or older integration is not sufficient evidence of compatibility.

For a separately authorized **new** Pi launch without that producer, the prototype extension can be loaded explicitly with `pi --extension /absolute/path/to/herdr-web/scripts/pi-subagents-extension.ts`. Do not inject this command into an existing pane or install a global hook as part of a web build. It writes only private snapshots beneath this checkout's ignored `.agent-state/runtime/upstream-v10700/pi-subagents`. It refuses existing non-private directories/files rather than repairing them, does not change the host's umask, and publishes through an owner-only atomic temporary file. Server and observer must refer to this same checkout/runtime root.

Receipts are bounded to 24 children and 16 KiB, refreshed every 2 seconds, and accepted for at most 8 seconds with exact parent file/session and a current Pi foreground PID. Oversized active sets, malformed/expired receipts, missing foreground Pi evidence or an incompatible service provide no live authority. Foreground validation accepts full Pi argv, or an explicit native `argv0: pi` after the exact `herdr:pi` parent binding is validated; a generic process name alone or contradictory argv is insufficient. Completed history can outlive the observer; launches without fresh live evidence remain unknown. The history scan is bounded to 32 MiB and retains 64 recent child records; a fresh live receipt remains usable if history exceeds the bound. The child route omits thinking and does not provide image/full-output fetching or nested-child controls.

The observer currently fails closed on Windows: native ACL-backed snapshot writing is not established. This is not a POSIX-mode or WSL fallback. Historical child reads can still use the Pi reader where its normal identity/path checks pass. Source/fixture checks are not proof that the observer has been loaded in an existing Pi process, nor native, rendered or human acceptance.

## Release-only CI

The active `.github/workflows/ci.yml` runs only on GitHub `release.published`, including published prereleases. Pushes, pull requests, tag pushes alone and saved release drafts do not trigger it; manual workflow dispatch is not enabled. Both hosted jobs check out the release tag explicitly, not the latest default branch. The source/unit and Windows bootstrap checks remain in place; there is no automatic native Herdr job. Local safe checks above remain available before publication.

These checks run **after publication**, not as a pre-release or merge gate. A release tag must contain this workflow revision for the new policy to apply. Changing the workflow does not cancel an already-started run or change branch-protection settings; no release is authorized merely to test the trigger.

## Native and browser boundaries

`bun run test:native` is an opt-in shell-only native fixture through the source disposable-config isolation. It refuses main/default targets, preserves real HOME and cleans up only receipt-owned resources. It does not start agents or authorize paid provider turns.

Broader integration, browser, SSH and updater scripts are imported engineering tools, not routine setup steps. Some can create stand-in agents, install software, change remote hosts or exercise native input. Read the exact owner and obtain separate approval for a bounded disposable lane before executing them. Never feed a user's existing pane or infer permission from an old test receipt.

Run app/reference servers only in verified named visible project terminals. Do not clear browser storage, disturb the normal browser profile or launch hidden detached servers for convenience. Independent QA has a separately assigned owner; the implementation author cannot certify their own work as independent or human-approved.

## Generated source and formatting

Theme colors live in `src/styles.css`. Inspect `scripts/generate-themes.ts`, then use `bun run generate:themes --check` to detect drift. A deliberate regeneration updates the generated theme module, DESIGN's marked table, HTML theme-color and manifest colors. Do not edit generated copies by hand. Protocol generation similarly belongs to `scripts/generate-protocol-types.ts` and `bun run generate:types --check`.

Keep imported double-quote/semicolon style and component anatomy. New UI strings need the existing Korean, Japanese and Simplified Chinese entries with matching placeholders. Format only touched owners with already available tooling; do not install formatters or reformat the repository as incidental work.

## Retired upstream distribution and retained test owners

The fork does not ship upstream's marketing site, README/film production pipeline, one-line installers, remote-bundle builders, Cloudflare telemetry receiver, release/deploy guards or self-hosted runner provisioning. Their exact retired paths and the original-to-current fixture mapping are recorded in `SOURCE_MANIFEST.json` and independently enforced by `scripts/verify-upstream.ts`. The pin and original blob inventory remain unchanged; deletion is not a broad source exception.

| Retained owner | Why it remains |
| --- | --- |
| `scripts/fixtures/demo/`, `scripts/demo-build.ts` | Fictional transport/history/fixtures used by app regression tests, not a deployed website. JSON fixtures are committed data; no native-session capture pipeline remains. |
| `scripts/preview-build.ts` | Optional offline fictional app preview and isolation tests; no marketing build, installer, account or deployment. |
| `scripts/browser-lane.test.ts`, `scripts/ci-browser*`, `scripts/ci-tests.ts`, `scripts/check.ts` | Local runner behavior, input-safety guards and test orchestration. They do not assert the pinned upstream's Pages deployment/cache policy. |
| `herdr-plugin.toml`, `scripts/plugin*`, `scripts/preflight*`, `scripts/with-bun*` | Compatibility fixtures exercised by plugin/runtime, pairing and platform tests. Normal fork startup never registers or starts this plugin. Retention is not install permission. |
| `server/machines.ts`, `server/machine-api.ts`, `shared/machines.ts`, SSH fixtures | Shared local-machine/protocol owners and guarded remote compatibility. Removing a remote bundle builder does not enable or remove local PC functionality. |
| `server/telemetry.ts`, `shared/telemetry.ts` | Optional wire/schema compatibility used by server/client tests. The normal fork launcher supplies no telemetry instance; this fork deploys no receiver. |
| `scripts/release-notes.ts`, `scripts/changelog-fold.ts`, `release-summaries.json` | Patch-note parsing/folding and app-visible release history, not authorization for plugin/remote/Worker publishing. |
| `docs/upstream-reference/`, `docs/history/legacy/` | Pinned provenance and dated history, not active commands or current deployment policy. |

`build:site` and `build:remote` are intentionally absent from package scripts. New features belong to runtime owners above, not retired marketing/deployment tools. Before deleting any retained compatibility owner, trace its test and runtime consumers; disabled capability is not proof of dead code.

## Provenance, references and publishing

The manifest records the source pin and exact approved promotion patches/additions; it cannot authorize its own changes. Update the independent verifier policy and focused fixtures when a new approved owner requires it. Do not replace exact entries with broad Markdown exemptions or rerun promotion for routine work. Licenses, notices, dependency patches and pinned upstream README blobs remain protected.

This page and the guides linked from the root README are current fork documentation. Other imported technical notes and upstream-reference readmes are pinned reference material, not current deployment, release or support authority. Historical guides and release entries retain their original context. See [coverage](upstream-parity.md) before treating a source feature as verified.

Fork releases are source-only and require explicit publication authorization. The retained plugin compatibility manifest and patch-note helpers do not define this fork's publishing process. Do not assume upstream workflows, review templates or nested agent-instruction files exist in this checkout. External CI run approval is distinct from review and merge protection; no enforced branch-protection setting is promised by these docs.
