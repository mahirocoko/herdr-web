# Installation

This is the setup guide for **mahirocoko/herdr-web**. Use a source checkout and the fork launcher. Upstream plugin installers, one-line install scripts and managed supervisors do not install this fork's supported runtime path.

## Before you clone

Have Git, **Bun 1.4.2**, **Node.js 22**, and an installed, running Herdr host available. The launcher requires native protocol **22**; the witnessed host was Herdr **0.9.5**. That version is a compatibility observation, not proof that every native feature works on every platform.

Check your tools in the terminal you will use:

```sh
git --version
bun --version
node --version
herdr --version
herdr status server
```

Use your normal user-owned tool installation method for missing prerequisites. The app never installs or upgrades Bun, Node or Herdr globally. Real Node owns the native PTY sidecar; Bun must not impersonate Node or load `@lydell/node-pty` itself. Windows mirror-only capability can avoid PTY attachment, but a real terminal attach still needs the Node sidecar.

The bootstrap chooses exact Bun 1.4.2 from an existing platform/architecture project-local copy, PATH, then the current executable. A fresh clone contains no ignored runtime binary. Having an older global Bun alone is insufficient. If Node is available but global Bun is old, Node can launch the bootstrap; an existing Bun 1.4.2 must still be discoverable.

## Initial setup

```sh
git clone https://github.com/mahirocoko/herdr-web.git
cd herdr-web
bun scripts/bun-project.mjs install --frozen-lockfile
bun start
```

If Bun itself cannot run the bootstrap, use `node scripts/bun-project.mjs install --frozen-lockfile`, then `node scripts/bun-project.mjs run start`. On Unix, `bash scripts/bun-project.sh run start` is another thin bootstrap entry, not an installer.

Frozen installation preserves the lockfile and applies both checked-in dependency patches. Do not replace it with a dependency upgrade to make setup pass.

Open **http://127.0.0.1:8787**. The foreground launcher checks the port and native prerequisites, rebuilds the client, then serves it. A failed build does not start a server with stale assets. Keep this terminal visible; Ctrl-C stops only this web instance. Startup help does not build or start anything:

```sh
bun start --help
```

## Stopping this checkout's Web launcher

On Linux/macOS, run from this checkout's canonical root:

```sh
bun run stop
bun run stop --help
```

New foreground launchers create an owner-private Unix control socket at
`.agent-state/runtime/upstream-v10700/web-control.sock`. Stop asks only that Web
launcher to shut down; it does not stop Herdr, `hc` core, terminals or agent
sessions, and does not signal a guessed PID or port. Ctrl-C in the foreground
Web terminal remains available on every supported startup platform. Windows
stop control is not implemented; use Ctrl-C, not WSL or a named-pipe workaround.

An absent control socket is a harmless no-op, **not proof that Web is down**:
older launchers need Ctrl-C in their verified foreground terminal. An occupied,
nonprivate, stale or unresponsive socket fails closed unchanged. Startup also
refuses an occupied control path; never auto-delete it, repair its permissions
or use a broad process-kill command. Have its verified owner inspect unknown
state before deciding recovery. This is cooperative same-user privacy, not
isolation from the same user or administrators.

Graceful Ctrl-C/SIGTERM/stop removes only sockets this process created while
their directory and socket identities still match. If replaced, the nodes stay
untouched; Bun's unsafe pathname-unlinking stop is skipped, clients are closed
and the inert listener is unreferenced until process exit. Crashes/forced kills
can leave sockets requiring owner inspection. Stop acknowledgment is not a
health check or a managed restart; start again in the visible Web terminal.

## Running again and choosing a port

Choose the runtime explicitly for everyday use:

| Running host | Command |
| --- | --- |
| Herdr App / herdr-core (Linux/macOS) | `bun run start:core` |
| Original Herdr | `bun run start:herdr` |

