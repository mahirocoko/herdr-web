# Hooks Pattern

- `useSnapshot` owns snapshot state and selection; `src/services/snapshot-reader.ts` owns initial/fallback HTTP fetching and the primary WebSocket event stream (`/api/events`), including bounded reads and browser lifecycle recovery.
- `useLifecycleOperations` is instantiated once by the root and owns one frozen lifecycle ticket across Drawer dismissal and route changes. It accepts no new mutation while pending, unknown, or reconciliation-failed; exact request identity plus reconciliation attempt fence every settlement/retry.
- Snapshot polling stops only after the backend bridge reports connected and a current authoritative read succeeds, not merely when the browser socket opens. Current read success owns UI readiness independently of bridge status; bridge health cannot heal a failed read or suppress its fallback. Application heartbeats detect stale-open event connections without relying on topology changes.
- Single-flight fallback HTTP polling remains active while visible in every unhealthy bridge state; socket reconnects use bounded backoff. Hidden/pagehide/offline retires reads once, and the first visible/pageshow/online resumes immediately without replaying mutations. Overlapping/delayed notifications preserve the new socket and read rather than restart them; Chat's conversation owner follows the same suspension/resume contract and retains loaded history/frontier.
- Reading hooks (`usePaneRead`) own their active HTTP polling interval for text content refresh on active surfaces (Panel: 1000ms, Question: 2000ms while blocked); `useConversation` owns active-pane polling and cursor pagination for Chat.
- Stream hooks (`useTerminalStream`) own the observer WebSocket connection (`/api/terminal`).
- Store callback functions in refs when long-lived sockets must call current logic without reconnecting for every render.
- Cleanup intervals, retry timers, sockets, observers, and event subscriptions on every effect exit.
- Keep reconnect loops bounded and expose connection state to the UI.
- Move pure parsing, selection, and geometry decisions into `src/utils/` with deterministic unit tests.
- Keep lifecycle membership freezing, operation-specific unknown copy, and post-refresh navigation decisions in `src/utils/lifecycle-operations.ts`; components collect intent while the root owns authoritative reconciliation and route effects.
