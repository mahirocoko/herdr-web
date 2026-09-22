# File Organization

```text
server/
  index.ts              HTTP, WebSocket (/api/events, /api/terminal, /api/terminal/control), action/lifecycle, push routes, and static-file owner
  operation-coordinator.ts process-local idempotency, topology readers/writer, pane, and Terminal Control ownership
  terminal-control.ts   shell preflight, child control bridge, and process-local lease manager
  herdr-adapter.ts      socket-first transport adapter with explicit CLI fallback
  herdr-socket.ts       typed NDJSON Unix socket client with protocol-22 validation
  snapshot-bridge.ts    event-driven snapshot invalidation bridge (events.subscribe)
  herdr-cli.ts          CLI fallback implementation and terminal observer owner
  security.ts           origin, pane, lifecycle membership, action, and viewport validation
  types.ts              server contracts
  push/                 Web Push subsystem (types, config, store, tab-policy-store, transition detector, sender, service, security)
  generated/
    protocol.ts         generated protocol metadata (HERDR_TRACKED_PROTOCOL=22)
    herdr-schema.json   tracked JSON schema from installed Herdr binary
app/
  root.tsx              root document layout, head metadata, SW listener, outlet context, and lifecycle reconciliation
  routes.ts             React Router flatRoutes() declaration
  routes/
    _index.tsx          root resolver (/ -> /spaces/:workspaceId or empty state)
    spaces.$workspaceId.tsx Space command center dashboard route
    settings.tsx        Web Push settings, diagnostics, and subscription management route
src/
  app.tsx               SpaceDashboard component (rendered by Space route)
  components/           product surfaces (Panel, Question, History, Stream/Control, SettingsView, SpaceDrawer, PaneDrawer)
  hooks/                useSnapshot, Root-owned useLifecycleOperations, usePushSubscription, useTabNotificationPolicy, useTerminalStream, useTerminalControl, read
  services/             browser-to-server API client (api-client, push-client with tab-policy)
  types/                browser contracts
  utils/                event-stream parser, push helpers, lifecycle reducers/membership, pure selection, and geometry helpers
build/
  client/               production client SPA build output served by Bun server
scripts/
  sync-herdr-schema.ts  script for syncing and checking installed Herdr schema
  init-push.ts          CLI script for generating VAPID keys and initializing push configuration
public/                 install metadata, static assets, and development service worker (sw.js)
docs/                   repository guidance and transport architecture
```

Keep a feature owner-local until reuse or lifecycle pressure is clear. Do not introduce broad `lib/`, global stores, or component-system layers for one caller.
