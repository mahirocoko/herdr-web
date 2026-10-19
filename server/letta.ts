import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HerdrPane } from "../shared/protocol.ts";
import {
  answerVersion,
  HistoryChanged,
  type ConversationPage,
  type RecognizedConversation,
} from "./conversation.ts";
import {
  LETTA_PARSE_BYTES,
  LETTA_PARSE_ENTRIES,
  parseLettaTranscript,
  stripLettaRuntimeContext,
} from "./letta-parser.ts";
import {
  LETTA_READ_WINDOW_BYTES,
  LettaStoreUnavailable,
  withLettaStore,
  type LettaStoreRead,
} from "./letta-store.ts";

export const LETTA_SCAN_BYTES = 128 * 1024 * 1024;
export const LETTA_INDEX_ENTRIES = 100_000;
export const LETTA_RECORD_BYTES = 8 * 1024 * 1024;
export const LETTA_INDEX_BYTES = 16 * 1024 * 1024;
export const LETTA_CACHE_BYTES = 32 * 1024 * 1024;
export const LETTA_PAGE_TURNS = 50;

export class LettaHistoryLimit extends Error {
  constructor() {
    super(
      "Letta history exceeds the supported scan, index, record or page limit",
    );
    this.name = "LettaHistoryLimit";
  }
}
interface Row {
  id: string;
  offset: number;
  length: number;
  role: unknown;
  user: boolean;
  calls: string[];
  result?: string;
  model?: string;
  cost: number;
  digest: string;
}
interface Index {
  rows: Map<string, Row>;
  size: number;
  end: number;
  changed: string;
  history: string;
  bytes: number;
  records: number;
  topology: string[];
}
const indexes = new Map<string, Index>();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const limit = (): never => {
  throw new LettaHistoryLimit();
};
const boundedId = (value: string): string => {
  if (Buffer.byteLength(value) > 512) limit();
  return value;
};
export const defaultLettaRoot = () =>
  join(homedir(), ".letta", "lc-local-backend", "conversations");
export function forgetLettaState(): void {
  indexes.clear();
}

function rowAt(bytes: Buffer, offset: number): Row | null {
  if (bytes.length > LETTA_RECORD_BYTES) limit();
  const entry: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    !object(entry) ||
    entry.type !== "message" ||
    !object(entry.message) ||
    typeof entry.message.id !== "string"
  )
    return null;
  const message = entry.message;
  const id = boundedId(message.id as string);
  const parts = Array.isArray(message.content) ? message.content : [];
  const visible =
    typeof message.content === "string"
      ? message.content
      : parts
          .filter(
            (part) =>
              object(part) &&
              part.type === "text" &&
              typeof part.text === "string",
          )
          .map((part) => part.text)
          .join("\n");
  const calls: string[] = [];
  for (const part of parts)
    if (
      object(part) &&
      part.type === "toolCall" &&
      typeof part.id === "string"
    ) {
      if (calls.length >= LETTA_PARSE_ENTRIES) limit();
      calls.push(boundedId(part.id));
    }
  const result =
    message.role === "toolResult" && typeof message.toolCallId === "string"
      ? boundedId(message.toolCallId)
      : undefined;
  const model =
    message.role === "assistant" && typeof message.model === "string"
      ? boundedId(message.model)
      : undefined;
  // Hash the message value, not the append entry's changing envelope metadata.
  const digest = createHash("sha256")
    .update(JSON.stringify(message))
    .digest("hex");
  const cost =
    320 +
    Buffer.byteLength(id) +
    calls.reduce((sum, call) => sum + 24 + Buffer.byteLength(call), 0) +
    Buffer.byteLength(result ?? "") +
    Buffer.byteLength(model ?? "");
  return {
    id,
    offset,
    length: bytes.length,
    role:
      message.role === "assistant" ||
      message.role === "user" ||
      message.role === "toolResult"
        ? message.role
        : "other",
    user:
      message.role === "user" &&
      (!!stripLettaRuntimeContext(visible) ||
        parts.some((part) => object(part) && part.type === "image")),
    calls,
    result,
    model,
    cost,
    digest,
  };
}

