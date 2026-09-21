# Onboarding

## Prerequisites

- Bun 1.3.11 or a repo-compatible version
- Herdr 0.9.1 running locally (protocol 22)
- Tailscale only when testing private remote access

## First Run

```bash
bun install
bun run schema:check
bun test
bun run typecheck
bun run build
```

For development, run `bun run start` and `bun run dev` in separate terminals. The React Router dev server (`react-router dev`) proxies `/api` and WebSocket traffic to the Bun server.

## Runtime Model

The browser never connects to the Herdr Unix socket or raw API directly. The loopback Bun server validates browser requests, communicates socket-first with Herdr over tracked protocol 22 (`~/.config/herdr/herdr.sock`), maintains an event-driven snapshot bridge over WebSocket `/api/events`, and bridges terminal observer frames (`/api/terminal`) to a same-origin WebSocket.

An explicit `HERDR_TRANSPORT=cli` fallback mode is available for debugging and compatibility.

Remote Tailnet Terminal Control (`/api/terminal/control`) requires configured owner identity from Push config (`ownerLogin`); without it remote requests fail closed, while narrow loopback development exception remains. It does not require Push enrollment/subscription, only owner config.

Tailscale Serve is manual infrastructure. Do not change machine-level Serve configuration as part of ordinary development.
