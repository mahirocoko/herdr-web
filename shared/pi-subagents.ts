/** Private bridge wire format. Never send this snapshot (paths/PIDs/native ids) to the browser. */
export const PI_ACTIVITY_VERSION = 1;
export const PI_ACTIVITY_TTL_MS = 8000;
export const PI_ACTIVITY_MAX_BYTES = 16_384;
export const PI_ACTIVITY_MAX_TASKS = 24;

export interface PiRunRecord {
  id: string;
  type: string;
  description: string;
  status: "queued" | "running" | "completed" | "aborted" | "stopped" | "error";
  startedAt: number;
  completedAt?: number;
  toolUses: number;
  outputFile?: string;
}
export interface PiActivitySnapshot {
  version: 1;
  parentFile: string;
  parentSessionId: string;
  pid: number;
  updatedAt: number;
  records: PiRunRecord[];
}

export function piRunRecord(value: unknown): PiRunRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.id)
    || typeof r.type !== "string" || r.type.length > 128
    || typeof r.description !== "string" || r.description.length > 1024
    || !["queued", "running", "completed", "aborted", "stopped", "error"].includes(String(r.status))
    || typeof r.startedAt !== "number" || !Number.isFinite(r.startedAt) || r.startedAt < 0 || r.startedAt > 8.64e15
    || typeof r.toolUses !== "number" || !Number.isSafeInteger(r.toolUses) || r.toolUses < 0
    || (r.completedAt !== undefined && (typeof r.completedAt !== "number" || !Number.isFinite(r.completedAt) || r.completedAt < r.startedAt || r.completedAt > 8.64e15))
    || (r.outputFile !== undefined && (typeof r.outputFile !== "string" || r.outputFile.length > 4096))) return null;
  return { id: r.id, type: r.type, description: r.description, status: r.status as PiRunRecord["status"], startedAt: r.startedAt,
    toolUses: r.toolUses, ...(r.completedAt === undefined ? {} : { completedAt: r.completedAt as number }),
    ...(r.outputFile === undefined ? {} : { outputFile: r.outputFile as string }) };
}
