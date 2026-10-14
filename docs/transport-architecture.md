# Transport Architecture

This document describes Herdr Web's socket-first, event-driven integration with the installed Herdr 0.9.3 host, retaining the bounded CLI fallback.

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

## Interactive prompt boundary

Chat reads owner-authenticated, no-store `GET /api/pane/prompt?pane=<id>` and answers through the existing `POST /api/action` pipeline using `type: 'prompt-answer'`, exact target/session, an occurrence ID and one typed answer intent. Native keys/plans never come from the browser. The complete pinned source pure parser/answer graph is server-owned; native Codex queue and OmO open-call evidence is replayed through the existing exact descriptor/session/history/branch reader, never newest-file or CWD selection. One coordinator claim spans navigation, answer and permitted queue cleanup. Target/session and observed cursor/checks/form phase are revalidated per write. Possibly-applied failures are cached unknown and not automatically replayed. Unverifiable transitions stop rather than continue into another question. Reads and writes are not native CAS: an identical prompt answered and repeated wholly between observations remains indistinguishable. Question stays read-only; generic input and raw keys authority is unchanged. The internal text-only answer adapter deliberately omits Enter.

### Explicit Web-held intents

`server/held-queue.ts` owns inert Web-held text, separate from both submission receipts and native pending-input observations. Authenticated same-Origin `POST /api/action` variants `held-enqueue`, `held-send` and `held-discard` retain the existing 4096-byte request-envelope ceiling and operation coordinator. Immutable text/target/session and a hashed owner/Origin/document capability bind each record; the random capability stays in Root memory and travels only in `X-Herdr-Held-Capability`. Record state, not the expiring operation cache, prevents a second dispatch. Possibly-written outcomes consume authority as uncertain; snapshot failures before any write abandon the attempt uncached and remove a newly allocated enqueue record.

Explicit no-store `POST /api/held/read` recovers original-document receipts by bounded enqueue operation IDs without another enqueue or native write. Saved projections restore informationally only, never capability or delivery authority. There is no scheduler, connection lease, automatic replay, native interruption or native cancellation. Send now means submit the server-held text through the existing prompt adapter after fresh target/session/readiness checks; it is not proof of execution. Native read/write remains non-CAS. Current behavior and user-facing limits are detailed in `docs/project-overview.md`.

## Repository Changes read boundary

`GET /api/workspace/diff/files` and `/api/workspace/diff/file` are implemented by `server/repo-diff.ts`, routed through the same configured owner identity as the contextual file viewer. Host/owner and supplied Origin are validated before repository or snapshot operations; the existing route-level configured-owner load may itself touch disk before authorization. GET reads permit missing Origin like the existing file viewer. Strict single-value query keys accept only `pane_id`, scope, explicit base/head for commit comparisons, and file path/optional rename identity for one patch. There is no browser-selected cwd: exact native pane `foreground_cwd || cwd` owns repository discovery, and a second snapshot fences terminal/folder/session replacement before publication. Lists return a deterministic SHA256 `repository_identity` over versioned pane/required terminal/effective cwd/canonical pane-first agent session (including absence), canonical root/gitdir/common-dir path and dev/ino, scope and resolved commit endpoints. Patches must supply that identity and full resolved OIDs for commit scope; a fresh server-derived mismatch returns 409 before listing/patch I/O. This stateless fingerprint is freshness, not an auth capability, HMAC or server-side store; ordinary file edits remain allowed.

