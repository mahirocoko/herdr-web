// Adapted from devswha/herdr-web-ui a4ff0c942716602c43362f05c8511984e2bcae44.
// MIT; see UPSTREAM_LICENSE. Fork opt-in compatibility, not a source repin.
import { chmodSync, lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Socket } from "bun";
import { type HcConnection, HcError } from "./connection.ts";
import { agentInfoOf, agentOfStatus, agentStatusOf, buildSnapshot, type HcTerminal, hcKeyName, HERDR_PROTOCOL, isRecord, keyBytes, LAYOUT_DOC, processInfoOf } from "./snapshot.ts";
import type { SessionSnapshot } from "../../shared/herdr-api.generated.ts";
import { corePiSession } from "./pi-binding.ts";

/**
 * herdr's socket API, answered from herdr-core. The server talks to herdr through one client
 * (server/herdr/client.ts) whose callers read herdr's session snapshot, panes, screens and status
 * events; this adapter listens where that client connects (HERDR_SOCKET) and answers the methods a
 * terminal view needs from hc, so none of those callers learns a second runtime:
 *
 * - `ping`, `session.snapshot`, `pane.get`, `agent.get`, `pane.process_info` and `pane.read` from
 *   hc's terminal records, the app's layout document and `terminal.read`;
 * - `pane.send_text` as bytes typed into the terminal, over a short attach stream at the
 *   terminal's own grid (hc has no other way to type raw bytes, and a viewer at the current size
 *   resizes nothing);
 * - `pane.send_keys` as those keys' bytes in the same way, or hc's `terminal.keys` for a key that
 *   only hc can encode for the program's keyboard mode;
 * - `agent.prompt` as hc's `terminal.send` (paste and Enter, refused while the program is blocked);
 * - `events.subscribe` from hc's own event stream: status changes per pane, and terminal and layout
 *   changes as herdr's lifecycle events.
 *
 * Everything else (workspaces, tabs, splits, focus, worktrees, plugins) belongs to the Herdr app's
 * window and is refused as `unsupported`. This fork streams terminal channels directly; it does not start `hc attach` or a PTY.
 *
 * As herdr does, each request has a connection of its own that ends with its answer; only an
 * events subscription stays open.
 */

const LINE_BYTES = 16 * 1024 * 1024;
/** Bounded UTF-8 line framing, local to the compatibility socket (not the old runtime client). */
function makeLineReader(limit: number, onLine: (line: string) => void, onOversize: () => void): (chunk: Uint8Array) => void {
  let tail = new Uint8Array(0);
  let failed = false;
  return (chunk) => {
    if (failed) return;
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start);
      const piece = chunk.subarray(start, end < 0 ? chunk.length : end);
      if (tail.length + piece.length > limit) { failed = true; tail = new Uint8Array(0); onOversize(); return; }
      const line = new Uint8Array(tail.length + piece.length);
      line.set(tail); line.set(piece, tail.length);
      tail = end < 0 ? line : new Uint8Array(0);
      if (end < 0) return;
      onLine(new TextDecoder().decode(line));
      start = end + 1;
    }
  };
}

interface Request { id: string; method: string; params: Record<string, unknown>; }
type Reply = { result: unknown; } | { error: { code: string; message: string; }; };

class AdapterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Ovis's subscription types that are status, not structure. */
const STATUS_EVENT = "pane.agent_status_changed";
const NOT_STRUCTURE = new Set([STATUS_EVENT, "pane.focused", "pane.output_matched"]);
/** A status or layout notification must fit in 4 MiB, even across hc frames. */
const EVENT_LINE_BYTES = 4 * 1024 * 1024;

interface ConnectionState {
  read: (chunk: Uint8Array) => void;
  /** bytes the kernel did not take yet */
  queue: Uint8Array[];
  /** end once the queue is out */
  ending: boolean;
  /** an events subscription this connection holds on hc */
  unsubscribe: (() => void) | null;
  closed: boolean;
}

export interface HerdrCoreAdapter {
  /** where it listens: the server's HERDR_SOCKET */
  socketPath: string;
  stop: () => void;
}