The aliases set runtime selection inside the launcher, without shell-specific
environment assignment. They override inherited `OVIS_RUNTIME` for this process
only; there is no auto-detection, fallback, host startup or global configuration
change. `bun start` still follows `OVIS_RUNTIME`, defaulting to original Herdr when
unset or empty. Use `bun run start:core --help` or `bun run start:herdr --help` for
non-starting help. If Bun cannot run the bootstrap, use
`node scripts/bun-project.mjs run start:core` (or `start:herdr`).

Every normal start rebuilds, including after a source update. Reuse an existing instance rather than starting a duplicate. The launcher rejects an occupied port before touching its assets. `start`, `server` and `dev` all take the same safe path; none enables Vite HMR or a managed updater.

For a different local port on Unix:

```sh
PORT=8788 bun start
```

In PowerShell, set `$env:PORT = "8788"` before `bun start`. This changes the local listener, not Tailscale configuration. Do not run a separate build over a live instance's `dist/`; development validation needs isolated output or a stopped owned instance.

## Herdr App / herdr-core (opt-in, Linux/macOS)

The newer desktop **Herdr App** uses `hc` (herdr-core), not the protocol-22 `herdr` host above. With an already installed, running core, select it for this Web process only:

```sh
hc --version
hc server status
bun run start:core
```

This does not install/start a core server, change global settings, reload Pi, or modify the desktop layout. `OVIS_HC_BIN` can select an existing `hc` executable; `hc connect` retains its normal endpoint selection (`HC_SOCKET` / `HC_SESSION` when explicitly provided). Keep the Web terminal visible. Switching an existing Web instance requires its owner to stop and restart it with this selection; an occupied port is still refused before building. The existing `OVIS_RUNTIME=herdr-core bun start` form remains supported. Use `start:core` again on later launches to select core explicitly; bare `bun start` without `OVIS_RUNTIME` still selects original Herdr. Do not run two instances over the same `dist/` output.

