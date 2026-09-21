# Development Commands

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
bun test
bun run test:live
bun run typecheck
bun run build
```

- `bun test`: deterministic tests; no Herdr daemon required.
- `bun run test:live`: bounded checks against the current local Herdr runtime.
- `bun run build`: production browser bundle served by the Bun server.

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