Working tree means unstaged plus untracked, Staged means index versus HEAD (including unborn repositories), and commit scope resolves two explicit names option-safely to hashes. The adapted upstream NUL listing parser preserves path identity, rename metadata and binary/null line counts. File requests match a fresh full listing; forged wildcard/pathspec or stale rename identities cannot authorize another read. Listings cap at 2000 files / 2 MiB per process; one whole patch caps at 1 MiB, with no partial-hunk response. Git processes use argv, literal pathspecs, `--` before paths, a 5-second deadline, ignored stderr, disabled external diff/textconv/fsmonitor/optional locks and a non-inherited environment. Git diff forces `--attr-source` to the object-format-specific built-in empty tree, `core.attributesFile=/dev/null` and `GIT_ATTR_NOSYSTEM=1`. These flags alone do not suppress common-dir `info/attributes` (the previous clean/process safety claim was refuted). Actual Git/common dirs are resolved with the same isolated Git invocation, including gitfiles/linked worktrees; immediately before every diff spawn, nofollow metadata checks accept only absent attributes or a readable regular zero-byte file. Nonempty files (even comments), symlink info/attributes entries (including dangling links), nonregular entries, ENOTDIR and permission ambiguity return 409 `attributes-unsupported`. Canonical gitdir symlinks are permitted. `GIT_NO_REPLACE_OBJECTS=1` protects the empty-tree source from replace refs. This requires cooperative same-UID/stable metadata, not atomic kernel protection against concurrent swaps; binary detection is automatic, not a repository's custom attributes/driver interpretation. Git lacking `--attr-source` support fails closed rather than silently reading with filters. Untracked files never use Git's pathname-reopening `--no-index`: canonical containment and regular FD/dev/ino/time identity checks precede a bounded descriptor read; symlink/nonregular/changed files return unsupported. Repository state is not an atomic native snapshot; concurrent native changes can require an explicit refresh. Descriptor checks follow the existing local file-viewer's identity model, not a kernel-level openat traversal guarantee against an adversarial process racing ancestor directories.

Responses are private no-store/nosniff; errors contain neither raw stderr nor repository paths. `repo-diff-api` owns browser requests and cancellation; `repo-changes` owns the header-triggered Base UI Dialog and reuses canonical control recipes plus the existing contextual file viewer. The lazily loaded `repo-diff` uses exact installed Apache-2.0 `@pierre/diffs@1.5.2` strict parsing and virtualized Unified/Split code rows. At <=600px the style is Unified regardless of desktop choice, returning to the reader's chosen desktop style when widened. One source-adapted shared two-worker pool uses the JS highlighter, 12-entry caches and a 30-second no-holder lease; a render discarded before effect ownership also schedules disposal. Context folding keeps one unchanged line (the upstream parser's supported minimum), wrapping is explicit, line/hunk metadata stays parser-owned, and local dark tokens cross the shadow root. Byte/line-heavy patches are plain but still virtualized. Loading, parse/renderer failure and no-lines metadata-only states are explicit; Copy always retains the complete original patch rather than rendered/folded rows. Tests cover FD-derived empty/no-newline/Thai/quote/tab patches and native rename/deletion/multi-hunk output using the actual installed parser. Apache/Pierre and bundled copyright/license texts remain in THIRD_PARTY_NOTICES. Browser/rendered acceptance is independent of these source tests. Open current file means disk content, not the compared historical blob. No mutations, filesystem crawler or turn-level changed-file integration are exposed.

## 3. Schema Ownership & Sync (`scripts/sync-herdr-schema.ts`)

The repository owns its generated protocol constants and tracked JSON schema without introducing external code-generation dependencies:

- `bun run schema:sync`: Invokes `herdr api schema --json` and writes:
  - `server/generated/herdr-schema.json`: Complete tracked JSON schema.
  - `server/generated/protocol.ts`: Constant exports for `HERDR_TRACKED_PROTOCOL = 22` and `HERDR_TRACKED_SCHEMA_VERSION = 1`.
