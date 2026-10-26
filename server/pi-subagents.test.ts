import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiSubagentStatus, piActivityName, piChildPath, piForegroundPids, piSessionHeader, piSubagentTurns, piTaskId, readPiActivity, type PiParent } from "./pi-subagents.ts";
import { piSubagentResponse } from "./pi-subagent-routes.ts";
import { PI_ACTIVITY_TTL_MS, piRunRecord, type PiRunRecord } from "../shared/pi-subagents.ts";
import { MACHINE_PROXY_PATH } from "./machine-api.ts";
import type { HerdrPane } from "../shared/protocol.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-pi-subagents-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let serial = 0;
const now = Date.now();
const record = (id = "child", changes: Partial<PiRunRecord> = {}): PiRunRecord => ({ id, type: "Explore", description: "Read parser", status: "completed", startedAt: now - 2000, completedAt: now - 1000, toolUses: 2, ...changes });
const lines = (entries: unknown[]) => entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
function fixture(records: PiRunRecord[] = [record()]) {
  const dir = join(root, `${serial++}`);
  const state = join(dir, "state");
  mkdirSync(join(state, "pi-subagents"), { recursive: true, mode: 0o700 });
  const path = join(dir, "parent.jsonl");
  const parent: PiParent = { path, id: "parent-session", pids: [12345] };
  const child = join(dir, "parent", "tasks", "child.jsonl");
  mkdirSync(join(dir, "parent", "tasks"), { recursive: true });
  writeFileSync(child, lines([
    { type: "session", id: "child-session", parentSession: parent.id },
    { type: "message", id: "u", parentId: null, timestamp: new Date(now - 2000).toISOString(), message: { role: "user", content: "Inspect the parser" } },
    { type: "message", id: "a", parentId: "u", timestamp: new Date(now - 1000).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "Parser inspected" }], stopReason: "stop" } },
  ]));
  const save = (runs: PiRunRecord[]) => writeFileSync(path, lines([
    { type: "session", id: parent.id },
    ...runs.map((r, index) => ({ type: "custom", id: `r${index}`, parentId: index ? `r${index - 1}` : null, customType: "subagents:record", data: { ...r, outputFile: r.outputFile ?? child } })),
  ]));
  save(records);
  const snapshotFile = join(state, "pi-subagents", piActivityName(path));
  const publish = (runs: PiRunRecord[], extra: Record<string, unknown> = {}) => writeFileSync(snapshotFile, JSON.stringify({ version: 1, parentFile: path, parentSessionId: parent.id, pid: 12345, updatedAt: now, records: runs, ...extra }), { mode: 0o600 });
  return { state, parent, child, save, publish, snapshotFile };
}

