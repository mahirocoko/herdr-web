import { lstatSync, opendirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { AgentSessionInfo } from "../../shared/herdr-api.generated.ts";
import { PI_ACTIVITY_MAX_BYTES, PI_ACTIVITY_MAX_TASKS, PI_ACTIVITY_TTL_MS, PI_ACTIVITY_VERSION, piRunRecord } from "../../shared/pi-subagents.ts";
import { readPrivateConfiguration } from "../../scripts/private-filesystem.ts";
import { isPiProcess, piTranscriptPath } from "../pi.ts";
import { piActivityName, piSessionHeader } from "../pi-subagents.ts";
import { processInfoOf, type HcTerminal } from "./snapshot.ts";

export const CORE_PI_OBSERVER_SOURCE = "herdr-core:pi-observer";
const MAX_RECEIPTS = 128;

/** A private, fresh exact-SessionManager receipt is the authority, never OSC text/labels.
 * The single runtime-neutral mahiro-pi producer must already be configured and activated in Pi.
 * Its session lifecycle is automatic; Web never installs, configures or reloads that resource.
 */
export async function corePiSession(terminal: HcTerminal, stateDir: string, options: { now?: number; sessionDir?: string; } = {}): Promise<AgentSessionInfo | undefined> {
  if (process.platform === "win32" || terminal.state !== "live" || terminal.status?.app !== "pi") return;
  const foreground = terminal.foreground;
  if (!foreground || !Number.isSafeInteger(foreground.pid) || foreground.pid <= 0 || !foreground.argv?.length || !isPiProcess(foreground.argv)) return;
  const now = options.now ?? Date.now();
  const directory = join(stateDir, "pi-subagents");
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== process.geteuid?.() || (stat.mode & 0o077) !== 0 || realpathSync(directory) !== directory) return;
    const files: string[] = [];
    const entries = opendirSync(directory);
    try {
      for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
        if (files.length === MAX_RECEIPTS) return;
        files.push(entry.name);
      }
    } finally { entries.closeSync(); }
    const matches: AgentSessionInfo[] = [];
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      const path = join(directory, file);
      const receiptStat = lstatSync(path);
      if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > PI_ACTIVITY_MAX_BYTES) continue;
      const receipt = readPrivateConfiguration(path);
      if (!receipt || receipt.version !== PI_ACTIVITY_VERSION || receipt.pid !== foreground.pid
        || typeof receipt.updatedAt !== "number" || !Number.isFinite(receipt.updatedAt)
        || now - receipt.updatedAt < -1000 || now - receipt.updatedAt > PI_ACTIVITY_TTL_MS
        || typeof receipt.parentFile !== "string" || typeof receipt.parentSessionId !== "string"
        || piActivityName(receipt.parentFile) !== file || realpathSync(receipt.parentFile) !== receipt.parentFile
        || (receipt.activity !== undefined && receipt.activity !== "unavailable")
        || !Array.isArray(receipt.records) || receipt.records.length > PI_ACTIVITY_MAX_TASKS
        || (receipt.activity === "unavailable" && receipt.records.length !== 0)) continue;
      const records = receipt.records.map(piRunRecord);
      if (records.some((record) => record === null) || new Set(records.map((record) => record!.id)).size !== records.length) continue;
      if (piSessionHeader(receipt.parentFile)?.id !== receipt.parentSessionId) continue;
      const session: AgentSessionInfo = { agent: "pi", source: CORE_PI_OBSERVER_SOURCE, kind: "path", value: receipt.parentFile };
      // Reuse the current Pi store/process guards, including custom-store and --session-dir refusal.
      const found = await piTranscriptPath(terminal.address, options.sessionDir, {
        agent: {
          agent: "pi", agent_status: "unknown", pane_id: terminal.address, terminal_id: terminal.address,
          workspace_id: "", tab_id: "", focused: false, revision: 0, agent_session: session
        },
        processes: processInfoOf(terminal).foreground_processes,
      });
      if (found && "path" in found && found.path === receipt.parentFile) matches.push(session);
    }
    // A PID can host several SessionManagers. Never choose newest, text-match, or guess the parent.
    return matches.length === 1 ? matches[0] : undefined;
  } catch { return; }
}
