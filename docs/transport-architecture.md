# Transport Architecture

This document describes the transport architecture of Herdr Web, migrating from per-request CLI subprocess polling to a socket-first, event-driven integration with Herdr 0.9.1.

## 1. High-Level Topology

```text
┌────────────────────────────────────────────────────────┐
│               Mobile Browser Client                     │
│  - useSnapshot: WebSocket /api/events (primary stream) │
│                 HTTP /api/snapshot (bootstrap/fallback)│
│  - Reading Surfaces: HTTP /api/pane/read (polling)     │
│  - Stream Mode: WebSocket /api/terminal (ANSI frames)  │
└───────────────────────────▲────────────────────────────┘
                            │ Same-Origin HTTP / WSS
┌───────────────────────────▼────────────────────────────┐
│               Herdr Web Backend Server                 │
│  - Bun.serve on 127.0.0.1:8787                         │
│  - SnapshotBridge: shared events.subscribe connection  │
│  - HerdrAdapter: socket-first with CLI fallback        │
└───────────────▲────────────────────────────▲───────────┘
                │ NDJSON Unix Socket         │ Child Process (argv)
                │ (protocol 22)              │
┌───────────────▼───────────┐    ┌───────────▼───────────┐
│     Herdr Unix Socket     │    │ Herdr CLI Observer    │
│ ~/.config/herdr/herdr.sock│    │ herdr terminal session│
│   (ping, snapshot, reads, │    │ observe <pane>        │
│    actions, events)       │    │ (Stream mode only)    │
└───────────────────────────┘    └───────────────────────┘
```

## 2. Socket-First Transport (`server/herdr-socket.ts`)

- **Protocol Metadata**: The backend communicates over Herdr tracked protocol 22 (`HERDR_TRACKED_PROTOCOL = 22`, `HERDR_TRACKED_SCHEMA_VERSION = 1`).
- **Path Resolution Order**:
  1. Explicit constructor/call option `socketPath`
  2. Environment variable `HERDR_SOCKET_PATH`
  3. Environment variable `HERDR_SESSION` (`~/.config/herdr/sessions/<name>/herdr.sock`)
  4. Default session socket (`~/.config/herdr/herdr.sock`)
- **NDJSON Framing**: Every request is sent as exactly one JSON line ending with `\n` and a unique request ID (`req_<timestamp>_<seq>_<rand>`). The server expects a matching response ID.
- **Envelope Handling**:
  - Success: `{ id, result }`
  - Error: `{ id, error: { code, message } }`
- **Error Typing**: Socket errors are preserved in `HerdrSocketError` with `.code` and `.message`. This enables HTTP routes to map `pane_not_found` directly to HTTP 404 without brittle substring guessing.
- **Bounds & Protection**:
  - Connect/request timeout: 5000ms bounded default.
  - Maximum response size: 16 MB bounded default.
  - Premature EOF, connection drops, and malformed JSON are trapped and rejected cleanly.
  - Prompt and command text are never logged to console.
- **Fail-Closed Validation**: `executePing()` verifies `res.protocol === 22`. On protocol mismatch, the transport fails closed rather than attempting silent degradation.
- **Operation Gate**: Every socket-mode pane read or mutation performs the protocol-22 handshake before pane validation and before the requested operation. A mismatched daemon cannot reach `pane.read`, `agent.prompt`, `pane.send_keys`, or `pane.send_input`.

## 3. Schema Ownership & Sync (`scripts/sync-herdr-schema.ts`)

The repository owns its generated protocol constants and tracked JSON schema without introducing external code-generation dependencies:
- `bun run schema:sync`: Invokes `herdr api schema --json` and writes:
  - `server/generated/herdr-schema.json`: Complete tracked JSON schema.
  - `server/generated/protocol.ts`: Constant exports for `HERDR_TRACKED_PROTOCOL = 22` and `HERDR_TRACKED_SCHEMA_VERSION = 1`.
