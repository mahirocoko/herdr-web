#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const requiredVersion = "1.4.2";
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Selection only: never install, download, or mutate the global runtime. */
export function selectBun({
  root = projectRoot,
  platform = process.platform,
  arch = process.arch,
  current = process.execPath,
  path = process.env.PATH ?? "",
  exists = existsSync,
  version = (binary) => {
    const result = spawnSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    return result.status === 0 ? result.stdout.trim() : "";
  },
} = {}) {
  const os = { darwin: "darwin", linux: "linux", win32: "windows" }[platform];
  const cpu = { arm64: "aarch64", x64: "x64" }[arch];
  const name = platform === "win32" ? "bun.exe" : "bun";
  const variants = os && cpu
    ? [
        `bun-${os}-${cpu}`,
        ...(cpu === "x64" ? [`bun-${os}-${cpu}-baseline`] : []),
        ...(platform === "linux"
          ? [
              `bun-${os}-${cpu}-musl`,
              ...(cpu === "x64" ? [`bun-${os}-${cpu}-musl-baseline`] : []),
            ]
          : []),
      ]
    : [];
  const local = variants.map((variant) =>
    join(root, ".agent-state", "tools", "bun", requiredVersion, variant, name),
  );
  const separator = platform === "win32" ? ";" : ":";
  const directories = path.split(separator).filter(Boolean).map((dir) =>
    platform === "win32" ? dir.replace(/^"(.*)"$/, "$1") : dir,
  );
  const candidates = [
    ...local,
    ...directories.map((dir) => join(dir, name)),
    current,
  ];
  for (const binary of [...new Set(candidates.filter(Boolean))]) {
    if (exists(binary) && version(binary) === requiredVersion) return binary;
  }
  throw new Error(
    `Bun ${requiredVersion} was not found. Provide that exact version on PATH or use the existing project-local copy; no runtime was installed or upgraded.`,
  );
}

export async function dispatch(args) {
  const binary = selectBun();
  const env = { ...process.env };
  // Windows environment names are case-insensitive; do not pass both Path/PATH.
  if (process.platform === "win32") {
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === "PATH") delete env[key];
    }
  }
  env.PATH = `${dirname(binary)}${delimiter}${process.env.PATH ?? ""}`;
  env.UNIT_TEST_WORKERS = process.env.UNIT_TEST_WORKERS ?? "1";
  env.HERDR_TEST_SHARDS = process.env.HERDR_TEST_SHARDS ?? "1";
  const child = spawn(binary, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env,
  });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const { code, signal } = await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => accept({ code, signal }));
    });
    if (signal) {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
      process.kill(process.pid, signal);
      return 1;
    }
    return code ?? 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await dispatch(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
