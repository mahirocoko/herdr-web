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
  describeWindowsPrivacyFailure,
  preparePrivateRuntimeTree,
  readPrivateConfiguration,
} from "./private-filesystem.ts";

// Worker stderr shape for a hypothetical default data-drive layout, not a
// measured host ACL.
function ancestorRefusal(path: string, sid = "S-1-5-11"): string {
  return [
    `Private filesystem refused: Untrusted ancestor replacement or ACL authority; path=${path}; sid=${sid}; mask=0x001301BF; blocked=0x00010000; flags=0x13; volumeRoot=False. No ACL repair attempted; runtime preparation stopped.`,
    "at Assert-Descriptor, <No file>: line 44",
    "at Assert-Chain, <No file>: line 61",
  ].join("\r\n");
}
const stdoutSentinel = "stdout-config-sentinel-not-a-real-key";
const runtime = "D:\\works\\herdr-web\\.agent-state\\runtime\\upstream-v10700";
const profile = "C:\\Users\\me";

test("Windows ancestor refusal prints explicit recovery instructions, never stdout", () => {
  const message = describeWindowsPrivacyFailure(
    Object.assign(new Error("Command failed"), {
      stderr: ancestorRefusal("D:\\works"),
      stdout: stdoutSentinel,
    }),
    "prepare",
    runtime,
    profile,
  );
  expect(message).toStartWith(
    "Native Windows privacy check failed; no POSIX fallback: Private filesystem refused: Untrusted ancestor replacement or ACL authority; path=D:\\works; sid=S-1-5-11;",
  );
  expect(message).toContain(
    "Recovery: the ACL grants Authenticated Users (S-1-5-11) access bits blocked by the privacy policy on D:\\works.",
  );
  expect(message).toContain("Nothing was created and no ACL was changed.");
  expect(message).toContain('icacls "D:\\works"');
  for (const line of [
    '  git -C "D:\\works\\herdr-web" status --short',
    '  git -C "D:\\works\\herdr-web" remote get-url origin',
    '  git clone "REPLACE_WITH_YOUR_ORIGIN_URL" "C:\\Users\\me\\src\\herdr-web"',
    '  pushd "C:\\Users\\me\\src\\herdr-web"',
    "  bun scripts/bun-project.mjs install --frozen-lockfile",
    "  bun run start",
  ])
    expect(message).toContain(line);
  expect(message).toContain(
    "replace REPLACE_WITH_YOUR_ORIGIN_URL with the origin URL before running git clone",
  );
  expect(message).toContain("Do not continue if clone or install fails.");
  expect(message).not.toContain("status --short   (");
  expect(message).not.toContain("<origin URL>");
  expect(message).not.toContain(stdoutSentinel);
  expect(message).not.toMatch(/chmod|WSL|\/(?:grant|remove|reset|inherit)/i);
  const unmarked = describeWindowsPrivacyFailure(
    { stderr: ancestorRefusal("D:\\works") },
    "prepare",
    "D:\\works\\state",
    profile,
  );
  expect(unmarked).toContain(
    'git clone "REPLACE_WITH_YOUR_ORIGIN_URL" "C:\\Users\\me\\src\\',
  );
  expect(unmarked).not.toContain("git -C");
});

test("Windows ancestor recovery never suggests relocating under a profile that shares the blocked folder", () => {
  for (const [ancestor, relation] of [
    ["C:\\", "above"],
    ["c:\\users", "above"],
    ["C:\\Users\\ME", "inside"],
    ["C:\\Users\\me\\works", "inside"],
  ] as const) {
    const message = describeWindowsPrivacyFailure(
      { stderr: Buffer.from(ancestorRefusal(ancestor)) },
      "prepare",
      "C:\\Users\\me\\works\\herdr-web\\.agent-state\\runtime\\upstream-v10700",
      profile,
    );
    expect(message).toContain(`privacy policy on ${ancestor}.`);
    expect(message).not.toContain("can rename, delete or re-permission");
    expect(message).toContain(
      "no rename or permission change was demonstrated",
    );
    expect(message).toContain(`This folder is ${relation} your profile`);
    expect(message).not.toContain("git clone");
  }
});

test("Windows privacy failures other than a structured prepare ancestor refusal stay unchanged", () => {
  const prefix = "Native Windows privacy check failed; no POSIX fallback: ";
  const legacy =
    "Private filesystem refused: Untrusted ancestor replacement or ACL authority\r\nat Assert-Descriptor, <No file>: line 43";
  const owner =
    "Private filesystem refused: Unrecognized protected path owner S-1-5-21-1 at D:\\works; no ACL repair attempted";
  const refusal = ancestorRefusal("D:\\works");
  const invalid = "Invalid native privacy response";
  for (const [error, operation, home, native] of [
    [{ stderr: refusal }, "read", profile, refusal],
    [{ stderr: refusal }, "prepare", undefined, refusal],
    [{ stderr: refusal }, "prepare", "relative\\home", refusal],
    [{ stderr: legacy }, "prepare", profile, legacy],
    [{ stderr: owner }, "prepare", profile, owner],
    [new Error(invalid), "prepare", profile, invalid],
    [
      new Error("spawn failed\nsecond line"),
      "prepare",
      profile,
      "spawn failed",
    ],
    [{ stdout: stdoutSentinel }, "read", profile, "unknown failure"],
  ] as const) {
    const message = describeWindowsPrivacyFailure(
      error,
      operation,
      runtime,
      home,
    );
    expect(message).toBe(prefix + native);
    expect(message).not.toContain("Recovery:");
    expect(message).not.toContain(stdoutSentinel);
  }
  const hidden = { stderr: "x".repeat(1024) + refusal };
  expect(
    describeWindowsPrivacyFailure(hidden, "prepare", runtime, profile),
  ).toBe(prefix + "x".repeat(1024));
});

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
