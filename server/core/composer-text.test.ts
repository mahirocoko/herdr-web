import { expect, it } from "bun:test";
import { pendingText } from "./composer.ts";

it("preserves pending-text normalization, whitespace, Unicode and the existing character limit", () => {
  expect(pendingText("  ไทย😀\r\nsecond\rthird\r\n\n")).toBe("  ไทย😀\nsecond\nthird");
  expect(pendingText("x \t\r\n")).toBe("x \t");
  expect(pendingText("x".repeat(20_000))).toHaveLength(20_000);
  expect(pendingText("x" + "\r\n".repeat(19_998) + "x")).toHaveLength(20_000);
  expect(() => pendingText("x".repeat(20_001))).toThrow("at most 20000");
  expect(() => pendingText("x" + "\r\n".repeat(19_999) + "x")).toThrow("at most 20000");
  for (const text of ["", "\r\n", " \t\r\n", "x\u0000", "x\u001b[200~", "x\u007f", "x\u0085"]) {
    expect(() => pendingText(text)).toThrow("A pending chat message");
  }
});

it("processes megabytes of trailing or internal newlines without regex backtracking", () => {
  expect(pendingText("ไทย" + "\r\n".repeat(1_000_000))).toBe("ไทย");
  expect(() => pendingText("x" + "\n".repeat(2_000_000) + "x")).toThrow("at most 20000");
  expect(() => pendingText("\r\n".repeat(1_000_000))).toThrow("nonempty");
}, 2_000);