interface Scan {
  index: Index;
  changes: Map<string, Row | undefined>;
}
function scan(store: LettaStoreRead, previous?: Index): Scan {
  if (store.size > LETTA_SCAN_BYTES) limit();
  // Cooperative publishers append or replace. Same-size rewrite and truncation
  // invalidate; growth is treated as append, not adversarial same-UID integrity.
  const reuse =
    previous &&
    store.size >= previous.size &&
    (store.size !== previous.size || store.changed === previous.changed);
  const changes = new Map<string, Row | undefined>();
  if (reuse && store.size === previous.size)
    return { index: previous, changes };
  const index: Index = reuse
    ? {
        ...previous,
        rows: new Map(previous.rows),
        topology: previous.topology.slice(),
      }
    : {
        rows: new Map(),
        size: 0,
        end: 0,
        changed: "",
        history: randomUUID(),
        bytes: 0,
        records: 0,
        topology: [],
      };
  let pending = Buffer.alloc(0);
  let base = index.end;
  for (let position = index.end; position < store.size;) {
    const chunk = store.read(
      position,
      Math.min(LETTA_READ_WINDOW_BYTES, store.size - position),
    );
    position += chunk.length;
    const buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    for (
      let end = buffer.indexOf(10);
      end >= 0;
      end = buffer.indexOf(10, start)
    ) {
      const bytes = buffer.subarray(start, end);
      if (bytes.length > LETTA_RECORD_BYTES) limit();
      if (bytes.toString("utf8").trim()) {
        if (++index.records > 500_000) limit();
        const row = rowAt(bytes, base + start);
        if (row) {
          const old = index.rows.get(row.id);
          index.bytes += row.cost - (old?.cost ?? 0);
          index.rows.set(row.id, row); // Map preserves FIRST-seen order.
          if (reuse) {
            const original = previous.rows.get(row.id);
            if (original?.digest !== row.digest) changes.set(row.id, original);
            else changes.delete(row.id);
          }
          if (
            index.rows.size > LETTA_INDEX_ENTRIES ||
            index.bytes > LETTA_INDEX_BYTES
          )
            limit();
        }
      }
      start = end + 1;
      index.end = base + start;
    }
    pending = Buffer.from(buffer.subarray(start));
    base += start;
    if (pending.length > LETTA_RECORD_BYTES) limit();
  }
  // An unterminated JSONL append is not a committed record. Rescan it next poll.
  index.size = store.size;
  index.changed = store.changed;
  return { index, changes };
}

function groups(index: Index): Row[][] {
  const turns: Row[][] = [];
  let assistant: Row[] | null = null;
  for (const row of index.rows.values()) {
    if (row.user) {
      turns.push([row]);
      assistant = null;
    } else if (row.role === "assistant") {
      if (assistant === null) {
        assistant = [];
        turns.push(assistant);
      }
      assistant.push(row);
    }
  }
  const topology = turns.map((turn) => turn[0]!.id);
  if (index.topology.some((id, at) => topology[at] !== id))
    index.history = randomUUID();
  index.topology = topology;
  return turns;
}

function readRecord(store: LettaStoreRead, row: Row): string {
  const chunks: Buffer[] = [];
  for (let at = 0; at < row.length; at += LETTA_READ_WINDOW_BYTES)
    chunks.push(
      store.read(
        row.offset + at,
        Math.min(LETTA_READ_WINDOW_BYTES, row.length - at),
      ),
    );
  return Buffer.concat(chunks).toString("utf8");
}

