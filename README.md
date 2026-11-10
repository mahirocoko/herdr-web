# Herdr Web

A local browser client for your installed [Herdr](https://github.com/herdrdev/herdr) terminal manager. Browse workspaces, read agent Chat, use live terminals, and inspect files and Git diffs from a desktop or phone.

This fork adopts the coherent frontend and backend from `devswha/herdr-web-ui`, with fork branding, private Letta Code history, and a guarded local launcher. It is a source checkout, not the upstream plugin or managed-update distribution. Some upstream controls remain visible but unavailable here; their presence is not a promise of enabled account, remote-install or paid services.

## Get started

Follow [Installation](INSTALL.md) once to prepare the exact Bun runtime, frozen dependencies, Node and your existing Herdr host. From a configured checkout:

Choose the command for your running host:

| Host | Command |
| --- | --- |
| Herdr App / herdr-core (Linux/macOS) | `bun run start:core` |
| Original Herdr | `bun run start:herdr` |

Both commands use the same foreground launcher and explicitly select the runtime
for this process, overriding `OVIS_RUNTIME`. There is no auto-detection or fallback.
`bun start` remains compatible: it uses `OVIS_RUNTIME` when set, otherwise the
original Herdr host.

Open **http://127.0.0.1:8787**. Startup builds the client and serves it in the foreground; Ctrl-C stops this web instance, not Herdr. There is no separate test or build prerequisite for everyday use. Keep the server in a visible project terminal.

If an instance already owns the port, open that instance instead. Startup refuses an occupied port before rebuilding and never stops its owner. `bun run server` and `bun run dev` use this same safe launcher, not a second development server or hot-reload proxy. Port selection and troubleshooting belong in the installation guide.

Using the newer **Herdr App / herdr-core** instead of the original Herdr host? On Linux/macOS, `bun run start:core` selects the already-running `hc` runtime for this process only, without global settings or a Pi reload. The existing `OVIS_RUNTIME=herdr-core bun start` form is still supported. Read the [core setup and Pi identity limits](INSTALL.md#herdr-app--herdr-core-opt-in-linuxmacos) before switching an existing Web service; see [socket troubleshooting](INSTALL.md#core-adapter-socket-is-occupied) if startup reports an occupied adapter socket.

## What to expect

Native Herdr owns processes and sessions. The private Letta reader uses source Chat; reading history does not authorize terminal input.

The default listener is loopback. An already configured, verified owner-only Tailscale Serve route can provide private access; this is not a public hosting guide. Existing credentials, Push identity and local drafts are preserved, not automatically replayed or migrated into queues.

Windows bootstrap and NTFS privacy fixtures have passed native CI, but actual Windows Herdr-host startup remains unverified. Physical Android installation and Push receipt are also pending. Scoped source, fixture or rendered checks must not be read as all-provider or all-device certification. See [coverage and limits](docs/upstream-parity.md) for the distinction.

## Pi subagent support

This fork supports **Pi subagents in Chat** with compatible `@gotgenes/pi-subagents` sessions: inline task cards at the original dispatch position, running/queued/completed/unknown states, and clickable read-only child conversations. Details render Markdown, highlighted code and expandable tool arguments, results and errors. Main's Send/Stop authority stays separate from child activity.

For automatic observation on **both the original Herdr runtime and Herdr App/core**, use the compatible [mahiro-pi](https://github.com/mahirocoko/mahiro-pi) worker-activity resource with the [one-time profile target setup](INSTALL.md#one-time-pi-setup-both-runtimes). All TUI sessions using that profile follow their own lifecycle automatically, including reload; there is no per-session observer start. `/mh-herdr-web-observer status` reports local health. Web does not edit profiles or activate/reload Pi, and older session-command-only producers must be retired. Producer and Web share the explicit checkout/runtime root, independent of the Pi session's cwd.

Without a fresh verified observer receipt, recorded history can still be read, but an unfinished child is **Status unknown**, not assumed running or completed. Updates follow Pi's recorded activity, not guaranteed token streaming. The live observer is POSIX-only; Windows live activity is not supported. See the [Pi user guide](docs/guide.md#pi-subagents) and [integration contract](docs/development.md#pi-subagent-observer) for compatibility, setup and limits.

## Find your way

- [User guide](docs/guide.md): workspaces, Chat, terminal, settings and current limitations.
- [Contributing](CONTRIBUTING.md) and [development](docs/development.md): changes, source owners and safe checks.
- [Security](SECURITY.md): access boundaries and how to request confidential reporting.
- [Manual updates](docs/app-updates.md): replace source without discarding local state.

These linked guides describe this fork. Pinned upstream readmes and technical reference documents are provenance, not alternate setup instructions. Historical guides remain under `docs/history/legacy/`; release history remains in [CHANGELOG.md](CHANGELOG.md).

## Source and licenses

The source pin and explicit fork changes are recorded in [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json). This fork preserves its [Apache-2.0 license](LICENSE), the adopted source's [MIT license](UPSTREAM_LICENSE), and [third-party notices](THIRD_PARTY_NOTICES.md). Both dependency patches remain part of the source distribution.