- `bun run schema:check`: Semantically compares the complete installed JSON schema with the tracked schema and validates generated protocol metadata. Formatting and object-key order are ignored; any schema-body drift exits non-zero.
- Handwritten minimal runtime TypeScript interfaces (`server/types.ts` and `src/types/herdr.ts`) model the specific subsets used by the application to avoid generating 270KB+ of unused type boilerplate.

## 4. Transport Adapter & Fallback (`server/herdr-adapter.ts`)

The transport adapter provides a unified interface selected by `HERDR_TRANSPORT`:
- **Default (`socket`)**:
  - `health`: Raw `ping` over Unix socket.
  - `snapshot`: Raw `session.snapshot` over Unix socket.
  - `pane validation`: Fresh `pane.get` checking existence.
  - `pane read`: Raw `pane.read` with `{ pane_id, source, format: 'text', strip_ansi: true, lines? }`; the browser-facing `recent-unwrapped` source is translated at this adapter boundary to the raw schema enum `recent_unwrapped`.
  - `agent explain`: Raw `agent.explain` with `{ target: pane_id }`, projected safely to strip evaluated rules, terminal evidence previews, absolute manifest paths, socket paths, and raw priority, returning a compact human summary (`{ ok, paneId, available, agent, state, matchedRule, manifest, ...activeFlags }`). Existing shell panes return `{ ok: true, paneId, available: false, reason: 'no-agent' }`.
  - `prompt`: Raw `agent.prompt` with `{ target, text }` without waiting.
  - `keys`: Raw `pane.send_keys` with `{ pane_id, keys }`.
  - `terminal-input`: Raw `pane.send_input` with `{ pane_id, text, keys: ['Enter'] }` bracketed atomically.
  - `tab-create`: Raw `tab.create` with `{ workspace_id, cwd, label?, focus: false }`. Resolves source pane CWD strictly from verified terminal-backed panes in target Space.
  - `catalog`: `GET /api/interactions/catalog?pane=<id>&terminalId=<id>` safely locates the nearest ancestor `.herdr/commands.json` inert draft fill presets, validating terminal identity before reading.
  - `strict action target`: All action mutations (`/api/action`) require an `operationId`. Prompt, terminal-input, and keys use preflight target `{paneId, terminalId, expectedMode, agentSessionId?}`; `tab-create` uses exact source `{paneId, terminalId}` plus `workspaceId`. Replays cached results for duplicate operation IDs, rejects conflicting operation IDs, and rejects target mismatches.
- **Explicit CLI Fallback (`cli`)**:
  - Activated only by exact `HERDR_TRANSPORT=cli`; missing or empty selects socket, exact `socket` selects socket, and every other nonempty value fails closed.
  - Invokes bounded argv arrays via `server/herdr-cli.ts` (including `herdr agent explain <pane> --json` with fallback projection).
  - `tab-create` action is strictly rejected in CLI mode with HTTP 409 (socket transport required).
  - `/api/events` returns a non-upgrade response in CLI mode, so browser session snapshots use HTTP fallback polling.
  - No automatic per-request fallback: transport mode is explicit to prevent masking protocol errors.
- **Stream Observer Child**:
  - `spawnObserverProcess` (`herdr terminal session observe`) is retained as the default CLI transport in socket mode because the raw socket API exposes no terminal session observe method.
- **Terminal Control Child (`herdr terminal session control`)**:
  - Opt-in shell-only control session bound to an exact verified idle shell pane.
  - Spawned as `herdr terminal session control <pane> --cols <N> --rows <N>` (bounded cols 40..240, rows 12..80).
  - Preflight validates snapshot (exact pane once, no agent or display_agent, no snapshot agent ownership) and socket-first `pane.process_info` (exact pane, positive shell PID and PGID, PGID == shell PID, sole foreground process PID == shell PID).
  - Rechecks after spawn before reporting `control.ready`.
  - Process-local lease manager enforces exactly one global active/pending lease total, 10-minute maximum duration without renewal, and unguessable server-side token.
  - Auto-release sends `terminal.release` NDJSON to stdin, waits bounded 1s grace, then requests a hard kill and waits another bounded 500ms. If child exit is still unconfirmed, the lease and pane claim remain quarantined until late exit rather than claiming orphan-free teardown.
  - Remote Tailnet Terminal Control requires configured owner identity from Push config (`ownerLogin`); without it remote requests fail closed, while narrow loopback development exception remains. It does not require Push enrollment/subscription, only owner config.
  - Never uses `--takeover` and never accepts agent panes.

