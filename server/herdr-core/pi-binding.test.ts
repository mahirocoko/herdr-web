import { afterEach, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piActivityName, readPiActivity } from "../pi-subagents.ts";
import { corePiSession, CORE_PI_OBSERVER_SOURCE } from "./pi-binding.ts";
import type { HcTerminal } from "./snapshot.ts";

const now = 50_000;
const posixIt = it.skipIf(process.platform === "win32");
let cleanup = () => { };
afterEach(() => { cleanup(); cleanup = () => { }; });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "core-pi-binding-")));
  cleanup = () => rmSync(root, { recursive: true, force: true });
  const state = join(root, "state");
  const store = join(root, "sessions");
  const directory = join(state, "pi-subagents");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(store, { mode: 0o700 });
  const terminal: HcTerminal = {
    address: "t1", cols: 80, rows: 24, cwd: root, state: "live", status: { app: "pi", state: "working" },
    foreground: { name: "pi", pid: 2147483600, argv: ["pi"], cwd: root }
  };
  const receipt = (name = "parent", extra: Record<string, unknown> = {}) => {
    const parent = join(store, `${name}.jsonl`);
    writeFileSync(parent, JSON.stringify({ type: "session", id: name, cwd: root }) + "\n", { mode: 0o600 });
    const path = join(directory, piActivityName(parent));
    const value = { version: 1, parentFile: parent, parentSessionId: name, pid: terminal.foreground!.pid, updatedAt: now, records: [], ...extra };
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
    return { parent, path, value };
  };
  const read = () => corePiSession(terminal, state, { now, sessionDir: store });
  return { root, state, store, directory, terminal, receipt, read };
}

posixIt("binds only a fresh private exact-SessionManager parent to the current foreground Pi PID", async () => {
  const f = fixture();
  const { parent } = f.receipt();
  expect(await f.read()).toEqual({ agent: "pi", source: CORE_PI_OBSERVER_SOURCE, kind: "path", value: parent });
});

posixIt("consumes the configured producer's v1 wire for parent binding and child activity, then expires it", async () => {
  const f = fixture();
  const { parent, path } = f.receipt();
  const snapshot = { version: 1, parentFile: parent, parentSessionId: "parent", records: [{ id: "child", type: "Explore", description: "Read only", status: "running", startedAt: 1, toolUses: 0 }], updatedAt: now, pid: f.terminal.foreground!.pid, producer: "fixture-generation" };
  writeFileSync(path, JSON.stringify(snapshot), { mode: 0o600 });
  expect(await f.read()).toMatchObject({ value: parent });
  const binding = { path: parent, id: "parent", pids: [f.terminal.foreground!.pid] };
  const activity = readPiActivity(binding, f.state, now);
  expect(activity.live).toBe(true);
  expect(activity.tasks[0]).toMatchObject({ title: "Read only", status: "running" });
  expect(JSON.stringify(activity.tasks)).not.toContain("PRIVATE");
  expect(await corePiSession(f.terminal, f.state, { now: now + 8001, sessionDir: f.store })).toBeUndefined();
  expect(readPiActivity(binding, f.state, now + 8001).live).toBe(false);
});

posixIt("binds parent-only receipts without granting live child authority", async () => {
  const f = fixture();
  const { parent } = f.receipt("parent", { activity: "unavailable" });
  expect(await f.read()).toMatchObject({ value: parent });
  expect(readPiActivity({ path: parent, id: "parent", pids: [f.terminal.foreground!.pid] }, f.state, now).live).toBe(false);
  for (const extra of [{ activity: "unknown" }, { activity: "unavailable", records: [{ id: "child", type: "test", description: "test", status: "running", startedAt: 1, toolUses: 0 }] }]) {
    f.receipt("parent", extra);
    expect(await f.read()).toBeUndefined();
  }
});

posixIt("does not derive identity from status, title, labels, process name, shell argv, or a foreign PID", async () => {
  const f = fixture();
  f.terminal.title = "pi /private/guessed.jsonl";
  f.terminal.labels = { "herdr:pi": "/private/guessed.jsonl" };
  expect(await f.read()).toBeUndefined();
  f.receipt();
  for (const argv of [undefined, ["node"], ["bash", "-c", "pi"]]) {
    f.terminal.foreground!.argv = argv;
    expect(await f.read()).toBeUndefined();
  }
  f.terminal.foreground!.argv = ["pi"];
  f.terminal.foreground!.pid++;
  expect(await f.read()).toBeUndefined();
});

posixIt("keeps an existing core Pi with only a stale foreign observer unbound, even when status says done", async () => {
  const f = fixture();
  // Real core foreground shape: the process name is node, Pi owns argv, no session argument.
  f.terminal.foreground = { name: "node", pid: 1234, argv: ["pi", ""], cwd: f.root };
  f.terminal.status = { app: "pi", state: "done" };
  f.receipt("old-session", { pid: 5678, updatedAt: now - 86400000 });
  expect(await f.read()).toBeUndefined();
  // Freshness alone cannot turn a different process's receipt into this pane's identity.
  f.receipt("old-session", { pid: 5678 });
  expect(await f.read()).toBeUndefined();
  // Only an explicit current-process receipt can bind the parent; completion status is irrelevant.
  const { parent } = f.receipt("old-session");
  expect(await f.read()).toMatchObject({ value: parent });
});

posixIt("refuses expired/future, incompatible, malformed, mismatched or ambiguous receipts", async () => {
  const f = fixture();
  for (const extra of [{ updatedAt: now - 8001 }, { updatedAt: now + 1001 }, { version: 2 }, { parentSessionId: "other" }, { records: [{}] }]) {
    f.receipt("parent", extra);
    expect(await f.read()).toBeUndefined();
  }
  f.receipt();
  f.receipt("other-parent");
  expect(await f.read()).toBeUndefined();
});

posixIt("refuses nonprivate, linked, oversized receipts and paths outside the Pi store without repair", async () => {
  const f = fixture();
  let { path } = f.receipt();
  chmodSync(path, 0o644);
  expect(await f.read()).toBeUndefined();
  chmodSync(path, 0o600);
  writeFileSync(path, " ".repeat(16_385));
  expect(await f.read()).toBeUndefined();
  ({ path } = f.receipt());
  const target = join(f.root, "receipt.json");
  rmSync(path); writeFileSync(target, "{}", { mode: 0o600 }); symlinkSync(target, path);
  expect(await f.read()).toBeUndefined();
  rmSync(path);
  const outside = join(f.root, "outside.jsonl");
  writeFileSync(outside, '{"type":"session","id":"outside"}\n');
  f.receipt("parent", { parentFile: outside, parentSessionId: "outside" });
  expect(await f.read()).toBeUndefined();
});

posixIt("refuses unbounded receipt discovery and CLI store overrides instead of guessing", async () => {
  const f = fixture();
  f.receipt();
  f.terminal.foreground!.argv = ["pi", "--session-dir", f.store];
  expect(await f.read()).toBeUndefined();
  f.terminal.foreground!.argv = ["pi"];
  for (let i = 0; i < 128; i++) writeFileSync(join(f.directory, `unknown-${i}`), "");
  expect(await f.read()).toBeUndefined();
});
