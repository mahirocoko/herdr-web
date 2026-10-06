# Testing and proof boundaries — refreshed deep study

Source: `54e5a1f67090cb09552d182e7e30dd0ecc314918`, inspected 2026-10-06. Previous study: `b498e7f`. Reader: task_3 (testing); Main consolidated and spot-checked discovery counts, CI browser list and test-session helper. All observations are source-only: no install, build, test, browser or live Herdr execution.

## Commands are documented, not executed results

The documented fast lane is generated-type freshness, typecheck, build and `bun run test:unit`. Integration is `bun run test:integration`; browser work is `bun run test:ui`, which builds before its browser suite. A bare `bun test` also discovers integration files, so it is not the safe unit command.

Owners: `package.json` lines 12–25, root `AGENTS.md` lines 53–67, `docs/development.md` lines 15–55 and 163–180. Root/server/src guidance agrees that Bun tests have no DOM, `.test.tsx` is not discovered, and `scripts/`/`site/` are not normally typechecked. There is no formatter/linter command.

## Discovery and CI

- The tracked source contains **144 `*.test.ts` files**. This is a filename count, not cases, coverage or passing tests. Main independently counted with `git ls-files`.
- Discovery walks `src`, `shared`, `server`, `scripts`. Contract-named files, server Herdr/PTY tests and the updater test belong to integration (`scripts/ci-tests.ts` lines 13–25, 35–40, 48–73).
- CI pins Bun 1.4.2, Node 22 and Herdr 0.9.3. Integration uses `HERDR_TEST_SHARDS=1`; separately named integration/browser lanes run concurrently (`.github/workflows/ci.yml` lines 57–90, `scripts/ci-lanes.ts` lines 2–6 and 18–36). This upstream policy does not authorize heavyweight local fan-out.
- `scripts/ci-browser.sh` lines 7–18 now list **12 browser scripts**, including math and machine-dialog regressions. Main inspected the complete list. Local `test:ui` remains narrower and omits file-viewer regression. Font-swap is a separate regression, not a member of that CI list.

## Changes since the previous study

The previous map described 10 CI browser scripts. The new snapshot adds two and substantially expands prompt parser and prompt-answer coverage. Relevant changed owners:

| Layer | Representative new/expanded evidence | What it does not prove |
| --- | --- | --- |
| Unit | `server/prompt.test.ts` parser fixtures; `attach-output.test.ts` read-boundary cases; `machine-update.test.ts` fake SSH; `omo-records.test.ts` synthetic JSONL; `src/lib/tabStripScroll.test.ts` pure state | DOM behavior, physical keyboard behavior, real provider/runtime success |
| Contract | `server/prompt.contract.test.ts` real-Herdr answer cases; `take-over.contract.test.ts` controlled attach-process steps; output contracts with real WS clients | Every platform/device/installed runtime |
| Browser | `scripts/take-over-regression.ts` and mobile-tabs wired into `ui-regression.ts`; math/machine-dialog CI scripts; separate font-swap tests over real app and demo fixtures | Physical iOS/Android keyboard, full live-native adoption, human visual acceptance |

Anchors: `server/attach-output.test.ts` lines 7–24; `server/machine-update.test.ts` lines 13–15, 24–26, 91–96; `server/omo-records.test.ts` lines 9–19; `src/lib/tabStripScroll.test.ts` lines 1–4, 21–45; `server/take-over.contract.test.ts` lines 29–47 and 75 onward; `server/output.contract.test.ts` lines 83–145; `scripts/ui-regression.ts` lines 19–27 and 366–371; `scripts/font-swap-demo-regression.ts` lines 9–16 and 148–202.

## Test helpers are not passive reads

`bunfig.toml` preloads `scripts/test-herdr.ts`. Unit mode points HERDR_SOCKET to a deliberately nonexistent temporary socket and exits before discovery/start. Other modes may start a named server, create config/log/ZDOTDIR state and an empty `.zshrc`, and create a resident workspace with HOME as cwd. The helper can also stop an old test server when its existing shell configuration needs migration. None of these operations ran in this study.

Main inspected `scripts/test-herdr.ts` lines 41–95. Before an authorized integration/browser run, resolve the actual isolated `XDG_CONFIG_HOME`, `HERDR_WEB_STATE_DIR`, `HERDR_TEST_SESSION`, ports and test-owned panes. Never silently use Mahiro's normal session or device store. Root/backend rules require temp stateDir/port0; real `herdr update` is prohibited in tests.

Other important side effects and limits:

- `scripts/generate-protocol-types.test.ts` lines 29–48 temporarily rewrites the generated file and restores it: a test invocation is not automatically read-only.
- `scripts/keyboard-viewport-regression.ts` lines 1–5, 64–94 fakes viewport/keyboard/safe-area signals. It cannot establish physical-device correctness.
- A second server cannot attach the same held pane. Browser/live checks require a pane the test owns, not a user's active terminal.

## How to use this map

Choose the narrowest owning proof: parsing/state → unit; Herdr/server wire → contract; rendered behavior → owning browser script; physical device/install → separately authorized device/platform proof. Report exact commands and omissions; no commands above were executed during learning.
