# Incremental quick reference

Source: `7f12ec6176ec7f4921ab4a7f1ab31c4ae826e116`, compared with `54e5a1f67090cb09552d182e7e30dd0ecc314918`. Three-reader study; no install, build, test, browser, SSH or live integration was performed.

## Version boundaries

- Package/plugin metadata: `0.4.8`. Local app tag `v0.4.8` is nine commits behind HEAD.
- Current source includes the changelog's **Unreleased** additions. Installed app updaters follow release tags, not arbitrary main commits.
- Remote runtime metadata: `v27`, versioned separately through `remote-vN`. Neither published assets nor installed versions were checked.
- Main independently checked package, changelog, tag commit and commit distance.

## Important changes since October 6

1. **Split view (Unreleased):** desktop tabs from different workspaces/PCs appear side by side over existing native layouts. Reload preserves the split; narrow windows show the active half.
2. **Saved-PC discovery and shared settings (Unreleased):** discovering a saved Herdr PC does not authorize SSH, install or startup. Eligible preferences/pins sync between browsers; device-local typography/input choices stay separate.
3. **File viewer:** standalone Markdown reader, source/highlighting/line numbers, tool-output path links and sandboxed HTML previews. File-viewer HTML does not imply arbitrary Chat HTML execution. Some enhancements are Unreleased; inspect the changelog entry for the exact feature.
4. **Safety and explicit delivery (Unreleased):** exposure warning for a network-reachable ungated server, and Codex explicit Send now interrupt behavior. A warning is not an authentication-policy change.
5. **0.4.8 changelog:** optional hold-until-Send-now behavior, standalone Markdown reading, README-style HTML rendering in file previews, and compressed JS/CSS delivery.

The broader source delta also includes remote PCs, pane/tab operations, terminal search, updater work and broader transcript/prompt adapters. Source presence is not live provider/device proof.

## Documented commands — not executed

```bash
bun install
bun run server
bun run dev
```

The last two are development processes. `bun run start` builds and uses the managed supervisor entrypoint.

Verification owners: `origin/package.json`, `origin/docs/development.md`, and `origin/scripts/AGENTS.md`.

```bash
bun run check fast
bun run check integration browser
bun run check full
bun run check concurrent
bun run typecheck
bun run build
bun run test:unit
bun run test:ui
bun run test:ssh
```

Do not overlap checks in one checkout: build output and generated-type tests are shared writable owners. Bare `bun test` also discovers contract tests; use the documented unit runner for a bounded unit pass. No formatter/linter is documented in the source repository.

## Guardrails to preserve

- Herdr owns PTYs, scrollback and native agent state. Bun owns the bridge; Node sidecar owns Unix PTY attachment; React owns browser state. Windows/no-sidecar mirror mode is not a PTY.
- Default bind is loopback. An ungated network-reachable server allows terminal input; pairing/token/Tailscale ingress is an explicit owner decision. Plain HTTP does not protect token transit.
- No automatic takeover or reconnect input replay. Observe connections must not gain input/resize authority.
- Remote connection consent and bridge installation/startup consent are separate; discovery grants neither.
- Tests must use isolated state, not real HOME/config, installed updaters or user sessions. Live opt-ins require separate scope review.
- Demo transport and fictional fixtures must track new HTTP/WS contracts; demo behavior is not live backend proof.
- App release tags and remote bundles have separate owners. Do not infer deployment or installed state from metadata.

## Reading map

- Overview/setup: `origin/README.md`, `origin/INSTALL.md`, `origin/docs/guide.md`.
- Architecture rules: root and directory `AGENTS.md` guides under `origin/`.
- Remote PCs: `origin/docs/remote-pcs.md`.
- Updating: `origin/docs/app-updates.md`, `origin/herdr-plugin.toml`, `origin/release-summaries.json`.
- Current versus released additions: `origin/CHANGELOG.md`.
- Contribution/verification: `origin/CONTRIBUTING.md`, `origin/.github/REVIEW.md`, `origin/docs/development.md`.

This is source learning only. Any local adaptation must identify its own owner and preserve accepted local UI, security and lifecycle contracts.