- `bun run schema:check`: Semantically compares the complete installed JSON schema with the tracked schema and validates generated protocol metadata. Formatting and object-key order are ignored; any schema-body drift exits non-zero.
- Handwritten minimal runtime TypeScript interfaces (`server/types.ts` and `src/types/herdr.ts`) model the specific subsets used by the application to avoid generating 270KB+ of unused type boilerplate.
- The current pin was regenerated against the installed 0.9.3 host on 2026-10-07. Protocol 22/schema 1 and existing Web request/result variants are unchanged. The host removed `pane.graphics.clear/info/set` and graphics result variants, added `pane.clear` and `server.ssh_agent.register`, and added optional restore/resume/completion metadata. Pinning these declarations does not expose new Web operations: SSH registration, pane clear, resume argv, and graphics remain outside the Web feature boundary. Other native builds must pass `schema:check`; a version string alone does not prove schema equality.

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
  - `workspace-create`: Raw `workspace.create` with `{ label?, cwd?, focus: false }`. An explicit source derives fresh `foreground_cwd || cwd`; omitted source delegates directory choice to Herdr. Requires the complete correlated `workspace_created` entity shapes and exact post-snapshot Space/Tab/root-pane proof.
  - `workspace-close`: Raw `workspace.close` with `{ workspace_id, close_group: false }`. Requires a fresh exact confirmed Tab/pane manifest before RPC, exact `{ type: 'ok' }`, and post-snapshot absence of the Space and all descendants.
  - `tab-close`: Raw `tab.close` with `{ tab_id }`. Rejects the last canonical Tab before RPC, requires a fresh exact confirmed pane manifest, exact `{ type: 'ok' }`, and post-snapshot target/descendant absence while the Space remains.
  - `catalog`: `GET /api/interactions/catalog?pane=<id>&terminalId=<id>` safely locates the nearest ancestor `.herdr/commands.json` inert draft fill presets, validating terminal identity before reading.
  - `strict action target`: All action mutations (`/api/action`) require an `operationId`. Prompt, terminal-input, and keys use preflight target `{paneId, terminalId, expectedMode, agentSessionId?}`; `tab-create` uses exact source `{paneId, terminalId}` plus `workspaceId`; lifecycle close requests include exact normalized expected membership. Replays cached results for duplicate operation IDs, rejects conflicting reuse, and rejects target or membership mismatches.
- **Explicit CLI Fallback (`cli`)**:
  - Activated only by exact `HERDR_TRANSPORT=cli`; missing or empty selects socket, exact `socket` selects socket, and every other nonempty value fails closed.
  - Invokes bounded argv arrays via `server/herdr-cli.ts` (including `herdr agent explain <pane> --json` with fallback projection).
  - `tab-create`, `workspace-create`, `workspace-close`, and `tab-close` actions are strictly rejected in CLI mode with HTTP 409 (socket transport required).
  - `/api/events` returns a non-upgrade response in CLI mode, so browser session snapshots use HTTP fallback polling.
  - No automatic per-request fallback: transport mode is explicit to prevent masking protocol errors.
- **Stream Observer Child (Fitted Live Grid)**:
  - Stream mode fits the actual native PTY grid to the browser canvas by spawning `herdr terminal session control <TARGET> --cols <N> --rows <N>` via `server/terminal-fit.ts` (bounded cols 1..500, rows 1..200, allowing mobile 35-col viewports without a min-40 restriction).
  - Synchronized reservation guarantees exactly one fitted geometry producer per `terminalId`. Non-WebSocket callers retain HTTP 409 with `FIT_BUSY`/`FIT_BLOCKED_BY_CONTROL`. Browser upgrades receive a denial-only socket closed with application code `4409` and the exact reason: `FIT_BUSY`, `FIT_BLOCKED_BY_CONTROL`, or `FIT_RELEASING` while a prior producer retires. That socket allocates no fit session, spawns no native producer, and accepts no input. This is the Web transport's admission contract, not a native Herdr frame/schema change.
  - Browser clients stop automatic retries for busy/control admission and show a manual Retry action. `FIT_RELEASING` uses the existing bounded backoff; it is not labelled as another active viewer. Busy suppression uses a socket-lifecycle ref rather than stale React error state. Manual Retry resets the block; no automatic takeover is introduced.
  - The browser stream hook debounces and dedupes `{ type: 'terminal.resize', cols, rows }` over the same WebSocket without reconnecting. Old fixed-grid layout watchers do not override browser-fitted dimensions.
  - The fitted WebSocket also accepts bounded native source scroll commands (`terminal.scroll` with signed `deltaRows`, `to: 'latest'`, or `reset: true`), clamped against current native `pane.get` scroll metadata and executed via canonical `pane.scroll`, emitting `terminal.scroll-state`.
  - Wheel and mobile touch drag in Live mode adjust native reading offset, with `Latest` restoring offset 0 and incoming updates preserving reading position when scrolled up (`offset > 0`).
  - Terminal fit automatically releases on document hidden/pagehide/unmount/Chat/pane switch and on manual pause, terminating the fitted producer child and restoring native desktop PTY dimensions automatically without calling `pane.resize`.
  - Resize and scroll authority do NOT acquire `operation-coordinator` pane claims, allowing Composer Send and agent prompts to execute concurrently without contention.
  - Shell input control (`/api/terminal/control`) uses a break-before-make transition: it exclusively blocks fit admission for the terminal and confirms fit-producer exit before activating an input lease; fit admission remains blocked until lease release or quarantine clearance.
  - The backend verifies the target against authoritative snapshot preflight before spawn and re-checks post-spawn.
  - Local 2D panning remains available when scrolled away. Source history is bounded by the native API; native source viewport scrolling is distinct from agent-app/internal scroll when no history exists.
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
  - Broadcasts `{ type: 'status', status }` and `{ type: 'snapshot', data }`, where snapshot data is strictly projected through `projectBrowserSnapshot`.
  - Server-side browser snapshot projection at HTTP `/api/snapshot` and WebSocket `/api/events` boundaries ensures minimal payloads, fresh allowlisted objects, and zero leakage of unknown fields, `layouts`, `state_labels`, raw token maps, Letta identity tokens, or worktree paths/path-like labels.
