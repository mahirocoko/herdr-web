import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentStatus, ConversationTurn, HerdrPane, OmoTask } from "../shared/protocol.ts";
import { PI_ACTIVITY_TTL_MS, PI_ACTIVITY_VERSION, piRunRecord, type PiRunRecord } from "../shared/pi-subagents.ts";
import { readPrivateConfiguration } from "../scripts/private-filesystem.ts";
import { agentGet, paneProcessInfo } from "./herdr/client.ts";
import { isPiProcess, piTranscriptPath } from "./pi.ts";
import { piBranchRecords } from "./pi-tree.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const piActivityName = (parent: string): string => `${hash(parent)}.json`;
export const piTaskId = (parent: string, id: string): string => hash(`${parent}\0${id}`);
const MAX_HISTORY_BYTES = 32 * 1024 * 1024;
const MAX_RUNS = 64;
export interface PiParent { path: string; id: string; pids: number[] }
export interface PiActivity { tasks: OmoTask[]; records: Map<string, PiRunRecord>; live: boolean }

/** Read only a regular file's bounded first line, never a pipe or an unbounded transcript. */
export function piSessionHeader(path: string): Record<string, unknown> | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return null;
    const bytes = Buffer.alloc(8192);
    const got = readSync(fd, bytes, 0, bytes.length, 0);
    const end = bytes.subarray(0, got).indexOf(10);
    if (end < 0) return null;
    const header = JSON.parse(bytes.subarray(0, end).toString("utf8"));
    return header?.type === "session" && typeof header.id === "string" ? header : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Used only after the exact herdr:pi parent binding is validated. Some native hosts
 * report the foreground executable as argv0 without argv. Never trust `name: node`
 * alone, or let argv0 override contradictory full argv. */
export function piForegroundPids(processes: readonly { pid?: number; argv?: readonly string[] | null; argv0?: string | null }[]): number[] {
  return processes.filter((p) => typeof p.pid === "number" && Number.isSafeInteger(p.pid) && p.pid > 0
    && (p.argv?.length ? isPiProcess(p.argv) : p.argv0 === "pi"))
    .map((p) => p.pid!);
}

/** Resolve afresh for every API read; cached pane/session guesses are never child-read authority. */
export async function piParentForPane(paneId: string): Promise<PiParent | null> {
  const [agent, info] = await Promise.all([agentGet(paneId).catch(() => null), paneProcessInfo(paneId).catch(() => null)]);
  const processes = info?.foreground_processes ?? [];
  const found = await piTranscriptPath(paneId, undefined, { agent, processes });
  if (!found || !("path" in found)) return null;
  const header = piSessionHeader(found.path);
  if (!header) return null;
  return { path: found.path, id: header.id as string, pids: piForegroundPids(processes) };
}

/** Both an exact parent-owned tasks directory and the child's native parent header must agree. */
export function piChildPath(parent: PiParent, outputFile: string | undefined): string | null {
  if (!outputFile) return null;
  try {
    const tasks = join(dirname(parent.path), basename(parent.path, ".jsonl"), "tasks");
    // Do not follow a linked directory or a linked transcript to another private session.
    if (realpathSync(tasks) !== tasks) return null;
    const path = realpathSync(outputFile);
    if (resolve(outputFile) !== path || dirname(path) !== tasks || !path.endsWith(".jsonl")) return null;
    const header = piSessionHeader(path);
    return header?.parentSession === parent.id ? path : null;
  } catch { return null; }
}

function liveRecords(parent: PiParent, stateDir: string, now: number): PiRunRecord[] | null {
  try {
    const value = readPrivateConfiguration(join(stateDir, "pi-subagents", piActivityName(parent.path)));
    if (!value || value.version !== PI_ACTIVITY_VERSION || value.parentFile !== parent.path || value.parentSessionId !== parent.id
      || typeof value.pid !== "number" || !parent.pids.includes(value.pid)
      || typeof value.updatedAt !== "number" || now - value.updatedAt < -1000 || now - value.updatedAt > PI_ACTIVITY_TTL_MS
      || !Array.isArray(value.records) || value.records.length > 24) return null;
    const records = value.records.map(piRunRecord);
    if (records.some((r) => r === null) || new Set(records.map((r) => r!.id)).size !== records.length) return null;
    return records as PiRunRecord[];
  } catch { return null; }
}

const historyCache = new Map<string, { signature: string; records: Map<string, PiRunRecord> }>();
/** Branch-aware, bounded metadata only. An unanswered launch is unknown, never inferred running. */
function historicalRecords(parent: PiParent): Map<string, PiRunRecord> {
  const stat = statSync(parent.path);
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const known = historyCache.get(parent.path);
  if (known?.signature === signature) return new Map(known.records);
  const records = new Map<string, PiRunRecord>();
  let bytes = 0;
  for (const line of piBranchRecords(parent.path, stat.size)) {
    bytes += Buffer.byteLength(line);
    if (bytes > MAX_HISTORY_BYTES) throw new Error("Pi subagent history exceeds bounded read");
    if (!line.includes("subagents:record") && !(line.includes("toolResult") && line.includes("subagent"))) continue;
    let e: { type?: string; customType?: string; timestamp: string; data?: unknown; message?: { role?: string; toolName?: string; details?: { agentId?: string; type?: string }; content?: { type?: string; text?: string }[] } };
    try { e = JSON.parse(line); } catch { continue; }
    let record: PiRunRecord | null = null;
    if (e.type === "custom" && e.customType === "subagents:record") record = piRunRecord(e.data);
    // The background-launch tool result gives the child identity before terminal persistence.
    // Its reported status is deliberately *not* used as evidence of current liveness.
    const m = e.message;
    if (m?.role === "toolResult" && m.toolName === "subagent" && m.details?.agentId) {
      const text = Array.isArray(m.content) ? m.content.map((b) => b?.type === "text" && typeof b.text === "string" ? b.text : "").join("\n") : "";
      record = piRunRecord({ id: m.details.agentId, type: m.details.type ?? "subagent", description: /^Description: (.*)$/m.exec(text)?.[1] ?? "subagent",
        status: "running", startedAt: Number.isFinite(Date.parse(e.timestamp)) ? Date.parse(e.timestamp) : 0, toolUses: 0,
        outputFile: /^Output file: (.+)$/m.exec(text)?.[1] });
    }
    if (record) { records.delete(record.id); records.set(record.id, record); }
    if (records.size > MAX_RUNS) records.delete(records.keys().next().value!);
  }
  historyCache.delete(parent.path);
  historyCache.set(parent.path, { signature, records });
  while (historyCache.size > 8) historyCache.delete(historyCache.keys().next().value!);
  return new Map(records);
}

