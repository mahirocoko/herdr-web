import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createECDH } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "../server/index.ts";
import { ping } from "../server/herdr/client.ts";
import { isRealNode } from "../server/pty/sidecar.ts";
import type { ForkPolicy } from "../server/fork-policy.ts";

const existingConfigPath = () =>
  process.env["HERDR_PUSH_CONFIG_PATH"] ||
  join(homedir(), ".config/herdr-web/push-config.json");

function privateConfiguration(config: string): Record<string, unknown> | null {
  if (!existsSync(config)) return null;
  const stat = lstatSync(config);
  const parent = lstatSync(resolve(config, ".."));
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.mode & 0o077
  )
    throw new Error(
      "Existing owner configuration is not private; left unchanged",
    );
  if (stat.size > 16_384)
    throw new Error(
      "Existing private configuration is oversized; left unchanged",
    );
  const value: unknown = JSON.parse(readFileSync(config, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Existing private configuration is invalid; left unchanged",
    );
  return value as Record<string, unknown>;
}

/** Keep the browser's existing Push subscription bound to the same VAPID identity.
 * Source Push repairs a changed key by unsubscribing on load, which must not happen at cutover.
 * Only the key pair is copied privately; legacy subscription/policy stores stay untouched.
 */
export function preservePushIdentity(
  stateDir: string,
  configPath = existingConfigPath(),
): boolean {
  const previous = privateConfiguration(configPath);
  if (!previous) return false;
  const { publicKey, privateKey, subject } = previous;
  if (
    typeof publicKey !== "string" ||
    typeof privateKey !== "string" ||
    typeof subject !== "string" ||
    !/^(?:mailto:|https:\/\/)[^\s\x00-\x1f\x7f]+$/.test(subject)
  )
    throw new Error("Existing Push identity is invalid; no keys rotated");
  const curve = createECDH("prime256v1");
  try {
    curve.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (!curve.getPublicKey().equals(Buffer.from(publicKey, "base64url")))
      throw new Error("mismatch");
  } catch {
    throw new Error("Existing Push keypair is invalid; no keys rotated");
  }
  const path = join(stateDir, "vapid.json");
  const current = privateConfiguration(path);
  if (
    current &&
    (current.publicKey !== publicKey || current.privateKey !== privateKey)
  )
    throw new Error(
      "Source Push identity differs from the protected legacy identity; no rotation or subscription changes attempted",
    );
  if (!current)
    writeFileSync(path, JSON.stringify({ publicKey, privateKey }), {
      mode: 0o600,
      flag: "wx",
    });
  process.env["HERDR_WEB_PUSH_SUBJECT"] = subject;
  return true;
}

/** This fork never enters upstream direct-main, managed updater or bridge registration. */
export function localPolicy(port: number): ForkPolicy {
  const policy: ForkPolicy = { port };
  const config = privateConfiguration(existingConfigPath());
  if (!config) return policy;
  const owner = config.ownerLogin;
  if (
    typeof owner !== "string" ||
    !owner.trim() ||
    /[\x00-\x1f\x7f]/.test(owner)
  )
    throw new Error("Existing owner identity is invalid; left unchanged");
  const tailscale = Bun.which("tailscale");
  if (!tailscale) return policy;
  const result = Bun.spawnSync([tailscale, "serve", "status", "--json"], {
    timeout: 5000,
    stderr: "ignore",
  });
  if (result.exitCode !== 0) return policy;
  const web = JSON.parse(result.stdout.toString()).Web ?? {};
  const matching = Object.entries(web).filter(
    ([host, value]) =>
      /^[a-z0-9.-]+\.ts\.net:443$/.test(host) &&
      (value as { Handlers?: Record<string, { Proxy?: string }> }).Handlers?.[
        "/"
      ]?.Proxy === `http://127.0.0.1:${port}`,
  );
  if (matching.length === 1) {
    policy.tailnetHost = matching[0]![0].replace(/:443$/, "");
    policy.ownerLogin = owner.trim();
  }
  return policy;
}

export async function startLocal() {
  if (Bun.version !== "1.4.2")
    throw new Error(
      "Use the verified project-local Bun 1.4.2; no global upgrade is needed",
    );
  const root = resolve(import.meta.dir, "..");
  if (process.cwd() !== root)
    throw new Error("Run the launcher from the canonical repository root");
  if (
    process.env["HERDR_TEST_MODE"] ||
    process.env["HERDR_TEST_LIVE"] ||
    process.env["HERDR_TEST_HOOKS"] === "1"
  )
    throw new Error("Test/demo environment is not a normal runtime");
  const port = Number(process.env["PORT"] || "8787");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid local port");
  const stateDir = join(root, ".agent-state/runtime/upstream-v10700");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  if (lstatSync(stateDir).isSymbolicLink())
    throw new Error("Runtime state must not be a symlink");
  chmodSync(stateDir, 0o700);
  process.umask(0o077);
  process.env["HERDR_WEB_STATE_DIR"] = stateDir;
  process.env["HERDR_WEB_FORK_PRIVACY"] = "1";
  process.env["HERDR_WEB_PASTE_DIR"] = join(stateDir, "paste");
  process.env["HERDR_SOCKET"] = join(homedir(), ".config/herdr/herdr.sock");
  process.env["HERDR_WEB_HERDR_BIN"] = Bun.which("herdr") || "";
  if (!process.env["HERDR_WEB_HERDR_BIN"])
    throw new Error("Installed Herdr binary is missing");
  const node = Bun.which("node");
  if (
    !node ||
    !isRealNode(node) ||
    Bun.spawnSync([node, join(root, "server/pty/smoke.mjs")], {
      cwd: root,
      stderr: "ignore",
      timeout: 15_000,
    }).exitCode !== 0
  )
    throw new Error("Real Node and the lock-pinned PTY sidecar are required");
  const native = await ping();
  if (native.protocol !== 22)
    throw new Error(
      "Installed native protocol differs; no auto-update attempted",
    );
  const policy = localPolicy(port);
  const pushPreserved = preservePushIdentity(stateDir);
  const instance = createServer({
    hostname: "127.0.0.1",
    port,
    stateDir,
    token: "",
    registerBridge: false,
    remoteOperations: false,
    tailscaleOwner: policy.ownerLogin ?? null,
    forkPolicy: policy,
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    instance.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", () => {
    if (!stopped) instance.stop();
  });
  await instance.statusReady;
  console.log(
    `Existing Push identity ${pushPreserved ? "preserved privately; no legacy subscription/policy stores changed" : "not configured"}`,
  );
  console.log(
    `Herdr source-native app ready at http://127.0.0.1:${instance.port} (native ${native.version}, protocol ${native.protocol}; private ingress ${policy.tailnetHost ? "verified" : "not configured"})`,
  );
  return instance;
}

if (import.meta.main) await startLocal();
