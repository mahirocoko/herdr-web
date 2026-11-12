import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertControlAvailable, assertControlPlatform, localControlPath, privateControlDirectory, requestLocalStop, startLocalControl } from "./local-control.ts";
import { parseStopArgs } from "./stop-local.ts";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
});
const fixture = () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "web-control-")));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};
const raw = (path: string, text: string, timeout = 500): Promise<string> => new Promise((resolve, reject) => {
  let bytes = "";
  const timer = setTimeout(() => reject(new Error("fixture timeout")), timeout);
  void Bun.connect({ unix: path, socket: {
    open(socket) { socket.write(text); },
    data(_socket, data) { bytes += Buffer.from(data).toString(); },
    close() { clearTimeout(timer); resolve(bytes); },
    error(_socket, error) { clearTimeout(timer); reject(error); },
  } }).catch(reject);
});

test("stop help and unknown arguments do not touch runtime state", () => {
  expect(parseStopArgs([])).toEqual({ help: false });
  expect(parseStopArgs(["-h"])).toEqual({ help: true });
  for (const args of [["--pid=1"], ["--help", "--port=8787"], ["stop"]])
    expect(() => parseStopArgs(args)).toThrow("Unknown stop argument");
  for (const args of [["--help"], ["-h"], ["--help", "--unknown"]]) {
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "stop-local.ts"), ...args], { timeout: 5000 });
    expect(result.exitCode).toBe(args.includes("--unknown") ? 1 : 0);
    expect((args.includes("--unknown") ? result.stderr : result.stdout).toString())
      .toContain(args.includes("--unknown") ? "Unknown stop argument" : "Usage: bun run stop");
  }
  const alias = Bun.spawnSync([process.execPath, "run", "stop", "--help"], { cwd: join(import.meta.dir, ".."), timeout: 5000 });
  expect(alias.exitCode).toBe(0);
  expect(alias.stdout.toString()).toContain("Same-user cooperative boundary");
  expect(() => assertControlPlatform("win32")).toThrow("Ctrl-C");
});