Core mode provides the existing Web shell, native screen/terminal streaming and guarded manual Send/Stop. Desktop create/close/split/focus/reorder, worktree, plugin and agent-start operations are not translated and remain unavailable. Windows core mode is refused. This is a compatibility lane, not full desktop parity; see the [integration contract](docs/development.md#opt-in-herdr-core-compatibility).

### Core adapter socket is occupied

If startup reports `herdr-core socket path is occupied`, it has stopped rather
than deleting or reusing the existing path. This is Web's private adapter
socket at `.agent-state/runtime/upstream-v10700/herdr-core.sock` in the checkout,
not the `hc` core socket. Starting another Web instance on a different port does
not give it a separate adapter socket or build output.

First check the Web terminal and the configured port for an existing instance.
For example, on macOS or Linux with `lsof` (substitute the configured port):

```sh
hc server status
lsof -nP -iTCP:8787 -sTCP:LISTEN
lsof -nP -U
```

Inspect the exact socket path in the Unix-socket listing and identify any owner
before taking action. A missing listing alone does not prove a socket is safe to
remove: permissions, races or an incomplete listing can hide ownership. Reuse
an existing Web instance, or deliberately stop only its verified owner. If an
old path remains, have the owner inspect its type, ownership and identity and
decide how to recover it; do not automatically unlink, repair permissions or
remove unknown runtime state. If ownership is uncertain, leave it intact. The
launcher does not clean up an occupied path or fall back to another runtime.

### Pi history in core mode

A terminal's Pi status, title and cwd do **not** identify its active SessionManager. Without a compatible private observer, the terminal remains usable, but core Pi transcript/questionnaire and child-conversation reads are unavailable. Web never guesses the newest transcript or derives identity from a label.

### One-time Pi setup (both runtimes)

Use a compatible [mahiro-pi worker-activity resource](https://github.com/mahirocoko/mahiro-pi/blob/main/docs/integrations.md). Its source revision must support `herdr-web.json`; older session-command-only versions are not sufficient. With separate profile-configuration approval:

1. Register the canonical `mahiro-pi/extensions/mahiro-worker-activity.ts` once in the intended Pi profile's public `settings.json` extension list, preserving other entries. It remains separate from the default 13-entry Mahiro manifest.
2. Create an owner-private (0600), regular, non-linked `herdr-web.json` in that profile's agent directory (`~/.pi/agent`, or its explicit `PI_CODING_AGENT_DIR`):

   ```json
   { "version": 1, "root": "/absolute/canonical/path/to/herdr-web" }
   ```

3. Keep the Web runtime directories owner-private. Do not repair unknown permissions automatically. Pi and Web must use the same checkout/runtime root and compatible session store.
4. Activate the resource only through an authorized fresh launch or reload. Thereafter **every TUI session using that profile**, regardless of cwd or old Herdr versus Herdr App/core, publishes automatically. New/resume/fork/reload follow Pi lifecycle events; **no per-session start command** is needed. Separate profiles require their own explicit setup.

`/mh-herdr-web-observer status` reports local publication, not Web acceptance. `stop` suspends only that session; the next session/reload returns to profile configuration. Normal shutdown/reload revokes only its own generation's receipt; crashes expire within 8 seconds. RPC/print/SDK children never acquire the TUI producer. The original Herdr runtime retains its existing native `herdr:pi` identity/lifecycle integration; this resource is the sole private Web receipt producer for both runtimes. Core requires no old socket or Herdr CLI inside Pi.

The old `scripts/pi-subagents-extension.ts` entrypoint is now a non-writing migration notice. Remove it from launch arguments/configuration when adopting the unified resource; do not combine old installed producer copies with the new producer. Web does not install resources, edit profiles, activate observers or reload existing sessions. An already running Pi without the configured source needs separately authorized activation; restarting Web alone cannot add Pi identity.

## Platform and private-state limits

Runtime data stays inside the checkout under ignored `.agent-state/runtime/upstream-v10700`. Private directories use POSIX mode 0700 or native Windows ACL protection. The helper rejects unsafe ownership, ancestors, reparse points and unsupported filesystems; it does not repair permissions.

Native Windows CI covers bootstrap, data-drive/profile NTFS and private-ACL fixtures. It does **not** establish actual Windows Herdr-host startup. A real startup under `D:\works\herdr-web` was refused for an unsafe ancestor; its ACL was not captured, so inherited Authenticated Users Modify remains a hypothesis, not a diagnosis. A fresh clone on local NTFS inside your profile, outside OneDrive, is the recommended next attempt, not a proven workaround. Do not whitelist the path, alter ACLs blindly, relocate state to AppData, or substitute WSL for native Windows evidence.

## Troubleshooting

| Failure                       | Next step                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Bun version mismatch          | Make exact 1.4.2 available to the bootstrap; do not let the app upgrade a global runtime.         |
| Port unavailable              | Open the existing instance, deliberately stop its owner, or choose another port.                  |
| Missing Herdr or ping failure | Open the installed host and check its CLI/socket. `HERDR_SOCKET` explicitly selects a socket.     |
| Protocol mismatch             | Use a compatible host; startup does not update it for you.                                        |
| Node/PTY failure              | Check real Node on PATH and the frozen dependency install.                                        |
| Client build failure          | Fix the reported build/install error before retrying.                                             |
| Private-state refusal         | Inspect the named path and owner; retain the error, not secret contents. Do not bypass the guard. |

If a phone receives `invalid_host` while its Tailscale route is becoming ready, wait at least ten seconds and reload. Web rechecks private ingress on demand; a temporary startup discovery failure does not require a server restart. If rejection persists, verify the existing Serve hostname and proxy target match this Web port, and that the configured owner is still valid. Do not disable the ingress guard, clear browser storage or change network configuration as a generic workaround.

Loopback works without configuring a network service. Private phone access requires an already configured, verified owner-only Tailscale Serve route. No public Funnel or generic reverse-proxy setup is supported here. See the [user guide](docs/guide.md) and [security policy](SECURITY.md) before exposing access.
