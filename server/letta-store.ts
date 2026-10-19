import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { join, resolve } from "node:path";
import type { HerdrPane } from "../shared/protocol.ts";

export const LETTA_STORE_ENTRIES = 32_768;
export const LETTA_READ_WINDOW_BYTES = 256 * 1024;
export const LETTA_READ_BUDGET_BYTES = 136 * 1024 * 1024;
const METADATA_BYTES = 64 * 1024;
const HEADER_BYTES = 4096;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Intentionally generic: a failed local-store lookup must not leak paths or IDs. */
export class LettaStoreUnavailable extends Error {
  constructor() {
    super("Letta transcript unavailable");
    this.name = "LettaStoreUnavailable";
  }
}

export interface LettaStoreRead {
  /** Server-private binding fingerprint, not the native scope or conversation ID. */
  binding: string;
  /** Validated watch path; server-internal only, never a response field. */
  path: string;
  changed: string;
  size: number;
  read(start: number, length: number): Buffer;
}

interface Opened {
  path: string;
  fd: number;
  stat: Stats;
}
const same = (a: Stats, b: Stats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
const unavailable = (): never => {
  throw new LettaStoreUnavailable();
};

/** Read only the store named by a SERVER-PRIVATE native snapshot. No cwd, title,
 * agent_session, browser field or newest-session fallback is permitted here.
 * This callback is a bounded store primitive, not a chat/paging/input capability.
 */
export function withLettaStore<T>(
  pane: HerdrPane,
  root: string,
  consume: (store: LettaStoreRead) => T,
): T {
  const scope = pane.tokens?.["letta_scope"];
  if (
    pane.agent !== "letta" ||
    typeof scope !== "string" ||
    !/^[a-f0-9]{16}$/.test(scope)
  )
    unavailable();
  root = resolve(root);
  const opened: Opened[] = [];
  let directory: ReturnType<typeof opendirSync> | undefined;
  try {
    // Reject symlinks in every ancestor as well as the final component.
    const canonical = (path: string) => {
      if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink())
        unavailable();
    };
    const open = (path: string, directory = false): Opened => {
      canonical(path);
      const before = lstatSync(path);
      if (directory ? !before.isDirectory() : !before.isFile()) unavailable();
      const fd = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const item = { path, fd, stat: fstatSync(fd) };
      opened.push(item);
      if (
        !same(before, item.stat) ||
        (directory ? !item.stat.isDirectory() : !item.stat.isFile())
      )
        unavailable();
      canonical(path);
      return item;
    };
    const bytes = (item: Opened, start: number, length: number): Buffer => {
      const buffer = Buffer.alloc(length);
      let at = 0;
      while (at < length) {
        const count = readSync(item.fd, buffer, at, length - at, start + at);
        if (!count) unavailable();
        at += count;
      }
      return buffer;
    };
    const metadata = (path: string): Record<string, unknown> => {
      const item = open(path);
      if (item.stat.size > METADATA_BYTES) unavailable();
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes(item, 0, item.stat.size),
        ),
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        unavailable();
      return value as Record<string, unknown>;
    };
    open(root, true);
    directory = opendirSync(root);
    let match: { name: string; id: string } | undefined;
    for (let count = 0; ; count++) {
      const entry = directory.readSync();
      if (!entry) break;
      if (count >= LETTA_STORE_ENTRIES) unavailable();
      // Names only: no unrelated conversation metadata or transcript is opened.
      if (!/^[A-Za-z0-9_+\/-]+={0,2}$/.test(entry.name)) continue;
      const decoded = Buffer.from(entry.name, "base64url").toString("utf8");
      if (!decoded.startsWith("conversation:")) continue;
      if (Buffer.from(decoded).toString("base64url") !== entry.name)
        unavailable();
      const id = decoded.slice(13);
      if (!id || hash(id).slice(0, 16) !== scope) continue;
      if (match || !entry.isDirectory() || entry.isSymbolicLink())
        unavailable();
      match = { name: entry.name, id };
    }
    directory.closeSync();
    directory = undefined;
    if (!match) throw new LettaStoreUnavailable();
    const path = join(root, match.name);
    const folder = open(path, true);
    const conversation = metadata(join(path, "conversation.json"));
    if (conversation.id !== match.id) unavailable();
    const manifest = metadata(join(path, "manifest.json"));
    if (
      manifest.schema_version !== 2 ||
      manifest.message_format !== "pi-session-entry-jsonl" ||
      manifest.provider_stack !== "pi-ai"
    )
      unavailable();
    const messages = open(join(path, "messages.jsonl"));
    if (!Number.isSafeInteger(messages.stat.size) || messages.stat.size < 0)
      unavailable();
    const headerBytes = bytes(
      messages,
      0,
      Math.min(messages.stat.size, HEADER_BYTES),
    );
    const newline = headerBytes.indexOf(10);
    if (newline < 0) unavailable();
    const header = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        headerBytes.subarray(0, newline),
      ),
    );
    if (
      !header ||
      header.type !== "session" ||
      header.version !== 3 ||
      header.id !== match.id
    )
      unavailable();
    let used = 0;
    const result = consume({
      binding: hash(
        `${root}\0${scope}\0${folder.stat.dev}:${folder.stat.ino}\0${messages.stat.dev}:${messages.stat.ino}`,
      ),
      path: messages.path,
      changed: `${messages.stat.mtimeMs}:${messages.stat.ctimeMs}`,
      size: messages.stat.size,
      read(start, length) {
        if (
          !Number.isSafeInteger(start) ||
          start < 0 ||
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > LETTA_READ_WINDOW_BYTES ||
          start + length > messages.stat.size ||
          used + length > LETTA_READ_BUDGET_BYTES
        )
          unavailable();
        used += length;
        return bytes(messages, start, length);
      },
    });
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      "then" in result
    )
      unavailable();
    if (pane.agent !== "letta" || pane.tokens?.["letta_scope"] !== scope)
      unavailable();
    // Validate every opened path AND descriptor after consumption. An append,
    // replacement, metadata edit or rebinding gets retried by the future owner;
    // no result from a torn identity is returned.
    for (const item of opened) {
      canonical(item.path);
      if (
        !same(item.stat, fstatSync(item.fd)) ||
        !same(item.stat, lstatSync(item.path))
      )
        unavailable();
    }
    return result;
  } catch {
    throw new LettaStoreUnavailable();
  } finally {
    directory?.closeSync();
    for (const item of opened) closeSync(item.fd);
  }
}