- **`useSnapshot` Lifecycle**:
  - Initial HTTP `fetchSnapshot()` provides immediate bootstrap on mount.
  - WebSocket `/api/events` connects and becomes the primary real-time snapshot source.
  - **Snapshot polling stops only when the backend bridge status is `connected` and a current authoritative snapshot read has succeeded**. A browser WebSocket `open` event alone is not healthy. UI readiness follows current successful HTTP/pushed read truth, separately from bridge health: an unhealthy status cannot demote that read, while a healthy status cannot clear a read error or suppress fallback until another read succeeds.
  - Fallback HTTP polling remains active while connecting, reconnecting, disconnected, errored, closed, when CLI mode rejects the event upgrade, or after a current HTTP read failure even with healthy bridge status. A status reply with no current successful read immediately requests one through the single-flight gate.
  - `src/services/snapshot-reader.ts` owns browser recovery, separate from the native snapshot bridge. Hidden/pagehide/offline retires the event socket and aborts HTTP once; the first visible/pageshow/online resumes the connection and immediately reads an authoritative HTTP snapshot. Overlapping or delayed notifications do not abort/reopen that new attempt or demote its successful read. An online notification can accelerate an existing socket retry without aborting HTTP. Socket callbacks are identity-fenced; retry/deadline/heartbeat timers and browser listeners are removed at cleanup.
  - Event connection/application response deadlines are 10s. Every 15s the browser sends the exact text `{"type":"events.ping"}`; the events-only server handler responds with its current `{ type: 'status', status }` without a native read/write. Actual application replies establish browser-path liveness independently of native bridge health; silence in topology updates alone never declares an idle stream dead. Missing replies retire the socket and restore HTTP fallback with bounded reconnect backoff (1–8s).
  - HTTP snapshot reads use no-store and a 10s deadline including response-body parsing, relay owner cancellation, and share one in-flight request. A newer pushed snapshot, lifecycle recovery or cleanup invalidates/aborts older reads; stale completions cannot mutate read state or pass explicit refresh gates.
  - Immediate `refreshSnapshot()` remains available for post-mutation updates. Recovery only restores reads: no automatic input, held-intent replay, mutation retry or Terminal Control reacquisition. Selection reconciliation preserves still-valid browser selection.
  - Fitted Terminal streams cancel CONNECTING sockets immediately on retirement and bound connection attempts through the first valid native frame to 10s using their existing retry budget; WebSocket open alone does not end that deadline. A valid empty frame also establishes producer response, so subsequently idle terminals are not timed out for lack of output. Busy/control fit denials retain manual Retry, and input Control lease ownership is unchanged.
- **Reading Surfaces Polling Truthfulness**:
  - Panel and Question views continue active HTTP polling (`/api/pane/read`), while Chat uses its dedicated conversation endpoint (`/api/conversation`). Chat's `use-conversation` read owner serializes exact-pane requests and invalidates/aborts tickets once on hidden/pagehide/offline; the first visible/pageshow/online requests a fresh latest page without clearing loaded history, session metadata or the earliest paging frontier. Overlapping/delayed resume notifications preserve that request and do not issue another read after it succeeds. Polling cannot preempt an explicit older-page read. Pane/enable changes and authoritative session replacement retain their existing resets, including one stale-history 409 retry. Conversation requests are no-store with a 10s deadline through response-body parsing; timeout frees the serial gate, and retired responses/errors cannot mutate the new ticket's state.
  - Terminal buffer text changes are not modeled as lifecycle events; truthful polling on active reading surfaces ensures responsive text viewing without fake full-stream subscriptions.

