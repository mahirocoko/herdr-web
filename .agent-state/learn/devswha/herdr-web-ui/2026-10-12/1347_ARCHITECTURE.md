# Incremental architecture study

Pinned source: `7f12ec6176ec7f4921ab4a7f1ab31c4ae826e116`.
Prior study: `54e5a1f67090cb09552d182e7e30dd0ecc314918`; pre-pull checkout: `59791189f76add8ddfba8d038264bb1a549d47da`.
Source inspection only: no install, build, tests, browser, SSH or server runs. Readers did not modify source. Runtime model identity/effort was not independently available to the readers; requested role model is not verified runtime identity.

## Three independent ownership layers

| Layer | Current owner | Boundary |
| --- | --- | --- |
| Native topology/process | Herdr, via `origin/server/herdr/client.ts` | PTYs, scrollback, tabs, pane geometry, agent state |
| Browser presentation | React `origin/src/App.tsx` and `origin/src/lib/split.ts` | Two visual slots and active target; not native layout mutation |
| Machine bridge | Bun `origin/server/machines.ts`, HTTP/WS router, SSH/relay modules | Per-PC connection, consent, auth, proxy and reconnect |

Unix attachment remains in Node `origin/server/pty/pty-host.mjs`, never node-pty loaded inside Bun. `origin/server/mirror.ts` supplies screen mirroring where attachment is unavailable. Mirror support is not PTY streaming parity.

## Split tabs over native layouts

- `origin/src/lib/split.ts` stores `{ machineId, paneId }` targets and dual-slot state in session storage; `dockPane` is a pure transition owner.
- `origin/src/lib/paneDrag.ts` coordinates sidebar/tab drags.
- Each visual half has a `TabStrip` and `PaneCanvas`; these select actual native tabs and draw their existing pane geometry, rather than inventing another native split.
- `origin/src/lib/paneCanvas.ts` owns zoom/narrow solo-pane behavior. Narrow viewports retain split state while showing the active half.
- App-level active selection owns header/palette/shortcut targeting. Inactive `PaneTerminal` instances blur focus; intentional pointer/recent keyboard focus selects the other half.
- Duplicate display of one native tab is rejected to avoid duplicate attachments/detach races. Targets may span PCs.
- `origin/scripts/split-view-regression.ts` is invoked from `ui-regression.ts`. Its existence is not a test PASS.

## Stable machine binding

- `origin/src/lib/machineContext.tsx` binds API calls to a fixed machine ID.
- `origin/src/lib/machineSessionContext.tsx` owns app-lifetime sessions; `machineSession.ts` owns one WebSocket per machine.
- `origin/src/components/PaneTerminal.tsx` owns pane attach/watch, not the PC connection.
- Async work must remain bound to its original machine/connection, not whichever machine the browser currently selects.

## Remote discovery is not consent

- `origin/server/herdr-profiles.ts` reads Herdr's saved machine catalog without connecting.
- `origin/server/herdr-profile-state.ts` stores Web-owned permissions/cache separately. Connection approval and bridge setup/install approval are distinct; binding changes invalidate approval.
- `origin/server/machines.ts` manages local/remote state, SSH connections, observers, snapshots and reconnects.
- `origin/server/ssh.ts` establishes the SSH local forward. Remote runtime starts through `remote-entry.ts`; `bridge.ts` registers/verifies identity; `remote-websocket.ts` owns bridge bearer auth.

## Proxy and access boundaries

- `origin/server/index.ts` owns HTTP/WS routing/access. `machine-api.ts` forwards only allowlisted routes with server-held bridge credentials; `machine-relay.ts` forwards machine-bound WS traffic and output ACKs.
- Browser credentials and remote Set-Cookie do not cross the proxy boundary. Mutations retain same-origin and machine-header checks; read-only devices remain observe-only through relays.
- `origin/server/machine-security.ts`, `access.ts`, and `auth.ts` own target/origin/access/token validation.
- Main checked `lanExposed` in `access.ts`: a non-loopback bind with neither token nor pairing gate triggers warning. This is observational metadata, not a change to who is admitted. Upstream's intentionally open mode must not be adopted into local Herdr Web's stricter ingress/auth rules by accident.
- `origin/shared/protocol.ts` owns HTTP/WS shapes; `origin/shared/machines.ts` owns machine/path policy and remote runtime version. Route/frame changes require corresponding demo transport changes in `origin/site/demo/transport.ts`.

## Queue and settings boundaries

Main checked `origin/shared/protocol.ts`: queue/hold requires the bridge capability and live interact attachment. Lease loss does not resume queued delivery. Pending actions claim IDs; explicit Send now differs from ordinary Send and automatic next-turn delivery.

Shared settings/pins separate server-shared preferences from device-local input/geometry choices. This is a new owner to inspect directly before any adaptation, not permission to move all browser settings server-side.

## Reconciliation and proof limits

- All three readers agree on Herdr/Bun/Node/React boundaries, metadata `0.4.8`, and source ahead of the release tag.
- Main independently checked clean source status, exact SHA, diff statistics, package/changelog, tag distance, queue schema, Codex steering, split transitions and returned focus/capability snippets.
- Documented checks include `bun run check fast`, `bun run check full`, `bun run test:unit`, and `bun run test:ssh`; none ran. Bare `bun test` also discovers Herdr-dependent contracts.
- No browser, physical-device, provider availability, live SSH, installed bundle or visual acceptance claim follows from this study.
- Keep accepted local UI, auth, terminal-control and lifecycle contracts when considering reference reuse. This run authorizes learning only.