describe("Pi child records and authoritative activity", () => {
  it("accepts native argv0-only Pi metadata, never a process name or contradictory argv", () => {
    expect(piForegroundPids([{ pid: 99112, argv0: "pi" }])).toEqual([99112]);
    expect(piForegroundPids([{ pid: 12345, argv: ["pi"] }])).toEqual([12345]);
    expect(piForegroundPids([{ pid: 99112, argv0: "node" }, { pid: 2, argv0: "zsh" },
      { pid: 3, argv0: "pi", argv: ["zsh"] }, { pid: -1, argv0: "pi" }])).toEqual([]);
  });
  it.skipIf(process.platform === "win32")("consumes fresh live running records with the actual macOS foreground metadata shape", () => {
    const f = fixture([]);
    f.parent.pids = piForegroundPids([{ pid: 12345, argv0: "pi" }]);
    f.publish([record("live", { status: "running", completedAt: undefined })]);
    expect(readPiActivity(f.parent, f.state, now)).toMatchObject({ live: true, tasks: [{ status: "running" }] });
    f.parent.pids = piForegroundPids([{ pid: 12345, argv0: "zsh" }]);
    expect(readPiActivity(f.parent, f.state, now).live).toBe(false);
  });
  it("validates record shapes without importing a service or accepting native paths as ids", () => {
    expect(piRunRecord(record())).toEqual(record());
    expect(piRunRecord(record("../escape"))).toBeNull();
    expect(piRunRecord(record("x", { startedAt: Infinity }))).toBeNull();
    expect(piRunRecord(record("x", { completedAt: -1 }))).toBeNull();
    expect(piRunRecord({ ...record(), status: "invented" })).toBeNull();
  });
  it("reconstructs terminal records with opaque child references, no native metadata", () => {
    const f = fixture();
    const result = readPiActivity(f.parent, f.state, now);
    expect(result.live).toBe(false);
    expect(result.tasks[0]).toMatchObject({ status: "completed", title: "Read parser", tool_calls: 2, detail_id: piTaskId(f.parent.path, "child") });
    expect(JSON.stringify(result.tasks)).not.toContain(f.child);
    expect(JSON.stringify(result.tasks)).not.toContain("child-session");
  });
  it.skipIf(process.platform === "win32")("uses fresh exact-process snapshots for running, queued and resumed children", () => {
    const f = fixture();
    f.publish([record("child", { status: "running", completedAt: undefined, outputFile: f.child }), record("queued", { status: "queued", completedAt: undefined })]);
    const result = readPiActivity(f.parent, f.state, now);
    expect(result.live).toBe(true);
    expect(result.tasks.map((t) => [t.status, t.phase])).toEqual([["running", undefined], ["running", "queued"]]);
    f.publish([record("child", { status: "error" })]);
    expect(readPiActivity(f.parent, f.state, now).tasks[0]?.status).toBe("failed");
  });
  it.each([
    { updatedAt: now - PI_ACTIVITY_TTL_MS - 1 }, { updatedAt: now + 1001 }, { pid: 22222 },
    { parentSessionId: "sibling" }, { parentFile: "/other/session.jsonl" }, { version: 99 },
  ])("rejects stale, wrong-runtime and wrong-parent snapshots: %j", (extra) => {
    const f = fixture([record("child", { status: "running", completedAt: undefined })]);
    f.publish([record("child", { status: "running", completedAt: undefined })], extra);
    expect(readPiActivity(f.parent, f.state, now)).toMatchObject({ live: false, tasks: [{ status: "lost", phase: "unknown", ended_at: null }] });
  });
  it("an unanswered background launch is unknown even if its parent process is alive", () => {
    const f = fixture([]);
    writeFileSync(f.parent.path, lines([
      { type: "session", id: f.parent.id },
      { type: "message", id: "launch", parentId: null, timestamp: new Date(now).toISOString(), message: { role: "toolResult", toolName: "subagent", details: { agentId: "job" }, content: [{ type: "text", text: `Agent started in background.\nAgent ID: job\nDescription: Read things\nOutput file: ${f.child}\n` }] } },
    ]));
    expect(readPiActivity(f.parent, f.state, now).tasks).toMatchObject([{ title: "Read things", phase: "unknown", status: "lost" }]);
  });
  it("only follows the active entry branch and lets the last resumed record win", () => {
    const f = fixture([]);
    writeFileSync(f.parent.path, lines([
      { type: "session", id: f.parent.id },
      { type: "custom", id: "a", parentId: null, customType: "subagents:record", data: record("job", { status: "error" }) },
      { type: "custom", id: "abandoned", parentId: "a", customType: "subagents:record", data: record("side") },
      { type: "custom", id: "resumed", parentId: "a", customType: "subagents:record", data: record("job") },
    ]));
    expect(readPiActivity(f.parent, f.state, now).tasks).toMatchObject([{ status: "completed" }]);
    expect(readPiActivity(f.parent, f.state, now).tasks).toHaveLength(1);
  });
  it.skipIf(process.platform === "win32")("rejects public or malformed observer receipts rather than repairing them", () => {
    const f = fixture([record("child", { status: "running", completedAt: undefined })]);
    f.publish([record()]); chmodSync(f.snapshotFile, 0o644);
    expect(readPiActivity(f.parent, f.state, now).live).toBe(false);
    chmodSync(f.snapshotFile, 0o600); writeFileSync(f.snapshotFile, "{torn");
    expect(readPiActivity(f.parent, f.state, now).live).toBe(false);
  });
});

describe("Pi activity status is presentation, not native input authority", () => {
  it.skipIf(process.platform === "win32")("counts running/queued children, expires missing liveness and preserves Main status", async () => {
    const f = fixture();
    const frames: number[] = [];
    const tracker = new PiSubagentStatus(f.state, (_pane, count) => frames.push(count), async () => f.parent);
    const pane = { pane_id: "p", agent: "pi", agent_status: "done" } as HerdrPane;
    f.publish([record("child", { status: "running", completedAt: undefined }), record("queued", { status: "queued", completedAt: undefined })]);
    await tracker.refresh([pane]);
    expect(tracker.countOf("p")).toBe(2);
    expect(tracker.waiting("p")).toBe(true);
    expect(pane.agent_status).toBe("done");
    f.publish([], { updatedAt: now - PI_ACTIVITY_TTL_MS - 1 });
    await tracker.refresh([pane]);
    expect(tracker.countOf("p")).toBe(0);
    expect(tracker.waiting("p")).toBe(false);
    expect(frames).toEqual([2, 0]);
    tracker.stop();
  });
  it("drops the previous Pi count when a pane changes provider", async () => {
    const f = fixture();
    const tracker = new PiSubagentStatus(f.state, () => {}, async () => f.parent);
    await tracker.refresh([{ pane_id: "p", agent: "pi", agent_status: "working" } as HerdrPane]);
    await tracker.refresh([{ pane_id: "p", agent: "claude", agent_status: "idle" } as HerdrPane]);
    expect(tracker.countOf("p")).toBe(0);
    tracker.stop();
  });
  it("does not resurrect state from a late lookup after the server stops", async () => {
    const f = fixture();
    let release!: (parent: PiParent) => void;
    const tracker = new PiSubagentStatus(f.state, () => { throw new Error("Late status broadcast"); }, () => new Promise((resolve) => { release = resolve; }));
    const read = tracker.refresh([{ pane_id: "p", agent: "pi", agent_status: "idle" } as HerdrPane]);
    tracker.stop(); release(f.parent); await read;
    expect(tracker.countOf("p")).toBe(0);
  });
});

