# Development

Read [Installation](../INSTALL.md) for the exact runtime and frozen setup, [Contributing](../CONTRIBUTING.md) for PR scope, and [AGENTS.md](../AGENTS.md) for safety rules. Normal `start`, `server` and `dev` commands all use the same foreground launcher. They are not separate API/HMR servers.

## Architecture and source owners

The root is one source-native application adopted from the pinned upstream tree, not the retired React Router frontend with an adapter.

| Area                                                  | Owner                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| React shell and selection                             | `src/App.tsx`, `src/main.tsx`                                                                                |
| Sidebar, Chat, composer, terminal, files and settings | `src/components/` and adjacent component CSS                                                                 |
| Shared styling, themes and settings                   | `src/styles.css`, `src/lib/`                                                                                 |
| Display localization                                  | `src/lib/i18n.ts`, `src/lib/i18n.th.ts`; release languages in `shared/update.ts`                             |
| HTTP/WebSocket server and source composition          | `server/index.ts`, `server/core/`                                                                            |
| Fork ingress/capability policy                        | `server/fork-policy.ts`; read-only Serve discovery in `scripts/run-local.ts`                                   |
| Native RPC and Node PTY                               | `server/herdr/`, `server/pty/`                                                                               |
| Conversation dispatch/readers                         | `server/conversation.ts`, provider modules including `server/letta.ts`                                       |
| Letta private index/parser and Stop witness           | `server/letta-store.ts`, `server/letta-parser.ts`, `server/letta-stop.ts`                                    |
| Pending/held input                                    | `server/pending-input.ts`, `src/lib/pendingMessages.ts`                                                      |
| Wire contracts                                        | `shared/protocol.ts`, generated Herdr types in `shared/`                                                     |
| Local bootstrap and private filesystem                | `scripts/bun-project.mjs`, `scripts/run-local.ts`, `scripts/private-filesystem.ts` and its PowerShell helper |
| PWA                                                   | `public/manifest.webmanifest`, `public/sw.js`                                                                |
| Source provenance                                     | `SOURCE_MANIFEST.json`, `scripts/verify-upstream.ts`                                                         |

Herdr owns native processes and sessions. Real Node owns `@lydell/node-pty`; do not import that native addon into Bun. Browser serialization exposes presentation tokens, not raw native session/state-label records. Put HTTP/WS changes in shared contracts and both consumers, with a focused regression test.

The fork's display languages are English and Thai. `system` resolves only those two browser languages and otherwise falls back to English; stored upstream `ko`, `ja` and `zh` choices sanitize back to `system`. Dictation locale remains a separate setting and may use other supported speech locales. Every literal `t(…)`/`tt(…)` key must exist in `i18n.th.ts` with identical placeholders. App-visible release notes require English for historical fallback, while every newly cut release must provide both English and Thai summaries.

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

## Private ingress discovery

The launcher supplies `RefreshingForkPolicy` from `server/fork-policy.ts`, not a permanent startup snapshot. Startup performs one discovery; later private-host requests share an asynchronous read of `tailscale serve status --json` when the cached result is at least ten seconds old. Each CLI read is bounded to five seconds and 64 KiB. Local-host and non-loopback requests never wait for discovery. There is no background polling or Serve configuration change.

`localPolicy` in `scripts/run-local.ts` re-reads the existing private owner configuration and verifies the same exact HTTPS-name/root-proxy match to this loopback port. An unavailable CLI, invalid result, missing route or rejected private configuration withdraws the cached private grant. A later request can recover without restarting Web. The newly verified owner also supplies source authentication for that request; the startup owner cannot keep a recovered route stuck. Host, loopback peer, owner, private source, Funnel and Origin checks still run before handlers, including WebSocket upgrades.

The readiness log describes discovery **at startup**, not permanent Tailscale availability or physical-phone acceptance. Unit regressions in `server/fork-policy.test.ts` and `scripts/run-local.test.ts` cover unavailable startup → ready → failed refresh → recovery, shared reads and immediate local access. The HTTP fixture verifies source auth as `via: tailscale`; it does not establish device connectivity or Push delivery.

## Durable private state

