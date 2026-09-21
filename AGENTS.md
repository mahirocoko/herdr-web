# Herdr Web Agent Guide

## Current Reality

- Private, single-user mobile command center for a local Herdr server.
- Bun owns package management and the server runtime. React, React Router Framework Mode (v8.4.0, `ssr: false`), Vite, and xterm own the browser app.
- Socket-first backend integration using Herdr 0.9.1's public NDJSON Unix socket API (tracked protocol 22, schema_version 1) for health, snapshots, pane validation, actions, and reads.
- Backend event-driven snapshot bridge (`server/snapshot-bridge.ts`) preflights a snapshot for pane IDs, opens one shared `events.subscribe` connection with global lifecycle plus exact per-pane `pane.agent_status_changed` subscriptions, waits for acknowledgement, then fetches an authoritative snapshot. Topology changes rebuild the subscription before resnapshotting.
- Keep browser-facing pane-read sources stable at the HTTP boundary. In particular, map `recent-unwrapped` to the raw Socket API enum `recent_unwrapped` inside `server/herdr-adapter.ts`; do not leak the wire spelling into browser hooks or UI state.
- Browser snapshot polling stops only after the backend bridge reports `connected`; WebSocket open alone is not healthy. HTTP snapshot fetching remains active during connecting, reconnecting, disconnected, error, and CLI fallback states.
- Panel, History, and Question surfaces retain truthful HTTP polling for text content refresh (`/api/pane/read`), as lifecycle events reflect session/pane structure rather than terminal buffer text changes.
- Explicit `HERDR_TRANSPORT=cli` fallback mode remains available for operational compatibility and debugging.
- The terminal observer (`Stream` mode) intentionally remains a bounded `herdr terminal session observe` CLI subprocess because the raw Herdr socket API exposes no terminal session observe method.
- The browser never sees the Unix socket path or raw Herdr socket methods.
- Upstream Herdr checkout remains strictly read-only evidence.
- Web Push subsystem (`server/push/`) evaluates authoritative snapshot diffs to send fixed `Needs input` / `Done` copy plus a bounded Space label via standard VAPID `web-push` (first canonical tab in each Space is enabled by default, with explicit live Tab overrides supported via `push-tab-policy.json` and `/api/push/tab-policy`). Push routes enforce strict origin validation and require `Tailscale-User-Login` matching configured `ownerLogin` (with loopback development exception). Push is disabled truthfully in CLI transport mode.
- Dedicated `/settings` SPA route provides push management and subscription diagnostics without cluttering the main terminal command header (navigated via App Menu).

## Read First

- `README.md`
- `docs/project-overview.md`
- `docs/transport-architecture.md`
- `docs/development-commands.md`
- `docs/best-practices.md`
- `docs/styling.md` for presentation work

## Non-Negotiable Boundaries

