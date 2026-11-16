import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import type { AgentStatus, HerdrPane, SessionSnapshot } from "../shared/protocol.ts";

export type ProviderTurnEnd = "failed" | "answered" | "running" | null;
const LIMIT = 256 * 1024;
const supported = (agent: string | null | undefined): boolean => agent === "codex" || agent === "claude";
const resting = (status: AgentStatus): boolean => status === "idle" || status === "done" || status === "unknown";
const paneKey = (pane: HerdrPane): string => JSON.stringify([pane.agent, pane.terminal_id, pane.agent_session ?? null]);

/** Complete appended records only. A second parent turn is not the observed turn's end. */
export function providerTurnEnd(agent: string, text: string): ProviderTurnEnd {
  let end: ProviderTurnEnd = null;
  let turn: string | undefined;
  let sawAssistant = false;
  for (const line of text.split("\n").slice(0, -1)) {
    if (!line.trim()) continue;
    let entry: any;
    try { entry = JSON.parse(line); } catch { return null; }
    if (!entry || typeof entry !== "object") return null;
    if (agent === "codex") {
      if (entry.type !== "event_msg" || !entry.payload || typeof entry.payload !== "object") continue;
      const p = entry.payload;
      const id = typeof p.turn_id === "string" ? p.turn_id : undefined;
      const root = typeof p.root_turn_id === "string" ? p.root_turn_id : undefined;
      if (id && root && id !== root) continue;
      if (p.type === "task_started" || p.type === "turn_started") {
        if (turn !== undefined && id !== turn) return null;
        turn = id; end = "running";
      } else if (["task_complete", "turn_complete", "turn_aborted"].includes(p.type)) {
        if (turn !== undefined && id !== undefined && id !== turn) continue;
        turn ??= id;
        end = p.type === "task_complete" && typeof p.error?.message === "string" && p.error.message.trim() ? "failed" : "answered";
      }
    } else if (agent === "claude" && entry.isSidechain !== true) {
      if (entry.type === "user" && entry.isMeta !== true) {
        const content = entry.message?.content;
        const human = typeof content === "string" ? !/^\s*<(?:task-notification|teammate-message)\b/.test(content)
          : Array.isArray(content) && content.some((part: any) => part?.type === "text" || part?.type === "image");
        if (human && sawAssistant) return null;
        if (human) end = "running";
      }
      if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
      sawAssistant = true;
      end = entry.isApiErrorMessage === true ? "failed" : entry.message.stop_reason === "end_turn" ? "answered" : "running";
    }
  }
  return end;
}

