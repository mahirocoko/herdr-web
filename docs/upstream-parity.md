# Source coverage and evidence

This page separates **retained implementation**, **observed behavior**, **blocked capability** and **missing proof**. It is not a declaration that every adopted feature works on every provider or device, or that Mahiro has accepted the product.

## Source and document ownership

The root application adopts `devswha/herdr-web-ui` at **d918448647e41079c52047ffc96cdaac50ccba32** (upstream package 0.4.12). The current fork version is defined in [`package.json`](../package.json); release history belongs in [CHANGELOG](../CHANGELOG.md). [SOURCE_MANIFEST.json](../SOURCE_MANIFEST.json) records the complete source inventory, exclusions, mapped readmes and explicit promotion exceptions. `scripts/verify-upstream.ts` derives the pinned Git tree independently; a manifest edit cannot authorize itself. Acquisition and promotion are not routine update commands.

The fork retains [Apache-2.0](../LICENSE) for its license scope, [upstream MIT](../UPSTREAM_LICENSE), [third-party notices](../THIRD_PARTY_NOTICES.md) and both dependency patches. No documentation rewrite changes these terms.

[README](../README.md) is the current entry point; [Installation](../INSTALL.md), [User guide](guide.md), [Development](development.md), [Design](../DESIGN.md), [Security](../SECURITY.md), [Contributing](../CONTRIBUTING.md), [Code of Conduct](../CODE_OF_CONDUCT.md), [agent rules](../AGENTS.md), [updates](app-updates.md) and [remote PCs](remote-pcs.md) each own their topic. Other imported technical notes and `docs/upstream-reference/` readmes are pinned reference, not current setup/support authority. `docs/history/legacy/`, changelog and generated release summaries retain history, not standing execution permission.

## UI coverage inventory

These groups include smaller controls, failure/empty/busy states and visible shell ancestors. Retained source is not rendered parity proof. Owners below are relative to `src/` unless otherwise noted.

| Group | Retained surface and owner                                                                                                                                                | Current boundary                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| U01   | Document/PWA shell, viewport, fonts, access/connecting shells: `App.tsx`, `main.tsx`, `styles.css`, root `index.html`                                                     | Fork brand retained; physical install proof pending.                                               |
| U02   | PC groups/setup notices/footer: `components/MachineSidebar.tsx`, `UpdateControls.tsx`, `LanExposureNotice.tsx`                                                            | Remote mutations, public exposure and managed updates blocked.                                     |
| U03   | Workspace/worktree tree, agents, status, pins/order/scroll: `Sidebar.tsx`, `AgentSidebar.tsx`, `UsageMeters.tsx` in components                                            | Subscription usage hidden, backend retained.                                                       |
| U04   | Tab creation/select/order/rename/close and touch menus: `components/TabStrip.tsx`, `RowMenu.tsx`                                                                          | Native target identity still governs actions.                                                      |
| U05   | Pane layout/select/split/zoom, desktop slots/mobile single pane: `components/PaneCanvas.tsx`, `App.tsx`, `lib/layoutMap.ts`                                               | Mobile lifecycle equivalence not inferred from old fork.                                           |
| U06   | Chat/history/Markdown/tool blocks/copy/find/recovery: `components/ChatView.tsx`, `ChatTimeline.tsx`                                                                       | Provider/platform proof varies; Letta limits below.                                                |
| U07   | Terminal attachment/lenses/key bar/find/read-only/mirror: `components/PaneTerminal.tsx`, `TerminalInput.tsx`, `KeyBar.tsx`                                                | Pause/resume adapted; Windows host proof pending.                                                  |
| U08   | Composer/drafts/attachments/completion/Send/Stop/pending/plan/tasks: `components/Composer.tsx`                                                                            | Paid voice blocked; uncertain writes never retried.                                                |
| U09   | Approval/question/plan cards and stale/busy states: `components/PromptCard.tsx`                                                                                           | Supported types are not universal provider coverage.                                               |
| U10   | Action/settings/folder/plugin discovery: `components/CommandPalette.tsx`, `lib/paletteFolders.ts`                                                                         | Plugin execution blocked; usage page requests hidden.                                              |
| U11   | Workspace/machine/worktree dialogs, confirmations/menus: `components/NewSessionDialog.tsx`, `MachineDialog.tsx`, `WorktreeDialog.tsx`, `ConfirmDialog.tsx`, `RowMenu.tsx` | Source anatomy retained, capability gates still apply.                                             |
| U12   | Files/media/Markdown/docking/repository changes/diffs/web panel: `components/FilesDialog.tsx`, `FileViewer.tsx`, `RepoChanges.tsx`, `RepoDiffViewer.tsx`, `WebPanel.tsx`  | Authenticated source features, not public file hosting.                                            |
| U13   | Settings pages: `components/SettingsDialog.tsx` and CSS                                                                                                                   | Fork About and truthful Letta entry; no app install/update controls.                               |
| U14   | Themes/density/language/fonts/key bar/preferences: `styles.css`, `lib/settings.ts`, theme generator                                                                       | Generated copies remain tied to CSS.                                                               |
| U15   | Alerts/pairing/access/telemetry/crash recovery: `components/Droplet.tsx`, `AccessGate.tsx`, `TelemetryControls.tsx`, `RenderBoundary.tsx`, `AppCrash.tsx`                 | Unavailable telemetry is absence, not enrollment.                                                  |
| U16   | Responsive sidebar/splits/sheets/header                                                                                                                                   | Source media queries at 768px, 640px and 480px; not universal device certification.                |
| U17   | Focus/keyboard/live regions/coarse pointers/reduced motion/safe areas                                                                                                     | Source focus/shortcut/viewport owners; accessibility needs behavior checks, not screenshots alone. |