- Never bind the app server to `0.0.0.0` or expose it directly to the LAN or public internet.
- Never add an arbitrary raw shell service. Mutations and terminal inputs map strictly to typed raw methods (`pane.send_input` with text and Enter atomically, `agent.prompt`, `pane.send_keys`, `tab.create`) or bounded CLI argv arrays in CLI mode, never shell strings.
- Mutations and WebSocket upgrades (`/api/events`, `/api/terminal`, `/api/terminal/control`) require an exact same-origin check. Keep CORS closed.
- Mutations (`/api/action`), terminal control (`/api/terminal/control`), and push management share one mutation owner auth validator using configured `ownerLogin` from push config (with narrow loopback development exception), failing closed on Tailnet if missing or mismatched. Push subscription is not required for action or control.
- Every prompt/terminal-input/keys action requires `operationId` and exact target identity `{paneId, terminalId, expectedMode, agentSessionId?}`. `agentSessionId` is required when authoritative agent evidence exposes one and must be omitted for shell panes. Authoritative snapshot preflight rejects missing targets, terminal replacement, expected-mode mismatch, and agent-session replacement (using canonical `isAgentPane` where literal `'shell'` is not agent evidence). Concurrency is coordinated per-terminal-target process-locally via a token-fenced admission arbiter reserving the operation ID and pane claim synchronously before any await; actions on leased control panes are rejected with 409 contention. Pre-dispatch snapshot fetch failure abandons the attempt uncached (502 rejected), while authoritative preflight rejection caches 409/404. Duplicate operation IDs replay cached terminal results within TTL (refreshing genuine LRU position); conflicting payload reuse is rejected.
- New shell tab creation (`type: tab-create`) requires socket transport (CLI returns 409), hardcodes `focus: false`, derives CWD from fresh source pane `foreground_cwd || cwd`, verifies workspace membership, correlates the exact RPC response type (`tab_created`) and ID, and verifies returned tab/root pane IDs against post-creation snapshot without inferring causation from snapshot deltas or CWD. Ambiguous timeout, malformed response, or daemon error without correlated identity returns truthful `outcome: 'unknown'` without retry; no snapshot inference is performed. In the UI, New Shell Tab unknown state is strictly gated and clears only on an explicit successful snapshot refresh (`result === true`). By contrast, prompt/terminal-input unknown state has no automatic retry; drafts and warnings are retained, where inspection before manual resubmission with a fresh operation ID is guidance, not an enforced gate.
- Repo-configured interaction catalog (`GET /api/interactions/catalog`) canonicalizes startDir via `realpathSync` and resolves the nearest ancestor `.herdr/commands.json` only within the target pane's Git repository, strictly as inert draft fill strings. Missing config returns an empty catalog; invalid config fails with 422. Native catalog is not established, command selection remains local/client-side, and future agent launch presets remain dormant contracts (no launch endpoint, route, or adapter exposed).
- Stream observer remains default for all panes. Opt-in shell-only Terminal Control Mode (`/api/terminal/control`) is available solely for verified idle shell panes via authenticated same-origin WebSocket under strict single-lease management; control footer restores only after server status (`GET /api/terminal/control/status`) confirms the exact pane is unleased, while quarantine stays releasing. Remote Tailnet Terminal Control requires configured owner identity from Push config (`ownerLogin`); without it remote requests fail closed, while narrow loopback development exception remains. It does not require Push enrollment/subscription, only owner config. Never activate or offer control for agent panes. Never use `--takeover` or expose an arbitrary shell endpoint.
- Do not claim Tailscale identity, latency, or authentication unless the runtime proves it.
- Web Push notifications use fixed event copy plus bounded Space label (`Space: <label>`) for `Needs input` and `Done` events emitted per Space: by default, the authoritative `agent_status` of the first canonical tab (lowest finite number, deterministic tie-break by `tab_id`) is enabled, while explicit live Tab policy overrides allow any Tab to be enabled or disabled. Individual pane transitions never emit, and disabled tabs never emit. `Done` covers an enabled tab entering `done` plus the evidence-backed interactive-turn transition `working → idle`; initial/repeated idle states and non-working → idle do not emit. Notification payloads, metadata, tags, and navigation never include pane/tab IDs, terminal output, prompts, question text, cwd, agent output, or secrets. State delivery is best-effort snapshot observation (transitions missed between snapshots/disconnection cannot be delivered; process restart baselines current state; provider TTL is 60s). Notification click targets the Space route (`/spaces/<encoded-id>`), never a Tab or pane; for an already-open same-origin client, the Service Worker focuses it only upon positive app acknowledgment (`herdr:workspace-opened`), with unknown spaces, invalid data, or timeouts causing zero navigate, zero focus, and zero window opens (stale/pre-update PWA bundles must close and reopen before clicks can focus them); physical iOS switching of an already-open PWA remains an unverified human investigation.
- Push delivery to physical devices (e.g. iOS Web Push) is a human on-device verification gate, not automated proof in CI/test suites.

## Commands

```bash
bun install
bun run schema:sync
bun run schema:check
bun test
bun run test:live
bun run typecheck
bun run build
bun run start
bun run dev
```

`bun test` must remain independent of a live Herdr daemon. Runtime integration belongs behind `HERDR_LIVE_TEST=1`.

## Code Shape

- Use kebab-case filenames, single quotes, and no semicolons.
- Prefer arrow-function React components and `I`-prefixed interfaces.
- Keep Herdr transport, socket client, and bridge in `server/`; keep browser API calls in `src/services/`.
- Add focused pure helpers before embedding non-trivial selection, geometry, or validation logic in components.
- React Router Framework Mode owns client SPA routing (`/`, `/spaces/:workspaceId`, `/settings`). Avoid additional state libraries, extra routers, CSS frameworks, or service layers until repeated need appears.

## Verification

- Server/security/transport change: unit tests, live test when Herdr behavior is involved, typecheck, build.
- UI behavior change: the same static checks plus a fresh read-only browser-QA lane.
- Browser QA must inspect console errors after load and after interactions.
- The human maintainer owns final visual and product acceptance.

## Git

- Do not commit, push, amend, tag, or release unless the maintainer explicitly asks.
- Keep `.letta/`, build output, coverage, logs, and local runtime state untracked.