## 7. Web Push Notification Subsystem (`server/push/`)

- **Bridge Attachment & Snapshot Diffing**:
  - Whenever valid push configuration exists, `PushService` attaches to the shared `SnapshotBridge` on backend startup, maintaining active background notification capability even when zero browser WebSocket clients are connected. Socket transport is required. In explicit CLI transport mode (`HERDR_TRANSPORT=cli`), Web Push is disabled truthfully. Generated configuration requires server restart or reload before Push becomes enabled.
  - Diffing strictly evaluates authoritative session snapshots rather than raw event streams:
    - **Initial Baseline**: The first authoritative snapshot establishes Tab attention and leaf-agent Space round tracking; zero pushes are dispatched even if agents are already `blocked` or `done`. Observed working agents arm a completion round.
    - **Tab Policy**: By default, only the first canonical tab (lowest finite `number`, deterministic tie-break by `tab_id`) is enabled, with live overrides via `/api/push/tab-policy` and the drawer UI. Needs input respects the emitting Tab's policy. Space completion requires at least one enabled Tab, but counts agents in every Tab, including muted Tabs. Internal `sourceTabId` is dropped by sender; push payloads, tags, and URLs remain Space-only (`/spaces/<encoded-id>`). All states are tracked while muted, so enabling never replays old completion.
    - **Needs Input**: Enabled tab transition from any non-blocked state to `blocked` dispatches one `needs_input` alert (`Herdr needs input · Space: <label>` or generic fallback).
    - **Done**: After observing work in a Space, emit one `done` alert only when every canonical agent pane is `done` or `idle`. Empty shell panes are excluded using server `isAgentPane`; `blocked`, `working`, unknown or unrecognized agent states prevent completion. Native Tab/Space attention can report `done` while a leaf works, so parent aggregates never establish completion. Initial idle/done and empty Spaces do not emit.
    - **Deduplication**: Reconnects and repeated unchanged snapshots produce zero pushes; a real state change observed after downtime may emit once.
    - **Re-entry**: Completion is consumed once (even when muted). Only a newly observed working leaf arms the next Space round. Needs input retains immediate enabled-Tab non-blocked → blocked transitions.
    - **Topology**: Changed Tab/agent membership or terminal/session identity establishes a silent Space baseline; removing a busy agent cannot manufacture completion. Removed Spaces and Tabs clear tracking. Invalid/duplicate or orphan topology fails closed. Policy-only changes do not replay completion.
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
- **Topology + Per-Target Operation Coordination & Idempotency (`server/operation-coordinator.ts`)**:
  - **Process-Local Scope**: Operation coordination is process-local within the single application server instance and does not provide multi-instance or daemon-wide transactional guarantees.
  - **Synchronous Token-Fenced Admission**: In `POST /api/action`, `coordinator.beginAction(operationId, options, fingerprint)` runs synchronously before any `await`. It reserves the `operationId`, acquires a shared or exclusive topology claim, and claims an exact pane where applicable with one unguessable attempt token.
  - In-flight duplicate requests return HTTP 409 Conflict immediately without awaiting.
  - Conflicting operation ID reuse with a different payload returns HTTP 409 Conflict immediately.
  - Workspace/Tab create/close actions acquire exclusive topology. Prompt/input/keys and the full Terminal Control lease lifecycle acquire shared topology plus exact pane ownership. Tab-policy writes acquire transient shared topology. Exclusive/shared or physical-pane contention returns HTTP 409 immediately.
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
- **Space and Tab Lifecycle (`server/herdr-adapter.ts`, `src/hooks/use-lifecycle-operations.ts`)**:
  - `executeWorkspaceCreate`, `executeWorkspaceClose`, and `executeTabClose` are socket-only typed adapters; browsers never receive or choose raw RPC method names.
  - Close requests carry canonical raw ID manifests rather than hashes alone. The adapter fetches an immediate fresh snapshot and compares exact sets before sending the destructive RPC; changed membership returns a definitive 409 rejection and zero RPC.
  - Direct close responses are exact `{ type: 'ok' }`; `workspace_closed` and `tab_closed` remain event invalidation signals, not operation receipts. Timeout, malformed response, or failed postcondition is `outcome: 'unknown'` and is cached without retry.
  - Root owns the lifecycle ticket and reconciliation attempt. Pending/unknown/reconciliation-failed states gate new lifecycle mutations across Drawer and route lifetime. A successful explicit inspection can reopen intent without replaying the old mutation; observed create selection requires exact refreshed returned IDs and a current origin fence.
