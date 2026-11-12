import { resolve } from "node:path";
import { assertControlPlatform, requestLocalStop } from "./local-control.ts";

export function parseStopArgs(args: string[]): { help: boolean } {
  if (args.some((arg) => arg !== "--help" && arg !== "-h"))
    throw new Error("Unknown stop argument; use bun run stop --help. No PID, port or socket override is supported");
  return { help: args.length > 0 };
}

export async function stopLocal(): Promise<void> {
  assertControlPlatform();
  const root = resolve(import.meta.dir, "..");
  if (process.cwd() !== root)
    throw new Error("Run stop from the canonical repository root");
  const result = await requestLocalStop(resolve(root, ".agent-state/runtime/upstream-v10700"));
  console.log(result === "absent"
    ? "No launcher-owned Web control socket for this checkout; already not running through this control. Older launchers may still be running: use Ctrl-C in their verified foreground Web terminal. Nothing was signalled or changed."
    : "This checkout's foreground Web launcher acknowledged shutdown. Native Herdr/core and agent sessions were not stopped.");
}

if (import.meta.main) {
  try {
    if (parseStopArgs(process.argv.slice(2)).help) {
      console.log(`Herdr Web — stop this checkout's foreground Web launcher

Usage: bun run stop
       bun run stop --help

Linux/macOS only. Uses the fixed owner-private local control socket, not a PID,
port, HTTP endpoint, hc stop or shell command. Same-user cooperative boundary.
An absent socket changes nothing; older launchers still require Ctrl-C.
Unknown, stale or unresponsive sockets fail closed and are never deleted.
Windows: use Ctrl-C in the foreground Web terminal. Native hosts and agents remain running.`);
    } else {
      await stopLocal();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Web stop failed; state left unchanged");
    process.exitCode = 1;
  }
}
