<div align="center">
  <img src="public/favicon.svg" alt="Herdr Web logo" width="64" height="64" />
  <h1>Herdr Web</h1>
  <p>Read and steer your local coding-agent sessions from a browser or phone.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache 2.0 license" /></a>
  </p>
  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#features">Features</a> ·
    <a href="#remote-access">Remote access</a> ·
    <a href="#security">Security</a> ·
    <a href="#development">Development</a> ·
    <a href="#documentation">Documentation</a>
  </p>
</div>

---

Herdr Web is an independent companion for [Herdr](https://github.com/ogulcancelik/herdr), not an official Herdr project. It connects to your local Herdr daemon and makes its Spaces, Tabs, agent conversations and terminals available through a mobile-first web interface.

Use it on the host through loopback, or privately from another device through Tailscale Serve. It is not a generic SSH client or an arbitrary remote shell.

## Quick start

You need **Bun** (1.3.11 or compatible) and a running **Herdr** daemon on macOS. The tracked host schema is Herdr 0.9.3, protocol 22; check compatibility before starting. Other host platforms are not verified.

```bash
git clone https://github.com/mahirocoko/herdr-web.git
cd herdr-web
bun install
bun run schema:check
bun run build
bun run start
```

Open **http://127.0.0.1:8787**. The server binds only to loopback.

`schema:check` compares the installed Herdr API schema with the tracked contract. Protocol mismatches fail closed at startup; use the schema check to catch other contract changes too.

## Features

### Read conversations and terminals

- **Chat** is the default for agent panes. It reads native conversation records with messages, tool details, attachments and interactive questions. Readers support Letta, Agy, Codex, Claude, OMP, OmO, GJC and PI on the macOS host. If records are unavailable, Chat explains why and offers Terminal instead.
- **Terminal** is the default for shell panes and remains available for agents. It streams real ANSI output, fits the native terminal grid to the browser and supports source scrolling. Your reading position stays put while you review older output.
- **Question** is an additional reading surface for blocked-agent questions. Status changes do not replace the surface you selected. Panel remains an internal source fallback, not a primary header mode.

### Navigate without mixing hierarchies

- The **Space sidebar** and mobile drawer list Spaces, their activity, counts and lifecycle actions. They no longer contain a nested Tabs & Panes list.
- The horizontal **Tab rail** switches between Tabs in the current Space. The separate **Tabs & Panes drawer** handles pane selection, New Shell Tab, Close Tab, notification policy and agent diagnostics through **Why?**.
- **Search** finds Spaces, Tabs and Panes from the live snapshot. It is a compact palette on desktop and a bottom sheet on mobile.
- **Needs input** shortcuts take you to agents waiting for attention. Activity indicators distinguish Working, Done and blocked states while retaining native attention information in accessible labels and tooltips.

### Send input deliberately

- The composer preserves drafts and supports IME input. Chat keeps keyboard actions behind **More controls**; Terminal retains its key rail.
- **Stop** requests Ctrl+C for the current agent. Acknowledgement is not completion: the UI waits for a fresh native state or reports an unconfirmed outcome without automatic retry.
- **Commands & Keys** offers read-only repository shortcuts and browser-local custom actions. Draft-fill actions require an explicit Send. Personal actions can be created, edited, pinned and deleted; they do not sync between devices or write repository configuration.
- Space and Tab creation/closure use target-bound requests and explicit confirmations. Close Tab cannot remove the last Tab in a Space. Unknown outcomes require inspection rather than automatic retry.
- **Terminal Control** is opt-in and restricted to verified idle shell panes under an exclusive lease. Agent panes cannot enter it.

### Dark workspace

The compact, dark-only shell and Chat use layered neutral surfaces with vivid colors for actions, activity and recorded Skill labels. Base UI owns component behavior; project-owned tokens and CSS recipes own presentation.

The current visual candidate studies BoardUI Dashboard and AI Chat without copying their assets. Earlier `devswha/herdr-web-ui` anatomy remains credited. Final visual acceptance is pending; see the [styling guide](docs/styling.md) for ownership and provenance.

## Remote access

Tailscale is optional. Configure private HTTPS on the host with Tailscale Serve:

```bash
tailscale serve --bg 8787
tailscale serve status
curl -fsS https://<device-name>.<tailnet-name>.ts.net/api/health
```

Remote input, lifecycle actions, Terminal Control and push management also require an authorized Tailscale login. Initialize owner identity and VAPID keys, then restart the server:

```bash
bun scripts/init-push.ts --owner-login <your-tailscale-login> --subject mailto:<your-email>
```

Configuration lives outside the repository in `~/.config/herdr-web/push-config.json`. Push enrollment is optional; owner authorization is still required for remote mutations and Terminal Control.

### Web Push

Optional **Needs input** and **Done** alerts identify the Space without including terminal output, prompts, code, paths or pane IDs.

Needs input follows enabled Tabs. Done alerts once per observed work round, after every agent in the Space—including muted Tabs—is done or idle. At least one Tab must have notifications enabled. Empty shells, initial idle states and policy changes do not manufacture completion alerts.

Push requires socket transport. On iOS, use Safari installed as a standalone PWA. Physical-device delivery and switching back to an existing PWA still require on-device verification.

To remove the private HTTPS proxy:

```bash
tailscale serve --https=443 off
```

## Security

- The Bun server binds to **127.0.0.1**, never raw LAN or `0.0.0.0`. Browsers do not receive Unix socket paths or raw Herdr RPC methods.
- Requests use allowed Host checks and route-specific authorization. Mutations and WebSocket upgrades enforce same-origin boundaries; permissive CORS is not supported.
- Remote mutations, Terminal Control and push management require `Tailscale-User-Login` to match the configured owner. Read-only event and observer streams do not apply that owner check. Keep access private through Tailscale Serve.
- Pane actions bind to exact terminal/session identity; close confirmations bind to exact membership. Operation IDs prevent duplicate dispatch, and topology changes cannot overlap conflicting control or input operations.
- There is no arbitrary shell endpoint or `--takeover` path. Terminal Control remains limited to one verified idle shell pane.

For request validation, transport fallback and lease details, read the [transport architecture](docs/transport-architecture.md).

## Development

Run the backend and React Router dev server in separate terminals:

```bash
bun run start
bun run dev
```

The dev server at **http://localhost:5173** proxies API and WebSocket requests to the backend on port 8787.

```bash
bun test                 # Deterministic tests; no daemon required
bun run typecheck
bun run build
bun run test:coverage    # Global coverage floors
bun run test:live        # Requires the local Herdr daemon
```

Use `bun run schema:check` to verify compatibility. Use `bun run schema:sync` only when intentionally updating the tracked host contract. [Development commands](docs/development-commands.md) documents configuration, transport options and the complete verification workflow.

## Limits

- One user and one active local Herdr daemon; macOS is the established host target.
- Space/Tab lifecycle and Web Push require socket transport, not CLI fallback.
- Native source scrolling is not agent-app scrolling. Alternate-screen applications expose their current screen, not source scrollback.
- Physical-device behavior and final visual acceptance are not implied by automated tests.
- Install from this repository. `package.json` is marked private to prevent accidental npm publication.

## Documentation

- [Project overview](docs/project-overview.md) — Features and behavior boundaries.
- [Onboarding](docs/onboarding.md) — Architecture and setup.
- [Transport architecture](docs/transport-architecture.md) — Socket bridge, authorization and action safety.
- [Development commands](docs/development-commands.md) — Configuration and verification.
- [Styling](docs/styling.md) — Presentation owners, tokens and reference provenance.
- [File organization](docs/file-organization.md) — Source layout.
- [Best practices](docs/best-practices.md) — Code conventions.
- [Commit guide](docs/commit-guide.md) — Verification and staging.
- [Agent guidance](AGENTS.md) — Repository rules for coding assistants.

## License

[Apache License 2.0](LICENSE).
