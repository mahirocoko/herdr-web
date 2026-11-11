import { afterEach, expect, it, spyOn } from "bun:test";
import { PaneWatch } from "./watch.ts";

const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });

function fixture() {
  const signals: Array<string | number | undefined> = [];
  const forced = Promise.withResolvers<void>();
  const { promise: exited, resolve } = Promise.withResolvers<number>();
  let out!: ReadableStreamDefaultController<Uint8Array>;
  let err!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled: string[] = [];
  const proc = {
    exited,
    stdout: new ReadableStream<Uint8Array>({ start(controller) { out = controller; }, cancel() { cancelled.push("out"); } }),
    stderr: new ReadableStream<Uint8Array>({ start(controller) { err = controller; }, cancel() { cancelled.push("err"); } }),
    kill: (signal?: string | number) => { signals.push(signal); if (signal === "SIGKILL") forced.resolve(); },
  };
  const spawn = spyOn(Bun, "spawn").mockReturnValue(proc as unknown as ReturnType<typeof Bun.spawn>);
  restores.push(() => spawn.mockRestore());
  const frames: string[] = [];
  const ended = Promise.withResolvers<void>();
  let ends = 0;
  const watch = new PaneWatch({ paneId: "fixture", cols: 80, rows: 24, socketPath: "/fixture.sock", killGraceMs: 10,
    onFrame: (data) => frames.push(data), onEnd: () => { ends++; ended.resolve(); } });
  return { watch, signals, cancelled, out, err, frames, forced: forced.promise, ended: ended.promise, ends: () => ends, exit: resolve };
}
const encode = (text: string) => new TextEncoder().encode(text);
const frame = (text: string) => encode(`${JSON.stringify({ type: "terminal.frame", encoding: "ansi", bytes: Buffer.from(text).toString("base64") })}\n`);

it("uses observe with ignored stdin and escalates a stuck stop once", async () => {
  const f = fixture();
  f.watch.kill(); f.watch.kill();
  expect(f.signals).toEqual([undefined]);
  await f.forced;
  expect(f.signals).toEqual([undefined, "SIGKILL"]);
  f.out.enqueue(frame("ignored after stop"));
  f.exit(0);
  await f.watch.exited;
  expect(f.cancelled.sort()).toEqual(["err", "out"]);
  expect(f.frames).toEqual([]);
  expect(f.ends()).toBe(0);
});

it("clears the force-kill timer on exit and cancels descendant-held pipes", async () => {
  const f = fixture();
  f.watch.kill(); f.exit(0);
  await f.watch.exited;
  // fixed wait: prove the already-armed 10ms kill timer produces no signal after exit.
  await Bun.sleep(25);
  expect(f.signals).toEqual([undefined]);
  expect(f.cancelled.sort()).toEqual(["err", "out"]);
});

it("a natural exit drains the final frame but bounds inherited open pipes", async () => {
  const f = fixture();
  f.out.enqueue(frame("last")); f.exit(0);
  await f.watch.exited;
  expect(f.frames).toEqual(["last"]);
  expect(f.cancelled.sort()).toEqual(["err", "out"]);
  expect(f.ends()).toBe(1);
  expect(f.signals).toEqual([]);
});

it("terminal.closed notifies once, stops the child and releases its pipes after exit", async () => {
  const f = fixture();
  f.out.enqueue(encode('{"type":"terminal.closed"}\n'));
  await f.ended;
  expect(f.ends()).toBe(1);
  expect(f.signals).toEqual([undefined]);
  f.exit(0);
  await f.watch.exited;
  expect(f.ends()).toBe(1);
  expect(f.cancelled.sort()).toEqual(["err", "out"]);
});

it("kill during the post-exit drain releases it immediately without signaling a gone child", async () => {
  const f = fixture();
  f.exit(0); await Promise.resolve();
  f.watch.kill();
  await f.watch.exited;
  expect(f.signals).toEqual([]);
  expect(f.cancelled.sort()).toEqual(["err", "out"]);
  expect(f.ends()).toBe(0);
});
