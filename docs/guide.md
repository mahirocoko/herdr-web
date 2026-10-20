# User guide

Herdr Web is a browser view onto your existing Herdr workspaces and terminals. Start with [Installation](../INSTALL.md); this guide covers the running app. It does not install Herdr, agent CLIs, plugins or remote runtimes for you.

## Workspaces, tabs and panes

The sidebar separates workspaces and agents. Select a workspace, then use its tab strip and pane canvas to choose the terminal you want. The native Herdr host remains the owner of these sessions and processes; closing the browser is not the same as stopping them.

Check the selected PC, workspace and pane before creating, closing, renaming or typing. A familiar title alone does not identify the right target.

On narrow screens the sidebar becomes a drawer and split panes collapse to a single-pane presentation. Use the tab/pane navigation rather than assuming every desktop pane is simultaneously visible. The command palette provides navigation and action discovery; a listed action may still be unavailable under this fork's policy.

## Chat and history

Choose the Chat lens for a structured view of a supported agent's own transcript. Open work/tool blocks for details; use copy, find and older-history navigation where the reader provides them. Loading, empty, partial and failed history states do not imply that the native process is idle.

Reader availability varies by provider and platform. Source contains Claude, Codex, OMP, OMO, GJC, Pi, OpenCode, Devin, Grok, Hermes and experimental Agy readers. This fork adds Letta Code through a private local history index and the same Chat UI. Source inventory is not live certification of each provider; use Terminal when a reader is unavailable or incomplete.

Letta supports bounded newest/older history pages. Image entries currently show an unavailable-preview notice, and full-output fetching is not implemented. Native records with distinct identities may display repeated text; the reader does not delete them by guessing that matching text is a duplicate.

## Sending, stopping and drafts

The composer belongs to the selected pane. Supported native approval/question cards appear in Chat; confirm the target and meaning before answering. Drafts and held messages are not evidence of delivery. Explicit queueing, holding and sending are different actions, and reconnection must not silently turn a draft into a send.

A pending or uncertain write is not automatically safe to retry. Leave uncertain/in-flight rows held rather than clicking repeatedly. Reading a conversation does not grant new input permission, and a web status label is not authoritative proof of native readiness.

For Letta, native Working can remain stale after interruption. The fork has a narrow one-shot recovery path after this joined client's successful Stop: a fresh native Interrupted state, empty composer and absence of native processing/interrupt affordances can permit one **new manual Send** while live attachment and identity checks still pass. This does not replay old queued rows or repair global native presence. A timed thinking badge in the footer is activity paint, not completion authority. If the guard refuses recovery, do not bypass it by forcing a queue or inventing idle.

## Terminal

The Terminal lens shows the selected native pane through the source attachment path. Its key bar helps with special keys on touch devices; terminal input still acts on the real process. Attachment/read-only/disconnected notices matter: do not treat a cached screen as a live input target.

**Pause fit** detaches and stops watching the fitted terminal view while preserving its drained last screen. It does not stop the process. **Resume Live** obtains a fresh attachment under current authority. Replacing the pane resets pause; switching to Chat leaves the terminal-only pause so Chat transport keeps its own rules.

Native Windows terminal mirroring and real PTY attachment are different capabilities. A mirror is not proof of resize, cursor or full terminal-attach behavior; see [coverage](upstream-parity.md) for platform limits.

## Files, diffs and adjacent views

Use the file browser/reader and repository changes for files, scopes and diffs. These are authenticated features, not public file hosting. Check the target machine/folder. An unavailable preview does not mean the file is absent.

Attachments and pasted content use the current source owners. Preserved legacy uploads and held evidence are not automatically imported or resent. Avoid sharing screenshots of private paths, credentials or transcripts in public issues.

## Settings and unavailable controls

Appearance covers themes, density, fonts and language. Chat, Terminal, Alerts, Shortcuts, Phone & devices and Agent integrations retain source settings structure. Letta describes private history, not global hooks. About identifies this fork.

Subscription usage is hidden in the page and palette. Its read-only backend remains, but account login and token refresh are not enabled. Paid voice/key configuration, account proxy, public exposure, managed updates, global plugin actions and remote-PC mutations are blocked before their handlers. Some source controls remain visible and return an unavailable/approval-required result. Do not follow upstream installer instructions to work around those errors. Local PC functionality is retained; [remote PCs](remote-pcs.md) explains the distinction.

## Phone, PWA and access

The app retains its manifest and service worker. App-owned “Install app” controls were removed; installation, when offered, is the browser's normal feature. Physical Android install/launch and real-device Push receipt remain pending; a source launch fix is not a device-support guarantee.

Loopback is the default. Private phone access is limited to an already configured, verified owner-only Tailscale Serve origin. Changing the local port does not update that route. Public Funnel, arbitrary public reverse proxies and LAN binding recipes are not supported alternatives. See [Security](../SECURITY.md).

Existing Push identity and browser drafts are preserved. Permission granted in a browser, subscription registration and an actual notification received on a physical device are separate observations. Do not clear browser storage or rotate keys as generic troubleshooting.

## Updates and help

Updates are [manual source updates](app-updates.md), followed by a controlled restart; Settings is not an upstream update supervisor. Use the [installation troubleshooting table](../INSTALL.md#troubleshooting) for startup failures and [fork issues](https://github.com/mahirocoko/herdr-web/issues) for non-sensitive bugs. Include revision, platform, selected feature and a redacted reproduction, not private state.
