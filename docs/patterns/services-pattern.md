# Services Pattern

## Browser Services

`src/services/` contains typed HTTP and WebSocket calls only. It must not know Herdr Unix socket or raw API protocol details.

## Server Services

`server/herdr-adapter.ts` provides the unified interface between HTTP/WebSocket routes and Herdr:
- Defaults to socket mode (`server/herdr-socket.ts`) using Herdr 0.9.1's public NDJSON Unix socket API (protocol 22).
- Delegates to `server/herdr-cli.ts` when `HERDR_TRANSPORT=cli` is explicitly configured.
- `server/snapshot-bridge.ts` manages long-lived `events.subscribe` connections for event-driven snapshot invalidation and broadcasts over WebSocket `/api/events`.
- In socket mode, `spawnObserverProcess` is the sole intentional CLI transport because the raw socket API does not expose terminal session observation.
- Typed lifecycle adapters map `workspace-create`, `workspace-close`, and `tab-close` to exact socket RPCs. Close adapters compare the client-confirmed raw membership with a fresh snapshot immediately before RPC and verify exact postconditions afterward.

Rules:

- No shell interpolation.
- Bounded argv array execution only for remaining CLI commands (`herdr terminal session observe` and CLI fallback mode).
- No hidden fallback between transports: transport is selected explicitly via `HERDR_TRANSPORT`.
- Return typed, actionable errors (`HerdrSocketError` with `.code` and `.message`) mapping `pane_not_found` to 404.
- Recheck live pane identity before mutations and reads.
- Recheck lifecycle target identity and full confirmed membership immediately before destructive topology RPCs; never automatically retry an unknown close outcome.
