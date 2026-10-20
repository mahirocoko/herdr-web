import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, win32 } from "node:path";
import { tmpdir } from "node:os";
import {
  decodePrivacyResponse,
  preparePrivateRuntimeTree,
  readPrivateConfiguration,
} from "./private-filesystem.ts";

test("malformed native responses never echo private output into diagnostics", () => {
  const secret = "private-output-sentinel-not-a-real-key";
  for (const text of [secret, `{"bytes":"${secret}",`]) {
    try {
      decodePrivacyResponse(text, "read");
      throw new Error("malformed response unexpectedly accepted");
    } catch (error) {
      expect((error as Error).message).toBe("Invalid native privacy response");
      expect((error as Error).message).not.toContain(secret);
    }
  }
});

test("fixed PowerShell worker fits Windows CreateProcess command-line budget", () => {
  const source = readFileSync(
    new URL("./private-filesystem.ps1", import.meta.url),
    "utf8",
  );
  const executable = win32.join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  // Conservative executable escaping plus fixed flags/quoting, not just the
  // encoded script. stdin configuration never consumes command-line space.
  const budget =
    Buffer.from(source, "utf16le").toString("base64").length +
    2 * executable.length +
    256;
  expect(budget).toBeLessThan(32_767);
});

test("native response protocol rejects malformed, extra, wrong-operation and oversized results", () => {
  for (const text of [
    "",
    "null",
    "[]",
    "{}",
    '{"version":1,"operation":"read","status":"ready"}',
    '{"version":1,"operation":"read","status":"absent","extra":true}',
    '{"version":1,"operation":"read","status":"read","bytes":"!?"}',
  ])
    expect(() => decodePrivacyResponse(text, "read")).toThrow();
  expect(
    decodePrivacyResponse(
      '{"version":1,"operation":"read","status":"absent"}',
      "read",
    ),
  ).toBeNull();
  expect(
    decodePrivacyResponse(
      '{"version":1,"operation":"prepare","status":"ready"}',
      "prepare",
    ),
  ).toBeNull();
  expect(
    decodePrivacyResponse(
      JSON.stringify({
        version: 1,
        operation: "read",
        status: "read",
        bytes: Buffer.from('{"kept":true}').toString("base64"),
      }),
      "read",
    ),
  ).toBe('{"kept":true}');
  expect(() =>
    decodePrivacyResponse(
      JSON.stringify({
        version: 1,
        operation: "read",
        status: "read",
        bytes: Buffer.alloc(16_385).toString("base64"),
      }),
      "read",
    ),
  ).toThrow("oversized");
});

test.if(process.platform !== "win32")(
  "Unix helper preserves leaf/parent-only validation and immutable invalid legacy bytes",
  () => {
    const root = mkdtempSync(join(tmpdir(), "herdr-private-"));
    const mask = process.umask();
    try {
      chmodSync(root, 0o755); // Ancestor read access is deliberately unchanged on Unix.
      const parent = join(root, "private");
      mkdirSync(parent, { mode: 0o700 });
      const config = join(parent, "legacy.json");
      writeFileSync(config, '{"kept":true}', { mode: 0o600 });
      const original = readFileSync(config);
      expect(readPrivateConfiguration(config)).toEqual({ kept: true });
      expect(readFileSync(config)).toEqual(original);
      expect(statSync(config).mode & 0o777).toBe(0o600);
      chmodSync(parent, 0o755);
      expect(() => readPrivateConfiguration(config)).toThrow("not private");
      chmodSync(parent, 0o700);
      for (const invalid of ["[1]", "null", "not-json", " ".repeat(16_385)]) {
        writeFileSync(config, invalid);
        expect(() => readPrivateConfiguration(config)).toThrow();
        expect(readFileSync(config, "utf8")).toBe(invalid);
      }
      const state = join(parent, "state");
      preparePrivateRuntimeTree(state);
      expect(statSync(state).mode & 0o777).toBe(0o700);
      expect(process.umask()).toBe(0o077);
      const redirect = join(parent, "redirect");
      symlinkSync(state, redirect);
      expect(() => preparePrivateRuntimeTree(redirect)).toThrow("symlink");
    } finally {
      process.umask(mask);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
