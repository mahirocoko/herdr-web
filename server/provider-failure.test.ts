import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexTranscriptParser, matchCodexTranscript, parseCodexTranscript } from "./codex.ts";
import { parseClaudeTranscript } from "./conversation.ts";
import { ProviderFailures, providerTurnEnd } from "./provider-failure.ts";
import type { HerdrPane } from "../shared/protocol.ts";

const event = (payload: unknown) => JSON.stringify({ type: "event_msg", timestamp: "2026-11-16T00:00:00Z", payload }) + "\n";
const start = (id = "parent") => event({ type: "task_started", turn_id: id });
const failure = (id = "parent", message = "fictional limit", root?: string) => event({ type: "task_complete", turn_id: id, root_turn_id: root, error: { message } });
const claude = (failed: boolean, text = "Fictional reply", stop = "end_turn") => JSON.stringify({ type: "assistant", isApiErrorMessage: failed, message: { content: [{ type: "text", text }], stop_reason: stop } }) + "\n";

test("failure-only Codex turn is visible; a child cannot fail or close its parent", () => {
  expect(parseCodexTranscript(start() + failure("child", "child refused", "parent"), Infinity)).toEqual([]);
  expect(parseCodexTranscript(start() + failure("child", "child refused", "parent") + failure(), Infinity).at(-1)?.parts).toEqual([{ kind: "text", text: "Error: fictional limit", failed: true }]);
});
test("keeps failed request snapshots independent and excludes errors from rollout display matching", () => {
  const parser = createCodexTranscriptParser(); parser.write(start() + failure());
  const before = parser.snapshot();
  parser.write(start("retry") + event({ type: "agent_message", turn_id: "retry", message: "Successful reply" }) + event({ type: "task_complete", turn_id: "retry" }));
  expect(before[0]?.parts).toHaveLength(1);
  expect(parser.snapshot()[0]?.parts).toHaveLength(2);
  const text = "Distinct fictional failure abcdefghijklmnopqrstuvwxyz 0123456789 ".repeat(4);
  expect(matchCodexTranscript(`OpenAI Codex (v1)\nError: ${text}`, [{ path: "/fictional", text: start() + failure("parent", text) }])).toBeNull();
});
test("Claude marks only explicit API errors and joins a successful retry without erasing the error", () => {
  const turns = parseClaudeTranscript(claude(true, "Rate limited") + claude(false, "Recovered"));
  expect(turns).toHaveLength(1);
  expect(turns[0]?.parts).toEqual([{ kind: "text", text: "Rate limited", failed: true }, { kind: "text", text: "Recovered" }]);
  expect(parseClaudeTranscript(claude(false, "Error: quoted ordinary prose"))[0]?.parts[0]).not.toHaveProperty("failed");
});
test("bounded end recognition ignores children, incomplete records and unobserved next turns", () => {
  expect(providerTurnEnd("codex", start() + failure("child", "no", "parent") + failure())).toBe("failed");
  expect(providerTurnEnd("codex", start() + failure("other"))).toBe("running");
  expect(providerTurnEnd("codex", start() + failure() + start("unobserved") + failure("unobserved"))).toBeNull();
  expect(providerTurnEnd("codex", failure().trimEnd())).toBeNull();
  expect(providerTurnEnd("codex", failure() + "{invalid}\n")).toBeNull();
  expect(providerTurnEnd("claude", claude(true) + claude(false))).toBe("answered");
  expect(providerTurnEnd("claude", claude(true) + JSON.stringify({ type: "user", message: { content: "new prompt" } }) + "\n" + claude(true))).toBeNull();
  expect(providerTurnEnd("claude", JSON.stringify({ type: "assistant", isSidechain: true, isApiErrorMessage: true, message: { content: [] } }) + "\n")).toBeNull();
});

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture(agent = "codex") {
  const root = mkdtempSync(join(tmpdir(), "herdr-provider-failure-")); roots.push(root);
  const path = join(root, "fictional.jsonl"); writeFileSync(path, '{"type":"session_header"}\n');
  let identity = "fixture-process:1", resolve: (() => Promise<{ path: string; identity: string } | null>) | undefined;
  let changed: (() => void) | undefined;
  const pane = { pane_id: "p", terminal_id: "t", agent, agent_status: "idle", cwd: "/fictional" } as HerdrPane;
  const tracker = new ProviderFailures({ resolve: async () => resolve ? resolve() : { path, identity }, onChange: () => { changed?.(); changed = undefined; }, timeoutMs: 25 });
  await tracker.refresh([pane]);
  const check = async (status = "done") => {
    const completed = new Promise<void>((done) => { changed = done; });
    tracker.observe("p", status, agent);
    await completed;
  };
  return { tracker, pane, path, root, check, append: (text: string) => appendFileSync(path, text), identity: () => { identity += "replacement"; }, resolver: (next: typeof resolve) => { resolve = next; } };
}
for (const agent of ["codex", "claude"]) {
  test(`${agent}: failure is presentation-only; retry starts clear it and success restores native Done`, async () => {
    const f = await fixture(agent);
    f.tracker.observe("p", "working", agent);
    f.append(agent === "codex" ? start() + failure() : claude(true));
    const read = f.check();
    expect(f.tracker.display("p", "done")).toBe("unknown"); expect(f.tracker.held("p")).toBe(true);
    await read;
    expect(f.tracker.display("p", "done")).toBe("failed");
    expect(f.tracker.display("p", "unknown")).toBe("failed");
    expect(f.tracker.display("p", "working")).toBe("working");
    expect(f.tracker.display("p", "blocked")).toBe("blocked");
    expect(f.pane.agent_status).toBe("idle"); // no native input state was rewritten
    f.tracker.observe("p", "working", agent);
    expect(f.tracker.held("p")).toBe(false);
    f.append(agent === "codex" ? start("retry") + event({ type: "task_complete", turn_id: "retry" }) : claude(false));
    await f.check(); expect(f.tracker.display("p", "done")).toBe("done"); expect(f.tracker.held("p")).toBe(false);
  });
}
for (const replacement of ["process", "file", "truncation", "bound", "provider"]) {
  test(`does not label an earlier failure after ${replacement} replacement`, async () => {
    const f = await fixture(); f.tracker.observe("p", "working", "codex"); f.append(start() + failure());
    if (replacement === "process") f.identity();
    if (replacement === "file") { rmSync(f.path); writeFileSync(f.path, start() + failure()); }
    if (replacement === "truncation") writeFileSync(f.path, "");
    if (replacement === "bound") f.append(" ".repeat(256 * 1024 + 1));
    if (replacement === "provider") { await f.tracker.refresh([{ ...f.pane, agent: "pi" }]); expect(f.tracker.held("p")).toBe(false); return; }
    await f.check(); expect(f.tracker.display("p", "done")).toBe("done"); expect(f.tracker.held("p")).toBe(false);
  });
}
test("late binding results cannot restore failure or input holds after a new native turn", async () => {
  const f = await fixture(); f.tracker.observe("p", "working", "codex"); f.append(start() + failure());
  let finish!: (value: { path: string; identity: string }) => void;
  f.resolver(() => new Promise((done) => { finish = done; }));
  f.tracker.observe("p", "done", "codex"); expect(f.tracker.held("p")).toBe(true);
  f.tracker.observe("p", "working", "codex"); finish({ path: f.path, identity: "fixture-process:1" });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  expect(f.tracker.held("p")).toBe(false); expect(f.tracker.display("p", "done")).toBe("done");
});
test("resting promotes an in-flight binding-only lookup before it can grant Done or automatic delivery", async () => {
  const f = await fixture(); f.tracker.observe("p", "working", "codex"); f.append(start() + failure());
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  f.resolver(async () => { await gate; return { path: f.path, identity: "fixture-process:1" }; });
  const pending = f.tracker.refresh([{ ...f.pane, agent_status: "working" }]);
  f.tracker.observe("p", "done", "codex");
  expect(f.tracker.held("p")).toBe(true); expect(f.tracker.display("p", "done")).toBe("unknown");
  release(); await pending;
  expect(f.tracker.held("p")).toBe(true); expect(f.tracker.display("p", "done")).toBe("failed");
});
test("a snapshot captured before Done cannot erase confirmed failure with late Working", async () => {
  const f = await fixture(); f.tracker.observe("p", "working", "codex");
  const old = f.tracker.capture(); f.append(start() + failure()); await f.check();
  expect(f.tracker.display("p", "done")).toBe("failed");
  await f.tracker.refresh([{ ...f.pane, agent_status: "working" }], old);
  await f.tracker.refresh([{ ...f.pane, agent_status: "done" }]);
  expect(f.tracker.display("p", "done")).toBe("failed"); expect(f.tracker.held("p")).toBe(true);
});
test("an older concurrent read cannot clear the newer snapshot's failure", async () => {
  const f = await fixture(); f.tracker.observe("p", "working", "codex"); f.append(start() + failure());
  const old = f.tracker.capture(), next = f.tracker.capture();
  await f.tracker.refresh([{ ...f.pane, agent_status: "done" }], next);
  // refresh resolves before an already-started check; its explicit onChange is the completion.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await f.tracker.refresh([{ ...f.pane, agent_status: "working" }], old);
  expect(f.tracker.display("p", "done")).toBe("failed");
});
test("a lost resolver is bounded, and unobserved old errors are never adopted at startup", async () => {
  const f = await fixture(); f.append(start() + failure());
  await f.tracker.refresh([f.pane]); expect(f.tracker.display("p", "done")).toBe("done");
  f.tracker.observe("p", "working", "codex"); f.resolver(() => new Promise(() => {}));
  await f.check(); expect(f.tracker.held("p")).toBe(false);
});