export async function startHerdrCoreAdapter(hc: HcConnection, socketPath: string): Promise<HerdrCoreAdapter> {
  const directory = dirname(socketPath);
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || realpathSync(directory) !== resolve(directory)
    || parent.uid !== process.geteuid?.() || (parent.mode & 0o077) !== 0) {
    throw new Error("herdr-core requires an existing canonical owner-only state directory");
  }
  // Even a stale socket is unknown work. Never unlink, probe, or repair it automatically.
  if (lstatSync(socketPath, { throwIfNoEntry: false })) {
    throw new Error("herdr-core socket path is occupied; no existing file was changed");
  }
  const answers = createAnswers(hc, directory);
  const listener = Bun.listen<ConnectionState>({
    unix: socketPath,
    socket: {
      open(socket) {
        let first = true;
        socket.data = {
          queue: [],
          ending: false,
          unsubscribe: null,
          closed: false,
          read: makeLineReader(LINE_BYTES, (line) => {
            // one request per connection, as herdr reads it
            if (!first) return;
            first = false;
            const request = parseRequest(line);
            if (!request) { send(socket, `${JSON.stringify({ id: "", error: { code: "bad_frame", message: "not a herdr request" } })}\n`, true); return; }
            if (request.method === "events.subscribe") { void subscribe(hc, socket, request); return; }
            void answers(request).then((reply) => send(socket, `${JSON.stringify({ id: request.id, ...reply })}\n`, true));
          }, () => socket.end()),
        };
      },
      data(socket, chunk) {
        socket.data.read(chunk);
      },
      drain(socket) {
        flush(socket);
      },
      close(socket) {
        socket.data.closed = true;
        socket.data.unsubscribe?.();
      },
      error(socket) {
        socket.data.closed = true;
        socket.data.unsubscribe?.();
      },
    },
  });
  chmodSync(socketPath, 0o600);
  return {
    socketPath,
    stop: () => {
      // Bun owns the socket lifecycle. Do not remove a path that may have been replaced.
      listener.stop(true);
    },
  };
}

function parseRequest(line: string): Request | null {
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(frame) || typeof frame["id"] !== "string" || typeof frame["method"] !== "string") return null;
  return { id: frame["id"], method: frame["method"], params: isRecord(frame["params"]) ? frame["params"] : {} };
}

function send(socket: Socket<ConnectionState>, text: string, end = false): void {
  const state = socket.data;
  if (state.closed) return;
  const bytes = new TextEncoder().encode(text);
  if (state.queue.reduce((size, queued) => size + queued.length, bytes.length) > LINE_BYTES) {
    state.closed = true;
    state.unsubscribe?.();
    socket.end();
    return;
  }
  state.queue.push(bytes);
  if (end) state.ending = true;
  flush(socket);
}

function flush(socket: Socket<ConnectionState>): void {
  const state = socket.data;
  while (state.queue.length > 0) {
    const next = state.queue[0]!;
    const written = socket.write(next);
    if (written < next.length) {
      state.queue[0] = next.subarray(Math.max(0, written));
      return;
    }
    state.queue.shift();
  }
  if (state.ending) socket.end();
}

function paneIdOf(params: Record<string, unknown>, field = "pane_id"): string {
  const value = params[field];
  if (typeof value !== "string" || value === "") throw new AdapterError("invalid_params", `${field} is required`);
  return value;
}

/** hc's refusal in herdr's words, where the server acts on them. */
function herdrCode(error: HcError, missing: string): string {
  switch (error.kind) {
    case "not_found": return missing;
    case "blocked": return "agent_blocked";
    case "unavailable": return "server_unavailable";
    case "timeout": return "timeout";
    // the line to hc ended or never spoke its protocol: hc cannot be reached, as a herdr socket nobody answers
    case "closed":
    case "bad_hello":
    case "bad_frame":
      return "connect_failed";
    default: return error.kind;
  }
}

