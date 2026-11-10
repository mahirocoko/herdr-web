import { existsSync, lstatSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createECDH } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "../server/index.ts";
import { herdrSocketPath, ping } from "../server/herdr/client.ts";
import { isRealNode } from "../server/pty/sidecar.ts";
import { runtime, startRuntime, type Runtime } from "../server/herdr-core/runtime.ts";
import type { ForkPolicy } from "../server/fork-policy.ts";

import {
  preparePrivateRuntimeTree,
  readPrivateConfiguration as privateConfiguration,
} from "./private-filesystem.ts";

const existingConfigPath = () =>
  process.env["HERDR_PUSH_CONFIG_PATH"] ||
  join(homedir(), ".config/herdr-web/push-config.json");

/** Keep the browser's existing Push subscription bound to the same VAPID identity.
 * Source Push repairs a changed key by unsubscribing on load, which must not happen at cutover.
 * Only the key pair is copied privately; legacy subscription/policy stores stay untouched.
 */
export function preservePushIdentity(
  stateDir: string,
  configPath = existingConfigPath(),
): boolean {
  if (process.platform === "win32") preparePrivateRuntimeTree(stateDir);
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

/** Fail before rebuilding assets served by an already-running instance.
 * The real server bind remains authoritative if another process wins the race.
 */
export function assertLocalPortAvailable(port: number): void {
  try {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: { data() {} },
    });
    listener.stop();
  } catch {
    throw new Error(
      `Port ${port} is unavailable. If Herdr Web is already running, open http://127.0.0.1:${port}; otherwise stop its owner or choose another PORT. No build or server was started.`,
    );
  }
}

/** Rebuild on every normal start so a pull cannot silently serve an old client. */
export function buildClient(
  root: string,
  runBuild: (cwd: string) => number = (cwd) =>
    Bun.spawnSync([process.execPath, "run", "build"], {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    }).exitCode,
): void {
  console.log("Building Herdr Web…");
  if (runBuild(root) !== 0)
    throw new Error(
      "Client build failed; the server was not started. For first-time setup, install the frozen dependencies before starting again.",
    );
  const index = join(root, "dist/index.html");
  if (!existsSync(index) || !statSync(index).isFile())
    throw new Error(
      "Build did not produce dist/index.html; server not started",
    );
}

/** Unix retains its real-Node smoke; Windows mirror does not need a PTY sidecar.
 * The caller uses the native client's capability normalization, not a version guess.
 */
export function requiresNodePty(
  terminalAttach: boolean,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform !== "win32" || terminalAttach;
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
  const selectedRuntime = runtime();
  assertLocalPortAvailable(port);
  const stateDir = join(root, ".agent-state/runtime/upstream-v10700");
  if (selectedRuntime === "herdr-core" && existsSync(stateDir)) {
    const state = lstatSync(stateDir);
    if (!state.isDirectory() || realpathSync(stateDir) !== stateDir
      || state.uid !== process.geteuid?.() || (state.mode & 0o077) !== 0) {
      throw new Error("herdr-core requires canonical owner-only runtime state; no permissions repaired");
    }
  }
  preparePrivateRuntimeTree(stateDir);
  process.env["HERDR_WEB_STATE_DIR"] = stateDir;
  process.env["HERDR_WEB_FORK_PRIVACY"] = "1";
  process.env["HERDR_WEB_PASTE_DIR"] = join(stateDir, "paste");
  process.env["HERDR_SOCKET"] = herdrSocketPath();
  if (selectedRuntime === "herdr") {
    process.env["HERDR_WEB_HERDR_BIN"] = Bun.which("herdr") || "";
    if (!process.env["HERDR_WEB_HERDR_BIN"])
      throw new Error("Installed Herdr binary is missing");
  }
  const core = await startRuntime(stateDir);
  try {
    const native = await ping();
    if (native.protocol !== 22)
      throw new Error(
        "Installed native protocol differs; no auto-update attempted",
      );
    if (!core && requiresNodePty(native.terminal_attach === true)) {
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
        throw new Error(
          "Real Node and the lock-pinned PTY sidecar are required for native terminal attachment; check Node on PATH and the frozen dependency installation",
        );
    }
    buildClient(root);
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
      // Core's framed transport is available without a Node PTY sidecar; keep health and attach aligned.
      ...(core ? { terminalAttach: true, sidecar: true } : {}),
    });
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      instance.stop();
      core?.stop();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.on("exit", () => {
      if (!stopped) instance.stop();
      core?.stop();
    });
    await instance.statusReady;
    console.log(
      `Existing Push identity ${pushPreserved ? "preserved privately; no legacy subscription/policy stores changed" : "not configured"}`,
    );
    console.log(
      `Herdr source-native app ready at http://127.0.0.1:${instance.port} (native ${native.version}, protocol ${native.protocol}; private ingress ${policy.tailnetHost ? "verified" : "not configured"})`,
    );
    return instance;
  } catch (error) {
    core?.stop();
    throw error;
  }
}

/** Explicit aliases override inherited runtime selection, never auto-detect or fall back. */
export function parseLauncherArgs(args: string[]): { help: boolean; runtime?: Runtime } {
  let help = false;
  let selectedRuntime: Runtime | undefined;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--runtime=herdr" || arg === "--runtime=herdr-core") {
      if (selectedRuntime !== undefined)
        throw new Error("Choose only one runtime; use bun start --help");
      selectedRuntime = arg === "--runtime=herdr-core" ? "herdr-core" : "herdr";
    } else {
      throw new Error("Unknown launcher argument; use bun start --help");
    }
  }
  return { help, runtime: selectedRuntime };
}

if (import.meta.main) {
  const options = parseLauncherArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Herdr Web — local source-native launcher

Usage: bun start            (OVIS_RUNTIME, otherwise original Herdr)
       bun run start:core   (Herdr App/core; Linux/macOS, already-running hc)
       bun run start:herdr  (original Herdr host)
       PORT=8788 bun run start:core

Aliases explicitly select the runtime for this process, overriding OVIS_RUNTIME.
No auto-detection or fallback. Direct selection: --runtime=herdr or --runtime=herdr-core.
OVIS_RUNTIME=herdr-core bun start remains supported.
Use --help or -h with any start command; help never builds or starts a runtime.

Builds the web client, then serves http://127.0.0.1:8787 in the foreground.
Requires Bun 1.4.2 (project-local or PATH) and installed dependencies.
Default runtime: running Herdr host with native protocol 22; Unix/native direct
attachment requires real Node. Opt-in core runtime: already installed/running hc,
Linux/macOS only; no Node PTY, core installation or global settings change.
Core Pi history needs an explicitly enabled compatible session observer; existing
Pi sessions are never reloaded or bound by guessing. See INSTALL.md for setup/limits.
Windows private state requires native NTFS ACL checks; host execution remains
unverified. No Bash/WSL.
Ctrl-C stops this process. No global install, managed updater or public bind.`);
  } else {
    if (options.runtime !== undefined) process.env["OVIS_RUNTIME"] = options.runtime;
    await startLocal();
  }
}
