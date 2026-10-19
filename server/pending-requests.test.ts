import { expect, it } from "bun:test";
import { PendingRequestBook } from "./pending-requests.ts";

it("keeps deduplication bounded while more than 256 completed requests continue", async () => {
  const book = new PendingRequestBook<number>(); let calls = 0;
  for (let id = 1; id <= 1000; id++) expect(await book.run(id, String(id), async () => { calls++; return id; })).toBe(id);
  expect(book.size).toBe(256); expect(calls).toBe(1000);
  expect(() => book.run(1, "1", async () => -1)).toThrow("older than");
  expect(await book.run(1000, "1000", async () => { calls++; return -1; })).toBe(1000); expect(calls).toBe(1000);
});

it("retains unresolved and pending-message identities instead of evicting them", async () => {
  const pinned = new Set([1]); const book = new PendingRequestBook<number>((value) => pinned.has(value), 2);
  await book.run(1, "first", async () => 1); await book.run(2, "second", async () => 2);
  await book.run(3, "third", async () => 3);
  expect(await book.run(1, "first", async () => -1)).toBe(1);
  expect(() => book.run(2, "second", async () => -1)).toThrow("older than");
  expect(book.size).toBe(2);
});

it("does not run a new task when all receipt slots are genuinely in flight", async () => {
  const book = new PendingRequestBook<number>(() => false, 1); let resolve!: (value: number) => void; let calls = 0;
  const first = book.run(1, "first", () => new Promise<number>((done) => { resolve = done; }));
  await Promise.resolve();
  expect(() => book.run(2, "second", async () => { calls++; return 2; })).toThrow("still active");
  expect(calls).toBe(0); resolve(1); await first;
  expect(await book.run(2, "second", async () => 2)).toBe(2);
});

it("rejects changed content on the same live receipt id", async () => {
  const book = new PendingRequestBook<number>(); await book.run(1, "first", async () => 1);
  expect(() => book.run(1, "different", async () => 2)).toThrow("another message");
});
