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

## Running again and choosing a port

Every normal start rebuilds, including after a source update. Reuse an existing instance rather than starting a duplicate. The launcher rejects an occupied port before touching its assets. `start`, `server` and `dev` all take the same safe path; none enables Vite HMR or a managed updater.

For a different local port on Unix:

```sh
PORT=8788 bun start
```

In PowerShell, set `$env:PORT = "8788"` before `bun start`. This changes the local listener, not Tailscale configuration. Do not run a separate build over a live instance's `dist/`; development validation needs isolated output or a stopped owned instance.

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

Loopback works without configuring a network service. Private phone access requires an already configured, verified owner-only Tailscale Serve route. No public Funnel or generic reverse-proxy setup is supported here. See the [user guide](docs/guide.md) and [security policy](SECURITY.md) before exposing access.
