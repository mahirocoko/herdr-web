import { expect, test } from "bun:test";
import { chatReadDeadlineMs, withChatReadDeadline } from "./chatReadDeadline.ts";
import { ConversationRefresh } from "./conversationRefresh.ts";

test("a stalled header aborts and releases the serialized reader", async () => {
  let signal: AbortSignal | undefined;
  await expect(withChatReadDeadline((next) => { signal = next; return new Promise(() => {}); }, 10)).rejects.toThrow("timed out");
  expect(signal?.aborted).toBe(true);
  expect(await withChatReadDeadline(async () => "next read", 10)).toBe("next read");
});

test("the same deadline covers the body and ignores a late result", async () => {
  let resolve!: (value: string) => void;
  const late = new Promise<string>((done) => { resolve = done; });
  const read = withChatReadDeadline(async () => { await Promise.resolve("headers"); return await late; }, 10);
  await expect(read).rejects.toThrow("timed out");
  resolve("obsolete");
  expect(await withChatReadDeadline(async () => "current", 10)).toBe("current");
});

test("success and HTTP failures preserve the original result or error", async () => {
  const error = new Error("HTTP 401");
  await expect(withChatReadDeadline(async () => { throw error; }, 10)).rejects.toBe(error);
  const result = { turns: [] };
  expect(await withChatReadDeadline(async () => result, 10)).toBe(result);
});

test("a remote PC's read, which crosses the machine proxy, waits twice as long as a local one", () => {
  expect(chatReadDeadlineMs("local")).toBe(15_000);
  expect(chatReadDeadlineMs("studio-mac")).toBe(30_000);
});

test("a replaced screen releases an uncooperative read and aborts its transport", async () => {
  const screen = new AbortController();
  let transport: AbortSignal | undefined;
  const late = Promise.withResolvers<string>();
  const pending = withChatReadDeadline((signal) => { transport = signal; return late.promise; }, 30_000, screen.signal);
  screen.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(transport?.aborted).toBe(true);
  late.resolve("obsolete");
  let started = false;
  await expect(withChatReadDeadline(async () => { started = true; }, 10, screen.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(started).toBe(false);
});

test("screen replacement cancels a stalled read and starts a fresh one", async () => {
  const previous = globalThis.window;
  Object.assign(globalThis, { window: globalThis });
  const refresh = new ConversationRefresh();
  const began = Promise.withResolvers<void>();
  const next = Promise.withResolvers<void>();
  try {
    refresh.setRead(async (signal) => {
      try { await withChatReadDeadline(() => { began.resolve(); return new Promise(() => {}); }, 30_000, signal); }
      catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) throw error; }
    });
    refresh.refresh();
    await began.promise;
    refresh.stop();
    refresh.setRead(async () => { next.resolve(); });
    refresh.refresh();
    await withChatReadDeadline(() => next.promise, 500);
  } finally {
    refresh.stop();
    Object.assign(globalThis, { window: previous });
  }
});
