/**
 * A browser's WebSocket connection: what the upgrade records on it, what it may do, how a frame is
 * sent to it, the presence beat it sends, and how it ends. Only this module changes a connection's
 * authority, its observe processes and its closing.
 */
import type { ServerWebSocket } from "bun";
import { forkBrowserReplacer } from "../http.ts";
import type { ClientRole, ServerMessage } from "../../shared/protocol.ts";
import { OUTPUT_STALLED_CLOSE_CODE } from "../../shared/terminal-flow.ts";
import type { DeviceStore } from "../devices.ts";
import { HerdrError, herdrSocketPath } from "../herdr/client.ts";
import type { MachineRelay } from "../machine-relay.ts";
import { OUTPUT_HARD_BYTES, type OutputWindow } from "../output-window.ts";
import type { PendingInputs } from "../pending-input.ts";
import { PaneWatch } from "../watch.ts";
import { coreConnectionForSocket } from "../herdr-core/runtime.ts";

/** Core has no read-only viewport stream. Never substitute an attach (which can own geometry). */
export function paneWatchSupported(socketPath = herdrSocketPath()): boolean {
  return coreConnectionForSocket(socketPath) === null;
}

export interface SocketData {
  deviceId?: string;
  readOnly?: boolean;
  relay?: MachineRelay;
  /** A fresh claim per attach lifetime; deleting it invalidates queued terminal keys. */
  attached: Map<string, { keepSize: boolean }>;
  conversationInterests: Set<string>;
  output: Map<string, OutputWindow>;
}

interface ConnectionState {
  closing: boolean;
  revoked: boolean;
  /** the connection's authority: observe connections cannot type or resize */
  mode: ClientRole;
  /** how often `mode` changed: a switch away and back during an await is still a change */
  roles: number;
  watches: Map<string, PaneWatch>;
  unwatchDevice?: () => void;
  /** One oversized frame is excluded from the normal backlog while it drains in order. */
  excused?: { ahead: number; frame: number; last: number };
}

/** Keyed by the very `data` object the upgrade passed, which Bun hands to every handler of the connection. */
const states = new WeakMap<SocketData, ConnectionState>();

function stateOf(client: Client): ConnectionState {
  const state = states.get(client.data);
  if (!state) throw new Error("connection state missing: the socket's data is not the object its upgrade passed");
  return state;
}

/** The data for a connection's upgrade: it starts to interact unless its access is read-only. */
export function connectionData(fields: { relay?: MachineRelay; deviceId: string | undefined; readOnly: boolean }): SocketData {
  const data: SocketData = { attached: new Map<string, { keepSize: boolean }>(), conversationInterests: new Set<string>(), output: new Map(), ...fields };
  states.set(data, { closing: false, revoked: false, mode: fields.readOnly ? "observe" : "interact", roles: 0, watches: new Map<string, PaneWatch>() });
  return data;
}

/** The connection's live authority and closing, read where a check needs them; changed only here. */
export function connectionOf(client: Client): Readonly<Pick<ConnectionState, "closing" | "mode" | "roles">> {
  return stateOf(client);
}

/** A `presence` frame's answer, or null for any other frame. A relayed frame is only parsed when it can be one. */
export function presenceOf(raw: string | Buffer): boolean | null {
  const text = String(raw);
  if (!text.includes("\"presence\"")) return null;
  try {
    const message = JSON.parse(text) as { type?: unknown; active?: unknown };
    return message?.type === "presence" ? message.active === true : null;
  } catch {
    return null;
  }
}

export type Client = ServerWebSocket<SocketData>;

export function backlog(client: Client): number {
  const state = stateOf(client);
  const buffered = client.getBufferedAmount();
  const excused = state.excused;
  if (!excused) return buffered;
  excused.ahead = Math.max(0, excused.ahead - Math.max(0, excused.last - buffered));
  excused.last = buffered;
  if (excused.ahead === 0) {
    state.excused = undefined;
    return buffered;
  }
  return buffered - Math.min(excused.frame, excused.ahead);
}

export function send(client: Client, message: ServerMessage): number {
  const state = stateOf(client);
  if (state.closing) return 0;
  try {
    const encoded = JSON.stringify(message, forkBrowserReplacer);
    const bytes = Buffer.byteLength(encoded);
    const queued = backlog(client);
    const oversized = bytes > OUTPUT_HARD_BYTES && queued <= OUTPUT_HARD_BYTES && !state.excused;
    if (queued + (oversized ? 0 : bytes) > OUTPUT_HARD_BYTES) {
      client.close(OUTPUT_STALLED_CLOSE_CODE, "terminal output transport stalled");
      return 0;
    }
    // -1 means ALREADY queued. Never retry that frame, or terminal bytes repeat.
    const result = client.send(encoded);
    if (result === 0) client.close(OUTPUT_STALLED_CLOSE_CODE, "output delivery failed");
    else {
      const after = client.getBufferedAmount();
      if (oversized) state.excused = after > 0 ? { ahead: after, frame: Math.min(bytes, after), last: after } : undefined;
      else if (state.excused) state.excused.last = after;
    }
    return result;
  } catch {
    /* client vanished mid-send */
    return 0;
  }
}