## Backend coverage inventory

Owners here are relative to `server/` except shared contracts.

| Group | Retained implementation                                                                                                                                                   | Current boundary                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| B01   | HTTP/WS/membership/revocation: `index.ts`, `core/connections.ts`, root `shared/protocol.ts`                                                                               | Fork Host/peer/Origin gates precede handlers.                                                      |
| B02   | RPC/identity/input/PTY: `herdr/client.ts`, `core/input.ts`, `pty/session.ts`, `pty/sidecar.ts`                                                                            | Protocol 22; real Node owns PTY, not Bun.                                                          |
| B03   | Workspace/tab/pane/worktree lifecycle: `pane-routes.ts`, `workspace-routes.ts`                                                                                            | Herdr remains native process owner.                                                                |
| B04   | Conversation readers: `conversation.ts` and provider modules                                                                                                              | Letta fork adapter added; other providers not universally exercised.                               |
| B05   | Prompt parsing/typed answers: `prompt.ts`                                                                                                                                 | Provider/menu-specific, no blanket live-input approval.                                            |
| B06   | Queued/held/uncertain input: `pending-input.ts`                                                                                                                           | Keep source semantics; no replay of old drafts/uncertain writes.                                   |
| B07   | Attachments/files/repository: `paste.ts`, `file-view.ts`, repository routes                                                                                               | Legacy TTL-upload data not bulk-imported.                                                          |
| B08   | Auth/devices/local/Tailnet: `auth.ts`, `access.ts`, `devices.ts`, `fork-policy.ts`                                                                                        | Loopback or verified owner-only Serve; no public Funnel/proxy.                                     |
| B09   | Remote SSH/bridge/relay/bundles: `machines.ts`, `machine-api.ts`, `machine-security.ts`, `ssh.ts`, `bridge.ts`, `machine-relay.ts`, `remote-entry.ts`, `remote-bundle.ts` | Mutations blocked; saved autoconnect and autoupdate off. Local PC retained.                        |
| B10   | Push/completion/preferences/profile: `push.ts`, `completion.ts`, `preferences.ts`, `herdr-profile-state.ts`                                                               | Existing identity preserved; physical receipt pending.                                             |
| B11   | Managed update/plugin source: `managed.ts`, `supervisor.ts`, `updater.ts`, `update-state.ts`, root `herdr-plugin.toml`                                                    | Not the fork launcher/publisher; mutations blocked.                                                |
| B12   | Usage/voice/proxy/Portal/telemetry: `usage.ts`, `voice.ts`, `cliproxy.ts`, `portal.ts`, `telemetry.ts`                                                                    | Read-only valid-credential usage retained; login/refresh/paid voice/proxy/public exposure blocked. |

## Fork adaptations and observations

### Focused upstream hardening backports

The snapshot pin remains `d918448647e41079c52047ffc96cdaac50ccba32`. Three
bounded fixes are backported from candidate
`818c461710e3765f5ef2c4dd4dbc119deab0b015`; this is not a full snapshot upgrade:

