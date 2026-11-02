// Fork privacy tests for the opt-in adapter; no hc/native process is started.
import { afterEach, expect, it } from "bun:test";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtime, startRuntime } from "./runtime.ts";

const previousRuntime = process.env["OVIS_RUNTIME"];
const previousSocket = process.env["HERDR_SOCKET"];
const platform = process.platform;
let cleanup = () => { };
afterEach(() => {
  cleanup(); cleanup = () => { };
  Object.defineProperty(process, "platform", { value: platform });
  if (previousRuntime === undefined) delete process.env["OVIS_RUNTIME"];
  else process.env["OVIS_RUNTIME"] = previousRuntime;
  if (previousSocket === undefined) delete process.env["HERDR_SOCKET"];
  else process.env["HERDR_SOCKET"] = previousSocket;
});

function directory() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "fork-core-runtime-")));
  cleanup = () => rmSync(dir, { recursive: true, force: true });
  return dir;
}

it("keeps the old runtime by default without touching state or socket", async () => {
  for (const value of [undefined, "", "herdr"]) {
    if (value === undefined) delete process.env["OVIS_RUNTIME"];
    else process.env["OVIS_RUNTIME"] = value;
    expect(runtime()).toBe("herdr");
    expect(await startRuntime("/not/a/runtime/directory")).toBeNull();
    expect(process.env["HERDR_SOCKET"]).toBe(previousSocket);
  }
});

it("refuses an unknown runtime and Windows without fallback or state creation", async () => {
  process.env["OVIS_RUNTIME"] = "typo";
  await expect(startRuntime("/not/a/runtime/directory")).rejects.toThrow("Unknown");
  process.env["OVIS_RUNTIME"] = "herdr-core";
  Object.defineProperty(process, "platform", { value: "win32" });
  await expect(startRuntime("/not/a/runtime/directory")).rejects.toThrow("Windows");
});

it.skipIf(platform === "win32")("publishes an owner-only socket and restores the old socket on idempotent shutdown", async () => {
  const dir = directory();
  process.env["OVIS_RUNTIME"] = "herdr-core";
  process.env["HERDR_SOCKET"] = "/previous/herdr.sock";
  const adapter = await startRuntime(dir);
  expect(adapter).not.toBeNull();
  try {
    expect(lstatSync(adapter!.socketPath).isSocket()).toBe(true);
    expect(lstatSync(adapter!.socketPath).mode & 0o777).toBe(0o600);
    expect(process.env["HERDR_SOCKET"]).toBe(adapter!.socketPath);
  } finally { adapter!.stop(); adapter!.stop(); }
  expect(process.env["HERDR_SOCKET"]).toBe("/previous/herdr.sock");
});

it.skipIf(platform === "win32")("refuses broad state permissions and symlinks without repairing unknown work", async () => {
  const dir = directory();
  process.env["OVIS_RUNTIME"] = "herdr-core";
  chmodSync(dir, 0o755);
  await expect(startRuntime(dir)).rejects.toThrow("owner-only");
  expect(lstatSync(dir).mode & 0o777).toBe(0o755);
  chmodSync(dir, 0o700);
  const link = join(dir, "linked");
  symlinkSync(dir, link);
  await expect(startRuntime(link)).rejects.toThrow("owner-only");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  const socket = join(dir, "herdr-core.sock");
  writeFileSync(socket, "unknown work", { mode: 0o600 });
  await expect(startRuntime(dir)).rejects.toThrow("occupied");
  expect(readFileSync(socket, "utf8")).toBe("unknown work");
});
