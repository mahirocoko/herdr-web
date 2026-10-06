# Architecture and ownership delta

Source: `54e5a1f67090cb09552d182e7e30dd0ecc314918`, 2026-10-06. Baseline: `b498e7f053de3ac30318ac7d88b6fd21865edadf`. Reader: task_1 (architecture), consolidated by Main. Source was fast-forwarded from origin/main, then kept read-only; no builds, tests, browser or runtime checks. Delta:116 files,+7,617/−638 lines. App metadata remains0.3.52; HEAD includes unreleased changes.

## Stable owner map

```text
React/Vite browser
  ├── xterm lifecycle, UI/render state, explicit user drafts
  ├── HTTP conversation/prompt reads and answers
  └── terminal WS input/output
          ↓
Bun server + shared TypeScript wire contracts
  ├── access policy, HTTP/SSE/WS routing, provider-history adapters
  ├── per-pane terminal attachment and client backpressure
  ├── Node PTY sidecar → herdr terminal attach
  └── Windows visible-screen mirror (different semantics)
          ↓
Herdr owns processes, PTYs, scrollback and agent state
```

Root `AGENTS.md` lines14–35 preserves the Node sidecar boundary: do not load node-pty into Bun; xterm scrollback stays0; attachment byte stream is authoritative, not reconstructed pane.read. Native RPC uses one connection per call; events.subscribe is the long-lived exception. Status subscription has one server collector owner.

Server lifecycle/adapters stay in `server/`; client terminal/render state lives in `src/`; HTTP/WS wire contracts belong to `shared/protocol.ts`. Root, server and src AGENTS apply alongside CONTRIBUTING, review, development and DESIGN documents. Changes must propagate to real clients and demo transport.

## Entry points and major flows

- `src/main.tsx`: browser entry/SettingsProvider, fonts and primitive styles. `src/App.tsx`: access gates, machine/pane selection, roster, views and dialogs.
- `PaneTerminal.tsx`: machine-scoped component lifetime; pane attachment generations, direct terminal input and xterm output parsing. A pane change is not the same as a machine remount.
- `ChatView.tsx`: polls structured history and prompt cards. It does not own provider-specific answer-key semantics.
- `server/index.ts`: HTTP/WS boundary, per-pane attachment/client state, access/interaction checks and input dispatch.
- `server/conversation.ts`: read-only native provider session-store history, not terminal-byte reconstruction. Supports Codex, Claude Code, omp, omo, gjc and pi; unsupported panes retain terminal/status surfaces.
- `server/prompt.ts`: visible-screen asking detection and server-owned answer navigation. OmO recorded asks can provide canonical question text where available.

Sources: server/src AGENTS; `conversation.ts` lines4–29,798–977,985–1112; `prompt.ts` lines608–670,2253–2318,2450–2478,2601–2815.

## Do not collapse three attachment meanings

1. Terminal attachment: backend process/slot and its subscribed WS clients.
2. Composer upload: user-provided files stored for the target pane.
3. Transcript image/tool output: resolved on demand from selected native history.

These have different lifetimes, identity and sources. `server/index.ts` lines307–363,613–674,891–900,1700–1771 and `shared/protocol.ts` lines283–304,542–647 establish their distinct shapes.

## Significant delta from the previous study

### Explicit bridge-to-bridge take-over

A held terminal attachment can now receive an explicit client `take-over` frame. Server requires an attached interact client and invokes `--takeover` only for that intent; ordinary attach/retry/reconnect still waits. This transfers a terminal attach slot between web bridges, not ownership of the Herdr pane or agent.

`server/attach-output.ts` lines1–42 suppresses the attach process's own take-over diagnostic across output read boundaries. README lines124–142 discusses Herdr TUI versus the app; do not generalize “nothing handed over” into a claim that competing Web bridges cannot transfer attachment.

### Guarded asking identity

Answer handling now distinguishes repeated identical asks when it observes the prior asking end, rereads the active menu/cursor before irreversible navigation and rejects stale cards. Session-only model-choice semantics belong on the server. Source limitation: if an ask ends and repeats entirely between observations without a detectable status transition, it may remain indistinguishable from the original asking. No runtime experiment was performed here.

### Structured OmO asks/background results

`server/omo-ask.ts` lines1–106 cross-checks visible questions against open provider-session calls. Waiting and non-waiting asks have different settlement rules. Background completions become typed `task_result` parts; titles are retained across transcript paging (`server/transcript-records.ts` lines93–149,175–301).

## Dependencies and verification boundaries

React18/Vite/TypeScript own browser development; Bun hosts API/WS, Node hosts Unix PTY attachment, xterm renders terminal bytes, and provider adapters parse native histories. Windows mirror is deliberately not full PTY streaming. Exact declarations belong in package.json/bun.lock; platform/installation behavior requires separate proof.

Declared checks are generated-types, typecheck, build, unit, integration and UI suites. Scripts/site are not normally typechecked; bare bun test includes contracts. This study executed none. Use the TESTING note to choose an authorized isolated check, not the mere existence of a test as runtime PASS.

## Reuse boundary

Use this pinned source as architecture evidence, preserving native/bridge/browser and prompt/history/attachment ownership. Mahiro's local herdr-web product decisions are a different owner; adopting upstream anatomy or behavior needs explicit local scope and real-consumer checks.
