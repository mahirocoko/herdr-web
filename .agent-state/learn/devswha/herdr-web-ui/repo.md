# herdr-web-ui Learning Index

## Source

- GitHub: https://github.com/devswha/herdr-web-ui
- Origin: `./origin/` → `/Users/mahiro/ghq/github.com/devswha/herdr-web-ui`
- Current pinned source: `54e5a1f67090cb09552d182e7e30dd0ecc314918`
- Fast-forwarded canonical clone from origin/main on 2026-10-06 21:24 Asia/Bangkok, then kept read-only. Delta from previous study:116 files,+7,617/−638 lines. No install, build, test, browser, SSH or live integration ran for this study.
- App metadata:0.3.52. HEAD includes two commits after release tag v0.3.52; remote runtime counter19 is a separate owner, not a verified published/installed bundle.

## Current deep study — 2026-10-06 2125

Five independent read-only readers returned findings; Main is the single writer of these project-owned documents. Main compared their claims and spot-checked source: test filename count/CI list, helper side effects, release-vs-HEAD, explicit take-over authorization and source excerpts. No implementation/adoption or runtime PASS is claimed.

- [Architecture](2026-10-06/2125_ARCHITECTURE.md)
- [Source patterns](2026-10-06/2125_CODE-SNIPPETS.md)
- [Quick reference](2026-10-06/2125_QUICK-REFERENCE.md)
- [Testing and proof boundaries](2026-10-06/2125_TESTING.md)
- [API and integration ownership](2026-10-06/2125_API-SURFACE.md)

### Findings to retain

1. New explicit take-over transfers an attachment slot between Web bridges. Observe clients cannot invoke it; ordinary attach/retry/reconnect never takes a held slot automatically.
2. Prompt answering is server-owned and freshness-checked. Structured OmO asks/background task results and session-only model cards must not be conflated with native Quick Commands.
3. KeyBar optional slots are sanitized local preferences; tab-strip scroll helpers preserve user intent through font/layout changes. These are stronger reuse owners than copied paint or generic input handlers.
4. #514 Codex citation/display pairing and #515 composer font changes are unreleased at this source snapshot even though package says0.3.52. Source HEAD is not installed release proof.
5. Testing layers differ:144 tracked test files are not coverage or a pass count;12 CI browser scripts are broader than local test:ui. Integration helpers can modify config and launch resident Herdr sessions, so they were not run.

### Cross-reader reconciliation

- Stable owner boundary remains Herdr(native terminal/processes), Bun(bridge/auth/adapters), Node(Unix PTY sidecar), React(browser state/IME/focus). Windows mirror is not a PTY.
- Schema declarations for command.invoke/surface-interest/plugin methods still have no observed application callers in the reader's exact app-directory scan. Runtime/native implementation remains unknown.
- OmO support table and current implementation/release notes disagree; keep the documentation drift explicit rather than inventing one unified capability claim.
- Main recovered the prior source-pattern file successfully; one reader could not access that external note. Prior documentation was not lost, and the full baseline SHA was independently confirmed.
- Current study lives in this project's ignored .agent-state/learn. Old personal-workspace documents remain historical authorities for their pinned source, not current clone behavior.

## Existing deep study — canonical notes

The previous complete five-reader study was performed in Mahiro's personal workspace on **2026-10-05 22:44**, pinned at `b498e7f053de3ac30318ac7d88b6fd21865edadf`. It was recovered here on October6 before the new pull/study. The new five-reader run above is separate and does not overwrite these notes.

Canonical hub: `/Users/mahiro/Git/me/mahirocoko/.agent-state/learn/devswha/herdr-web-ui/repo.md`

- Architecture: `/Users/mahiro/Git/me/mahirocoko/.agent-state/learn/devswha/herdr-web-ui/2026-10-05/2244_ARCHITECTURE.md`
- Source patterns: `/Users/mahiro/Git/me/mahirocoko/.agent-state/learn/devswha/herdr-web-ui/2026-10-05/2244_CODE-SNIPPETS.md`
- Usage/configuration: `/Users/mahiro/Git/me/mahirocoko/.agent-state/learn/devswha/herdr-web-ui/2026-10-05/2244_QUICK-REFERENCE.md`
- Testing/proof boundaries: `/Users/mahiro/Git/me/mahirocoko/.agent-state/learn/devswha/herdr-web-ui/2026-10-05/2244_TESTING.md`
- API/integration ownership: `/Users/mahiro/Git/me/mahirocoko/.agent-state/learn/devswha/herdr-web-ui/2026-10-05/2244_API-SURFACE.md`

## Previous-study context (historical baseline)

1. Herdr owns terminals/processes. React owns browser drafts and rendering; Bun owns HTTP/SSE/WS/auth boundaries; Unix PTY attachment requires a Node sidecar. Windows mirror behavior is not full PTY streaming.
2. Native generated schema declares command.invoke/surface-interest contracts, but the Web application has no callers establishing native Quick Commands functionality. Browser palettes, slash suggestions and plugin actions are separate owners.
3. Input paths have different IME/focus/retry semantics. xterm output ACKs bind to the original attachment generation/connection and occur after parsing; reconnect never authorizes replaying held input.
4. Unit/contract/browser/physical-device evidence are separate gates. Default integration helpers may touch HOME and launch resident Herdr sessions; none were executed for this recovery.
5. Upstream DESIGN/styles/components are source evidence for the current herdr-web adaptation, not permission to overwrite local accepted product decisions or lifecycle safety contracts.

Source revision changes require a bounded delta review before reusing these notes as current evidence. They are source-study notes, not runtime verification.
