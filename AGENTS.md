# Repository working rules

## Authority and ownership

This is the source-native Herdr Web fork. Read the current task, human constraints, git status and nearest source owners before writing. Preserve unrelated changes. A prior task receipt, pane identifier or test approval is not standing permission for new native input, provider spend or external changes.

[README.md](README.md) routes readers to the current guides. [Installation](INSTALL.md) owns setup, [development](docs/development.md) owns architecture/checks, [DESIGN.md](DESIGN.md) owns the human UI reference, and [upstream parity](docs/upstream-parity.md) owns coverage and limitations. Current source overrides stale prose. Imported technical references, pinned readmes in `docs/upstream-reference/`, and `docs/history/legacy/` do not authorize deployment or revive retired architecture. Changelog and release summaries retain historical meaning; do not turn them into current instructions.

The adopted pin is `d918448647e41079c52047ffc96cdaac50ccba32` from `devswha/herdr-web-ui`. `SOURCE_MANIFEST.json` records inventory and explicit exceptions; `scripts/verify-upstream.ts` independently checks them. Never broaden exceptions to hide unexplained changes, repin or rerun acquisition/promotion without approval. Preserve `LICENSE`, `UPSTREAM_LICENSE`, third-party notices and both dependency patches.

## Source and UI

`src/`, its component CSS, fonts and fixtures own the UI. Keep the accepted source shell/anatomy and current fork brand. Imported client code uses double quotes and semicolons; follow each owner's conventions and avoid mass formatting. There is no active legacy React Router/DTO app. Adapt a legacy behavior only for an approved missing capability or a concrete evidence-backed advantage, through current owners rather than a parallel architecture.

Use existing protocol, i18n, theme and focus primitives. Do not hand-edit generated types/themes. Subscription usage is hidden at rendering boundaries, not deleted from backend data. About is fork-owned; app-owned install/update controls are not authorization to enable upstream services. Browser PWA/service-worker functionality remains intact. The Letta integration describes local private history, not installed global hooks.

## Runtime and privacy

Normal startup is `bun start` through `scripts/bun-project.mjs` and `scripts/run-local.ts` into `createServer`. `server` and `dev` are the same foreground build-and-serve path. It rejects an occupied loopback port before rebuilding. Do not invoke upstream direct-main, managed supervisor, installers or plugin registration. Exact Bun 1.4.2 must already exist; never install or upgrade it globally. Real Node, never Bun, owns `@lydell/node-pty`.

Use verified named visible project Herdr terminals for app/reference servers, without changing focus. Revalidate PID, argv, cwd and pane before signaling. Do not create hidden detached product servers or rebuild a live instance's `dist/` for QA. Reuse the instance or use isolated build output.

Runtime state lives under ignored `.agent-state/runtime/upstream-v10700`, with private POSIX permissions or native ACL validation. All `.agent-state` content is local-only, including retrospectives, pulse and QA evidence: never force-add any of it. Preserve HOME, user profiles, credentials, private uploads, drafts, native panes and unknown work. Never reset/clean them as cleanup.

The Windows helper fails closed on unsupported paths, owners, ACLs and unsafe ancestors. No chmod/WSL fallback, automatic ACL repair or migration is allowed. Its boundary is cooperative, not isolation from the same UID/user, SYSTEM or administrators. Native CI fixtures are not real Windows host acceptance.

Keep existing VAPID pair and subject as the same Push identity; do not rotate, unsubscribe/rekey or bulk-translate legacy subscription/policy stores. Preserved uploads, held evidence and drafts do not acquire automatic replay authority. Physical Push delivery needs separate device proof.

## Access and input

`server/fork-policy.ts` gates Host, peer, Origin, HTTP/WS and machine traffic before source effects. Only explicit loopback ingress or an already verified owner-only private Tailscale Serve origin is allowed. No public Funnel, generic public proxy, new account or network configuration. Preserve the narrow origin-less Android root-navigation exception without widening API, iframe, WS or mutation access.

Account/login and refresh, paid voice/configuration, account proxy, public exposure, managed updates, plugin execution and remote-PC mutations stay blocked before handlers. Saved remote autoconnect and bridge autoupdate stay off. Local PC functionality remains. Presentation serialization must omit raw native `agent_session` and `state_labels`; authenticated files/history are not public serving. Retired action/controller routes cannot mutate the new protocol.

Letta history is a private read path, not permission to send. Keep native session/store identity server-private. Do not text-deduplicate distinct native message identities. Pending uncertain/in-flight writes remain held and are never retried; explicit Hold is not automatic queue consent. Never invent idle or drain old rows to make recovery look successful.

`server/letta-stop.ts` owns the expiring compatibility witness: only after this joined client's successful Stop and a fresh native Interrupted transition with empty composer and no native processing/interrupt affordance may one explicitly NEW manual Send pass the remaining live identity/attachment guards. The statusline's timed thinking paint is not native completion authority. This is not a global presence fix or permission for another provider test.

## Validation and external actions

Use package-owned safe checks from the development guide. Never run bare `bun test`: native preload can start sessions. Focused unit tests must use the explicit unit preload. Native/browser/integration/SSH scripts require separately approved scope and disposable ownership; none authorizes existing-pane input or paid turns. No silent tool downloads, dependency installs or global changes.

One writer owns a bounded change. Do not start nested agents/reviewers or claim independent QA of your own edits. Headless browser checks are not permission to disturb normal-user Chrome or clear profiles/storage. Independent browser QA and human visual/device acceptance remain separately assigned roles.

No commit, push, release, tag, GitHub-setting change, global hook/configuration, account action, native agent start or user/TUI input without explicit authorization. Fork publishing is source-only; imported release/plugin/remote scripts are not its publisher. Report actual commands, candidate-bound results and remaining limitations. Keep private execution receipts outside public guides; never label implementation complete as human accepted.
