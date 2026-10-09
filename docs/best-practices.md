# Best Practices

## Herdr Boundary

- Connect socket-first using the installed Herdr 0.9.3 host's public NDJSON Unix socket API (`HERDR_TRACKED_PROTOCOL=22`, `schema_version=1`).
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
- Keep reading surfaces (Panel, Question) on truthful active HTTP polling (`/api/pane/read`) for buffer text content, while Chat uses its dedicated conversation endpoint (`/api/conversation`).
- Decode terminal frame bytes losslessly before writing to xterm.
- Match observer and control dimensions to fitted xterm geometry.
- Tear down the exact observer or control child, release process-local leases, or tear down event subscriptions when its WebSocket closes.

## Product Boundary

- Keep one primary pane visible on mobile with a unified 44px surface mode switcher.
- Terminal and Chat are the primary header modes, with Question offered explicitly when blocked. Status transitions never replace the surface being read. Internal text fallback remains available:
  - `Panel`: Internal current source snapshot (`visible`, 1000ms active polling), not a primary header mode. Plain text preserving whitespace, wrapping long lines without horizontal loss, allowing text selection, follow-latest near bottom, reading position preservation when scrolled up, and a `Latest` jump button. Truthfully exposes the source snapshot (including source statusline when Herdr exposes it).
  - `Chat`: Native Letta, Agy, Codex, Claude, OMP, OmO, GJC and PI readers on macOS with bounded history and typed prompt cards. Authenticate before native file/record IO; require current process/session witnesses rather than CWD/newest guesses. Chat composition waits for a binding-specific authoritative prompt read; unknown outcomes require inspection and explicit re-read, never generic-input fallthrough or automatic replay.
  - `Question`: Explicit blocked detection snapshot (`detection`, 2000ms polling when blocked) for long questions/options. It does not automatically replace Terminal or Chat.
  - `Terminal` (internal `stream`): Default fitted-grid observer (`terminal session control`) streaming real-time ANSI into `@xterm/xterm`, fitting the actual native PTY grid to browser canvas dimensions via `server/terminal-fit.ts` (valid 1..500 cols, 1..200 rows without a min-40 restriction, allowing mobile 35-col viewports). Exactly one fitted reader is permitted per `terminalId` with explicit `FIT_BUSY` (HTTP 409) for concurrent joins; debounced, deduped resize and bounded native source scroll commands (`terminal.scroll` with signed `deltaRows`, `to: 'latest'`, or `reset: true`) over the same WebSocket without reconnecting. Wheel and touch drag in Live mode adjust native reading offset via `pane.scroll`, while Latest resets offset to 0 and incoming updates do not force the reader back while scrolled up (`offset > 0`). Terminal fit automatically releases on document hidden/pagehide/unmount/Chat/pane switch and manual pause, terminating the fitted producer child and restoring native desktop PTY dimensions automatically without calling `pane.resize`. Resize and scroll authority do not acquire operation-coordinator claims, allowing Composer Send and agent prompts to execute concurrently without contention. Shell input control exclusively blocks fit admission and confirms fit-producer exit before activating an input lease. Local 2D panning and Latest affordance remain active when scrolled away. Empty status frames do not establish Live readiness. Scrollback is bounded by the native source (distinguish native source viewport scrolling from agent-app/internal scroll when no history exists, as alternate-screen applications expose zero source scrollback). Opt-in shell-only Terminal Control Mode (`/api/terminal/control`) remains available solely for verified idle shell panes under strict single-lease management without `--takeover` flags. Direct agent live typing remains outside this slice.
- When Terminal Control Mode is active on a shell pane, replace the prompt composer and thumb deck with a compact, high-contrast footer notice to enforce single-channel input exclusivity.
- Route unblocked agent input through `agent.prompt` and blocked questions or shell sessions through typed `terminal-input` (`pane.send_input` bracketed with text + Enter). Every action mutation must supply a client `operationId`. Prompt, terminal-input, and keys use preflight target `{paneId, terminalId, expectedMode, agentSessionId?}`, requiring the session ID when authoritative agent evidence exposes one and omitting it for shell mode; `tab-create` instead uses exact source `{paneId, terminalId}` plus `workspaceId`. Single shared mutation gate serializes text and quick-key actions, ending immediately after `sendAction` acknowledgment. On successful acknowledgment, trigger snapshot and surface refresh as detached best-effort follow-up (`Promise.allSettled`) that cannot delay draft clear, send-button readiness, key readiness, or keyboard stability.
- Treat topology lifecycle actions as a separate exclusive class under the same `/api/action` and `operationId` contract. New Space accepts only a bounded label plus Herdr default or an exact terminal-backed source. Close Space/Tab requests must carry the raw sorted membership shown at confirmation; the backend compares exact sets against a fresh immediately-before-RPC snapshot and sends zero RPC on drift. Never infer success from a snapshot delta, automatically retry an unknown destructive result, or escalate `workspace.close` to group close.
- IME composition safety: Track composition state in `PromptComposer` to prevent accidental premature submissions from either the Enter key or the Send button during Japanese/Thai/Chinese IME input.
- Quick Commands: 44x44 trigger opens an accessible bottom sheet (`InteractionPickerSheet`) for inert draft filling from repository `.herdr/commands.json`. When draft is present, offer Replace / Append (with 2 newlines) / Cancel. Never execute commands directly upon selection.
- Attention Horizon & Queue: When exactly one blocked pane exists, provide a direct "Jump" button; when multiple blocked panes exist, provide a "Review N" trigger opening `AttentionQueueSheet` ordered deterministically with current Space first, then workspace number, tab number, and pane ID.
- Keep Space and Tab navigation as separate ownership surfaces. The hamburger opens the Herdr-style Spaces side sheet; the header Tab trigger opens the active-Space Tabs & Panes bottom sheet. Never restore Space pills or Space lifecycle actions inside the Tab hierarchy.
- New Shell Tab in the Tabs & Panes sheet: the footer action performs an in-sheet view transition (with Back button, without stacking modal overlays) allowing Space CWD selection and optional label; unknown outcome handling guides the user to inspect the pane list without automatic re-dispatch.
- Lifecycle UI state belongs above both route-local sheets. Pending, unknown, and reconciliation-failed ownership survives dismissal and navigation; an observed create may redirect only after exact refreshed identity proof and a current-route/selection fence. Confirmation membership changes require a fresh confirmation, and Cancel receives first focus.
- Preserve status provenance: pane status is an effective agent state, while Tab and Space status are upstream attention aggregates (`blocked > unseen done > working > seen idle > unknown`). Do not call the aggregate “Space activity” or recompute it silently. If a future derived activity summary is added, keep it separately named and include only canonical agent-owned panes.
- Keep multiline text input enabled whenever an active pane is selected; do not disable textarea during send to preserve mobile keyboard and caret stability.
- Preserve visible loading, reconnecting, empty, and error states.

## Web Push Boundary

- Never expose, log, or serialize VAPID private keys, auth secrets, full endpoint capabilities with credentials, or question/terminal text.
- Bound Web Push to `Needs input` and `Done` with fixed copy plus bounded Space label, never pane/tab IDs, terminal output, prompts, questions, paths, code, or secrets. Needs input retains immediate native Tab attention transitions and per-Tab policy (first canonical Tab enabled by default, live overrides supported). Done is once per observed working round only after every canonical agent pane in the Space is done/idle, including muted Tabs; exclude empty shells, block on working/blocked/unknown agents, and require at least one enabled Tab. Never infer completion from native parent attention or replay it after policy changes; topology changes establish a silent baseline.
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