## 5. Event-Driven Snapshot Bridge (`server/snapshot-bridge.ts`)

The snapshot bridge maintains an efficient, shared event-driven invalidation loop for all connected browser clients:
- **Subscriptions**: Opens one dedicated Unix socket connection with `events.subscribe` for global lifecycle events plus one `{ type: 'pane.agent_status_changed', pane_id }` subscription for every current pane. Output content and terminal byte subscriptions are strictly excluded.
- **Sequence**:
  1. Fetches a preflight `session.snapshot` to discover the exact pane-ID set.
  2. Sends the global and per-pane subscriptions and waits for `{ result: { type: 'subscription_started' } }`.
  3. Fetches an authoritative `session.snapshot` on a separate request connection.
  4. Transitions to `'connected'` only after acknowledgement and authoritative snapshot receipt succeed.
  5. If the authoritative pane-ID set differs, rebuilds the subscription with the new exact set and resnapshots after its acknowledgement.
- **Serialized Refresh & Burst Coalescing Within One Active Subscription Generation**:
  - Arriving events mark `isDirty = true`.
  - If a snapshot fetch is currently in flight, arriving events coalesce into a single follow-up fetch:
    ```ts
    do {
      isDirty = false
      const snap = await fetchSnapshot()
      emitSnapshot(snap)
    } while (isDirty)
    ```
  - This prevents overlapping snapshot queries during event bursts in the same active subscription generation. A stale fetch from a lost connection cannot publish because generation checks reject it; reconnect preflight is allowed to proceed without waiting for an unresponsive stale request to time out.
- **Resilience**:
  - Connect and subscription acknowledgement waits are bounded; malformed or oversized event lines reconnect.
  - Disconnects transition to `'reconnecting'`.
  - Exponential bounded backoff reconnects, re-subscribes, and re-snapshots.
  - Stale snapshots are retained during reconnecting states.

## 6. Browser Event Transport & Hook Lifecycles

- **WebSocket `/api/events`**:
  - Strict-origin check enforces same-origin or authorized Tailnet host.
  - Discriminated union in `server/index.ts` ensures terminal close cleanup never attempts process kills on event connections.
  - Broadcasts `{ type: 'status', status }` and `{ type: 'snapshot', data }`.
- **`useSnapshot` Lifecycle**:
  - Initial HTTP `fetchSnapshot()` provides immediate bootstrap on mount.
  - WebSocket `/api/events` connects and becomes the primary real-time snapshot source.
  - **Snapshot polling stops only when the backend bridge status is `connected`**. A browser WebSocket `open` event alone is not healthy.
  - Fallback HTTP polling remains active while connecting, reconnecting, disconnected, errored, closed, or when CLI mode rejects the event upgrade.
  - Immediate `refreshSnapshot()` remains available for post-mutation updates.
- **Reading Surfaces Polling Truthfulness**:
  - Panel, History, and Question views continue active HTTP polling (`/api/pane/read`).
  - Terminal buffer text changes are not modeled as lifecycle events; truthful polling on active reading surfaces ensures responsive text viewing without fake full-stream subscriptions.

## 7. Web Push Notification Subsystem (`server/push/`)

