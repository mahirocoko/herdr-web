import { chmodSync, lstatSync, realpathSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Socket } from "bun";

const REQUEST = '{"version":1,"command":"stop"}\n';
const RESPONSE = '{"version":1,"status":"stopping"}\n';
const LIMIT = 128;
const TIMEOUT = 2000;
export const localControlPath = (stateDir: string) => join(stateDir, "web-control.sock");

export function assertControlPlatform(platform = process.platform): void {
  if (platform !== "linux" && platform !== "darwin")
    throw new Error("Web stop control is Linux/macOS only; use Ctrl-C in the foreground Web terminal on Windows");
}

/** Same-user cooperative privacy, not isolation from the owner or administrators.
 * Validate, never create or repair: stop must be read-only when no launcher exists.
 * Like the launcher/core privacy guard, the existing leaf must be canonical and owner-only.
 */
export function privateControlDirectory(stateDir: string): Stats | null {
  assertControlPlatform();
  if (resolve(stateDir) !== stateDir) throw new Error("Runtime path must be absolute and canonical");
  const state = lstatSync(stateDir, { throwIfNoEntry: false });
  if (!state) {
    let ancestor = dirname(stateDir);
    while (!lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = dirname(ancestor);
    if (realpathSync(ancestor) !== ancestor)
      throw new Error("Runtime ancestor is not canonical; left unchanged");
    return null;
  }
  if (!state.isDirectory() || realpathSync(stateDir) !== stateDir
    || state.uid !== process.geteuid?.() || (state.mode & 0o077) !== 0)
    throw new Error("Web control requires canonical owner-only runtime state; no permissions repaired");
  return state;
}

function sameNode(a: Stats, b: Stats | undefined): boolean {
  return !!b && a.dev === b.dev && a.ino === b.ino && a.uid === b.uid
    && (a.mode & 0o170000) === (b.mode & 0o170000);
}

function privateSocket(path: string): Stats | undefined {
  const node = lstatSync(path, { throwIfNoEntry: false });
  if (node && (!node.isSocket() || node.uid !== process.geteuid?.() || (node.mode & 0o777) !== 0o600))
    throw new Error("Web control path is not an owner-private socket; left unchanged");
  return node;
}

export function assertControlAvailable(stateDir: string): void {
  privateControlDirectory(stateDir);
  if (lstatSync(localControlPath(stateDir), { throwIfNoEntry: false }))
    throw new Error("Web control socket path is occupied; no existing node was changed. Use its verified owner or Ctrl-C; never auto-delete stale state");
}

type Peer = { bytes: string; timer: ReturnType<typeof setTimeout>; accepted: boolean };

/** Created only by the foreground launcher; fixtures use private temporary directories.
 * One bounded newline frame, no HTTP, PID discovery, shell, or native host stop.
 */
export function startLocalControl(stateDir: string, onStop: () => void, timeoutMs = TIMEOUT): { stop(): void } {
  const directory = privateControlDirectory(stateDir);
  if (!directory) throw new Error("Runtime directory is missing");
  assertControlAvailable(stateDir);
  const path = localControlPath(stateDir);
  const peers = new Set<Socket<Peer>>();
  let stopped = false;
  let requested = false;
  let delivered = false;
  const deliver = () => {
    if (!requested || delivered || stopped) return;
    delivered = true;
    onStop();
  };
  const listener = Bun.listen<Peer>({
    unix: path,
    socket: {
      open(socket) {
        socket.data = { bytes: "", accepted: false, timer: setTimeout(() => socket.terminate(), timeoutMs) };
        if (stopped || peers.size >= 8) { socket.terminate(); return; }
        peers.add(socket);
      },
      data(socket, chunk) {
        if (stopped || socket.data.accepted || socket.data.bytes.length + chunk.length > LIMIT) {
          socket.terminate(); return;
        }
        // Protocol is ASCII; comparing exact bytes also refuses malformed UTF-8/JSON and extra fields.
        socket.data.bytes += Buffer.from(chunk).toString("latin1");
        if (!socket.data.bytes.includes("\n")) return;
        if (socket.data.bytes !== REQUEST) { socket.terminate(); return; }
        socket.data.accepted = true;
        requested = true;
        socket.end(RESPONSE);
      },
      close(socket) {
        clearTimeout(socket.data.timer);
        peers.delete(socket);
        // Let the acknowledgment drain before the launcher's process.exit closes this connection.
        if (socket.data.accepted) deliver();
      },
      error(socket) { socket.terminate(); },
    },
  });
  const owned = lstatSync(path);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const peer of peers) { clearTimeout(peer.data.timer); peer.terminate(); }
    peers.clear();
    // Bun 1.4.2 stop() unlinks its original pathname even if replaced. Never call it
    // after losing identity. Unref + inert callbacks leave descriptor closure to exit.
    let matches = false;
    try {
      matches = owned.isSocket() && owned.uid === process.geteuid?.()
        && sameNode(directory, privateControlDirectory(stateDir) ?? undefined)
        && sameNode(owned, lstatSync(path, { throwIfNoEntry: false }));
    } catch { /* Unknown/replaced state is left unchanged. */ }
    if (matches) listener.stop(true);
    else listener.unref();
  };
  try { chmodSync(path, 0o600); } catch (error) { stop(); throw error; }
  return { stop };
}

/** Absence is a no-op, but stale, replaced, malformed and unresponsive sockets are errors. */
export async function requestLocalStop(stateDir: string, timeoutMs = TIMEOUT): Promise<"absent" | "stopping"> {
  if (!privateControlDirectory(stateDir)) return "absent";
  const path = localControlPath(stateDir);
  const owned = privateSocket(path);
  if (!owned) return "absent";
  return new Promise((resolve, reject) => {
    let peer: Socket | undefined;
    let bytes = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer?.terminate();
      if (error) reject(error);
      else resolve("stopping");
    };
    const fail = () => finish(new Error("Web stop was not acknowledged; socket left unchanged. Use the verified foreground Web terminal; no PID or port was signalled"));
    const timer = setTimeout(fail, timeoutMs);
    void Bun.connect({
      unix: path,
      socket: {
        open(socket) {
          peer = socket;
          if (settled) { socket.terminate(); return; }
          try {
            privateControlDirectory(stateDir);
            if (!sameNode(owned, privateSocket(path))) { fail(); return; }
            socket.write(REQUEST);
          } catch { fail(); }
        },
        data(_socket, chunk) {
          if (bytes.length + chunk.length > LIMIT) { fail(); return; }
          bytes += Buffer.from(chunk).toString("latin1");
          if (!RESPONSE.startsWith(bytes)) fail();
        },
        close() { if (bytes === RESPONSE) finish(); else fail(); },
        error: fail,
      },
    }).catch(fail);
  });
}