export interface ProviderBinding { path: string; identity: string; }
interface FileMark { id: string; from: number; anchor: string; }
interface Mark extends FileMark { binding: ProviderBinding; agent: string; }
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const fileId = (stat: ReturnType<typeof fstatSync>): string => `${stat.dev}:${stat.ino}`;
function openPlain(path: string): number {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  if (!fstatSync(fd).isFile()) { closeSync(fd); throw new Error("Not a regular transcript"); }
  return fd;
}
function anchor(fd: number, size: number): string {
  const bytes = Buffer.alloc(Math.min(size, 1024));
  if (readSync(fd, bytes, 0, bytes.length, size - bytes.length) !== bytes.length) throw new Error("Short transcript read");
  return hash(bytes);
}
function markFile(path: string): FileMark | null {
  let fd: number | undefined;
  try {
    fd = openPlain(path);
    const stat = fstatSync(fd), stamp = anchor(fd, stat.size), after = fstatSync(fd);
    return stat.size === after.size && stat.mtimeMs === after.mtimeMs && stat.ctimeMs === after.ctimeMs
      ? { id: fileId(stat), from: stat.size, anchor: stamp } : null;
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function readEnd(mark: Mark): ProviderTurnEnd {
  let fd: number | undefined;
  try {
    fd = openPlain(mark.binding.path);
    const stat = fstatSync(fd);
    if (fileId(stat) !== mark.id || stat.size <= mark.from || stat.size - mark.from > LIMIT || anchor(fd, mark.from) !== mark.anchor) return null;
    const bytes = Buffer.alloc(stat.size - mark.from);
    if (readSync(fd, bytes, 0, bytes.length, mark.from) !== bytes.length) return null;
    const after = fstatSync(fd);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) return null;
    return providerTurnEnd(mark.agent, bytes.toString("utf8"));
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

/**
 * Presentation-only failure evidence for turns observed after a live binding was established.
 * Native/completion status remains separate for manual input. Pending checks hold automatic
 * delivery while evidence is being resolved; a failure never grants idle/send authority.
 */
export class ProviderFailures {
  private readonly panes = new Map<string, HerdrPane>();
  private readonly statuses = new Map<string, AgentStatus>();
  private readonly bindings = new Map<string, ProviderBinding>();
  private readonly marks = new Map<string, Mark>();
  private readonly failures = new Set<string>();
  private readonly jobs = new Map<string, { check: boolean }>();
  private eventVersion = 0;
  private snapshotOrder = 0;
  private appliedOrder = 0;
  constructor(private readonly deps: {
    resolve: (pane: HerdrPane) => Promise<ProviderBinding | null>;
    onChange: (paneId: string) => void;
    timeoutMs?: number;
  }) {}

  /** Capture before the native snapshot starts, not after its asynchronous provider enrichment. */
  capture(): { event: number; order: number } { return { event: this.eventVersion, order: ++this.snapshotOrder }; }
  observe(paneId: string, status: AgentStatus, agent: string | null): void {
    this.eventVersion++;
    this.observeCurrent(paneId, status, agent);
  }
  private observeCurrent(paneId: string, status: AgentStatus, agent: string | null): void {
    if (!supported(agent)) { this.clear(paneId); return; }
    const before = this.statuses.get(paneId);
    this.statuses.set(paneId, status);
    if (status === "working" && before !== "working") {
      this.jobs.delete(paneId);
      this.failures.delete(paneId);
      this.marks.delete(paneId);
      const binding = this.bindings.get(paneId), pane = this.panes.get(paneId);
      const file = binding && pane?.agent === agent ? markFile(binding.path) : null;
      if (binding && file) this.marks.set(paneId, { ...file, binding, agent: agent! });
    } else if (status === "blocked") {
      this.jobs.delete(paneId); this.failures.delete(paneId); this.marks.delete(paneId);
    }
    const pane = this.panes.get(paneId);
    if (pane && resting(status) && this.marks.has(paneId)) void this.lookup({ ...pane, agent_status: status }, true);
  }

  held(paneId: string): boolean { return this.failures.has(paneId) || this.jobs.get(paneId)?.check === true; }
  display(paneId: string, status: AgentStatus): AgentStatus {
    if (!resting(status)) return status;
    return this.failures.has(paneId) ? "failed" : this.jobs.get(paneId)?.check ? "unknown" : status;
  }
  apply(snapshot: SessionSnapshot): SessionSnapshot {
    return { ...snapshot, panes: snapshot.panes.map((pane) => ({ ...pane, agent_status: this.display(pane.pane_id, pane.agent_status) })) };
  }
  forget(paneId: string): void { this.eventVersion++; this.clear(paneId); }
  private clear(paneId: string): void {
    this.panes.delete(paneId); this.statuses.delete(paneId); this.bindings.delete(paneId);
    this.marks.delete(paneId); this.failures.delete(paneId); this.jobs.delete(paneId);
  }
  async refresh(panes: readonly HerdrPane[], ticket = this.capture()): Promise<void> {
    // A late Working snapshot must not clear a newer failed/Done event. Newer reads also win.
    if (ticket.event !== this.eventVersion || ticket.order < this.appliedOrder) return;
    this.appliedOrder = ticket.order;
    const live = new Set(panes.map((pane) => pane.pane_id));
    for (const id of this.panes.keys()) if (!live.has(id)) this.clear(id);
    await Promise.all(panes.filter((pane) => supported(pane.agent)).map(async (pane) => {
      const before = this.panes.get(pane.pane_id);
      if (before && paneKey(before) !== paneKey(pane)) this.clear(pane.pane_id);
      this.panes.set(pane.pane_id, { ...pane });
      this.observeCurrent(pane.pane_id, pane.agent_status, pane.agent ?? null);
      await this.lookup(pane, resting(pane.agent_status) && this.marks.has(pane.pane_id));
    }));
    for (const pane of panes) if (!supported(pane.agent)) this.clear(pane.pane_id);
  }
  private async lookup(pane: HerdrPane, check: boolean): Promise<void> {
    const id = pane.pane_id;
    const existing = this.jobs.get(id);
    if (existing) { existing.check ||= check; return; }
    const job = { check }, mark = this.marks.get(id);
    this.jobs.set(id, job);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const binding = await Promise.race([
        this.deps.resolve(pane).catch(() => null),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), this.deps.timeoutMs ?? 1000); }),
      ]);
      if (this.jobs.get(id) !== job || paneKey(this.panes.get(id) ?? pane) !== paneKey(pane)) return;
      const previous = this.bindings.get(id);
      if (!binding || (previous && (previous.identity !== binding.identity || previous.path !== binding.path))) {
        this.bindings.delete(id); this.marks.delete(id); this.failures.delete(id);
        if (binding) this.bindings.set(id, binding);
        return;
      }
      this.bindings.set(id, binding);
      if (!job.check || !mark || this.marks.get(id) !== mark || !resting(this.statuses.get(id) ?? "unknown")) return;
      if (mark.binding.path !== binding.path || mark.binding.identity !== binding.identity) { this.marks.delete(id); this.failures.delete(id); return; }
      const end = readEnd(mark);
      if (end === "failed") this.failures.add(id);
      else this.failures.delete(id);
      if (end === "answered") this.marks.delete(id);
    } finally {
      clearTimeout(timer);
      if (this.jobs.get(id) === job) {
        this.jobs.delete(id);
        if (job.check) this.deps.onChange(id);
      }
    }
  }
}