export function readPiActivity(parent: PiParent, stateDir: string, now = Date.now()): PiActivity {
  const live = liveRecords(parent, stateDir, now);
  let records: Map<string, PiRunRecord>;
  try { records = historicalRecords(parent); }
  catch (error) {
    // A bounded history failure must not erase a fresh service's live child facts.
    if (live === null) throw error;
    records = new Map();
  }
  const current = new Set(live?.map((r) => r.id) ?? []);
  for (const r of live ?? []) records.set(r.id, r);
  const activeNow = (r: PiRunRecord) => current.has(r.id) && (r.status === "running" || r.status === "queued");
  const tasks = [...records.values()].sort((a, b) => Number(activeNow(b)) - Number(activeNow(a)) || b.startedAt - a.startedAt).slice(0, MAX_RUNS).map((r): OmoTask => {
    const active = r.status === "running" || r.status === "queued";
    const fresh = live !== null && current.has(r.id);
    const status = active ? fresh ? "running" : "lost" : r.status === "completed" ? "completed" : r.status === "error" ? "failed" : "cancelled";
    const id = piTaskId(parent.path, r.id);
    return { id, title: r.description, category: r.type, model: null, status,
      started_at: new Date(r.startedAt).toISOString(), ended_at: r.completedAt === undefined ? null : new Date(r.completedAt).toISOString(),
      turns: null, tool_calls: r.toolUses, tokens: null, detail_id: id,
      ...(active && !fresh ? { phase: "unknown" as const } : r.status === "queued" ? { phase: "queued" as const } : {}) };
  });
  return { tasks, records, live: live !== null };
}

/** Copy presentation parts: never mutate the transcript page cache shared by other reads. */
export function piSubagentTurns(turns: ConversationTurn[], parent: string): ConversationTurn[] {
  const clean = (text: string) => text.replace(/^Output file: .*\n?/gm, "").replace(/^Full transcript available at: .*\n?/gm, "").replace(/<output-file>[\s\S]*?<\/output-file>\n?/g, "");
  return turns.map((turn) => ({ ...turn, parts: turn.parts.map((part) => {
    if (part.kind === "tool" && ["subagent", "get_subagent_result", "steer_subagent"].includes(part.name)) {
      const id = /^Agent ID: ([a-zA-Z0-9_-]+)$/m.exec(part.output)?.[1];
      return { ...part, output: clean(part.output), ...(id ? { subagent_id: piTaskId(parent, id) } : {}) };
    }
    if (part.kind === "notice" && part.source?.startsWith("subagent-")) return { ...part, text: clean(part.text) };
    return part;
  }) }));
}

/** Presentation-only status. Never feeds pending-input admission, agent status or Stop authority. */
export class PiSubagentStatus {
  private panes = new Map<string, { status: AgentStatus; count: number }>();
  private busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private epoch = 0;
  constructor(private stateDir: string, private changed: (id: string, count: number) => void,
    private resolveParent: (id: string) => Promise<PiParent | null> = piParentForPane) {}
  countOf(id: string): number { return this.panes.get(id)?.count ?? 0; }
  waiting(id: string): boolean { const p = this.panes.get(id); return !!p && p.count > 0 && (p.status === "idle" || p.status === "done"); }
  async refresh(panes: HerdrPane[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.read(panes, this.epoch); } finally { this.busy = false; }
  }
  private async read(panes: HerdrPane[], epoch: number): Promise<void> {
    const ids = new Set(panes.filter((p) => p.agent === "pi").map((p) => p.pane_id));
    for (const id of this.panes.keys()) if (!ids.has(id)) { this.panes.delete(id); this.changed(id, 0); }
    for (const pane of panes.filter((p) => p.agent === "pi")) {
      let count = 0;
      try { const parent = await this.resolveParent(pane.pane_id); if (parent) count = liveRecords(parent, this.stateDir, Date.now())?.filter((r) => r.status === "running" || r.status === "queued").length ?? 0; } catch { /* unknown never reads as running */ }
      if (epoch !== this.epoch) return;
      const previous = this.panes.get(pane.pane_id);
      this.panes.set(pane.pane_id, { status: pane.agent_status, count });
      if (previous?.count !== count || previous.status !== pane.agent_status) this.changed(pane.pane_id, count);
    }
  }
  start(snapshot: () => Promise<{ panes: HerdrPane[] }>): void {
    this.timer = setInterval(() => { void snapshot().then((s) => this.refresh(s.panes)).catch(() => undefined); }, 2000);
    this.timer.unref?.();
  }
  stop(): void { ++this.epoch; clearInterval(this.timer); this.panes.clear(); }
}