function createAnswers(hc: HcConnection, stateDir: string): (request: Request) => Promise<Reply> {
  const terminal = async (address: string, missing = "pane_not_found"): Promise<HcTerminal> => {
    const record = await hc.call<{ terminal: HcTerminal; } | HcTerminal>("terminal.get", { terminal: address }).catch((error: unknown) => {
      throw error instanceof HcError ? new AdapterError(herdrCode(error, missing), error.message) : error;
    });
    const found = "terminal" in record ? record.terminal : record;
    if (found.state !== "live") throw new AdapterError(missing, `terminal ${address} has finished`);
    return found;
  };

  const snapshot = async (): Promise<SessionSnapshot> => {
    const [list, doc, hello] = await Promise.all([
      hc.call<{ terminals: HcTerminal[]; }>("terminal.list", {}),
      hc.call<{ value: unknown; }>("doc.get", { name: LAYOUT_DOC }),
      hc.hello(),
    ]);
    const shown = buildSnapshot(list.terminals, doc.value, hello.version);
    await Promise.all(shown.panes.map(async (pane) => {
      const record = list.terminals.find((terminal) => terminal.address === pane.pane_id);
      if (!record || pane.agent !== "pi") return;
      const session = await corePiSession(record, stateDir);
      if (session) pane.agent_session = session;
    }));
    shown.agents = shown.panes.filter((pane) => pane.agent).map(agentInfoOf);
    return shown;
  };

  const paneOf = async (paneId: string, missing = "pane_not_found") => {
    const found = (await snapshot()).panes.find((pane) => pane.pane_id === paneId);
    if (!found) throw new AdapterError(missing, `pane ${paneId} not found`);
    return found;
  };

  /**
   * Bytes typed into the terminal, as a person at it would: over an attach at the grid hc says the
   * terminal has (a viewer that typed sets the size, so it must set this one), answered once hc
   * took the close that follows them, so what the caller does next comes after the bytes.
   */
  const type = async (paneId: string, bytes: string): Promise<void> => {
    const record = await terminal(paneId);
    const { result, channel } = await hc.open<{ channel: number; terminal?: HcTerminal; }>("terminal.attach", { terminal: paneId, cols: record.cols, rows: record.rows }, { onData: () => { }, onClose: () => { } });
    // resized since it was looked up: type at the size it has now
    const now = result.terminal;
    if (now && (now.cols !== record.cols || now.rows !== record.rows)) channel.resize(now.cols, now.rows);
    channel.write(bytes);
    await channel.close();
  };

  /** Input to one pane in the order it was asked for: each attach and its bytes finish before the next. */
  const turns = new Map<string, Promise<unknown>>();
  const inTurn = <T>(paneId: string, work: () => Promise<T>): Promise<T> => {
    const run = (turns.get(paneId) ?? Promise.resolve()).then(work, work);
    const settled = run.then(() => { }, () => { });
    turns.set(paneId, settled);
    void settled.then(() => { if (turns.get(paneId) === settled) turns.delete(paneId); });
    return run;
  };

  const methods: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    async ping() {
      const hello = await hc.hello();
      return { version: hello.version, protocol: HERDR_PROTOCOL, capabilities: { direct_terminal_attach: true, runtime: "herdr-core" } };
    },
    async "session.snapshot"() {
      return { snapshot: await snapshot() };
    },
    async "pane.get"(params) {
      return { pane: await paneOf(paneIdOf(params)) };
    },
    async "agent.get"(params) {
      const pane = await paneOf(paneIdOf(params, "target"), "agent_not_found");
      if (!pane.agent) throw new AdapterError("agent_not_found", `no agent in pane ${pane.pane_id}`);
      return { type: "agent_info", agent: agentInfoOf(pane) };
    },
    async "pane.process_info"(params) {
      return { type: "pane_process_info", process_info: processInfoOf(await terminal(paneIdOf(params))) };
    },
    async "pane.read"(params) {
      const paneId = paneIdOf(params);
      const pane = await paneOf(paneId);
      const source = typeof params["source"] === "string" ? params["source"] : "visible";
      const format = typeof params["format"] === "string" ? params["format"] : "text";
      const recent = source === "recent" || source === "recent_unwrapped";
      const wanted = typeof params["lines"] === "number" && params["lines"] > 0 ? Math.floor(params["lines"]) : null;
      // hc reads the screen plus `lines` of history above it; herdr's recent read is the last `lines` lines
      const read = await hc.call<{ text: string; complete: boolean; }>("terminal.read", { terminal: paneId, lines: recent ? wanted ?? 1000 : 0 });
      let text = read.text;
      if (recent && wanted !== null) {
        const rows = text.split("\n");
        if (rows.length > wanted) text = rows.slice(-wanted).join("\n");
      }
      // hc reads text only: plain text is an ANSI screen without colours
      return { read: { pane_id: paneId, workspace_id: pane.workspace_id, tab_id: pane.tab_id, source, format, text, revision: pane.revision, truncated: !read.complete } };
    },
    async "pane.send_text"(params) {
      const text = params["text"];
      if (typeof text !== "string") throw new AdapterError("invalid_params", "text is required");
      const paneId = paneIdOf(params);
      await inTurn(paneId, () => type(paneId, text));
      return { type: "ok" };
    },
    async "pane.send_keys"(params) {
      const paneId = paneIdOf(params);
      const keys = Array.isArray(params["keys"]) ? params["keys"].filter((key): key is string => typeof key === "string") : [];
      await inTurn(paneId, async () => {
        // in order: a run of printable characters typed at once, a run of named keys and chords
        // through hc, which encodes them for the program's current keyboard modes
        let typed = "";
        let named: string[] = [];
        const sendRun = async () => {
          if (typed) { await type(paneId, typed); typed = ""; }
          if (named.length > 0) { await hc.call("terminal.keys", { terminal: paneId, keys: named }); named = []; }
        };
        for (const key of keys) {
          const bytes = keyBytes(key);
          if (bytes !== null ? named.length > 0 : typed !== "") await sendRun();
          if (bytes !== null) typed += bytes;
          else named.push(hcKeyName(key));
        }
        await sendRun();
      });
      return { type: "ok" };
    },
    async "agent.prompt"(params) {
      const paneId = paneIdOf(params, "target");
      const text = params["text"];
      if (typeof text !== "string") throw new AdapterError("invalid_params", "text is required");
      if (!(await paneOf(paneId, "agent_not_found")).agent) throw new AdapterError("agent_not_found", `no agent in pane ${paneId}`);
      await inTurn(paneId, () => hc.call("terminal.send", { terminal: paneId, text }, 30_000));
      return { type: "ok" };
    },

  };

  return async (request) => {
    const method = Object.hasOwn(methods, request.method) ? methods[request.method] : undefined;
    if (!method) return { error: { code: "unsupported", message: `${request.method} is not available on herdr-core: the Herdr app owns its workspaces, tabs and panes` } };
    try {
      return { result: await method(request.params) };
    } catch (error) {
      if (error instanceof AdapterError) return { error: { code: error.code, message: error.message } };
      if (error instanceof HcError) return { error: { code: herdrCode(error, "pane_not_found"), message: error.message } };
      // what failed is the server's own business: its log has it, the caller a plain reason
      console.error(`herdr-core adapter: ${request.method} failed:`, error);
      return { error: { code: "internal", message: `herdr-core could not answer ${request.method}` } };
    }
  };
}