describe("Pi read-only child route", () => {
  const request = (id: string, method = "GET", suffix = "") => new Request(`http://localhost/api/pane/pi-subagent?pane_id=p&id=${id}${suffix}`, { method });
  it("reads only the parent's named child and uses private no-store responses", async () => {
    const f = fixture();
    const response = await piSubagentResponse(request(piTaskId(f.parent.path, "child")), f.state, async () => f.parent);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json() as { turns: unknown[]; bounds: { has_earlier: boolean; showing_latest: boolean; incomplete: boolean; omitted_turns: number }; freshness: { read_at: string; transcript_updated_at: string | null; revision: string; observer_live: boolean } };
    const text = JSON.stringify(result);
    expect(text).toContain("Parser inspected");
    expect(result.bounds).toEqual({ has_earlier: false, showing_latest: true, incomplete: false, omitted_turns: 0 });
    expect(Number.isFinite(Date.parse(result.freshness.read_at))).toBe(true);
    expect(Number.isFinite(Date.parse(result.freshness.transcript_updated_at!))).toBe(true);
    expect(result.freshness.revision.length).toBeGreaterThan(0);
    expect(result.freshness.observer_live).toBe(false);
    expect(text).not.toContain(f.child);
    expect(text).not.toContain("child-session");
  });
  it("rejects mutation, raw paths, sibling ids and a rebound parent", async () => {
    const f = fixture();
    const resolve = async () => f.parent;
    expect((await piSubagentResponse(request(piTaskId(f.parent.path, "child"), "POST"), f.state, resolve)).status).toBe(400);
    expect((await piSubagentResponse(request(encodeURIComponent(f.child)), f.state, resolve)).status).toBe(400);
    expect((await piSubagentResponse(request(piTaskId("another-parent", "child")), f.state, resolve)).status).toBe(404);
    let calls = 0;
    const rebound = await piSubagentResponse(request(piTaskId(f.parent.path, "child")), f.state, async () => calls++ ? { ...f.parent, id: "replacement" } : f.parent);
    expect(rebound.status).toBe(409);
    expect((await rebound.json()).error.code).toBe("subagent_changed");
  });
  it("requires both child directory containment and native parent identity", () => {
    const f = fixture();
    expect(piChildPath(f.parent, f.child)).toBe(f.child);
    expect(piChildPath(f.parent, f.parent.path)).toBeNull();
    writeFileSync(f.child, lines([{ type: "session", id: "child", parentSession: "somebody-else" }]));
    expect(piChildPath(f.parent, f.child)).toBeNull();
    expect(piSessionHeader(join(root, "absent"))).toBeNull();
  });
  it.skipIf(process.platform === "win32")("refuses a linked child pointing into a sibling session", () => {
    const f = fixture(); const other = fixture();
    const link = join(f.child, "..", "link.jsonl"); symlinkSync(other.child, link);
    expect(piChildPath(f.parent, link)).toBeNull();
  });
  it("rejects a cursor from another child as changed, not as an empty transcript", async () => {
    const f = fixture();
    const response = await piSubagentResponse(request(piTaskId(f.parent.path, "child"), "GET", "&before=invalid"), f.state, async () => f.parent);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("subagent_changed");
  });
  it("permits the exact machine read route, not child controls", () => {
    expect(MACHINE_PROXY_PATH.test("pane/pi-subagent")).toBe(true);
    expect(MACHINE_PROXY_PATH.test("pane/pi-subagent/stop")).toBe(false);
  });
  it("adds a Chat drill-down ref and strips runtime output pointers without mutating shared turns", () => {
    const f = fixture();
    const original = [{ role: "assistant" as const, ts: null, parts: [{ kind: "tool" as const, name: "subagent", summary: "Read things", input: "{}", output: `Agent ID: child\nOutput file: ${f.child}\nUseful result` }] }];
    const result = piSubagentTurns(original, f.parent.path);
    expect(result[0]?.parts[0]).toMatchObject({ subagent_id: piTaskId(f.parent.path, "child"), output: "Agent ID: child\nUseful result" });
    expect(original[0]?.parts[0]?.output).toContain(f.child);
  });
});
