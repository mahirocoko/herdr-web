import { expect, it, spyOn } from "bun:test";
import type { DeviceStore } from "../devices.ts";
import type { PendingInputs } from "../pending-input.ts";
import type { PaneWatchOptions } from "../watch.ts";
import { type Client, connectionData, createConnections } from "./connections.ts";

function watching() {
  const started: Array<{ paneId: string; cols: number; killed: number; exit: () => Promise<void>; options: PaneWatchOptions }> = [];
  const frames: Array<{ type: string; pane_id?: string }> = [];
  let failNext = false;
  const client = {
    data: connectionData({ deviceId: undefined, readOnly: true }),
    close() {}, getBufferedAmount: () => 0,
    send: (raw: string) => { frames.push(JSON.parse(raw)); return raw.length; },
  } as unknown as Client;
  const connections = createConnections({
    clients: new Set([client]), present: new Set([client]),
    pending: { close() {} } as unknown as PendingInputs<Client, never>,
    devices: {} as DeviceStore, detachClaimed() {}, dropClaims() {},
    startWatch: (options) => {
      if (failNext) { failNext = false; throw new Error("fixture spawn failure"); }
      const { promise, resolve } = Promise.withResolvers<void>();
      const process = { paneId: options.paneId, cols: options.cols, killed: 0, options, exit: async () => { resolve(); await promise; await Promise.resolve(); } };
      started.push(process);
      return { kill: () => { process.killed++; }, exited: promise };
    },
  });
  return { client, frames, started, fail: () => { failNext = true; }, ...connections };
}
const GRID = { cols: 80, rows: 24 };

it("caps live and exiting processes at 64, including rapid watch/unwatch churn", async () => {
  const w = watching();
  for (let n = 0; n < 64; n++) w.watchPane(w.client, `p${n}`, GRID);
  w.watchPane(w.client, "overflow", GRID);
  expect(w.started).toHaveLength(64);
  expect(w.frames).toEqual([{ type: "watch-end", pane_id: "overflow" }]);
  w.end(w.client, "closed");
  expect(w.started.every((process) => process.killed === 1)).toBe(true);
  w.watchPane(w.client, "closed", GRID);
  expect(w.started).toHaveLength(64);
  for (const process of w.started) await process.exit();
  expect(w.started).toHaveLength(64);

  const churn = watching();
  for (let n = 0; n < 3000; n++) {
    churn.watchPane(churn.client, `p${n}`, GRID);
    churn.unwatchPane(churn.client, `p${n}`);
  }
  expect(churn.started).toHaveLength(64);
  for (const process of churn.started) await process.exit();
  expect(churn.started).toHaveLength(64);
});

it("coalesces resize and unwatch/rewatch until exit, keeping only the latest grid", async () => {
  const w = watching();
  w.watchPane(w.client, "pane", GRID);
  for (let cols = 81; cols <= 400; cols++) w.watchPane(w.client, "pane", { cols, rows: 24 });
  expect(w.started.map((process) => [process.cols, process.killed])).toEqual([[80, 1]]);
  w.started[0]!.options.onFrame("stale");
  expect(w.frames).toEqual([]);
  await w.started[0]!.exit();
  expect(w.started.map((process) => process.cols)).toEqual([80, 400]);
  for (let cols = 81; cols <= 300; cols++) {
    w.unwatchPane(w.client, "pane");
    w.watchPane(w.client, "pane", { cols, rows: 24 });
  }
  expect(w.started[1]!.killed).toBe(1);
  await w.started[1]!.exit();
  expect(w.started.map((process) => process.cols)).toEqual([80, 400, 300]);
  expect(w.frames).toEqual([]);
});

it("queues only available logical slots FIFO and updates the last waiting grid", async () => {
  const w = watching();
  for (let n = 0; n < 64; n++) w.watchPane(w.client, `p${n}`, GRID);
  w.unwatchPane(w.client, "p0"); w.unwatchPane(w.client, "p1");
  w.watchPane(w.client, "a", GRID); w.watchPane(w.client, "b", GRID);
  w.watchPane(w.client, "b", { cols: 100, rows: 30 });
  w.watchPane(w.client, "p0", GRID); // Must not reclaim a slot already promised to a waiting pane.
  w.watchPane(w.client, "c", GRID);
  expect(w.started).toHaveLength(64);
  expect(w.frames).toEqual([{ type: "watch-end", pane_id: "p0" }, { type: "watch-end", pane_id: "c" }]);
  await w.started[0]!.exit(); await w.started[1]!.exit();
  expect(w.started.slice(64).map((process) => [process.paneId, process.cols])).toEqual([["a", 80], ["b", 100]]);
});

it("a canceled pane requested anew does not overtake an older queued view", async () => {
  const w = watching();
  for (let n = 0; n < 64; n++) w.watchPane(w.client, `p${n}`, GRID);
  w.unwatchPane(w.client, "p0"); w.unwatchPane(w.client, "p1");
  w.watchPane(w.client, "a", GRID);
  w.watchPane(w.client, "p1", { cols: 90, rows: 30 });
  await w.started[1]!.exit();
  expect(w.started.slice(64).map((process) => process.paneId)).toEqual(["a"]);
  await w.started[0]!.exit();
  expect(w.started.slice(64).map((process) => [process.paneId, process.cols])).toEqual([["a", 80], ["p1", 90]]);
});

it("forgets waiting views on unwatch and on each connection-ending path", async () => {
  for (const reason of ["closed", "stalled", "revoked"] as const) {
    const w = watching();
    for (let n = 0; n < 64; n++) w.watchPane(w.client, `p${n}`, GRID);
    w.unwatchPane(w.client, "p0"); w.watchPane(w.client, "a", GRID);
    w.unwatchPane(w.client, "a");
    await w.started[0]!.exit();
    expect(w.started).toHaveLength(64);
    w.watchPane(w.client, "a", GRID);
    w.unwatchPane(w.client, "p1"); w.watchPane(w.client, "b", GRID);
    w.watchPane(w.client, "p2", { cols: 90, rows: 30 });
    w.end(w.client, reason);
    await w.started[1]!.exit(); await w.started[2]!.exit();
    w.watchPane(w.client, "after-close", GRID);
    expect(w.started).toHaveLength(65);
  }
});

it("notifies natural end once, retaining its process slot until exit", async () => {
  const w = watching();
  w.watchPane(w.client, "pane", GRID);
  w.started[0]!.options.onEnd(); w.started[0]!.options.onEnd();
  expect(w.frames).toEqual([{ type: "watch-end", pane_id: "pane" }]);
  w.watchPane(w.client, "pane", { cols: 100, rows: 30 });
  expect(w.started).toHaveLength(1);
  await w.started[0]!.exit();
  expect(w.started.map((process) => process.cols)).toEqual([80, 100]);
  await w.started[1]!.exit(); // A crash with no stream end still notifies the page.
  expect(w.frames).toEqual([{ type: "watch-end", pane_id: "pane" }, { type: "watch-end", pane_id: "pane" }]);
});

it("a replacement spawn failure ends the view and leaves its slot reusable", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const w = watching();
    w.watchPane(w.client, "pane", GRID); w.watchPane(w.client, "pane", { cols: 90, rows: 30 });
    w.fail(); await w.started[0]!.exit();
    expect(w.frames).toEqual([{ type: "watch-end", pane_id: "pane" }]);
    w.watchPane(w.client, "pane", GRID);
    expect(w.started).toHaveLength(2);
  } finally { warn.mockRestore(); }
});