/** One hc event notification (herdr-core schema/README.md, Events). */
interface HcEvent { type: string; terminal?: string; data?: Record<string, unknown>; }

/**
 * An events subscription: herdr's acknowledgement once hc's own stream is open, so nothing that
 * happens after the server's next snapshot is missed, then herdr's frames for what hc reports. A
 * subscriber that fell behind on hc (`missed`), or a line to hc that ended, ends this connection:
 * the status collector reopens it and reads what it missed from a fresh snapshot.
 */
async function subscribe(hc: HcConnection, socket: Socket<ConnectionState>, request: Request): Promise<void> {
  const subscriptions = Array.isArray(request.params["subscriptions"]) ? request.params["subscriptions"].filter(isRecord) : [];
  const statusPanes = new Set(subscriptions.flatMap((entry) => entry["type"] === STATUS_EVENT && typeof entry["pane_id"] === "string" ? [entry["pane_id"]] : []));
  const structure = subscriptions.some((entry) => typeof entry["type"] === "string" && !NOT_STRUCTURE.has(entry["type"]));
  const ack = () => send(socket, `${JSON.stringify({ id: request.id, result: { type: "subscription_started" } })}\n`);
  if (statusPanes.size === 0 && !structure) {
    // focus only: hc has no focus to report, and the connection stays open as herdr's does
    ack();
    return;
  }
  let acknowledged = false;
  const queued: string[] = [];
  let ended = false;
  const emit = (event: string, data: Record<string, unknown>) => {
    const frame = `${JSON.stringify({ event, data })}\n`;
    if (acknowledged) send(socket, frame);
    else queued.push(frame);
  };
  /** Ends the subscription on both sides: hc's stream goes, and what was already written still reaches the reader. */
  const end = () => {
    if (ended) return;
    ended = true;
    socket.data.unsubscribe?.();
    socket.data.unsubscribe = null;
    if (!socket.data.closed) {
      socket.data.ending = true;
      flush(socket);
    }
  };
  const lifecycle = (event: string, type: string, paneId?: string) => {
    if (structure) emit(event, { type, ...(paneId ? { pane_id: paneId } : {}) });
  };
  const onEvent = (event: HcEvent) => {
    const paneId = event.terminal;
    switch (event.type) {
      case "status": {
        if (!paneId || !statusPanes.has(paneId)) return;
        const reported = event.data?.["status"];
        const status = isRecord(reported) && typeof reported["state"] === "string"
          ? { state: reported["state"], ...(typeof reported["app"] === "string" ? { app: reported["app"] } : {}) }
          : null;
        emit(STATUS_EVENT, { pane_id: paneId, agent_status: agentStatusOf(status), agent: agentOfStatus(status) });
        return;
      }
      case "created":
        lifecycle("pane.created", "pane_created", paneId);
        return;
      case "finished":
        lifecycle("pane.exited", "pane_exited", paneId);
        lifecycle("pane.closed", "pane_closed", paneId);
        return;
      case "removed":
        lifecycle("pane.closed", "pane_closed", paneId);
        return;
      case "lost":
      case "restarted":
        lifecycle("pane.updated", "pane_updated", paneId);
        return;
      case "labels":
        lifecycle("layout.updated", "layout_updated");
        return;
      case "doc":
        if (event.data?.["name"] === LAYOUT_DOC) lifecycle("layout.updated", "layout_updated");
        return;
      default:
        // title, size, foreground and turn change many times a second and show in the next snapshot
        return;
    }
  };
  const read = makeLineReader(EVENT_LINE_BYTES, (line) => {
    if (ended) return;
    let message: unknown;
    try { message = JSON.parse(line); } catch { end(); return; }
    if (!isRecord(message)) return;
    if (message["method"] === "missed") { end(); return; }
    const params = message["params"];
    if (message["method"] !== "event" || !isRecord(params) || typeof params["type"] !== "string") return;
    onEvent({ type: params["type"], ...(typeof params["terminal"] === "string" ? { terminal: params["terminal"] } : {}), ...(isRecord(params["data"]) ? { data: params["data"] } : {}) });
  }, () => {
    socket.data.unsubscribe?.();
    send(socket, `${JSON.stringify({ id: request.id, error: { code: "bad_frame", message: `hc event line exceeds ${EVENT_LINE_BYTES} bytes` } })}\n`, true);
  });
  try {
    const { channel } = await hc.open("events.subscribe", {}, { onData: read, onClose: end });
    // the herdr side went, or hc's stream did (`missed` can come with the answer), before the
    // acknowledgement: nothing is started, and hc's stream goes too
    if (ended || socket.data.closed || socket.data.ending) {
      void channel.close().catch(() => { });
      end();
      return;
    }
    socket.data.unsubscribe = () => { void channel.close().catch(() => { }); };
    ack();
    acknowledged = true;
    for (const frame of queued) send(socket, frame);
    queued.length = 0;
  } catch (error) {
    // whatever kept hc's stream from opening, the collector retries as it does for a herdr it cannot reach
    const message = error instanceof HcError ? error.message : "herdr-core could not open its event stream";
    if (!(error instanceof HcError)) console.error("herdr-core adapter: events.subscribe failed:", error);
    send(socket, `${JSON.stringify({ id: request.id, error: { code: "connect_failed", message } })}\n`, true);
  }
}
