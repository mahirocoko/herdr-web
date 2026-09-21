# Best Practices

## Herdr Boundary

- Connect socket-first using Herdr 0.9.1's public NDJSON Unix socket API (`HERDR_TRACKED_PROTOCOL=22`, `schema_version=1`).
- Maintain `HERDR_TRANSPORT=cli` strictly as an explicit operational fallback and debugging mode. Do not use automatic per-request fallback that could mask protocol mismatches.
- Retain `herdr terminal session observe` as the sole intentional CLI transport in socket mode because the raw socket API does not expose terminal session observation.
- When CLI transport is selected, pass commands strictly as typed argv arrays without shell interpolation.
- Bound socket and subprocess runtimes, timeouts, and payload sizes.
- Revalidate pane identity with fresh `pane.get` or snapshot state immediately before mutations and stream creation.
- Treat acknowledgement as acknowledgement, not proof that an agent completed work.

## Browser Boundary

- Require exact same-origin requests for mutation (`/api/action`) and WebSocket (`/api/events`, `/api/terminal`) paths.
- Keep the server loopback-only (`127.0.0.1:8787`).
- Never expose raw Herdr socket paths or internal methods to the browser client.
- Broadcast full snapshot state over WebSocket `/api/events` backed by preflight-derived global and per-pane status subscriptions. Stop client snapshot polling only after backend status is `connected`, never merely because the WebSocket opened; retain HTTP snapshot polling in CLI mode.
- Keep reading surfaces (Panel, History, Question) on truthful active HTTP polling (`/api/pane/read`) for buffer text content.
- Decode terminal frame bytes losslessly before writing to xterm.
- Match observer and control dimensions to fitted xterm geometry.
- Tear down the exact observer or control child, release process-local leases, or tear down event subscriptions when its WebSocket closes.

## Product Boundary

- Keep one primary pane visible on mobile with a unified 44px surface mode switcher.
- Provide four truthful, typed surface modes:
  - `Panel`: Complete current source snapshot (`visible`, 1000ms active polling), default for non-blocked panes. Plain text preserving whitespace, wrapping long lines without horizontal loss, allowing text selection, follow-latest near bottom, reading position preservation when scrolled up, and a `Latest` jump button. Truthfully exposes the complete source snapshot (including source statusline when Herdr exposes it).
  - `History`: Bounded latest 1000 unwrapped rows (`recent-unwrapped`, 2000ms active polling). Plain text with word wrapping, text selection, follow-latest near bottom, reading position preservation when scrolled up, and a compact `Latest` jump button. Do not claim infinite or full terminal scrollback.
  - `Question`: Complete blocked detection snapshot (`detection`, 2000ms polling when blocked), default for blocked panes to prevent question or option truncation.
  - `Stream`: Low-latency client viewport observer (`terminal session observe`) streaming real-time ANSI into `@xterm/xterm`. Truthfully scoped as a client-sized viewport only; explicitly state that it can omit parts of the 158x52 source panel/statusline when the client viewport is shorter, and provides neither full panel nor scrollback. Opt-in shell-only Terminal Control Mode (`/api/terminal/control`) is available solely for verified idle shell panes under strict single-lease management without `--takeover` flags.
- When Terminal Control Mode is active on a shell pane, replace the prompt composer and thumb deck with a compact, high-contrast footer notice to enforce single-channel input exclusivity.
- Route unblocked agent input through `agent.prompt` and blocked questions or shell sessions through typed `terminal-input` (`pane.send_input` bracketed with text + Enter). Every action mutation must supply a client `operationId`. Prompt, terminal-input, and keys use preflight target `{paneId, terminalId, expectedMode, agentSessionId?}`, requiring the session ID when authoritative agent evidence exposes one and omitting it for shell mode; `tab-create` instead uses exact source `{paneId, terminalId}` plus `workspaceId`. Single shared mutation gate serializes text and quick-key actions, ending immediately after `sendAction` acknowledgment. On successful acknowledgment, trigger snapshot and surface refresh as detached best-effort follow-up (`Promise.allSettled`) that cannot delay draft clear, send-button readiness, key readiness, or keyboard stability.
- IME composition safety: Track composition state in `PromptComposer` to prevent accidental premature submissions from either the Enter key or the Send button during Japanese/Thai/Chinese IME input.
- Quick Commands: 44x44 trigger opens an accessible bottom sheet (`InteractionPickerSheet`) for inert draft filling from repository `.herdr/commands.json`. When draft is present, offer Replace / Append (with 2 newlines) / Cancel. Never execute commands directly upon selection.
- Attention Horizon & Queue: When exactly one blocked pane exists, provide a direct "Jump" button; when multiple blocked panes exist, provide a "Review N" trigger opening `AttentionQueueSheet` ordered deterministically with current Space first, then workspace number, tab number, and pane ID.
- New Shell Tab in Drawer: Footer action performs an in-drawer view transition (with Back button, without stacking modal overlays) allowing Space CWD selection and optional label; unknown outcome handling guides user to inspect pane list without automatic re-dispatch.
- Keep multiline text input enabled whenever an active pane is selected; do not disable textarea during send to preserve mobile keyboard and caret stability.
- Preserve visible loading, reconnecting, empty, and error states.

## Web Push Boundary

- Never expose, log, or serialize VAPID private keys, auth secrets, full endpoint capabilities with credentials, or question/terminal text.
- Bound Web Push events exclusively to `Needs input` and `Done` events with fixed event copy plus bounded Space label (`Space: <label>`) or generic fallback; notification payloads, metadata, tags, and navigation never include pane/tab IDs, terminal output, prompts, question text, cwd, agent output, or secrets. Track aggregate `tab.agent_status` streams per Space: by default, only the first canonical tab (lowest finite `number`, deterministic tie-break by `tab_id`) is enabled, while explicit live Tab overrides allow any Tab to be enabled or disabled via per-Tab policy. Individual pane transitions and disabled tabs never emit.
- Treat the 10-second browser Push deadline as a UI deadline, not cancellation. A volatile in-memory exclusive ticket continues observing the original non-cancellable browser promise, reconciles late settlement, and prevents duplicate mutations; after the deadline Settings offers only reload. A full document termination loses that volatile reconciliation state.
- Delivery is best-effort snapshot observation: transitions missed entirely between snapshots or disconnections cannot be delivered; process restart baselines current state; provider TTL is 60s. Notification clicks open the Space route (`/spaces/<encoded-id>`), not a Tab or pane.
- Service worker (`public/sw.js`) must always display a notification under `event.waitUntil` with safe fallback; never dispatch silent pushes or navigate to untrusted external URLs.
- State-changing subscription routes require strict Origin/Host validation plus exact `Tailscale-User-Login` authorization (with narrow loopback dev exception).
- Physical iOS push delivery requires human on-device verification; automated proof covers contract and service worker syntax.

## Testing

- Pure validation, protocol serialization, and selection logic belong in deterministic unit tests.
- Live Herdr tests are opt-in (`HERDR_LIVE_TEST=1`) and non-mutating.
- No test may mutate real Herdr sessions (no input submission, pane creation/closing, or moving).
- Rendered UI claims require fresh browser evidence and console inspection.
- State physical iOS delivery is human verification, not automated proof.
