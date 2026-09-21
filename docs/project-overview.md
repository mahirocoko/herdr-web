# Project Overview

## Product Job

Herdr Web lets the operator inspect and steer existing Herdr panes from a phone or tablet over a private Tailnet. It is an agent-aware mobile companion, not a generic SSH client.

## Current Slice

- Socket-first backend integration using Herdr 0.9.1's public NDJSON Unix socket API (protocol 22) for health, snapshots, pane validation, actions, and reading.
- Backend event-driven snapshot bridge (`server/snapshot-bridge.ts`) preflights pane IDs, subscribes to global lifecycle plus exact per-pane `pane.agent_status_changed` events, waits for acknowledgement, and then fetches the authoritative snapshot. Topology changes rebuild subscriptions before another authoritative snapshot.
- Browser snapshot polling is halted only after the backend bridge reports `connected`; WebSocket open alone is not healthy. HTTP polling remains active during all other bridge states and is the session-snapshot fallback in explicit CLI mode.
- Group panes under their canonical Herdr tabs in navigation. Initial browser bootstrap/reload follows Herdr's authoritative focused pane, tab, and workspace chain before blocked/first-pane fallback; later snapshot updates preserve a still-valid browser selection.
- Prioritize blocked work with the Attention Horizon: single direct Jump for one blocked pane, and an accessible Attention Queue bottom sheet (`AttentionQueueSheet`) when multiple blocked panes exist across spaces (ordered deterministically with current Space first, then workspace number, tab number, and pane ID).
- Dedicated Question view rendering complete detection snapshots for blocked panes.
- Provide four dedicated, typed surface modes with a unified 44px surface switcher:
  - **Panel (Default on non-blocked panes)**: Complete current source snapshot backed by `/api/pane/read?pane=<id>&source=visible` (polled at 1000ms while active). Truthfully represents the full source panel (including source statusline when Herdr exposes it), preserves whitespace, wraps long lines without horizontal loss, allows text selection, automatically follows updates near bottom, preserves reading position when scrolled up, and shows a `Latest` button when away from bottom. A deterministic semantic layer highlights bounded terminal states and structural anchors while preserving the exact source text.
  - **History**: Bounded scrollable plain text containing the latest 1000 unwrapped rows (`/api/pane/read?pane=<id>&source=recent-unwrapped&lines=1000`, polled at 2000ms while active). Supports the same safe semantic highlighting as Panel plus exact text selection/copy, wrapping, follow-latest near bottom, and reading position preservation.
  - **Question (Default on blocked panes)**: Complete blocked detection snapshot (`/api/pane/read?pane=<id>&source=detection`, polled at 2000ms while blocked).
  - **Stream**: Low-latency client viewport observer streaming real-time ANSI from `herdr terminal session observe` into `@xterm/xterm`. Truthfully scoped as a low-latency client viewport only; explicitly documented that it can omit parts of the 158x52 source panel/statusline when the client viewport is shorter, and provides neither full panel nor scrollback. Stream observer remains default for all panes. Opt-in shell-only Terminal Control Mode (`/api/terminal/control`) is available exclusively for verified idle shell panes via authenticated same-origin WebSocket under strict single-lease management. When Control Mode is active, the prompt composer and thumb deck are replaced by a compact footer notice to enforce input exclusivity.
