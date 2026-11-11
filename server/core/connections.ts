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
import { PaneWatch, type PaneWatchOptions } from "../watch.ts";
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

/** A connection owns at most this many observe processes, including ones still exiting. */
const MAX_WATCHES = 64;

interface PaneView {
  process: Pick<PaneWatch, "kill" | "exited">;
  /** No further frames or end notification are owed for this lifetime. */
  over: boolean;
  stopped: boolean;
  next?: { cols: number; rows: number };
}

interface ConnectionState {
  closing: boolean;
  revoked: boolean;
  /** the connection's authority: observe connections cannot type or resize */
  mode: ClientRole;
  /** how often `mode` changed: a switch away and back during an await is still a change */
  roles: number;
  watches: Map<string, PaneView>;
  /** Latest requested grids waiting for an exiting process's slot. */
  waiting: Map<string, { cols: number; rows: number }>;
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
  states.set(data, { closing: false, revoked: false, mode: fields.readOnly ? "observe" : "interact", roles: 0, watches: new Map<string, PaneView>(), waiting: new Map() });
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
export function createConnections<Lease>({ clients, present, pending, devices, detachClaimed, dropClaims, startWatch = (options) => new PaneWatch(options) }: {
  clients: Set<Client>;
  present: Set<Client>;
  pending: PendingInputs<Client, Lease>;
  devices: DeviceStore;
  detachClaimed: (client: Client) => void;
  dropClaims: (client: Client) => void;
  /** Test seam; production always starts the same read-only observe process. */
  startWatch?: (options: PaneWatchOptions) => Pick<PaneWatch, "kill" | "exited">;
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

  function stopView(view: PaneView): void {
    view.over = true;
    if (view.stopped) return;
    view.stopped = true;
    view.process.kill();
  }

  const wanted = (view: PaneView): boolean => !view.over || view.next !== undefined;

  function watchPane(client: Client, paneId: string, geometry: { cols: number; rows: number }): void {
    const state = stateOf(client);
    if (state.closing || !clients.has(client)) return;
    if (!paneWatchSupported()) {
      send(client, { type: "watch-end", pane_id: paneId });
      return;
    }
    const { watches, waiting } = state;
    if (waiting.has(paneId)) { waiting.set(paneId, geometry); return; }
    const current = watches.get(paneId);
    if (current && wanted(current)) {
      // Repeated geometry changes coalesce; a killed process still occupies its slot until exit.
      current.next = geometry;
      stopView(current);
      return;
    }
    let views = waiting.size;
    for (const view of watches.values()) if (wanted(view)) views++;
    if (views >= MAX_WATCHES) {
      send(client, { type: "watch-end", pane_id: paneId });
      return;
    }
    if (current) {
      // A canceled/ended view requested anew joins the queue; only an existing wanted resize
      // keeps its reservation. It must also wait for its own old process to leave.
      waiting.set(paneId, geometry);
      stopView(current);
      startWaiting(client);
    } else if (watches.size >= MAX_WATCHES) waiting.set(paneId, geometry);
    else startView(client, paneId, geometry);
  }

  function startWaiting(client: Client): void {
    const { watches, waiting } = stateOf(client);
    for (const [paneId, geometry] of waiting) {
      if (watches.size >= MAX_WATCHES) return;
      if (watches.has(paneId)) continue;
      waiting.delete(paneId);
      startView(client, paneId, geometry);
    }
  }

  function startView(client: Client, paneId: string, geometry: { cols: number; rows: number }): void {
    const state = stateOf(client);
    if (state.closing || !clients.has(client)) return;
    const socketPath = herdrSocketPath();
    if (!paneWatchSupported(socketPath)) {
      send(client, { type: "watch-end", pane_id: paneId });
      return;
    }
    const { watches } = state;
    try {
      let view: PaneView | undefined;
      const ended = (): void => {
        if (!view || watches.get(paneId) !== view || view.over) return;
        view.over = true;
        send(client, { type: "watch-end", pane_id: paneId });
      };
      const started: PaneView = view = { over: false, stopped: false, process: startWatch({
        paneId,
        ...geometry,
        socketPath,
        onFrame: (data) => {
          if (view && !view.over && watches.get(paneId) === view) send(client, { type: "watch-data", pane_id: paneId, data });
        },
        onEnd: ended,
      }) };
      watches.set(paneId, started);
      const exited = (): void => {
        // Closing clears the map: neither a replacement nor a queued view may restart afterward.
        if (watches.get(paneId) !== started) return;
        ended();
        watches.delete(paneId);
        if (started.next) startView(client, paneId, started.next);
        startWaiting(client);
      };
      void started.process.exited.then(exited, exited);
    } catch (error) {
      console.warn(`[watch] ${paneId} could not start: ${error instanceof Error ? error.message : String(error)}`);
      send(client, { type: "watch-end", pane_id: paneId });
    }
  }

  function unwatchPane(client: Client, paneId: string): void {
    const { watches, waiting } = stateOf(client);
    if (waiting.delete(paneId)) return;
    const view = watches.get(paneId);
    if (!view) return;
    view.next = undefined;
    stopView(view);
  }

  function killWatches(client: Client): void {
    const { watches, waiting } = stateOf(client);
    for (const view of watches.values()) stopView(view);
    watches.clear();
    waiting.clear();
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
