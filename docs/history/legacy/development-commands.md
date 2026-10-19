# Development Commands — historical

> Superseded at source promotion on 2026-10-19. Do not execute these legacy commands; current guidance is the root README/AGENTS and `docs/upstream-parity.md`.

## Install

```bash
bun install
```

Dependencies use exact versions. Do not replace them with `latest`, caret, tilde, or wildcard ranges.

## Develop

Terminal 1:

```bash
bun run start
```

Terminal 2:

```bash
bun run dev
```

## Verify

```bash
bun run test
bun run test:coverage
bun run test:live
bun run typecheck
bun run build
```

- `bun run test`: deterministic tests; no Herdr daemon required.
- `bun run test:coverage`: runs the deterministic suite with LCOV instrumentation and enforces global floors of 55% lines and 75% functions. The output lives in an isolated temporary directory and is removed after the check. Bun 1.3.11's built-in threshold is intentionally not used because it evaluates each loaded file rather than the global suite baseline.
- `bun run test:live`: bounded checks against the current local Herdr runtime.
- `bun run build`: production browser bundle served by the Bun server.

Never run bare `bun test`: it can discover the temporary `adoption/upstream` candidate's native tests. Canonical root test/coverage/live commands exclude that directory with `--path-ignore-patterns=adoption/upstream`. Candidate tests need a separately approved isolated native harness; their bunfig preloads Herdr session setup.

## Production-Like Local Run

```bash
bun run build
bun run start
```

Open `http://127.0.0.1:8787`. Configure Tailscale Serve manually only when remote testing is intended.

## Web Push Configuration (Optional)

Initialize local VAPID keys and push configuration:

```bash
bun scripts/init-push.ts --owner-login <login> --subject <mailto:...|https://...>
```

- Generates private/public VAPID keypair in `~/.config/herdr-web/push-config.json` (`0600` permissions).
- Sets the authorized Tailnet owner login required for device subscription.
- Never prints private keys or secrets to standard output.
- Physical iOS delivery requires human on-device verification; automated proof covers contract and service worker syntax.