`server/private-state.ts` owns durable replacement of security records that cannot be reconstructed safely: `devices.json`, `vapid.json` and `push-subscriptions.json`. It creates an exclusive same-directory temporary file, writes every byte, fsyncs and closes the file, atomically renames it, then attempts a parent-directory fsync on POSIX. A failure through rename leaves the previous destination intact and removes the temporary; directory-sync failure after rename is reported only as a weaker durability result because the new document is already in place. Existing modes are never widened beyond `0600`. Windows keeps the existing private-state directory/ACL guard and does not claim POSIX directory-sync evidence.

Callers must build the next authorization/subscription value separately and replace in-memory state only after `writePrivateState` returns. `push-retired.json` remains non-authoritative telemetry and keeps its cheaper existing whole-file path. Never rotate VAPID keys or rewrite subscriptions as a migration or test cleanup.

## Pi subagent observer

`server/pi-subagents.ts` owns parent-scoped child discovery and live-count projection. `server/pi-subagent-routes.ts` owns the GET-only child view; it revalidates the current pane, parent session, child path and child header after the read. The existing Pi transcript reader supplies bounded branch-aware pages. Responses expose only opaque content revisions, read/transcript times, earlier-page and omitted-branch counts; browser references are hashes scoped to the parent file, never client-selected native paths. Unavailable identity returns 404, a changed identity/cursor returns 409 and an otherwise validated transcript that cannot be read returns 503, all without native paths.

`src/components/PiSubagents.tsx` owns inline call cards and the read-only drill-down, held above virtualized Chat rows by the pane. The same opaque `detail_id` opens from Chat and `BackgroundTasks.tsx`. A single visible Pi pane poll refreshes the cards and open latest detail every two seconds, pausing when the pane/page is hidden. Failed activity-list reads remove live authority rather than keeping stale running paint; failed detail refreshes may retain the last successful content but label it stale. Initial loading, background refresh, empty, unreadable/missing, bounded and earlier-page states are distinct. Chat splits its work at the original subagent calls so cards stay visible outside folded blocks. Detail pages reuse the Markdown renderer and code surfaces with structured prompt, prose and expandable tool input/results/errors; they do not mount another Chat or composer.

