# Quick reference — refreshed source study

Source: `54e5a1f67090cb09552d182e7e30dd0ecc314918`, 2026-10-06. Previous snapshot: `b498e7f` (app 0.3.49). Reader: task_4 (usage/configuration); Main consolidated and checked changelog/release separation. No installs, builds, tests, browser, SSH, actual configuration reads or live verification ran.

## What this is

A browser/phone client for Herdr terminals: React 18/xterm client and Bun HTTP/SSE/WS bridge. Herdr owns PTYs/processes/scrollback/agent state. Unix attachment uses a Node sidecar; Windows uses a visible-screen mirror with different fidelity. Client preferences, agent transcript adapters and bridge credentials have separate owners.

## Version truth

- `package.json` and `herdr-plugin.toml` declare app **0.3.52**.
- Pinned HEAD contains **two commits after tag v0.3.52**. `CHANGELOG.md` explicitly places #514 (Codex citation/display filtering) and #515 (composer follows chat font size) under Unreleased. Package version alone does not prove those changes shipped.
- `shared/machines.ts` declares remote runtime version **19**. Remote bundles use their own `remote-vN` counter, not app-version suffixes. Publication/installed remote bundle availability was not checked.
- Installed update behavior follows published release tags, not every main-branch commit. Main inspected changelog lines 1–20 and the tag-to-HEAD log.

## Documented setup — not instructions executed here

`INSTALL.md` lines 39–89 describes the Herdr plugin as default installation route, source checkout for development and separate platform installers. Documented prerequisites are Herdr 0.9.0+, Bun 1.4+ and Node18+ for the Unix sidecar. Managed `start`/plugin lifecycle differs from running backend and Vite side by side (`docs/development.md` lines 3–27, 136–152).

Typical development commands documented by source:

```sh
bun run server
bun run dev
```

Backend defaults to loopback7317; Vite5173 proxies API/WS. These commands were not run. Bootstrap installers can change user-level installations, start services and configure Tailscale; study does not authorize them.

Normal documented checks: generated-type freshness, typecheck, build, `test:unit`; contract/browser commands need explicitly isolated Herdr/state/session setup. See this run's TESTING note before executing anything.

## Current feature and ownership map

### Mobile terminal input and shortcut customization

Settings owns input mode and optional key-bar selection. Esc/Tab/Ctrl/arrows/Ctrl+C remain; optional Alt defaults on, modifiers are one-shot. Shortcut customization is a separate Settings section: Mod+Shift convention, conflict rejection, Reset defaults, and fixed hold-to-dictate binding. These are locally stored client preferences, not native Herdr Quick Commands.

Sources: `docs/terminal-input.md` lines 6–57; `SettingsDialog.tsx` lines 297–316, 540–560; `src/lib/keys.ts` lines 8–21, 36–93; `src/lib/shortcuts.ts` lines 7–19, 34–64, 119–157; `shortcutBindings.ts` lines 1–13; `settings.ts` lines 34–38, 99–103, 157–160, 218–229, 270–285.

### Prompt/model cards

Client posts pane/prompt identity through the machine-scoped API. Server re-reads the asking and checks expected menu/cursor before consequential navigation keys; changed prompts return409. Release notes add Claude/Codex `/model` list cards: choosing a model is session-only, setting defaults remains a terminal operation.

Sources: `PromptCard.tsx` lines 13–27, 69–99; `server/prompt.ts` lines 2601–2655, 2717–2817. Source/contract definitions are not proof of live provider behavior.

### Remote bridge update and explicit take-over

A machine-dialog version-mismatch path offers Update bridge and connect, including an unregistered first-connect failure. Server checks bridge protocol/bundle version and refuses to replace independently managed bridges. Ordinary attachment waits for its holder; only explicit take-over intent from a connected interact client may invoke `--takeover` for a held pane.

Sources: `docs/remote-pcs.md` lines 40–63; `MachineDialog.tsx` lines 24–32, 48–52, 76–91; `server/machines.ts` lines 254–261, 338–365, 428–431, 508–547; `server/index.ts` lines 666–689, 794–812, 866–900, 1764–1771. Repository-documented Herdr0.9.3 observations are not this run's live verification.

## Configuration owners

Backend environment names include HOST/PORT, HERDR_SOCKET, HERDR_WEB_TOKEN, HERDR_WEB_STATE_DIR, HERDR_WEB_TAILSCALE_OWNER, voice/push provider settings and remote bundle selection. No actual env/credential values were read. Plugin config is separate from shell environment; app persistent state differs from plugin process PID/log state. See source INSTALL/development guides and existing study for detailed names, then recheck the owning source before changing configuration.

PWA/push need secure context; cached static shell does not create an offline command queue. Remote SSH runs from the server host's account, not the browser. Windows mirror is not a Unix PTY stream.

## Documentation drift to retain honestly

The agent-support table in `docs/guide.md` still says OmO prompt cards use Terminal, while current changelog/server implementation describe OmO chat question cards. Treat that table as potentially stale; inspect the actual adapter before making a capability claim. This learn run records the disagreement rather than editing upstream docs.

## Follow-up use

Keep mobile preference changes in Settings/key helpers, prompt safety in server prompt owner/tests, and bridge lifecycle in machine/server owners. Do not silently adopt unreleased behavior or install software as a side effect of source learning.
