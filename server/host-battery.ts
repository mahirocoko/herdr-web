import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export type HostBattery = { status: "available"; percent: number; power: "charging" | "charged" | "not-charging" | "discharging" } | { status: "unavailable" };

/** Parse only the built-in battery line; never return command output to the browser. */
export function parseHostBattery(output: string): HostBattery {
  const line = output.split("\n").find((value) => /InternalBattery/i.test(value));
  if (!line) return { status: "unavailable" };
  const match = line.match(/\b(100|[1-9]?\d)%;\s*(AC attached;\s*not charging|charging|discharging|charged|finishing charge)\b/i);
  if (!match || !match[1] || !match[2]) return { status: "unavailable" };
  const state = match[2].toLowerCase();
  const power = state.startsWith("ac attached") ? "not-charging" : state === "charged" ? "charged" : state === "discharging" ? "discharging" : "charging";
  return { status: "available", percent: Number(match[1]), power };
}

export async function readHostBattery(): Promise<HostBattery> {
  if (process.platform !== "darwin") return { status: "unavailable" };
  try {
    const { stdout } = await run("/usr/bin/pmset", ["-g", "batt"], { timeout: 3000, maxBuffer: 16384 });
    return parseHostBattery(stdout);
  } catch { return { status: "unavailable" }; }
}
