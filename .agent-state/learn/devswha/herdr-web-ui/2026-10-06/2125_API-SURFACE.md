# API surface and integration ownership

Source: `54e5a1f67090cb09552d182e7e30dd0ecc314918`, 2026-10-06; baseline `b498e7f053de3ac30318ac7d88b6fd21865edadf`. Reader: task_5 (API), consolidated by Main. No source writes, installs, builds, tests, browser sessions or runtime actions. Local source was clean at the pin.

## Owners and transport map

| Surface | Canonical owner | Identity/proof boundary |
| --- | --- | --- |
| HTTP/WS shapes | `shared/protocol.ts` | Typed browser/server contract, not runtime validation by itself |
| HTTP routing/access | `server/index.ts`, auth/access helpers | Same-origin, watch-only, route-order and error-envelope policy |
| Native newline-JSON RPC | `server/herdr/client.ts` | Method-specific target params; one socket/call, default10s timeout |
| Status events | `server/collector.ts` | Long-lived events.subscribe; no duplicate status subscription owners |
| Terminal bytes | Node PTY sidecar/native attach; Windows mirror alternative | Per-pane attachment, client generation/credit and explicit held slot |
| Conversations/prompts | server provider-history adapters, `server/prompt.ts` | Native-store history and visible asking/key semantics stay backend-owned |
| Remote routing | machine-api/relay/remote-websocket owners | Machine identity bound for connection lifetime; allowlisted internal bridge forwarding |

Root/server/src AGENTS require shared protocol changes, matching contract tests and demo transport coverage. Errors use `{ error: { code, message } }` through `server/http.ts`. Mutations preserve same-origin and watch-only restrictions. Route order in createServer.fetch matters.

Anchors: `shared/protocol.ts` lines35–139,280–310,624–671; `server/index.ts` lines1006–1085,1122–1165,1640–1685,1700–1985; root AGENTS lines3–35,39–67.

## HTTP and provider integration

The route ledger covers health/session, panes/workspaces, conversation and prompts, devices/push, updates and machines. Transcript resolution/parsing feeds `/api/pane/conversation`; prompt detection/answering remains server-owned rather than client key guessing.

Sources: `server/conversation.ts` lines854–893; `transcript-records.ts` lines101–149,175–214; `prompt.ts` lines2246–2319,2601–2652,2741–2815. New protocol parts include OmO `task_result`, and usage providers include `opencode`. Structured data does not establish live adapter success for every provider.

## Native RPC has a deliberately limited result contract

Ordinary calls open one connection, default10s; events.subscribe is long-lived. The wrapper resolves the first result frame without matching response ID or exhaustively validating results at runtime (`server/herdr/client.ts` lines44–153,162–165,369–384,412–497).

Native request ID is not an established idempotency key. A timeout after mutation is ambiguous; do not blindly retry. Target params differ: pane methods use pane_id, agent.prompt uses target, attachment resolves pane to terminal_id. A pane ID is not a global cross-machine target.

## Submission, readiness and output ACK are different

- For submit, text goes to agent.prompt; payload is paste-shaped fallback. submit-result success means Enter was sent, not that an agent completed or even accepted the task. A failure can mean nothing—or only text—reached the terminal.
- input-ready establishes readiness, not typed-text acknowledgement.
- pty-ack releases output flow-control credit after xterm parses bytes. It is not command acknowledgement.
- Client ACK identity stays tied to originating connection/attachment generation, so delayed callbacks cannot credit a new stream.

Sources: `src/lib/ws.ts` lines190–245,258–295; `docs/terminal-flow-control.md` lines11–24; server WS dispatcher. Preserve explicit user review/no-auto-replay on reconnect.

## New explicit take-over surface

WS adds `{ type: "take-over", pane_id }` and advertises take-over capability. Main inspected `server/index.ts` lines1764–1771: observe mode is refused and the addressed attachment must contain that client before the takeOver callback runs. Only explicit interact intent for a held attachment adds `--takeover`; normal attach/retry/reconnect never takes the slot automatically.

There is no correlated direct take-over ACK; attachment/readiness/error frames report progress. This is attachment-slot transfer between Web bridges, not native agent/pane ownership or command completion. `server/attach-output.ts` prevents the attach-process diagnostic leaking into the terminal stream.

## Remote identity, access and retry layers

Remote pane/workspace requests go through machine API; WS machine_id is fixed for its lifetime. Relay uses the remote bridge credential, forwards ACKs unchanged and forces observe for read-only access. It does not forward browser cookies/Authorization.

Reconnect backs off1–60s. Version mismatch stops futile reconnects and requires explicit update. Approved managed-bridge replacement verifies old ownership/PID, waits with a deadline, then strictly verifies the new bundle. Native RPC itself is not retried by its wrapper.

Sources: `server/machine-api.ts` lines7–16,79–115; `machine-relay.ts` lines7–80; `remote-websocket.ts` lines1–5; `machines.ts` lines385–432,508–535; `auth.ts` lines46–66,93–117; `access.ts` lines83–97; `bridge.ts` lines15–45. User/device/Tailscale access is separate from internal bridge Bearer authentication.

## Native declarations are not app implementations

Protocol22 schema declares command.invoke, client_shell.surface.set, surface_interest and plugin-action methods. The reader independently scanned checked-in app directories and found no application call sites for those methods, only schema declarations. This does not establish native runtime support/implementation.

`herdr-plugin.toml` separately declares start/stop/status/phone actions and panes. These declarations are not calls to native plugin-action RPCs, browser command palettes or a user-defined native Quick Commands catalog.

Anchors: `scripts/herdr-schema.json` lines3,1698–1760,4844–4906,6220–6250,10385–10454; `herdr-plugin.toml` lines23–100. Any future native extension needs its runtime/catalog/projection owner inspected separately.

## Follow-up boundary

Keep API changes typed through the shared owner, propagate actual producers/consumers/demo, and choose isolated contract proof. No commands, installed capabilities or native acceptance were verified in this study.
