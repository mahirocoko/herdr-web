import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { resolve, win32 } from "node:path";

/** Cooperative local privacy, not protection against the same user or administrators.
 * Windows never substitutes POSIX mode bits for a native security descriptor.
 */
type Operation = "read" | "prepare";

export function decodePrivacyResponse(
  text: string,
  operation: Operation,
): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Native read responses can contain private bytes. Parser diagnostics must
    // not echo even a fragment of malformed worker output.
    throw new Error("Invalid native privacy response");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid native privacy response");
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort().join(",");
  if (row.version !== 1 || row.operation !== operation)
    throw new Error("Invalid native privacy response");
  if (
    operation === "prepare" &&
    keys === "operation,status,version" &&
    row.status === "ready"
  )
    return null;
  if (
    operation === "read" &&
    keys === "operation,status,version" &&
    row.status === "absent"
  )
    return null;
  if (
    operation === "read" &&
    keys === "bytes,operation,status,version" &&
    row.status === "read" &&
    typeof row.bytes === "string" &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      row.bytes,
    )
  ) {
    const bytes = Buffer.from(row.bytes, "base64");
    if (bytes.length > 16_384)
      throw new Error(
        "Existing private configuration is oversized; left unchanged",
      );
    return bytes.toString("utf8");
  }
  throw new Error("Invalid native privacy response");
}

function windowsPrivacy(operation: Operation, path: string): string | null {
  // Do not search PATH for a user-installed PowerShell. SystemRoot is the OS
  // environment inherited by this process; a hostile launch environment is not
  // an isolation boundary against the launching user.
  const systemRoot = process.env["SystemRoot"];
  if (!systemRoot || !/^[A-Za-z]:\\[^\x00-\x1f]+$/.test(systemRoot))
    throw new Error(
      "Windows SystemRoot is unavailable; private filesystem access refused",
    );
  const executable = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const source = readFileSync(
    new URL("./private-filesystem.ps1", import.meta.url),
    "utf8",
  );
  try {
    const output = execFileSync(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(source, "utf16le").toString("base64"),
      ],
      {
        input: JSON.stringify({ version: 1, operation, path: resolve(path) }),
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 128 * 1024,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return decodePrivacyResponse(output.trim(), operation);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown failure";
    // Never include stdout (which may contain legacy secret bytes) in errors.
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    throw new Error(
      `Native Windows privacy check failed; no POSIX fallback: ${stderr ? String(stderr).slice(0, 1024) : detail.split("\n")[0]}`,
    );
  }
}

export function readPrivateConfiguration(
  config: string,
): Record<string, unknown> | null {
  let text: string | null;
  if (process.platform === "win32") {
    text = windowsPrivacy("read", config);
    if (text === null) return null;
  } else {
    // Preserve the original Unix leaf + immediate-parent contract, not a new
    // all-ancestor policy. Legacy files are validated, never repaired.
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
    text = readFileSync(config, "utf8");
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Existing private configuration is invalid; left unchanged",
    );
  return value as Record<string, unknown>;
}

export function preparePrivateRuntimeTree(stateDir: string): void {
  if (process.platform === "win32") {
    windowsPrivacy("prepare", stateDir);
    return;
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  if (lstatSync(stateDir).isSymbolicLink())
    throw new Error("Runtime state must not be a symlink");
  chmodSync(stateDir, 0o700);
  process.umask(0o077);
}