- **Bridge Attachment & Snapshot Diffing**:
  - Whenever valid push configuration exists, `PushService` attaches to the shared `SnapshotBridge` on backend startup, maintaining active background notification capability even when zero browser WebSocket clients are connected. Socket transport is required. In explicit CLI transport mode (`HERDR_TRANSPORT=cli`), Web Push is disabled truthfully. Generated configuration requires server restart or reload before Push becomes enabled.
  - Diffing strictly evaluates authoritative session snapshots rather than raw event streams:
    - **Initial Baseline**: The first authoritative snapshot establishes aggregate tab-status tracking; zero pushes are dispatched even if tabs are already `blocked` or `done`.
    - **Tab Owner Scope & Per-Tab Policy**: Background notifications track aggregate streams per Space: by default, only the first canonical tab (lowest finite `number`, deterministic tie-break by `tab_id`) is enabled, while explicit live Tab policy overrides allow any Tab to be enabled or disabled via `/api/push/tab-policy` and the drawer UI. Individual pane transitions and disabled tabs never emit. Internal `sourceTabId` on `IPushTransition` is dropped by sender; push payloads, tags, and URLs remain Space-only (`/spaces/<encoded-id>`). State delivery is best-effort snapshot observation. All Tab statuses continue to be tracked even while disabled so enabling never replays old state retroactively.
    - **Needs Input**: Enabled tab transition from any non-blocked state to `blocked` dispatches one `needs_input` alert (`Herdr needs input · Space: <label>` or generic fallback).
    - **Done**: Enabled tab transition from any non-done state to `done`, or the evidence-backed interactive-turn transition from `working` to `idle`, dispatches one `done` alert (`Herdr task finished · Space: <label>` or generic fallback). Initial/repeated idle and non-working to idle do not emit.
    - **Deduplication**: Reconnects and repeated unchanged snapshots produce zero pushes; a real state change observed after downtime may emit once.
    - **Re-entry**: Enabled tabs returning to `working` and later entering `blocked`, `done`, or the interactive completion transition `working → idle` cleanly re-trigger.
    - **Topology**: Removed tabs clear their aggregate baseline tracking. If canonical or enabled tabs change due to topology changes, previous unchanged states do not retroactively emit; only a future aggregate transition from an enabled tab can notify.
- **VAPID & Atomic Stores**:
  - Standard Web Push protocol powered by `web-push` with 60-second TTL and dependency-injected mockable sender.
  - Atomic private JSON storage for subscriptions (`~/.config/herdr-web/push-subscriptions.json`, overridden by `HERDR_PUSH_SUBSCRIPTIONS_PATH`) with directory `0700` and file `0600` permissions.
  - Atomic private JSON storage for per-tab notification policy overrides (`~/.config/herdr-web/push-tab-policy.json`, overridden by `HERDR_PUSH_TAB_POLICY_PATH`) with directory `0700` and file `0600` permissions, schema version 1, and bounded topology fingerprinting (`workspaceNumber`, `workspaceLabel`, `tabNumber`, `tabLabel`) to survive restarts with identical topology and reject stale reuse. Store failure before detector mutation preserves transition state and dispatches zero pushes. Setting a tab to its default removes its override record from the store.
  - Push service automatically prunes subscriptions returning HTTP 404 or 410 (Gone/Unregistered).
- **Route Authorization & Security Boundary**:
  - `GET /api/push/config`: Public key and enabled status only; private keys and secrets are never exposed.
  - `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions`, and `POST /api/push/test` enforce strict Origin/Host validation.
  - Over Tailnet HTTPS (`*.ts.net`), requests strictly require a `Tailscale-User-Login` header matching configured `ownerLogin`. Tailscale membership without matching login is rejected with HTTP 403.
  - Narrow loopback development exception is allowed exclusively for approved loopback host/origin pairs (ports 8787/5173).
