# Hooks Pattern

- `useSnapshot` owns the snapshot state and combines initial/fallback HTTP fetching with primary WebSocket event stream listening (`/api/events`).
- Snapshot polling stops while the event WebSocket stream is healthy.
- Fallback HTTP polling activates only when disconnected or reconnecting, using bounded backoff.
- Reading hooks (`usePaneRead`) own their active HTTP polling interval for text content refresh on active surfaces (Panel: 1000ms, History: 2000ms, Question: 2000ms while blocked).
- Stream hooks (`useTerminalStream`) own the observer WebSocket connection (`/api/terminal`).
- Store callback functions in refs when long-lived sockets must call current logic without reconnecting for every render.
- Cleanup intervals, retry timers, sockets, observers, and event subscriptions on every effect exit.
- Keep reconnect loops bounded and expose connection state to the UI.
- Move pure parsing, selection, and geometry decisions into `src/utils/` with deterministic unit tests.
