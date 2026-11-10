import { expect, test } from "bun:test";
import { createECDH } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertLocalPortAvailable,
  buildClient,
  localPolicy,
  parseLauncherArgs,
  preservePushIdentity,
  readServeStatus,
  requiresNodePty,
} from "./run-local.ts";

import { RefreshingForkPolicy } from "../server/fork-policy.ts";
import { createServer } from "../server/index.ts";

const serveFixture = (port: number, proxy = `http://127.0.0.1:${port}`) => JSON.stringify({
  TCP: { "443": { HTTPS: true } },
  Web: { "owner.tail-test.ts.net:443": { Handlers: { "/": { Proxy: proxy } } } },
});

test.if(process.platform !== "win32")("private ingress recovers on the same HTTP server after unavailable startup discovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-ingress-recovery-"));
  const config = join(root, "owner.json");
  writeFileSync(config, JSON.stringify({ ownerLogin: "owner@example.test" }), { mode: 0o600 });
  let now = 0;
  let status: string | null = null;
  let reads = 0;
  const source = new RefreshingForkPolicy(8787, () => localPolicy(8787, config, async () => {
    reads++;
    return status;
  }), () => now);
  let app: ReturnType<typeof createServer> | undefined;
  try {
    expect(await source.current()).toEqual({ port: 8787 });
    app = createServer({ port: 0, hostname: "127.0.0.1", stateDir: join(root, "state"),
      token: "", registerBridge: false, machines: false, terminalAttach: false,
      tailscaleOwner: null, forkPolicy: source });
    const base = `http://127.0.0.1:${app.port}`;
    const headers = { host: "owner.tail-test.ts.net", "tailscale-user-login": "owner@example.test",
      "x-forwarded-for": "100.70.1.2", "x-forwarded-proto": "https" };
    const request = (patch: Record<string, string> = {}) => fetch(`${base}/api/health?scope=bridge`, { headers: { ...headers, ...patch } });
    expect((await request()).status).toBe(403);
    status = serveFixture(8787);
    now = 10_000;
    const responses = await Promise.all([request(), request(), request()]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect((await response.json()).auth).toMatchObject({ authenticated: true, via: "tailscale" });
    }
    expect(reads).toBe(2);
    for (const patch of [
      { "tailscale-user-login": "other@example.test" },
      { "x-forwarded-for": "203.0.113.1" },
      { "tailscale-funnel-request": "1" },
      { origin: "https://attacker.test" },
    ]) expect((await request(patch)).status).toBe(403);
    // A later failure must revoke the cached grant, not reuse last-known-good authority.
    status = "not JSON";
    now = 20_000;
    expect((await request()).status).toBe(403);
    status = serveFixture(8787);
    now = 30_000;
    expect((await request()).status).toBe(200);
    expect(reads).toBe(4);
    writeFileSync(config, JSON.stringify({ ownerLogin: "new-owner@example.test" }));
    now = 40_000;
    expect((await request()).status).toBe(403);
    const changedOwner = await request({ "tailscale-user-login": "new-owner@example.test" });
    expect((await changedOwner.json()).auth).toMatchObject({ authenticated: true, via: "tailscale" });
    status = "{}";
    now = 50_000;
    expect((await request({ "tailscale-user-login": "new-owner@example.test" })).status).toBe(403);
  } finally {
    app?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test.if(process.platform !== "win32")("Serve discovery retains exact route and private owner configuration checks", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-ingress-policy-"));
  const config = join(root, "owner.json");
  writeFileSync(config, JSON.stringify({ ownerLogin: "owner@example.test" }), { mode: 0o600 });
  const read = (status: string | null) => localPolicy(8787, config, async () => status);
  try {
    expect(await read(serveFixture(8787))).toEqual({ port: 8787, tailnetHost: "owner.tail-test.ts.net", ownerLogin: "owner@example.test" });
    for (const status of [null, "bad JSON", "null", "{}", serveFixture(9999), serveFixture(8787, "http://192.168.1.1:8787")])
      expect(await read(status)).toEqual({ port: 8787 });
    writeFileSync(config, JSON.stringify({ ownerLogin: "" }));
    await expect(read(serveFixture(8787))).rejects.toThrow("owner identity is invalid");
    writeFileSync(config, JSON.stringify({ ownerLogin: "owner@example.test" }));
    chmodSync(config, 0o644);
    await expect(read(serveFixture(8787))).rejects.toThrow("not private");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.if(process.platform !== "win32")("Serve CLI timeout settles and terminates a child that ignores SIGTERM", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-serve-timeout-"));
  const binary = join(root, "tailscale-fixture");
  const pidPath = join(root, "pid");
  writeFileSync(binary, `#!/bin/sh\ntrap '' TERM\nprintf '%s' "$$" > '${pidPath.replace(/'/g, "'\\''")}'\nexec /bin/sleep 60\n`, { mode: 0o700 });
  try {
    const started = performance.now();
    // Allow macOS's first execution check of a fresh executable fixture.
    expect(await readServeStatus(binary, 1000)).toBeNull();
    expect(performance.now() - started).toBeLessThan(3000);
    expect(existsSync(pidPath)).toBe(true);
    const pid = Number(readFileSync(pidPath, "utf8"));
    // kill(pid, 0) also succeeds for a terminated child awaiting OS reaping.
    const state = Bun.spawnSync(["/bin/ps", "-p", String(pid), "-o", "stat="]).stdout.toString().trim();
    expect(state === "" || state.startsWith("Z")).toBe(true);
  } finally {
    if (existsSync(pidPath)) {
      try { process.kill(Number(readFileSync(pidPath, "utf8")), "SIGKILL"); } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("launcher help distinguishes per-process core selection and Pi identity limits without starting a runtime", () => {
  const result = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, "run-local.ts"), "--help"],
    {
      env: { ...process.env, OVIS_RUNTIME: "invalid-help-must-not-start" },
      timeout: 15_000,
    },
  );
  expect(result.exitCode).toBe(0);
  const text = result.stdout.toString();
  expect(text).toContain("OVIS_RUNTIME=herdr-core bun start");
  expect(text).toContain(
    "Default runtime: running Herdr host with native protocol 22",
  );
  expect(text).toContain("no Node PTY, core installation or global settings change");
  expect(text).toContain(
    "existing\nPi sessions are never reloaded or bound by guessing",
  );
});

test("runtime arguments preserve default selection and reject ambiguity before startup", () => {
  expect(parseLauncherArgs([])).toEqual({ help: false, runtime: undefined });
  expect(parseLauncherArgs(["--runtime=herdr-core"])).toEqual({
    help: false,
    runtime: "herdr-core",
  });
  expect(parseLauncherArgs(["--runtime=herdr"])).toEqual({
    help: false,
    runtime: "herdr",
  });
  for (const args of [
    ["--runtime=herdr-core", "--help"],
    ["-h", "--runtime=herdr-core"],
  ]) {
    expect(parseLauncherArgs(args)).toEqual({ help: true, runtime: "herdr-core" });
  }
  for (const args of [
    ["--runtime=other"],
    ["--runtime"],
    ["--runtime", "herdr-core"],
    ["--runtime=herdr", "--runtime=herdr-core"],
    ["--runtime=herdr-core", "--runtime=herdr-core"],
    ["--help", "--unknown"],
  ]) {
    expect(() => parseLauncherArgs(args)).toThrow();
  }
});

for (const script of ["start:core", "start:herdr"]) {
  test(`${script} help uses the package alias without starting or validating a runtime`, () => {
    const result = Bun.spawnSync([process.execPath, "run", script, "--help"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, OVIS_RUNTIME: "invalid-help-must-not-start" },
      timeout: 15_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("bun run start:core");
    expect(result.stdout.toString()).toContain("bun run start:herdr");
    expect(result.stdout.toString()).toContain("No auto-detection or fallback");
  });

  test(`${script} overrides inherited runtime but refuses an occupied port before effects`, () => {
    const owner = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    try {
      const result = Bun.spawnSync([process.execPath, "run", script], {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          OVIS_RUNTIME: "invalid-inherited-runtime",
          PORT: String(owner.port),
          HERDR_TEST_MODE: undefined,
          HERDR_TEST_LIVE: undefined,
          HERDR_TEST_HOOKS: undefined,
        },
        timeout: 15_000,
      });
      expect(result.exitCode).not.toBe(0);
      const error = result.stderr.toString();
      // Match the thrown error, not neighboring source lines in Bun's diagnostic excerpt.
      if (script === "start:core" && process.platform === "win32") {
        expect(error).toContain("error: herdr-core is Linux/macOS only");
      } else {
        expect(error).toContain(`error: Port ${owner.port} is unavailable`);
        expect(error).toContain("No build or server was started");
      }
      expect(owner.port).toBeGreaterThan(0);
    } finally {
      owner.stop();
    }
  });
}

test("PTY requirement retains Unix smoke and follows Windows native attach capability", () => {
  expect(requiresNodePty(false, "darwin")).toBe(true);
  expect(requiresNodePty(false, "linux")).toBe(true);
  expect(requiresNodePty(false, "win32")).toBe(false);
  expect(requiresNodePty(true, "win32")).toBe(true);
});

test.if(process.platform !== "win32")(
  "fresh-clone wrapper explains missing Bun without installing a runtime",
  () => {
    const root = mkdtempSync(join(tmpdir(), "herdr-missing-bun-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "bin"));
      const wrapper = join(root, "scripts/bun-project.sh");
      writeFileSync(
        wrapper,
        readFileSync(new URL("./bun-project.sh", import.meta.url)),
      );
      symlinkSync(Bun.which("dirname")!, join(root, "bin/dirname"));
      const result = Bun.spawnSync(["/bin/bash", wrapper, "--version"], {
        env: { PATH: join(root, "bin") },
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Bun 1.4.2 was not found");
      expect(existsSync(join(root, ".agent-state"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("startup refuses an occupied loopback port without closing its owner", () => {
  const owner = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  try {
    expect(() => assertLocalPortAvailable(owner.port)).toThrow(
      "No build or server was started",
    );
    expect(owner.port).toBeGreaterThan(0);
  } finally {
    owner.stop();
  }
});

test("startup port probe releases its own listener", () => {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const port = listener.port;
  listener.stop();
  assertLocalPortAvailable(port);
  const next = Bun.listen({
    hostname: "127.0.0.1",
    port,
    socket: { data() {} },
  });
  next.stop();
});

test("normal start really executes the build script, including when dist already exists", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-start-build-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { build: "bun build.ts" } }),
    );
    writeFileSync(
      join(root, "build.ts"),
      `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", "built");`,
    );
    buildClient(root);
    const index = join(root, "dist/index.html");
    expect(readFileSync(index, "utf8")).toBe("built");
    writeFileSync(index, "stale");
    buildClient(root);
    expect(readFileSync(index, "utf8")).toBe("built");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed or empty builds never qualify an old client for startup", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-failed-build-"));
  try {
    expect(() => buildClient(root, () => 1)).toThrow("server was not started");
    expect(() => buildClient(root, () => 0)).toThrow("did not produce");
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/index.html"), "old client");
    expect(() => buildClient(root, () => 2)).toThrow("server was not started");
    expect(readFileSync(join(root, "dist/index.html"), "utf8")).toBe(
      "old client",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const pair = () => {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  return {
    publicKey: curve.getPublicKey().toString("base64url"),
    privateKey: curve.getPrivateKey().toString("base64url"),
  };
};
const fixture = (
  run: (
    state: string,
    config: string,
    identity: ReturnType<typeof pair>,
  ) => void,
) => {
  const root = mkdtempSync(join(tmpdir(), "t195-push-identity-"));
  const before = process.env["HERDR_WEB_PUSH_SUBJECT"];
  try {
    const state = join(root, "state");
    mkdirSync(state, { mode: 0o700 });
    const config = join(root, "push-config.json");
    const identity = pair();
    writeFileSync(
      config,
      JSON.stringify({
        ...identity,
        ownerLogin: "fixture@example.invalid",
        subject: "mailto:fixture@example.invalid",
      }),
      { mode: 0o600 },
    );
    run(state, config, identity);
  } finally {
    if (before === undefined) delete process.env["HERDR_WEB_PUSH_SUBJECT"];
    else process.env["HERDR_WEB_PUSH_SUBJECT"] = before;
    rmSync(root, { recursive: true, force: true });
  }
};

test.if(process.platform !== "win32")(
  "Push preservation copies only the same valid VAPID pair privately, leaving legacy config byte-exact",
  () =>
    fixture((state, config, identity) => {
      const original = readFileSync(config);
      expect(preservePushIdentity(state, config)).toBe(true);
      const target = join(state, "vapid.json");
      expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(identity);
      expect(statSync(target).mode & 0o777).toBe(0o600);
      expect(readFileSync(config)).toEqual(original);
      const modified = statSync(target).mtimeMs;
      expect(preservePushIdentity(state, config)).toBe(true);
      expect(statSync(target).mtimeMs).toBe(modified);
    }),
);

test.if(process.platform !== "win32")(
  "Push preservation never rotates a different source identity or imports subscription records",
  () =>
    fixture((state, config) => {
      const target = join(state, "vapid.json");
      const current = JSON.stringify(pair());
      writeFileSync(target, current, { mode: 0o600 });
      expect(() => preservePushIdentity(state, config)).toThrow(
        "differs from the protected legacy identity",
      );
      expect(readFileSync(target, "utf8")).toBe(current);
      expect(existsSync(join(state, "push-subscriptions.json"))).toBe(false);
    }),
);

test.if(process.platform !== "win32")(
  "Push preservation refuses insecure config, invalid keys and redirected key files",
  () =>
    fixture((state, config) => {
      chmodSync(config, 0o644);
      expect(() => preservePushIdentity(state, config)).toThrow("not private");
      chmodSync(config, 0o600);
      const redirected = join(state, "protected-fixture");
      writeFileSync(redirected, "unchanged", { mode: 0o600 });
      symlinkSync(redirected, join(state, "vapid.json"));
      expect(() => preservePushIdentity(state, config)).toThrow("not private");
      expect(readFileSync(redirected, "utf8")).toBe("unchanged");
      rmSync(join(state, "vapid.json"));
      writeFileSync(
        config,
        JSON.stringify({
          publicKey: "invalid",
          privateKey: "invalid",
          subject: "mailto:fixture@example.invalid",
        }),
      );
      expect(() => preservePushIdentity(state, config)).toThrow(
        "keypair is invalid",
      );
      expect(existsSync(join(state, "vapid.json"))).toBe(false);
    }),
);

test.if(process.platform !== "win32")(
  "no legacy Push config causes no key generation or subscription cleanup",
  () =>
    fixture((state, config) => {
      rmSync(config);
      expect(preservePushIdentity(state, config)).toBe(false);
      expect(existsSync(join(state, "vapid.json"))).toBe(false);
    }),
);