/**
 * What a connection may do, its observe processes, and its end. A connection's panes stay with the
 * terminal code: `detachClaimed` detaches them while the claims still count, `dropClaims` forgets them.
 */
export function createConnections<Lease>({ clients, present, pending, devices, detachClaimed, dropClaims }: {
  clients: Set<Client>;
  present: Set<Client>;
  pending: PendingInputs<Client, Lease>;
  devices: DeviceStore;
  detachClaimed: (client: Client) => void;
  dropClaims: (client: Client) => void;
}) {
  /** authorizeSocket as a test: may this connection type now? */
  function mayType(client: Client): boolean {
    const state = stateOf(client);
    return clients.has(client) && !state.closing && !state.revoked && !client.data.readOnly && state.mode !== "observe";
  }

  function authorizeSocket(client: Client): void {
    const state = stateOf(client);
    if (state.revoked) throw new HerdrError("device_revoked", "this device's access was revoked");
    if (client.data.readOnly || state.mode === "observe") throw new HerdrError("read_only", "this connection can only watch");
  }

  /** Ends the connection when its device is revoked, at once for one revoked already: then it is not admitted. */
  function admit(client: Client): boolean {
    const state = stateOf(client);
    if (client.data.deviceId) {
      state.unwatchDevice = devices.onRevoke(client.data.deviceId, () => end(client, "revoked"));
      if (state.revoked) return false;
    }
    return true;
  }

  function setRole(client: Client, mode: ClientRole): void {
    const state = stateOf(client);
    if (state.mode !== mode) state.roles++;
    state.mode = mode;
  }

  function watchPane(client: Client, paneId: string, geometry: { cols: number; rows: number }): void {
    const { watches } = stateOf(client);
    watches.get(paneId)?.kill();
    watches.delete(paneId);
    const socketPath = herdrSocketPath();
    if (!paneWatchSupported(socketPath)) {
      send(client, { type: "watch-end", pane_id: paneId });
      return;
    }
    try {
      const watch = new PaneWatch({
        paneId,
        ...geometry,
        socketPath,
        onFrame: (data) => send(client, { type: "watch-data", pane_id: paneId, data }),
        onEnd: () => {
          if (watches.get(paneId) !== watch) return;
          watches.delete(paneId);
          send(client, { type: "watch-end", pane_id: paneId });
        },
      });
      watches.set(paneId, watch);
    } catch (error) {
      console.warn(`[watch] ${paneId} could not start: ${error instanceof Error ? error.message : String(error)}`);
      send(client, { type: "watch-end", pane_id: paneId });
    }
  }

  function unwatchPane(client: Client, paneId: string): void {
    const { watches } = stateOf(client);
    watches.get(paneId)?.kill();
    watches.delete(paneId);
  }

  function killWatches(client: Client): void {
    const { watches } = stateOf(client);
    for (const watch of watches.values()) watch.kill();
    watches.clear();
  }

  /**
   * Ends the connection, each way as it always did: its output consumer stalled, its device was
   * revoked, or its socket closed. A close follows the other two and runs as well.
   */
  function end(client: Client, reason: "stalled" | "revoked" | "closed"): void {
    const state = stateOf(client);
    switch (reason) {
      case "stalled": {
        if (state.closing) return;
        state.closing = true;
        killWatches(client);
        pending.close(client);
        clients.delete(client);
        detachClaimed(client);
        dropClaims(client);
        client.close(OUTPUT_STALLED_CLOSE_CODE, "terminal output consumer stalled");
        return;
      }
      case "revoked": {
        state.revoked = true;
        state.closing = true;
        killWatches(client);
        clients.delete(client);
        present.delete(client);
        detachClaimed(client);
        dropClaims(client);
        client.data.relay?.close(1008, "Device access revoked");
        client.close(1008, "Device access revoked");
        return;
      }
      case "closed": {
        state.unwatchDevice?.();
        state.closing = true;
        present.delete(client);
        if (client.data.relay) { client.data.relay.close(); return; }
        killWatches(client);
        pending.close(client);
        clients.delete(client);
        detachClaimed(client);
        dropClaims(client);
        return;
      }
    }
  }

  return { mayType, authorizeSocket, admit, setRole, watchPane, unwatchPane, killWatches, end };
}