- **Service Worker Contract (`public/sw.js`)**:
  - App bootstrap requests an uncached service-worker update, waits for an installing/waiting worker to activate, and verifies the active worker's explicit protocol version before Push is marked ready. A stale or non-responsive worker yields a truthful close-and-reopen state instead of silently accepting broken notification clicks.
  - Promptly calls `showNotification` under `event.waitUntil` with safe fallbacks for malformed payloads. Never issues silent pushes. Derives visible title, body, and target URL directly; ignores caller-supplied title/body/url.
  - Delivery is best-effort snapshot observation: transitions missed entirely between snapshots or disconnections cannot be delivered; process restart baselines current state; provider TTL is 60s.
  - `notificationclick` validates the Space target. For an already-open same-origin client, the Service Worker sends a bounded `herdr:open-workspace` message and focuses that existing client only after receiving an explicit `herdr:workspace-opened` positive acknowledgment from the current app bundle. If the app explicitly rejects an unknown Space (`herdr:workspace-rejected` with bounded fixed reason `unknown_space`), returns invalid data, or times out (including stale/pre-update PWA bundles without the listener), the worker does not call `client.navigate`, does not focus the client, and does not open a duplicate window while that same-origin client exists; it records bounded truthful diagnostics and terminates safely. Stale or pre-update PWA bundles must close and reopen before notification clicks can focus them. When zero same-origin window clients exist, `openWindow('/spaces/:workspaceId')` opens the canonical deep link. Non-Space/root test notifications preserve safe exact-root behavior deliberately. Target conflicts fail closed to exact root without dispatching Space messages. Physical iOS focus and Space switching of an already-open PWA has not passed the human verification gate and remains unverified under bounded diagnostic investigation.
  - Automated tests validate VAPID keypairs, local payload encryption/request construction, store/route behavior, and the static service worker contract. Provider/APNs delivery and physical iOS reception remain human verification.
- **Browser Push Operation Ownership**:
  - Settings status describes this device: inspection reads `pushManager.getSubscription()` and idempotently synchronizes an existing local subscription before reporting Active. Browser permission alone and subscriptions stored for other devices do not establish current-device enrollment. No subscription-list/count API is exposed.
  - Android Chrome subscription `AbortError` uses fixed push-provider registration guidance: check/update Chrome and Google Play services, check the network, and retry only after a relevant state change. This is troubleshooting guidance, not proof of a specific GMS/FCM cause or a repair by Herdr. Other platforms retain generic allowlisted error copy. The coarse Android/Chrome check remains local; raw browser errors and user-agent strings are never displayed, logged, or sent. Re-check Status inspects/synchronizes; it does not call `subscribe()`.
  - Physical iOS delivery has been reported working by the owner. Physical Android enrollment/delivery remains human-owned and unverified after the observed provider registration failure. Automated tests do not establish physical delivery; the deferred iOS Space-switch gate is unchanged.
  - One volatile document-lifetime ticket owns each Push mutation. Its 10-second foreground deadline releases the busy presentation but does not treat non-cancellable browser promises as failed, release exclusivity, or permit a duplicate mutation.
  - Late subscribe/unsubscribe settlement is reconciled against the browser's authoritative subscription before backend synchronization or cleanup. Settings exposes only reload while a ticket remains unresolved. Document termination intentionally loses this volatile reconciliation; no endpoint capability is written to web storage.
  - Push HTTP requests keep one deadline across response headers and JSON body parsing. An aborted mutation is not assumed to be uncommitted, so confirmed browser rollback performs best-effort backend cleanup.

## 8. Core Pack Backend & Foundation (`server/operation-coordinator.ts`, `server/catalog.ts`, `server/agent-presets.ts`)

- **Shared Mutation & Terminal Control Authorization (`server/security.ts`)**:
  - `validateOwnerAuth`: Unified owner authorization check used across `/api/terminal/control`, `/api/terminal/control/status`, `/api/action`, and `/api/push/*`.
  - Remote Tailnet HTTPS requests (`*.ts.net`) enforce `Tailscale-User-Login` matching configured `ownerLogin` in `push-config.json`. Mismatched logins fail with HTTP 403 Forbidden; missing server owner configuration fails closed with HTTP 500 (`Server misconfigured: owner login not set`).
  - Narrow loopback development exception is allowed exclusively for approved loopback Host/Origin pairs (ports 8787/5173); the read-only Control status GET may omit Origin while retaining the approved Host check.
  - Action and Terminal Control authorization does not require Web Push enrollment or an active push subscription; it only requires server owner configuration.