describe.skipIf(process.platform !== "linux" && process.platform !== "darwin")("private local stop control", () => {
  test("stops its own instance once, removes own socket, and repeated stop is absent", async () => {
    const directory = fixture();
    let stops = 0;
    const stopped = Promise.withResolvers<void>();
    const control = startLocalControl(directory, () => { stops++; control.stop(); stopped.resolve(); });
    cleanups.push(() => control.stop());
    expect(lstatSync(localControlPath(directory)).mode & 0o777).toBe(0o600);
    expect(await requestLocalStop(directory)).toBe("stopping");
    await stopped.promise;
    expect(stops).toBe(1);
    expect(lstatSync(localControlPath(directory), { throwIfNoEntry: false })).toBeUndefined();
    control.stop();
    expect(await requestLocalStop(directory)).toBe("absent");
    expect(stops).toBe(1);
  });

  test("absent state/socket is read-only and never creates runtime directories", async () => {
    const directory = fixture();
    expect(await requestLocalStop(directory)).toBe("absent");
    const missing = join(directory, "missing", "runtime");
    expect(await requestLocalStop(missing)).toBe("absent");
    expect(lstatSync(join(directory, "missing"), { throwIfNoEntry: false })).toBeUndefined();
  });

  test("occupied regular, linked, live unknown and stale sockets stay unchanged", async () => {
    const directory = fixture();
    const path = localControlPath(directory);
    writeFileSync(path, "unknown");
    expect(() => assertControlAvailable(directory)).toThrow("occupied");
    await expect(requestLocalStop(directory)).rejects.toThrow("not an owner-private socket");
    expect(readFileSync(path, "utf8")).toBe("unknown");
    rmSync(path);
    symlinkSync(join(directory, "absent-target"), path);
    expect(() => assertControlAvailable(directory)).toThrow("occupied");
    await expect(requestLocalStop(directory)).rejects.toThrow();
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    rmSync(path);
    const unknown = Bun.listen({ unix: path, socket: { data(socket) { socket.end("unknown\n"); } } });
    cleanups.push(() => unknown.stop(true));
    chmodSync(path, 0o600);
    const before = lstatSync(path);
    expect(() => startLocalControl(directory, () => {})).toThrow("occupied");
    await expect(requestLocalStop(directory)).rejects.toThrow("not acknowledged");
    expect(lstatSync(path).ino).toBe(before.ino);
    // Make a stale fixture without stopping a real owner; stop only the fixture's original path.
    const stale = join(directory, "stale.sock");
    renameSync(path, stale);
    unknown.stop(true);
    renameSync(stale, path);
    await expect(requestLocalStop(directory)).rejects.toThrow("not acknowledged");
    expect(lstatSync(path).ino).toBe(before.ino);
  });

  test("malformed, extra, oversized and incomplete frames never invoke shutdown", async () => {
    const directory = fixture();
    let stops = 0;
    const control = startLocalControl(directory, () => { stops++; }, 50);
    cleanups.push(() => control.stop());
    for (const text of ["bad\n", '{"version":2,"command":"stop"}\n', '{"version":1,"command":"stop","pid":1}\n', '{"version":1,"command":"stop"}\nextra', "x".repeat(129), '{"version":1']) {
      expect(await raw(localControlPath(directory), text)).toBe("");
      expect(stops).toBe(0);
    }
  });

  test("lost-identity cleanup closes accepted clients and leaves the old listener inert", async () => {
    const directory = fixture();
    const path = localControlPath(directory);
    let stops = 0;
    const control = startLocalControl(directory, () => { stops++; });
    cleanups.push(() => control.stop());
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const peer = await Bun.connect({ unix: path, socket: {
      open() { opened.resolve(); },
      data() {},
      close() { closed.resolve(); },
    } });
    cleanups.push(() => peer.terminate());
    await opened.promise;
    // A later connection round-trip drains earlier accepts without a guessed settle delay.
    expect(await raw(path, "bad\n")).toBe("");
    const original = join(directory, "original.sock");
    renameSync(path, original);
    writeFileSync(path, "replacement");
    control.stop();
    await closed.promise;
    expect(await raw(original, '{"version":1,"command":"stop"}\n')).toBe("");
    expect(stops).toBe(0);
    expect(readFileSync(path, "utf8")).toBe("replacement");
  });

  test("private/canonical directory and socket modes are validated without repair", async () => {
    const directory = fixture();
    chmodSync(directory, 0o755);
    expect(() => privateControlDirectory(directory)).toThrow("owner-only");
    expect(() => startLocalControl(directory, () => {})).toThrow("owner-only");
    await expect(requestLocalStop(directory)).rejects.toThrow("owner-only");
    expect(lstatSync(directory).mode & 0o777).toBe(0o755);
    chmodSync(directory, 0o700);
    const alias = join(fixture(), "linked");
    symlinkSync(directory, alias);
    await expect(requestLocalStop(alias)).rejects.toThrow("owner-only");
    await expect(requestLocalStop(join(alias, "missing"))).rejects.toThrow("not canonical");
    const control = startLocalControl(directory, () => {});
    cleanups.push(() => control.stop());
    chmodSync(localControlPath(directory), 0o666);
    await expect(requestLocalStop(directory)).rejects.toThrow("owner-private socket");
    expect(lstatSync(localControlPath(directory)).mode & 0o777).toBe(0o666);
  });

  test("timeout and oversized/partial responses never report success or delete unknown socket", async () => {
    for (const response of ["", "x".repeat(129), '{"version":1,"status":"stopping"}']) {
      const directory = fixture();
      const path = localControlPath(directory);
      const peers = new Set<Bun.Socket>();
      const unknown = Bun.listen({ unix: path, socket: {
        open(socket) { peers.add(socket); },
        data(socket) { if (response) socket.write(response); },
      } });
      cleanups.push(() => { for (const peer of peers) peer.terminate(); unknown.stop(true); });
      chmodSync(path, 0o600);
      const before = lstatSync(path);
      await expect(requestLocalStop(directory, 50)).rejects.toThrow("not acknowledged");
      expect(lstatSync(path).ino).toBe(before.ino);
    }
  });

  for (const replacement of ["file", "symlink", "socket", "directory"]) {
    test(`cleanup preserves replaced ${replacement} identity and is idempotent`, () => {
      const directory = fixture();
      const path = localControlPath(directory);
      const control = startLocalControl(directory, () => {});
      cleanups.push(() => control.stop());
      if (replacement === "directory") {
        renameSync(directory, `${directory}.old`);
        cleanups.push(() => rmSync(`${directory}.old`, { recursive: true, force: true }));
        symlinkSync(`${directory}.old`, directory);
      } else {
        renameSync(path, join(directory, "original.sock"));
        if (replacement === "file") writeFileSync(path, "replacement");
        if (replacement === "symlink") symlinkSync(join(directory, "missing"), path);
        if (replacement === "socket") {
          const other = Bun.listen({ unix: path, socket: { data() {} } });
          cleanups.push(() => other.stop(true));
        }
      }
      const before = lstatSync(path);
      control.stop();
      control.stop();
      expect(lstatSync(path).ino).toBe(before.ino);
      expect(lstatSync(path).mode).toBe(before.mode);
    });
  }
});