- **Agent Status Semantics**:
  - `session.snapshot` is the canonical owner. Herdr Web validates and republishes status without recomputation.
  - Pane `agent_status` is the effective pane state. Tab and Space `agent_status` are Herdr attention aggregates with precedence `blocked > unseen idle (public done) > working > seen idle > unknown`; therefore a Space can truthfully aggregate to `done` while another Tab is `working`. Raw snapshot DTOs, wire schema, socket protocol, and action targets preserve native attention semantics without alteration. Push Needs input uses native Tab attention; Push Done derives all-agent Space completion separately without rewriting snapshot statuses.
  - UI must not describe aggregate fields as “any agent working.” For browser UI presentation, Herdr Web computes a pure derived Activity view (`blocked > working > done > idle > unknown`) from leaf panes (`src/utils/activity-status.ts`) across navigation consumers (Space/Tab compact indicators, Pane plain word + indicator, rotating Working spinner with static reduced-motion equivalent), displaying current activity truthfully while preserving native attention in tooltips and accessible labels (`Activity: ... (Native attention: ...)`).
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

## 9. Terminal Image Preview Transport (`server/image-preview.ts`)

- **Endpoint**: `POST /api/media/image` accepting bounded JSON payload `{ path: string, paneId?: string }` (maximum 4096 bytes).
- **Authentication & Origin Protection**: Shares the existing `validateOwnerAuth` owner check (`requireOrigin: true`), strictly requiring valid host/origin and matching `Tailscale-User-Login` (configured `ownerLogin` from push config) with loopback development exception. Checks run strictly before body reading, filesystem access, or native snapshot lookup. Unauthenticated GET, filesystem browsing, directory listing, text reading, and open file servers are rejected.
- **Owner-Image Access & Path Resolution**:
  - Absolute paths and `~/` (homedir) require no pane context and resolve directly across the owner-accessible local filesystem without manual root enrollment.
  - Relative paths require an active `paneId` in the request body. The server looks up the pane in the authoritative native snapshot (`IPane.foreground_cwd` preferred, fallback `IPane.cwd`). Missing, stale, or unavailable working directories fail closed without fallback.
  - OS-normal `..` path traversal is resolved within local owner-accessible directories. Remote URLs, file schemes, NUL bytes, and ASCII control characters remain strictly rejected.
- **File System & Content Validation**:
  - Rejects NUL bytes, ASCII control characters, remote URLs, and `file://` schemes before data access.
  - Checks regular-file identity before opening (`lstat`), opens with no-follow/nonblocking flags (`O_NOFOLLOW | O_NONBLOCK`), and compares descriptor and canonical device/inode identities before reading. Directories, FIFOs, device nodes, symlinks at leaf, and detected replacement races are rejected.
  - Bounded reading with a 12 MiB compressed-file limit (`MAX_IMAGE_BYTES`); PNG/JPEG/WebP headers must also report dimensions at most 8192 pixels per axis and 33,554,432 pixels total. This is cooperative-local checking, not protection against an adversarial same-UID filesystem writer.
  - Dual validation of file extension (`.png`, `.jpg`, `.jpeg`, `.webp`) and magic bytes (PNG header, JPEG markers, WebP RIFF/WEBP chunks). Files with extension/magic mismatch (such as SVGs or HTML disguised as PNG) are rejected.
- **Security Response Headers**: Returns binary buffer with explicit Content-Type (`image/png`, `image/jpeg`, `image/webp`), `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. Generic error responses avoid leaking internal filesystem paths or stack traces.
- **Terminal Link Ownership**: Browser-only detection maps xterm cells across a bounded physical-row window. Formatting indentation is removed only inside a recognized unquoted `View Image` argument at its owned column alignment, including intervening native wraps. Completed paths, new rooted paths, tool records and unrelated prose remain separate. Terminal text is only a candidate; backend validation remains authoritative. This does not add previews to the native terminal or promise recognition of every agent's output format.
