# Herdr Web

Private, source-native browser UI for the installed Herdr terminal manager. The complete frontend/backend is adopted from `devswha/herdr-web-ui` at `d918448647e41079c52047ffc96cdaac50ccba32`, rather than adapted through the former local API.

## Run this fork

The approved project-local Bun **1.4.2** is selected by the wrapper; global Bun is not upgraded. Node must be real Node with the lock-pinned `@lydell/node-pty`. Herdr must already be installed/running (verified local host: 0.9.5, protocol 22).

```sh
bash scripts/bun-project.sh run typecheck
bash scripts/bun-project.sh run build
bash scripts/bun-project.sh run test
bash scripts/bun-project.sh run test:native
bash scripts/bun-project.sh run source:verify
bash scripts/bun-project.sh run start
```

Normal app: `http://127.0.0.1:8787`. Start in a named visible project terminal. `start`, `server` and `dev` all invoke the safe imported-builder launcher; none invokes upstream managed updates or its direct-main entrypoint. This is the real source client/native server, not the fictional demo. It serves the built `dist/` application; rebuild after client edits.

The server uses project-owned private state and the existing authenticated HOME. The previously configured private Tailscale Serve address remains owner-restricted; no new exposure/configuration is created. Legacy credentials, subscriptions, browser drafts and held evidence are preserved, not imported into source automatic queues. The same existing VAPID identity is copied privately so an already-permitted browser is not silently unsubscribed/rekeyed; subscription/policy stores are not bulk-translated and physical Push receipt is still unproven. Existing browser pages must reload after cutover; retired legacy action/controllers cannot write through the new API. Do not clear browser storage.

## Scope and evidence

The 22:53 Settings refinement hides Subscription usage (including old palette requests and page links) without removing its backend. About identifies this fork and its pinned upstream source, not upstream update/install controls. Agent integrations describes local private Letta Code history separately from unsupported native session hooks; it performs no installation. App-owned Install app controls are removed; the PWA manifest, service worker and normal browser installation remain intact. The provider mark is Letta's unmodified official organization image, locally vendored with provenance. Terminal Pause fit detaches the fitted view and preserves its drained last screen without stopping the process; Resume Live obtains a fresh screen under current source authority. Pane replacement resets pause; switching to Chat leaves this terminal-only pause. The existing server serves the verified production build without a backend restart. Independent scoped desktop/mobile and actual Light/Dark checks passed, including populated-grid pause/detach/resume; human acceptance and native post-Stop recovery remain open. See the parity inventory for unexercised boundaries and intentional QA guard failures.

The adopted source retains its complete UI, local-PC management, Chat/native history, Node PTY terminal, composer, prompt, filesystem/diff and workspace/tab/worktree implementations. A source implementation or shell fixture does **not** prove every provider/device feature. Optional account/login, forced usage refresh, paid voice, account proxy, public exposure, remote-PC mutation, plugin execution and managed-update capabilities return explicit approval-required/unavailable status rather than changing global accounts or configuration. Valid read-only subscription usage is retained; no OAuth refresh is performed. Provider-specific live Chat/input and physical Push remain separately scoped proof. Upstream has no Letta Chat reader; this fork now adapts read-only Letta history into the existing source Chat path with explicit bounded indexing/paging. Synthetic checks do not establish live rendering or Letta Send/Stop safety.

The canonical coverage/status inventory and rollback references are in `docs/upstream-parity.md`. The reintegrated Letta reader has real read-only HTTP proof for newest/older pages, 304 and 409 without logging transcript bodies, plus independent live desktop/mobile rendering and visible older-history proof. Images remain unavailable-preview notices and full-output fetching is not implemented. An explicitly authorized fresh Letta conversation proved real Send/reply and Stop/interruption, but automatic post-Stop recovery is blocked by native lifecycle status remaining `working`; the web queue must not invent idle. Physical-device/PWA receipt and Mahiro's product acceptance remain separate; automated engineering checks are not human acceptance. The separate T194 provider checkpoint is not closed by this migration.

Never run bare `bun test` (the upstream test preload can start native sessions). `test` is unit-only and `test:native` uses a disposable shell-only fixture that refuses main/default targets. Broader source integration/browser/SSH/install scripts need their own explicit scope; do not run them as a generic smoke test.

## Source, history and licenses

`SOURCE_MANIFEST.json` records the pin, exclusions and explicit fork patches. `scripts/verify-upstream.ts` independently derives the pinned Git tree, checks source byte/mode ownership and rejects leftover legacy app owners; the manifest is not its own authority. Source UI/CSS conventions remain upstream-owned.

This fork retains its Apache-2.0 `LICENSE`; adopted source retains MIT copyright/permission in `UPSTREAM_LICENSE` and applicable `THIRD_PARTY_NOTICES.md` (including both dependency patches). Upstream readmes in `docs/upstream-reference/` and upstream installer/maintainer documents are reference material, not this fork's deployment instructions. Pre-cutover guides are explicitly historical under `docs/history/legacy/`; the old React Router application is no longer runnable in the canonical tree.
