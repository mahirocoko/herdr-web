// Adapted from devswha/herdr-web-ui a4ff0c942716602c43362f05c8511984e2bcae44.
// MIT; see UPSTREAM_LICENSE. No source provenance pin change.
import { join } from "node:path";
import { startHerdrCoreAdapter, type HerdrCoreAdapter } from "./adapter.ts";
import { HcConnection, spawnHcConnect } from "./connection.ts";

export type Runtime = "herdr" | "herdr-core";
let active: { socketPath: string; hc: HcConnection; } | undefined;

/** Only a successfully started adapter for this exact socket owns streaming authority. */
export function coreConnectionForSocket(socketPath: string): HcConnection | null {
  return active?.socketPath === socketPath ? active.hc : null;
}

/** Only the foreground fork launcher opts in; createServer/tests never start native processes. */
export function runtime(): Runtime {
  const value = process.env["OVIS_RUNTIME"];
  if (value === undefined || value === "" || value === "herdr") return "herdr";
  if (value !== "herdr-core") throw new Error("Unknown OVIS_RUNTIME; use herdr (default) or herdr-core");
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new Error("herdr-core is Linux/macOS only; no Windows named-pipe fallback");
  }
  return value;
}

/** Does not install, start a core server, rewrite HC_SOCKET/HC_SESSION, or guess an endpoint. */
export async function startRuntime(stateDir: string, options: { connection?: HcConnection; } = {}): Promise<HerdrCoreAdapter | null> {
  if (runtime() !== "herdr-core") return null;
  const previousSocket = process.env["HERDR_SOCKET"];
  const hc = options.connection ?? new HcConnection(() => spawnHcConnect(process.env["OVIS_HC_BIN"] || "hc"));
  try {
    const adapter = await startHerdrCoreAdapter(hc, join(stateDir, "herdr-core.sock"));
    process.env["HERDR_SOCKET"] = adapter.socketPath;
    active = { socketPath: adapter.socketPath, hc };
    let stopped = false;
    return {
      socketPath: adapter.socketPath,
      stop() {
        if (stopped) return;
        stopped = true;
        adapter.stop();
        hc.close();
        if (active?.hc === hc) active = undefined;
        if (process.env["HERDR_SOCKET"] === adapter.socketPath) {
          if (previousSocket === undefined) delete process.env["HERDR_SOCKET"];
          else process.env["HERDR_SOCKET"] = previousSocket;
        }
      },
    };
  } catch (error) {
    hc.close();
    throw error;
  }
}