function project(
  store: LettaStoreRead,
  index: Index,
  page: ConversationPage,
  changes: Scan["changes"],
): RecognizedConversation {
  const turns = groups(index);
  // The pinned consumer only polls its newest held page. It retains older pages
  // until a 409/history change, so an out-of-window logical edit must invalidate
  // their generation before accepting ANY held cursor. Recent streaming updates
  // remain in the response window and must not cause this reload loop.
  if (changes.size > 0) {
    const olderRows = new Set<string>();
    const olderCalls = new Set<string>();
    for (const turn of turns.slice(
      0,
      Math.max(0, turns.length - LETTA_PAGE_TURNS),
    )) {
      for (const row of turn) {
        olderRows.add(row.id);
        for (const call of row.calls) olderCalls.add(call);
      }
    }
    for (const [id, before] of changes) {
      const after = index.rows.get(id)!;
      if (
        (before && olderRows.has(id)) ||
        (before?.result && olderCalls.has(before.result)) ||
        (after.result && olderCalls.has(after.result))
      ) {
        index.history = randomUUID();
        break;
      }
    }
  }
  const cursorOf = (cursor: string): number => {
    const separator = cursor.lastIndexOf(":");
    const offset = Number(cursor.slice(separator + 1));
    if (
      separator <= 0 ||
      cursor.slice(0, separator) !== index.history ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > turns.length
    )
      throw new HistoryChanged();
    return offset;
  };
  let end = turns.length;
  let start: number;
  if (page.before !== undefined) {
    end = cursorOf(page.before);
    const floor = page.since === undefined ? 0 : cursorOf(page.since);
    if (floor > end) throw new HistoryChanged();
    start = Math.max(floor, end - LETTA_PAGE_TURNS);
  } else {
    const held = page.from === undefined ? null : cursorOf(page.from);
    const newest = Math.max(0, end - LETTA_PAGE_TURNS);
    start = held !== null && held >= newest ? held : newest;
  }
  const selected = new Set(turns.slice(start, end).flat());
  const results = new Map<string, Row>();
  let model: string | null = null;
  for (const row of index.rows.values()) {
    if (row.result) results.set(row.result, row);
    if (row.model) model = row.model;
  }
  for (const row of [...selected])
    for (const call of row.calls) {
      const result = results.get(call);
      if (result) selected.add(result);
    }
  const rows = [...index.rows.values()].filter((row) => selected.has(row));
  if (
    rows.length > LETTA_PARSE_ENTRIES ||
    rows.reduce((sum, row) => sum + row.length + 1, 0) > LETTA_PARSE_BYTES
  )
    limit();
  const parsed = parseLettaTranscript(
    rows.map((row) => readRecord(store, row)).join("\n") + "\n",
  );
  // Explicit public allowlist: never spread the private store or index into HTTP.
  return {
    source: "letta-transcript",
    turns: parsed.turns,
    metadata: { model, reasoning_effort: null },
    cursor: start > 0 ? `${index.history}:${start}` : null,
    history_id: index.history,
    version: answerVersion(
      index.history,
      `${store.size}:${store.changed}:${start}:${end}`,
    ),
  };
}

export function lettaConversationPage(
  pane: HerdrPane,
  root = defaultLettaRoot(),
  page: ConversationPage = {},
): RecognizedConversation {
  let failure: unknown;
  let commit: { binding: string; index: Index } | undefined;
  const answer = withLettaStore(pane, root, (store) => {
    try {
      const { index, changes } = scan(store, indexes.get(store.binding));
      const answer = project(store, index, page, changes);
      commit = { binding: store.binding, index };
      return answer;
    } catch (error) {
      failure = error;
      return null;
    }
  });
  if (failure instanceof HistoryChanged || failure instanceof LettaHistoryLimit)
    throw failure;
  if (failure || !answer || !commit) throw new LettaStoreUnavailable();
  indexes.delete(commit.binding);
  indexes.set(commit.binding, commit.index);
  while (
    indexes.size > 4 ||
    [...indexes.values()].reduce((sum, index) => sum + index.bytes, 0) >
      LETTA_CACHE_BYTES
  )
    indexes.delete(indexes.keys().next().value!);
  return answer;
}