- **Terminal Control Status & Server-Governed Release (`server/terminal-control.ts`, `server/index.ts`)**:
  - `GET /api/terminal/control/status?pane=<exact>`: Read-only status endpoint enforcing host allowlist and Tailnet owner authorization, while validating any supplied Origin (permits omitted Origin for same-origin browser GET while rejecting malicious origins with HTTP 403).
  - Validates exactly one conservative pane ID without query ambiguity.
  - Returns only bounded `{ ok: true, pane, leased, status }` where `status` is `pending | active | releasing | null`; never exposes lease ID or process IDs.
  - In CLI transport mode, consistently returns unleased status (`{ ok: true, pane, leased: false, status: null }`) because Terminal Control is unsupported.
  - Browser ownership state tracks the exact controlling pane and polls this endpoint serially upon release (user release, error, pane change, view change) with bounded interval. Exclusivity remains in `releasing` while `leased: true` or requests fail; the footer banner restores to idle and composer only after the server explicitly returns `leased: false` for that exact pane. Quarantined leases retain releasing indefinitely.
- **Unified Physical Pane & Lease Mutual Exclusion (`server/operation-coordinator.ts`)**:
  - Mutual exclusion between action mutations and Terminal Control sessions is unified in the `OperationCoordinator` arbiter.
  - Action mutations and Terminal Control lease reservations claim physical panes through the same process-local arbiter (`claimPaneForControl`, `releaseControlPane`, `beginAction`).
  - Terminal Control reservations fail immediately with HTTP 409 Conflict if an action mutation is active or in-flight on the pane; action mutations fail with HTTP 409 Conflict if a Terminal Control lease is active or pending on the pane.
- **Target Identity & State Preflight (`server/security.ts`)**:
  - `IActionTargetIdentity` requires `{ terminalId: string, paneId: string, expectedMode: 'agent' | 'blocked-agent' | 'shell', agentSessionId?: string | null }`.
  - Canonical server agent helper `isAgentPane(pane, snapshotAgents)` aligns server mode verification and Terminal Control preflight with frontend semantics: literal case-insensitive `'shell'` in `agent` or `display_agent` is not agent evidence; presence of `agent_session` or matching snapshot agents is agent evidence.
  - Preflight validates the target against the authoritative snapshot:
    - Verifies pane presence (HTTP 404).
    - Terminal replacement verification: rejects with HTTP 409 Conflict if `target.terminalId !== pane.terminal_id`.
    - Mode verification: evaluates canonical agent evidence (`agent`, `display_agent`, `agent_session`, or matching snapshot agent) together with authoritative `pane.agent_status`; blocked agent evidence maps to `blocked-agent`, other agent evidence maps to `agent`, and absence of agent evidence maps to `shell`. Mismatches return HTTP 409 Conflict.
    - Agent session identity: when `expectedMode` is `agent` or `blocked-agent` and authoritative pane/snapshot agent evidence exposes a session identity, caller must provide matching `agentSessionId` (omission or replacement returns HTTP 409 Conflict). If no authoritative session identity exists, absence is allowed. Shell panes reject caller-provided `agentSessionId` with HTTP 409 Conflict.
- **Per-Target Operation Coordination & Idempotency (`server/operation-coordinator.ts`)**:
  - **Process-Local Scope**: Operation coordination is process-local within the single application server instance and does not provide multi-instance or daemon-wide transactional guarantees.
  - **Synchronous Token-Fenced Admission**: In `POST /api/action`, `coordinator.beginAction(operationId, paneId, fingerprint)` runs synchronously before any `await` (such as `await fetchSnapshot`). It reserves the `operationId` and claims the target physical pane with an unguessable attempt token, returning `{ kind: 'admitted', token }`.
  - In-flight duplicate requests return HTTP 409 Conflict immediately without awaiting.
  - Conflicting operation ID reuse with a different payload returns HTTP 409 Conflict immediately.
  - Physical pane contention with another in-flight mutation or active Terminal Control session returns HTTP 409 Conflict immediately.
  - **Pre-Dispatch Snapshot Failure Handling**: If `fetchSnapshot` throws or times out before dispatch, the route calls `coordinator.abandonAction(token)`: the operation ID and pane claim are freed without caching, returning HTTP 502 with `outcome: 'rejected'` so the caller can retry cleanly.
  - **Outcome Caching & Genuine LRU Order**:
    - Completed dispatch outcomes (`outcome: 'acknowledged'`, `outcome: 'observed'`, `outcome: 'unknown'`) and authoritative target/mode preflight rejections (`outcome: 'rejected'`) call `coordinator.completeAction(token, status, body)`, caching the response in a bounded LRU map (1000 entries, 60s TTL).
    - Exact replay during TTL returns the cached response without redispatching. Replay hits touch the cache entry, refreshing it to the most-recently-used position to prevent active idempotent operations from being evicted under load.