- [#1562](https://github.com/devswha/herdr-web-ui/pull/1562): remove
  `HERDR_WEB_TOKEN` after merging the PTY sidecar environment and again in the
  real-Node host before spawning its attach child.
- [#1599](https://github.com/devswha/herdr-web-ui/pull/1599): name raster uploads
  from exact byte signatures and refuse unsupported raster claims before pane
  lookup or writes. This is signature validation, not decoding or malware scanning;
  generic named uploads keep their existing behavior.
- [#1570](https://github.com/devswha/herdr-web-ui/pull/1570): isolate Git file
  inventories from inherited repository variables, disable fsmonitor, and bound
  both listing paths to 16 MiB and three seconds. Failed, oversized or incomplete
  listings fall back to the existing bounded filesystem walk.

Exact source/test paths are declared in the promotion patch policy and its
independent verifier. These changes do not alter native input authority, private
state identity, Pi subagent support, branding or the source-only launcher. Unit
fixtures do not establish physical-device or real-host acceptance.

Three later changes are also adapted narrowly without repinning the snapshot:

- [#1568](https://github.com/devswha/herdr-web-ui/pull/1568), commit
  `ee2daec00af8579c3a6c4d0de4fc1b51a317a47e`: durable same-directory private-state
  replacement for the device registry, VAPID key pair and Push subscriptions.
  Retired endpoint telemetry keeps its cheaper existing write path.
- [#1952](https://github.com/devswha/herdr-web-ui/pull/1952), commit
  `e299f81a1daeddc4c69f967d6c382733705218b0`: compact tool-image previews on work
  lines. This fork prefetches only immutable opaque refs and retains the existing
  image route and lightbox; mutable/no-store refs still wait for an opened row.
- [#1842](https://github.com/devswha/herdr-web-ui/pull/1842), commit
  `6f322874322201a9644b3bbd92d1cbd05b5c4c8c`: selected bounded-detail and refresh
  UX ideas applied to the existing Pi owner, not a Claude detail architecture.
  The Pi route reports page/freshness evidence, revalidates parent and child after
  reads, and remains GET-only with opaque parent-scoped IDs.

These adaptations do not adopt Ovis branding, Rust PTY/native applications,
installers, managed updates, public Push relay or release/provisioning tooling.
They preserve the existing VAPID identity and subscriptions; source/unit checks
are not physical Push delivery, rendered UI or human acceptance evidence.

The fork preserves the source shell and restores its own terminal-mark brand. Letta's official provider mark is locally vendored with provenance. Terminal Pause fit detaches/unwatches and retains the drained grid without stopping the process; Resume Live obtains fresh source authority. Scoped desktop/mobile and light/dark rendered checks covered the selected settings and pause/resume behavior, not every inventory state.

Letta history uses `letta.ts`, `letta-store.ts` and `letta-parser.ts` through the source conversation path. Read-only HTTP checks covered newest/older pages, 304 and 409; separate rendered checks covered desktop/mobile and visible older history. Image previews and full-output fetching remain unavailable. Distinct native message identities are preserved even when text repeats; native serialization/display duplication remains unresolved.

A separately authorized fresh Letta conversation demonstrated Send/reply, Stop/interruption and one new manual recovery Send through `letta-stop.ts` while native Working was stale. The bounded witness is not a native presence repair, automatic queue recovery or approval for further turns. Pending uncertain/in-flight rows stay held; the statusline thinking TTL is paint only. No other-provider completeness follows from that observation.

Windows native bootstrap CI covered frozen setup, typechecks, launcher help and focused data-drive/profile NTFS/private-ACL fixtures on the checked source candidate. It did not start the app against a real user's Windows Herdr host. A real data-drive startup failed the unsafe-ancestor check; the actual ACL cause is unknown. Profile-local NTFS outside OneDrive is a recommended next attempt, not passed host evidence. Physical Android install/launch and Push delivery remain open despite the 0.10.3 source launch-redirect correction.

Pi subagents use `pi-subagents.ts`, `pi-subagent-routes.ts` and `components/PiSubagents.tsx` for parent-scoped inline cards, live activity and read-only child conversations. Detail reads now distinguish initial load, refresh, stale retained content, unreadable/missing identity, empty pages and bounded/earlier pages; the response carries successful-read and omitted-branch evidence without exposing native paths. A scoped local Mac session previously demonstrated running-to-completed transitions and the earlier inline/detail presentation received human acceptance; the new detail and thumbnail adaptations have source/unit evidence only. This is not universal provider/device certification. Live status requires a compatible [mahiro-pi](https://github.com/mahirocoko/mahiro-pi) observer explicitly enabled for that session; unknown/stale evidence never becomes a completion claim. Windows live snapshot writing, child controls, image/full-output retrieval and token streaming are not established by this feature. See the [user guide](guide.md#pi-subagents) and [observer contract](development.md#pi-subagent-observer).

## Evidence gates and unresolved decisions

Source verification proves inventory/policy, unit fixtures prove their modeled cases, native shell tests prove only owned shell behavior, and browser checks prove only the exercised rendering/interaction. Human product acceptance and physical-device evidence are separate. Installed Herdr version/protocol cannot stand in for all capability checks.

Keep source queue/hold/uncertainty owners rather than restoring a parallel legacy queue. Pi native scroll-to-latest remains a distinct missing-capability candidate; Chat follow-scroll does not prove it. Mobile workspace lifecycle needs current comparative proof before legacy adaptation. Preserve private legacy data without granting it replay authority.

GitHub private vulnerability reporting and PR/CI-gate changes require maintainer approval; these docs do not claim them enabled or enforced. Remaining proof should be bounded to the affected feature and exact candidate, not a repeated broad sweep or an implicit paid/native test permission. Private execution receipts belong in ignored local evidence, not this public inventory.
