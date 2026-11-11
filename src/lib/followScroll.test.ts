import { describe, expect, test } from "bun:test";

import { dropPendingListScroll, followGlides } from "./followScroll.ts";

test("reading supersedes a list scroll with a stable absent-row sentinel, never a new destination", () => {
  const requests: Array<{ item: unknown; animated?: boolean }> = [];
  const list = { scrollToItem: async (request: { item: unknown; animated?: boolean }) => { requests.push(request); } };
  dropPendingListScroll(null);
  dropPendingListScroll(list);
  dropPendingListScroll(list);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.item).toBe(requests[1]?.item);
  expect(requests[0]?.animated).toBe(false);
});

describe("followGlides", () => {
  test("glides only while a turn works", () => {
    expect(followGlides({ working: true, reducedMotion: false })).toBe(true);
    expect(followGlides({ working: false, reducedMotion: false })).toBe(false);
  });
  test("reduced motion stays instant", () => {
    expect(followGlides({ working: true, reducedMotion: true })).toBe(false);
  });
  test("a layout the reader changed stays instant", () => {
    expect(followGlides({ working: true, reducedMotion: false, manualLayout: true })).toBe(false);
  });
});
