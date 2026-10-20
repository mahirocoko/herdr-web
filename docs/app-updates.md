# Updating this fork

This fork runs from source through the local foreground launcher. There is no enabled managed updater, plugin supervisor, automatic bridge update or Settings-based installation path. Upstream update modules remain in the adopted source, but the fork blocks their mutations before handlers.

## Choose and prepare an update

Review the target fork revision and [release history](../CHANGELOG.md). Inspect `git status` and preserve local changes before replacing source. Use your normal reviewed Git workflow; there is no universal pull/merge command that is safe for every existing checkout.

In particular, old clones may contain history that tracked private `.agent-state` material before a history rewrite. Do not blindly pull or merge that old history back into the cleaned repository. Preserve private data locally, establish which history you have, and prefer a reviewed fresh clone when continuity is unclear. Do not force-push, reset unknown work, or copy an old `.git` directory into the new checkout.

## Restart deliberately

Stop only the owned web instance in its visible terminal; do not stop Herdr or user agent sessions. If the target dependency graph changed, install its frozen dependencies with the [installation](../INSTALL.md#initial-setup) command. Then run:

```sh
bun start
```

Startup checks the port before rebuilding, builds the new client and only then serves it. Do not rebuild live `dist/` while the old backend is still serving it. `server` and `dev` are aliases of this same path, not ways to avoid the safety checks.

Reload the browser when the new server is ready. Keep unsent drafts and inspect held/uncertain input; never replay it automatically. A browser reload does not establish that a pending native write failed.

## Preserve state

Keep the checkout's private runtime tree, existing HOME configuration, VAPID identity, subscriptions, uploads and browser drafts. A fresh clone does not automatically migrate them. Any state transfer must preserve privacy and identity and be separately reviewed; do not bulk-copy secrets into Git or merge old queues. Do not rotate Push keys or clear browser storage as an update step.

If an update fails, retain the error and choose a known compatible source candidate deliberately. No managed rollback guarantee is provided. The [development guide](development.md) covers isolated validation; the [security policy](../SECURITY.md) covers confidential reports.
