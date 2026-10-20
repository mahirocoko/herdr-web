# Contributing

Bugs and ideas for this fork belong in [mahirocoko/herdr-web issues](https://github.com/mahirocoko/herdr-web/issues). For security problems, follow [SECURITY.md](SECURITY.md) instead of posting details publicly. Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Small, focused fixes can go straight to a pull request. For a new feature, architectural change, new external service or changed permission boundary, open an issue first and agree on the outcome before implementing it. Preserve the source-native application rather than restoring the retired frontend or redesigning the shell as incidental cleanup.

## Prepare a change

Use [Installation](INSTALL.md) for setup and [Development](docs/development.md) for architecture, commands and test isolation. [AGENTS.md](AGENTS.md) states repository safety rules for both people and coding assistants. [DESIGN.md](DESIGN.md) describes the current UI, not a request to invent a new visual system.

Branch from current `main` and send a focused [pull request to this fork](https://github.com/mahirocoko/herdr-web/pulls). Independent changes should remain independently reviewable. Describe the user-visible problem, the chosen fix, affected source owners and checks actually run. Include limitations and screenshots for visible changes, with private transcript, filesystem and account data removed. A source test, browser capture and human acceptance answer different questions; say which evidence you have.

## Review expectations

Keep the existing file's conventions. Imported UI code uses double quotes and semicolons; do not mass-format it. HTTP/WebSocket changes belong in shared contracts and both consumers. Generated protocol types and theme copies must come from their generators. New translated UI strings need matching placeholders in the existing language files.

The source manifest is not a blanket exception mechanism. Changes to imported files need a precise, independently approved verifier policy entry where required; keep the upstream pin, inventory, modes and notices intact. Do not acquire or promote upstream again merely to fix a local bug. The development guide explains those owners.

Run the narrowest meaningful tests and typechecks. For a broader application change, include the safe unit suite and an isolated build when relevant. Never use native sessions or paid providers as an implicit smoke test. External-contributor CI may need maintainer approval before it runs; run approval is not code review or proof that merge protection is configured. This repository does not promise enforced branch-protection or review-count rules.

## Keep private material out

Do not include `.agent-state`, tokens, cookies, VAPID keys, private history, uploads, user drafts, local runtime binaries, browser profiles, screenshots containing secrets, or execution/task ledgers. The ignored state tree is local-only, including retrospectives and pulse records; never force-add it. Avoid unrelated lockfile changes, dependency upgrades, release metadata churn and generated build output.

Maintainers handle tags and source-only releases. Keep plugin registration, global configuration changes and remote installation out of unrelated PRs.

## Licensing

This repository has two preserved scopes: fork material under [Apache-2.0](LICENSE), adopted upstream source under [MIT](UPSTREAM_LICENSE), plus [third-party notices](THIRD_PARTY_NOTICES.md) and dependency patches. Package metadata records `Apache-2.0 AND MIT`. Contributions must respect the applicable scope; this is not a blanket MIT relicensing or a promise of a new CLA. Identify adapted code and retain its required notices. Ask before introducing material with unclear or incompatible terms.
