import { afterAll, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import observer, { piObserverSnapshot, piOwnedRuns, preparePiActivityDirectory } from "./pi-subagents-extension.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-pi-observer-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const parent = join(root, "parent.jsonl");
writeFileSync(parent, "{}\n");
const owner = { getSessionFile: () => parent, getSessionId: () => "parent" };
const run = (id: string, status = "running") => ({ id, type: "Explore", description: "Inspect source", status, startedAt: 10, toolUses: 1 });

it("publishes only admitted facts, never prompts, result payloads, auth or live service objects", () => {
  const snapshot = piObserverSnapshot(owner, [{ ...run("job"), prompt: "PRIVATE", result: "PRIVATE", modelRegistry: { auth: "PRIVATE" } }], 20, 123);
  expect(snapshot).toMatchObject({ version: 1, parentFile: parent, parentSessionId: "parent", updatedAt: 20, pid: 123, records: [run("job")] });
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE");
});
it("never silently truncates active children to fit its bounded receipt", () => {
  expect(piObserverSnapshot(owner, Array.from({ length: 25 }, (_, n) => run(`job${n}`)))).toBeNull();
  expect(piObserverSnapshot(owner, [{ ...run("job"), description: "a".repeat(1025) }])).toBeNull();
  expect(piObserverSnapshot(owner, [run("job"), run("job")])).toBeNull();
  const snapshot = piObserverSnapshot(owner, [...Array.from({ length: 30 }, (_, n) => run(`ended${n}`, "completed")), run("active")]);
  expect(snapshot?.records).toHaveLength(24);
  expect(snapshot?.records[0]?.id).toBe("active");
});
it("returns no snapshot for an unwritten parent", () => {
  expect(piObserverSnapshot({ ...owner, getSessionFile: () => undefined }, [])).toBeNull();
});
it("uses exact SDK owner identity and refuses a sibling/global service", () => {
  const key = Symbol.for("pi-subagents.session-owner-registry.v1");
  const globalKey = Symbol.for("@gotgenes/pi-subagents:service");
  const host = globalThis as Record<symbol, unknown>;
  const before = host[key], globalBefore = host[globalKey];
  try {
    host[globalKey] = { listAgents: () => [run("wrong")] };
    host[key] = undefined;
    expect(piOwnedRuns(owner)).toBeUndefined();
    host[key] = { protocol: "pi-subagents.session-owner", version: 1, get: (o: object) => o === owner ? { listAgents: () => [run("own")] } : undefined };
    expect(piOwnedRuns(owner)).toEqual([run("own")]);
    expect(piOwnedRuns({ ...owner })).toBeUndefined();
  } finally { if (before === undefined) delete host[key]; else host[key] = before; if (globalBefore === undefined) delete host[globalKey]; else host[globalKey] = globalBefore; }
});
it("the factory registers lifecycle observation only, and starts no timer/input/tool at load", () => {
  const names: string[] = [];
  observer({ on: (event) => { names.push(event); } });
  expect(names).toEqual(["session_start", "session_shutdown"]);
});
it("refuses unrelated observer directories without creating or repairing them", () => {
  expect(() => preparePiActivityDirectory(root)).toThrow();
});
