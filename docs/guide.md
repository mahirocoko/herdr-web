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

### Pi questionnaire extension

The `questionnaire` tool is an optional Pi extension, not a built-in Herdr Web feature. A Pi session without that extension cannot call it; ordinary Pi chat does not require it. Herdr Web does not install or enable Pi extensions.

To try Pi's example questionnaire without changing global settings, locate `examples/extensions/questionnaire.ts` in your installed Pi package and start a **new** Pi session with its absolute path:

```sh
pi --extension /absolute/path/to/questionnaire.ts
```

The example's location and availability depend on your Pi distribution; consult its documentation if it is not included. This loads the extension for that launch only. It does not enable the tool in an existing Pi session or establish support for other questionnaire implementations.

For all new Pi sessions, Pi also discovers extensions in `~/.pi/agent/extensions/`. You can place a trusted questionnaire extension there instead; remove that specific file or symlink to stop loading it in future sessions. A symlink to Pi's packaged example depends on that installation path and may change or break when Pi is updated. Existing sessions need their own reload or restart to pick up resource changes; do not reload a session with work in progress without checking first.

Herdr Web reads the active example questionnaire using Pi’s recorded tool call and terminal drawing, then presents the existing prompt card in Chat when both can be matched. It does not require an additional Herdr-specific Pi extension. Unsupported, clipped, ambiguous or changed widgets remain terminal-only; finish or cancel an existing terminal-owned draft in Terminal. If an answer’s outcome is uncertain, check Terminal before taking further action—Herdr does not automatically retry it.

### Pi subagents

Pi's `subagent` calls appear as inline task cards at the position where Main dispatched them, outside folded work blocks. Adjacent calls form a group. Each card keeps its own title and current running, queued, completed or unknown state; completed cards stay at the same position. There is no trailing Chat history button. The activity chip beside the composer also lists children. Select a card to read its Markdown messages, code blocks, expandable tool arguments/results and errors in a separate read-only dialog; Main's Chat stays mounted. Use earlier/latest activity controls for bounded history pages. This view has no Send, Stop, steer or resume controls, and does not expose the child's native session identity as a browser control.

Historical outcomes come from the parent's `subagents:record` entries. A background launch without a current live receipt is **Status unknown**, not proof that the child is still running or finished. The child reader requires the parent's own tasks directory and a matching native parent header; unavailable or unpersisted child transcripts cannot be opened.

Accurate running/queued counts need the optional observer described in [development](development.md#pi-subagent-observer). With a compatible [mahiro-pi](https://github.com/mahirocoko/mahiro-pi) revision and its optional worker-activity resource already configured, run `/mh-herdr-web-observer start` in the Pi session you want to observe, then `status` to check it. Use `stop` to disable publication; reload requires another explicit start. An unknown command means that integration needs separate provisioning or an update, not that Web can install it for you. With a fresh verified receipt, Main at rest plus active children reads **BG**, and the corresponding inline cards update their own statuses. This changes presentation only, never Main's native Send/Stop permission. The observer is not automatically installed or loaded. Without it, history/details remain available where records exist, but live counts are unavailable. Updates follow recorded activity rather than every streamed token. Native/browser/device acceptance is separate from source and fixture checks.

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
