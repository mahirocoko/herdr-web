<div align="center">
  <img src="public/favicon.svg" alt="Herdr Web Logo" width="64" height="64" />
  <h1>Herdr Web</h1>
  <p>Mobile-first web companion and reading canvas for local Herdr terminal sessions and AI coding agents.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  </p>
  <p>
    <a href="#quick-start">Quick Start</a> ·
    <a href="#what-it-does">What It Does</a> ·
    <a href="#security-model">Security Model</a> ·
    <a href="#remote-access--web-push">Remote &amp; Push</a> ·
    <a href="#development">Development</a> ·
    <a href="#documentation">Documentation</a> ·
    <a href="#status--known-limitations">Limitations</a> ·
    <a href="#license">License</a>
  </p>
</div>

---

**Herdr Web** is an independent, mobile-first web companion for [Herdr](https://github.com/ogulcancelik/herdr) ([herdr.dev](https://herdr.dev))—it is **not** an official Herdr project and **not** a generic SSH client. It connects to an active local Herdr daemon over its Unix domain socket to monitor, read, and steer coding agent sessions from a phone or tablet over a private Tailscale network, or from a browser on the host machine via loopback.

- **What it is**: A touch-first companion for reading agent progress, reviewing questions, steering input, and push alerts.
- **What it is NOT**: An upstream project, a generic SSH/terminal emulator, or an arbitrary remote shell.

## Prerequisites

- **[Bun](https://bun.sh)**: `1.3.11` or repo-compatible. Required for package management, runtime, and tests; Node.js and Deno are not runtime targets.
- **[Herdr](https://github.com/ogulcancelik/herdr)**: `0.9.1` running locally with tracked protocol 22 (`schema_version: 1`).
- **Tailscale** *(optional)*: For private remote access via host-managed Tailscale Serve.
- **Platform Scope**: Current host and runtime target is macOS with an active local Herdr Unix domain socket. Other host platforms are not established.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/mahirocoko/herdr-web.git
cd herdr-web

# Install dependencies
bun install

# Verify protocol and schema compatibility
bun run schema:check

# Build the client SPA bundle
bun run build

# Start server on 127.0.0.1:8787
bun run start
```

Open **`http://127.0.0.1:8787`**.

> [!NOTE]
> `bun run schema:check` runs installed `herdr api schema --json` and validates contracts, failing closed on protocol or schema drift before startup.

## What It Does

Herdr Web organizes an active Herdr session into canonical tabs across four dedicated reading surfaces:

| Surface | Best For | Behavior & Source |
| :--- | :--- | :--- |
| **Panel** | Full screen source reading | Source snapshot preserving whitespace, wrapping, semantic highlighting, auto-follow, and scroll position (`/api/pane/read?source=visible`, 1000ms polling). Default for running/idle panes. |
| **History** | Plain-text scrollback | Bounded scrollback up to 1000 unwrapped rows (`/api/pane/read?source=recent-unwrapped&lines=1000`, 2000ms polling), text selection, and jump control. |
| **Question** | Long agent questions & choices | Detection snapshot preventing truncation on multi-line questions and choices (`/api/pane/read?source=detection`, 2000ms polling). Default for blocked panes. |
| **Stream** | Low-latency live progress | Real-time ANSI observer streaming from `herdr terminal session observe` into `@xterm/xterm`. Viewport observer only; not full panel or scrollback. |

For polling and bridge lifecycle internals, see [Transport Architecture](docs/transport-architecture.md).

### Key Capabilities

- **Attention Queue & Horizon**: Banner appears when an agent is `blocked`. Direct "Jump" navigates to a single blocked pane, while an accessible queue sheet lists multiple blocked panes deterministically (current space first, then workspace number, tab number, pane ID).
- **Mobile Prompt Dock & Terminal Rail**: Touch composer with a six-key terminal rail (`ESC`, `TAB`, `CTRL+C`, `ENTER`, `↑`, `↓`) and IME safety. Viewport integration shrinks canvas as virtual keyboards emerge without resetting drafts.
- **Quick Commands**: Opens an interaction sheet fetching `.herdr/commands.json` shortcuts from the target repo. Fills drafts inertly (Replace, Append, Cancel)—never auto-executes.
- **Canonical Tabs & New Shell Tab**: Panes group under upstream tabs. Drawer footer includes "New Shell Tab" deriving approved directory inheritance via socket RPC (`tab-create`).
- **Agent Diagnostics ("Why?")**: Agent panes expose a "Why?" trigger in the drawer, expanding an accordion with matched rule, source region, and status flags from `agent.explain`. Raw evaluated rules, buffer previews, paths, and free text are stripped at projection.
- **Privacy-Bounded Web Push**: Optional background alerts deliver `Needs input` and `Done` notifications per Space via VAPID encryption (`web-push`). Alerts omit pane IDs, terminal output, prompts, questions, paths, or code.
- **Opt-In Shell-Only Terminal Control**: Verified idle shell panes can enter Terminal Control Mode (`/api/terminal/control`) via authenticated WebSocket under an exclusive lease. Unavailable for agent panes; never uses `--takeover`; never exposes arbitrary shells.

## Security Model

- **Loopback-Only Binding**: Binds strictly to `127.0.0.1:8787`. Never binds to `0.0.0.0` or raw LAN.
- **Manual Tailscale Serve**: Host-managed Tailscale Serve proxies private HTTPS (`*.ts.net`) to loopback.
- **Host & Origin Boundaries**: WebSocket upgrades (`/api/events`, `/api/terminal`, `/api/terminal/control`) and state-changing routes require approved same-origin Host and Origin headers. Read-only HTTP routes require an allowed Host with route-specific auth (e.g., Terminal Control status checks owner identity without requiring Origin). Permissive CORS is prohibited.
- **Tailnet Owner Authorization**: Remote Tailnet requests to mutations (`/api/action`), Terminal Control (including status), and push management require `Tailscale-User-Login` matching `ownerLogin` (failing closed with 500/403, with narrow loopback dev exception). Read-only events and observer streams do not run owner auth.
- **Hidden Socket IPC**: Browsers never see Unix socket paths or raw Herdr RPC methods.
- **Target-Bound Mutations & Idempotency**: Actions require client `operationId` and target `{paneId, terminalId, expectedMode, agentSessionId?}` preflighted against snapshots. Results replay within TTL; conflicting reuse is rejected.
- **No Generic Shell & No `--takeover`**: There is no generic public shell endpoint or arbitrary PTY takeover. Ordinary inputs map to typed Herdr methods (`pane.send_input` with text and Enter bracketed) or bounded CLI argv in fallback mode, while Terminal Control binds exclusively to one verified idle shell pane under lease without `--takeover`.
- **Control Mode Isolation**: Terminal Control is restricted strictly to verified idle shell panes (`PGID === shell_pid`). Agent panes cannot enter control mode.

## Remote Access & Web Push

### Tailscale Remote Access

To access Herdr Web from mobile devices over a private Tailnet:

```bash
# Proxy HTTPS :443 to port 8787
tailscale serve --bg 8787

# Confirm status
tailscale serve status

# Verify connectivity
curl -fsS https://<device-name>.<tailnet-name>.ts.net/api/health

# Disable HTTPS proxy
tailscale serve --https=443 off
```

### Owner Authorization & Web Push

Tailscale Serve provides private routing, but remote mutations and Terminal Control require `ownerLogin` matching `Tailscale-User-Login`. Running the setup script writes owner authorization and VAPID keys:

```bash
# Configure owner identity and VAPID keys
bun scripts/init-push.ts --owner-login <your-tailscale-login> --subject mailto:<your-email>

# Restart server to load configuration
bun run start
```

- **Owner Authorization**: Configuring `ownerLogin` is required for remote mutation and Terminal Control; Push enrollment itself remains optional.
- **Web Push Alerts**: Optional alerts for `Needs input` and `Done` require default `socket` mode and iOS Safari standalone PWA installation.
- **Storage**: Stored outside the repo in `~/.config/herdr-web/push-config.json`. Server restart is required to load changes.
- **Verification**: On-device physical delivery remains a human verification gate.

## Development

Deterministic unit tests run independently of a live daemon, alongside live integration tests:

```bash
# Start backend server
bun run start

# Start Vite dev server in another terminal
bun run dev

# Run unit tests (no daemon required)
bun test

# Run the full suite with global coverage floors
bun run test:coverage

# Run live integration tests (requires Herdr daemon)
bun run test:live

# Run TypeScript typecheck
bun run typecheck

# Sync schema from installed Herdr
bun run schema:sync

# Check schema against installed Herdr
bun run schema:check
```

The Vite dev server (`http://localhost:5173`) proxies API requests and WebSockets to `127.0.0.1:8787`.

## Documentation

Technical documentation is in [`docs/`](docs/):

- [Project Overview](docs/project-overview.md) — Requirements, surface behaviors, and UX boundaries.
- [Transport Architecture](docs/transport-architecture.md) — Socket IPC, bridge lifecycle, and action preflight.
- [Best Practices](docs/best-practices.md) — Architectural principles and codebase conventions.
- [Development Commands](docs/development-commands.md) — CLI flags, testing commands, and environment variables.
- [File Organization](docs/file-organization.md) — Repository structure and directory layout.
- [Styling Guide](docs/styling.md) — Viewport geometry, typography, touch targets, and mobile rules.
- [Commit Guide](docs/commit-guide.md) — Verification checklist and staging rules.
- [Onboarding](docs/onboarding.md) — Architecture tour and developer setup.
- [Agent Guidance](AGENTS.md) — Operational rules for coding assistants.

## Status & Known Limitations

- **Strict Protocol Lock**: Tracks Herdr 0.9.1 protocol 22 (`schema_version: 1`). Mismatches fail closed during preflight.
- **Single Local Session Scope**: Single-user companion observing one active local Herdr daemon.
- **Socket-Only Features**: New Shell Tab and Web Push require Unix socket transport; unavailable in CLI fallback.
- **Stream Mode Scope**: ANSI observer viewport streaming into `@xterm/xterm`, omitting full 158×52 panel text and scrollback; use Panel and History for full reading.
- **Physical iOS Verification**: Web Push delivery and PWA switching on physical iOS devices require on-device human verification.
- **Self-Hosted Repository**: Installed via `git clone`. Marked `"private": true` in `package.json` to prevent accidental npm publication.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file for details.
