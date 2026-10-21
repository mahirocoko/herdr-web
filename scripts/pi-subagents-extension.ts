/** Optional, read-only Pi observer. Explicitly load with `pi -e /absolute/path/to/this/file.ts`.
 * Never installed by Herdr Web. No tools, model calls, messages, native input or global hooks.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PI_ACTIVITY_MAX_BYTES, PI_ACTIVITY_MAX_TASKS, piRunRecord, type PiActivitySnapshot } from "../shared/pi-subagents.ts";

interface SessionOwner { getSessionFile(): string | undefined; getSessionId(): string }
interface PiObserverApi {
  events?: { on(event: string, handler: () => void): (() => void) | undefined };
  on(event: "session_start" | "session_shutdown", handler: (event: unknown, ctx: { sessionManager: SessionOwner }) => void): unknown;
}
interface OwnerRegistry {
  protocol: "pi-subagents.session-owner";
  version: 1;
  get(owner: object): { listAgents(): unknown[] } | undefined;
}
const directory = fileURLToPath(new URL("../.agent-state/runtime/upstream-v10700/pi-subagents/", import.meta.url));

/** Fail closed, without chmod/ACL repair or changing the host process's umask. */
export function preparePiActivityDirectory(path: string): void {
  // Native Windows ACL-backed observer writing is not established. History remains available.
  if (process.platform === "win32") throw new Error("Pi live observer requires POSIX privacy; no Windows fallback");
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (!path.startsWith(root)) throw new Error("Observer directory is outside this checkout");
  let next = root.replace(/\/$/, "");
  for (const part of path.slice(root.length).split("/").filter(Boolean)) {
    next = join(next, part);
    if (!existsSync(next)) mkdirSync(next, { mode: 0o700 });
    const stat = lstatSync(next);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.()) throw new Error("Observer runtime directory is not private; left unchanged");
  }
}

export function piObserverSnapshot(owner: SessionOwner, all: unknown[], now = Date.now(), pid = process.pid): PiActivitySnapshot | null {
  const parentFile = owner.getSessionFile();
  if (!parentFile || !existsSync(parentFile)) return null;
  const parsed = all.map(piRunRecord);
  if (parsed.some((r) => r === null)) return null;
  const sorted = parsed.filter((r) => r !== null).sort((a, b) => Number(b.status === "running" || b.status === "queued") - Number(a.status === "running" || a.status === "queued") || b.startedAt - a.startedAt);
  if (new Set(sorted.map((r) => r.id)).size !== sorted.length || sorted.filter((r) => r.status === "running" || r.status === "queued").length > PI_ACTIVITY_MAX_TASKS) return null;
  const snapshot: PiActivitySnapshot = { version: 1, parentFile: realpathSync(parentFile), parentSessionId: owner.getSessionId(), pid, updatedAt: now, records: sorted.slice(0, PI_ACTIVITY_MAX_TASKS) };
  return Buffer.byteLength(JSON.stringify(snapshot)) <= PI_ACTIVITY_MAX_BYTES ? snapshot : null;
}

export function piOwnedRuns(owner: object): unknown[] | undefined {
  const registry = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-subagents.session-owner-registry.v1")] as OwnerRegistry | undefined;
  if (registry?.protocol !== "pi-subagents.session-owner" || registry.version !== 1 || typeof registry.get !== "function") return undefined;
  return registry.get(owner)?.listAgents();
}

export default function piSubagentsObserver(pi: PiObserverApi): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let owner: SessionOwner | undefined;
  let file: string | undefined;
  const subscriptions: (() => void)[] = [];
  const dispose = () => {
    clearInterval(timer); timer = undefined; owner = undefined; file = undefined;
    for (const off of subscriptions.splice(0)) off();
  };
  const publish = () => {
    if (!owner) return;
    let temporary: string | undefined;
    try {
      // Exact SessionManager ownership only. Never use the process-global legacy service.
      const all = piOwnedRuns(owner);
      if (!all) return;
      const snapshot = piObserverSnapshot(owner, all);
      if (!snapshot) return;
      const text = JSON.stringify(snapshot);
      const canonical = snapshot.parentFile;
      preparePiActivityDirectory(directory);
      file = join(directory, `${createHash("sha256").update(canonical).digest("hex")}.json`);
      if (existsSync(file)) {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.()) return;
      }
      temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
      renameSync(temporary, file);
      temporary = undefined;
    } catch { /* Observation failure must never affect the parent or its children. Lease expires. */ }
    finally { if (temporary) { try { unlinkSync(temporary); } catch { /* only our own temporary */ } } }
  };
  pi.on("session_start", (_event, ctx) => {
    dispose();
    owner = ctx.sessionManager;
    for (const channel of ["subagents:created", "subagents:started", "subagents:completed", "subagents:failed", "subagents:resuming", "subagents:resumed"]) {
      const off = pi.events?.on(channel, () => queueMicrotask(publish));
      if (off) subscriptions.push(off);
    }
    publish();
    timer = setInterval(publish, 2000);
    timer.unref?.();
  });
  // Do not erase a newer runtime's receipt at reload/shutdown; the old lease simply expires.
  pi.on("session_shutdown", dispose);
}