- **Workspace Tab Creation (`server/herdr-adapter.ts`)**:
  - `executeTabCreate`: Socket-first creation using raw `tab.create`.
  - CLI fallback mode returns HTTP 409 Conflict truthfully (`outcome: 'rejected'`) as raw `tab.create` requires socket transport.
  - Hardcodes `focus: false` to guarantee zero disruption to active terminal focus.
  - Derives CWD truthfully from source pane (`foreground_cwd || cwd`).
  - Verifies source workspace membership before dispatch.
  - **Correlated RPC Response Matching**: Requires exact `rpcResponse.type === 'tab_created'` matching the correlated request ID, extracting the authoritative `tab.tab_id`, `workspace_id`, and optional `root_pane`. Post-creation snapshot proof confirms the exact returned tab exists in the target Space. If `root_pane` is returned, verifies its tab membership; if tab-only, asserts exactly 1 terminal-backed pane exists in that tab.
  - Unrelated concurrent tabs are never attributed. Rejections, timeouts, wrong response types, or ambiguous daemon returns yield truthful `{ ok: false, status: 504, outcome: 'unknown' }` without inferring causation from matching new tabs (no timeout/daemon error reconciliation exists). Replay returns cached 504 without reinvoking `tab.create`.
  - In the UI, New Shell Tab unknown state persists across drawer close, back navigation, and form reopening until cleared strictly by an explicit successful snapshot refresh (`result === true`). By contrast, prompt and terminal-input unknown state has no automatic retry; drafts and warnings are retained, where inspection before manual resubmission with a fresh operation ID is guidance, not an enforced gate.
- **Command & Interaction Catalog (`server/catalog.ts`)**:
  - Inert draft fill commands: catalog items are non-executable suggestions designed for local client selection and input-draft filling, never automated execution without user confirmation.
  - `GET /api/interactions/catalog?pane=...&terminalId=...`: Requires both `pane` and `terminalId`, preflights against authoritative snapshot, and rejects missing or replaced terminal IDs (HTTP 409). Never accepts an arbitrary `?cwd`.
  - **Canonical Git Boundary Traversal**: Resolves `startDir` with `fs.realpathSync` before traversing ancestors, ensuring symlinked path components cannot cause lexical traversal to escape across the Git repository boundary into untrusted parent directories.
  - Distinguishable status returns:
    - Missing config within boundary: returns HTTP 200 with valid empty catalog (`items: []`).
    - Invalid config (symlink, non-directory, non-regular file, oversize > 64 KB, invalid JSON, or schema validation failure): returns HTTP 422 Unprocessable Entity with safe bounded error without leaking absolute paths or file contents.
  - Endpoint returns only `source: 'repo-config'` with repository commands; no native choices or presets are returned by the endpoint.
- **Future Native Interactions & Dormant Presets (`server/agent-presets.ts`, `server/types.ts`)**:
  - Authoritative native interaction envelope (`INativeInteractionEnvelope` with providerId, providerVersion, target, interactionId, revision, expiry, responseMethod, choices) and response type (`INativeChoiceResponse`). No runtime or endpoint.
  - Structured dormant preset contract (`IAgentPreset` with kind `'agy'`, model `'gemini-3.8-flash-high'`, effort `'high'`, permissions `'dangerously-skip-permissions'`, `enabled: false`, fixed argv `['agy', '--model', 'gemini-3.8-flash-high', '--dangerously-skip-permissions']`).
  - Launch execution validator fails closed (`Agent presets are dormant; no agent launch runtime or route is enabled.`); dormant preset is unreferenced by routes or UI.