- Active reading surfaces (Panel, History, Question) continue active HTTP polling (`/api/pane/read`) for text content updates because socket lifecycle subscriptions invalidate session structure, not raw terminal text buffer streams.
- Strict action target validation: all prompt, terminal-input, and keys actions require client-provided `operationId` and preflight-checked target `{paneId, terminalId, expectedMode, agentSessionId?}`. Agent actions require `agentSessionId` when authoritative evidence exposes one; shell panes strictly omit it.
- Send agent prompts (`agent.prompt`) over socket when the selected agent is not blocked.
- Submit terminal commands and textual answers (`pane.send_input` with text and Enter atomically bracketed) for shell panes and blocked questions, keeping text input active. Full IME composition tracking prevents premature submission from Enter key or submit button.
- Quick Commands: 44x44 trigger in the prompt composer opens an accessible bottom sheet (`InteractionPickerSheet`) lazily fetching repository-configured shortcuts (`.herdr/commands.json`) for inert draft fill. When a draft is already present, prompts user with Replace / Append (with 2 newlines) / Cancel.
- New Shell Tab in Drawer: Footer action performs an in-drawer view transition (with Back button, without stacking overlays) to create a shell tab with approved Space CWD source selection and optional tab label, handling observed success or unknown outcome without retry.
- Send a small allowlist of logical terminal keys (`pane.send_keys`).
- Keep mobile input in one in-flow dock: a stable prompt composer followed by the six-key terminal rail. The app follows intended bounded unzoomed `visualViewport` height/offset geometry with `100dvh` fallback so viewport changes shrink the reading surface without remounting or clearing the draft; physical mobile keyboard behavior remains human-device validated.
- On-demand Agent Explain: read-only status explanation in the existing pane drawer via `GET /api/agent/explain?pane=<id>`. Agent panes expose a trailing 44x44 "Why?" trigger that expands an inline accordion disclosing the matched rule, human readable source region, manifest source kind/version, and active true-only flags, while strictly stripping evaluated rules, buffer evidence previews, absolute manifest paths, socket paths, raw priority, and free-text fields (`warning`, `fallback_reason`).
- Explicit operational compatibility fallback mode via `HERDR_TRANSPORT=cli`.

## Architecture

```text
Mobile browser
  -> Tailscale Serve HTTPS/WSS
  -> Bun server on 127.0.0.1:8787
  -> Unix Domain Socket (~/.config/herdr/herdr.sock, protocol 22)
  -> herdr terminal session observe (Stream mode observer CLI subprocess) or herdr terminal session control (opt-in shell-only control CLI subprocess)
```

The browser app is React + Vite + xterm with React Router Framework Mode (v8.4.0, `ssr: false`) powering file-based client routing (`/` for root resolver, `/spaces/:workspaceId` for Space command center, and `/settings` for push management). The server is direct `Bun.serve`. Background Web Push alerts for Needs Input and Done events are backed by standard Web Push (`web-push`) with Space-aware labels (`Space: <label>`) and aggregate status streams per Space (by default enabled for the first canonical tab per Space, with explicit live Tab overrides supported via `push-tab-policy.json` and `/api/push/tab-policy`; individual panes and disabled tabs never emit). The click target is a validated Space deep link (`/spaces/<encoded-id>`), focusing an existing client only upon positive app acknowledgment (stale/pre-update bundles must close/reopen before clicks can focus them), while physical iOS switching of an already-open PWA remains unverified under investigation. Subscriptions use an atomic private JSON store. There is no relational database, user account system, or arbitrary PTY takeover. Opt-in Terminal Control Mode exists solely as an authenticated same-origin WebSocket session bound to an exact verified idle shell pane under strict lease control, with no agent pane control and no `--takeover` flag. Remote Tailnet Terminal Control requires configured owner identity from Push config (`ownerLogin`); without it remote requests fail closed, while narrow loopback development exception remains. It does not require Push enrollment/subscription, only owner config.

## Preferred Direction

Keep the product compact, calm, and touch-first. Preserve the single-pane canvas, attention horizon, pane drawer, key deck, and prompt composer before adding broader orchestration features.

## Verification & Not Established Yet

- Physical iOS push delivery requires human on-device verification; automated tests validate VAPID keypairs, local payload encryption/request construction, store/route behavior, and the static service worker contract without claiming provider or APNs delivery.
- Agent pane terminal control (agent panes remain strictly observer-only; control is idle-shell only without takeover flags)
- Multi-user authorization (Tailnet owner allowlist enforces single-user access)
- Public internet deployment (strictly private Tailscale / loopback)
