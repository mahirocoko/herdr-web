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
import { preservePushIdentity } from "./run-local.ts";

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

test("Push preservation copies only the same valid VAPID pair privately, leaving legacy config byte-exact", () =>
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
  }));

test("Push preservation never rotates a different source identity or imports subscription records", () =>
  fixture((state, config) => {
    const target = join(state, "vapid.json");
    const current = JSON.stringify(pair());
    writeFileSync(target, current, { mode: 0o600 });
    expect(() => preservePushIdentity(state, config)).toThrow(
      "differs from the protected legacy identity",
    );
    expect(readFileSync(target, "utf8")).toBe(current);
    expect(existsSync(join(state, "push-subscriptions.json"))).toBe(false);
  }));

test("Push preservation refuses insecure config, invalid keys and redirected key files", () =>
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
  }));

test("no legacy Push config causes no key generation or subscription cleanup", () =>
  fixture((state, config) => {
    rmSync(config);
    expect(preservePushIdentity(state, config)).toBe(false);
    expect(existsSync(join(state, "vapid.json"))).toBe(false);
  }));
