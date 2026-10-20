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
  preservePushIdentity,
  requiresNodePty,
} from "./run-local.ts";

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