The installed `@gotgenes/pi-subagents` contract persists terminal `subagents:record` entries but keeps current running/queued/resumed states in its in-process service. The compatible [mahiro-pi worker-activity resource](https://github.com/mahirocoko/mahiro-pi/blob/main/docs/integrations.md) is the **single producer** for both runtimes. Its explicitly registered resource and owner-private `herdr-web.json` profile target are a [one-time setup](../INSTALL.md#one-time-pi-setup-both-runtimes), not per-session commands. After separately approved activation, every TUI session using that profile automatically publishes through Pi session_start/shutdown, including replacement and reload, independent of cwd. Public exact-SessionManager lookup is mandatory; the legacy global service is never a fallback. Missing child service permits parent-only `activity: "unavailable"`, never live child authority. RPC/print/embedded SDK children cannot acquire or retire the TUI producer. It registers no tools and sends no messages, starts no agents and steers/aborts no work.

Pi owns lifecycle production, profile configuration, one bounded poll and generation-fenced atomic publication. Web owns foreground validation, receipt admission, Chat placement and read-only rendering. The runtime-neutral writer needs no old Herdr socket/CLI inside Pi. It publishes only to the configured checkout's ignored `.agent-state/runtime/upstream-v10700/pi-subagents`, never session cwd. Normal shutdown/reload conditionally revokes its own generation's receipt without erasing a successor; a crash relies on the eight-second lease. `/mh-herdr-web-observer status` reports local health, not consumer acceptance; `stop` suspends the current session only. No Web build configures, activates or reloads Pi. Older installed producer copies must be retired separately. `scripts/pi-subagents-extension.ts` now retains only a non-writing migration notice, not another producer.

The writer refuses non-private or linked runtime nodes, never repairs modes/ACLs or changes umask, and uses owner-only exclusive temporaries plus atomic rename. Windows remains unavailable for live publication. Server and producer must share the configured runtime root and compatible Pi store.

Receipts are bounded to 24 children and 16 KiB, refreshed every 2 seconds, and accepted for at most 8 seconds with exact parent file/session and a current Pi foreground PID. Oversized active sets, malformed/expired receipts, missing foreground Pi evidence or an incompatible service provide no live authority. Foreground validation accepts full Pi argv, or an explicit native `argv0: pi` after the exact `herdr:pi` parent binding is validated; a generic process name alone or contradictory argv is insufficient. Completed history can outlive the observer; launches without fresh live evidence remain unknown. The history scan is bounded to 32 MiB and retains 64 recent child records; a fresh live receipt remains usable if history exceeds the bound. The child route omits thinking and does not provide image/full-output fetching or nested-child controls.

The observer currently fails closed on Windows: native ACL-backed snapshot writing is not established. This is not a POSIX-mode or WSL fallback. Historical child reads can still use the Pi reader where its normal identity/path checks pass. Source/fixture checks are not proof that the observer has been loaded in an existing Pi process, nor native, rendered or human acceptance.

## Release-only CI

The active `.github/workflows/ci.yml` runs only on GitHub `release.published`, including published prereleases. Pushes, pull requests, tag pushes alone and saved release drafts do not trigger it; manual workflow dispatch is not enabled. Both hosted jobs check out the release tag explicitly, not the latest default branch. The source/unit and Windows bootstrap checks remain in place; there is no automatic native Herdr job. Local safe checks above remain available before publication.

These checks run **after publication**, not as a pre-release or merge gate. A release tag must contain this workflow revision for the new policy to apply. Changing the workflow does not cancel an already-started run or change branch-protection settings; no release is authorized merely to test the trigger.

## Opt-in herdr-core compatibility

The foreground fork launcher provides `bun run start:core` and `bun run start:herdr`, passing `--runtime=herdr-core` or `--runtime=herdr` to `scripts/run-local.ts`. These explicit selections override inherited `OVIS_RUNTIME` for the Web process only; they never auto-detect or fall back. Runtime selection with no CLI override remains unchanged: `OVIS_RUNTIME=herdr-core` selects core on Linux/macOS; unset, empty or `herdr` retains the existing protocol-22 runtime. `--help`/`-h` works with either alias without building or starting a runtime; unknown or repeated runtime arguments are refused before startup. `OVIS_HC_BIN` optionally selects an already installed `hc`. This is a focused adaptation from upstream candidate `a4ff0c942716602c43362f05c8511984e2bcae44`, not a provenance repin or permission to install/start a core server. `hc connect` uses its own existing endpoint resolution, with the current process environment passed explicitly (Bun's implicit subprocess environment can retain its startup snapshot). Fake-transport unit checks are separate from the bounded disposable macOS-native validation described below.

`server/herdr-core/` owns the framed connection, snapshot projection and private compatibility socket. It only starts through `scripts/run-local.ts`, after the occupied-port check and private runtime preparation; `createServer` alone never starts it. Startup refuses an occupied socket path, noncanonical/nonprivate state or unsupported platform instead of deleting, repairing or falling back. The launcher restores the previous `HERDR_SOCKET` on shutdown/startup failure. The framed connection pins the first core identity: a reconnect to a different core fails before requests can target reused terminal addresses. Fork ingress, privacy serialization, manual input lanes, pending holds and Letta Stop guards remain in their existing owners.

The adapter supports snapshots, pane/agent/process reads, text screen reads, status/lifecycle subscriptions and native text/key/prompt forwarding. `attach-session.ts` streams terminal channels over the same framed connection without a PTY or `hc attach` process. Native attach acknowledgment gates readiness; pre-ready typing is refused, not buffered/replayed. Observer-first viewing starts at the native grid, and the existing interaction/geometry owner gates later resizes. Stream credit provides pause/resume backpressure; closing/loss holds pending input and ends the attachment without automatically replaying input or taking another viewer's slot. The old runtime's PTY recovery is unchanged. Core does not implement the desktop app's focus/layout/takeover controls. It also has no independent read-only viewport/watch stream: Web omits the `watch` capability and ends stale watch requests without spawning the old Herdr CLI or substituting an attachment. The old runtime's read-only watcher is unchanged. Same-size repaint requests remain a no-op in the upstream channel adapter, so a late viewer whose bounded replay lost the initial paint may wait for the program's next redraw; this is not certified repaint parity.

Agent starts/manifests, create/close/split/focus/reorder/worktree/plugin operations are refused rather than translated into shell commands or desktop document writes. Send uses `terminal.send`; RPC raw typing uses a short `terminal.attach` at the terminal's own grid, live-terminal input uses its existing channel, and named keys (including Stop keys) use `terminal.keys`. A lost/expired acknowledgment is an error, not delivery success or retry consent. Terminal focus reporting is enabled once at attach; later focus refreshes query display facts without re-enabling it, avoiding an xterm focus/query feedback loop. Fake-transport protocol/stream checks do not establish supported behavior for every agent.

**Pi binding:** core app/status/foreground records alone do not identify an active session. `pi-binding.ts` consumes the configured automatic producer's private v1 receipt from this checkout. It requires exact foreground Pi argv/PID, canonical hashed parent path, matching session header, the existing Pi store guards, valid bounded records and an 8-second freshness lease. Discovery is bounded to 128 directory entries; conflicting fresh SessionManagers on one PID fail closed. It publishes only a server-private `herdr-core:pi-observer` identity, never fabricates `herdr:pi`, and never derives authority from cwd/title/labels/status. Existing Pi transcript and child-route guards revalidate the parent; browser presentation still omits raw session/state-label records.

The configured mahiro-pi worker-activity resource supplies the same automatic producer in both runtimes; no per-session start, Herdr socket or `hc` invocation is needed inside Pi. Exact-owner service lookup supplies live child records when available; without it the observer publishes only parent identity with `activity: "unavailable"`, allowing guarded parent transcript/questionnaire reads but no live child count. Historical child reads retain their existing parent/child checks. Malformed/oversized service results supply no receipt rather than pretending the child set is empty. The original Herdr native Pi integration remains its separate identity/lifecycle owner, not a second Web receipt producer. Without a compatible fresh receipt, core Pi history/questionnaire/subagent reads remain unavailable. The installed core Terminal/Foreground/Status schema exposes no SessionManager path or ID, and open-file inspection is not a stable current-session protocol. There is no proven source-only hot binding for an existing Pi without a producer: no cwd/title/mtime scan, manually assigned mapping, stale old-socket report or status label substitutes for exact active-session evidence. The [installation guide](../INSTALL.md#one-time-pi-setup-both-runtimes) documents explicit one-time profile setup and the separate activation boundary. No global hooks, profile edits, observer activation or agent starts are performed by Web. The old runtime's identity path is unchanged. Bounded disposable macOS validation has exercised installed `hc` and real Pi with a loopback synthetic provider: observer parent binding/expiry, browser Chat Send/Stop followed by a new manual Send, terminal input, and attach pre-ready/closed/lost-stream input refusal without replay. Initial synthetic child registry/transcript fixtures exercised live-count and read-only Markdown/code rendering. Subsequent disposable tests used the installed gotgenes package's real in-process SDK worker with a local synthetic provider, then exercised Chat dispatch, running child detail and completed Markdown/code refresh through the full Web shell against an App-associated target; no paid provider was used. These are implementation-author checks, not independent QA, real-provider certification, device or human acceptance. This opt-in is not full runtime parity.

## Native and browser boundaries

`bun run test:native` is an opt-in shell-only native fixture through the source disposable-config isolation. It refuses main/default targets, preserves real HOME and cleans up only receipt-owned resources. It does not start agents or authorize paid provider turns.

Broader integration, browser, SSH and updater scripts are imported engineering tools, not routine setup steps. Some can create stand-in agents, install software, change remote hosts or exercise native input. Read the exact owner and obtain separate approval for a bounded disposable lane before executing them. Never feed a user's existing pane or infer permission from an old test receipt.

Run app/reference servers only in verified named visible project terminals. Do not clear browser storage, disturb the normal browser profile or launch hidden detached servers for convenience. Independent QA has a separately assigned owner; the implementation author cannot certify their own work as independent or human-approved.

## Generated source and formatting

Theme colors live in `src/styles.css`. Inspect `scripts/generate-themes.ts`, then use `bun run generate:themes --check` to detect drift. A deliberate regeneration updates the generated theme module, DESIGN's marked table, HTML theme-color and manifest colors. Do not edit generated copies by hand. Protocol generation similarly belongs to `scripts/generate-protocol-types.ts` and `bun run generate:types --check`.

Keep imported double-quote/semicolon style and component anatomy. New UI strings need a natural Thai entry with matching placeholders in `src/lib/i18n.th.ts`; English remains the source key and fallback. Format only touched owners with already available tooling; do not install formatters or reformat the repository as incidental work.

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
