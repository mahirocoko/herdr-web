// Adapted from devswha/herdr-web-ui a4ff0c942716602c43362f05c8511984e2bcae44; MIT, see UPSTREAM_LICENSE.
import { afterEach, describe, expect, it, jest } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { piActivityName, piChildPath, piParentForPane, readPiActivity } from "../pi-subagents.ts";
import { forkBrowserReplacer } from "../http.ts";
import { coreConnectionForSocket, startRuntime } from "./runtime.ts";
import { createSpawnAttachment, type PaneAttachment } from "../core/terminal-process.ts";
import { paneWatchSupported } from "../core/connections.ts";
import { HerdrError, herdrRpc, paneGet, paneSendKeys, paneSendText, sessionSnapshot, subscribeEvents, type EventFrame, ping, agentGet, agentPrompt } from "../herdr/client.ts";
import { startHerdrCoreAdapter } from "./adapter.ts";
import { encodeFrame, FRAME_CLOSE, FRAME_DATA, HcConnection, HcError, type HcTransport, makeFrameReader, spawnHcConnect } from "./connection.ts";
import type { HcTerminal } from "./snapshot.ts";

it("hc connect inherits the current explicit endpoint, not Bun's startup environment", async () => {
  if (process.platform === "win32") return; // POSIX-only runtime, no native hc required.
  const dir = mkdtempSync(join(tmpdir(), "hc-connect-env-"));
  const bin = join(dir, "fake-hc");
  const previous = { socket: process.env["HC_SOCKET"], session: process.env["HC_SESSION"] };
  try {
    writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n%s\\n" "$HC_SOCKET" "$HC_SESSION"\n');
    chmodSync(bin, 0o700);
    process.env["HC_SOCKET"] = join(dir, "owned.sock");
    process.env["HC_SESSION"] = "owned-disposable-session";
    const child = spawnHcConnect(bin);
    const output = await new Response(child.readable).text();
    await child.exited;
    expect(output).toBe(`${join(dir, "owned.sock")}\nowned-disposable-session\n`);
  } finally {
    if (previous.socket === undefined) delete process.env["HC_SOCKET"]; else process.env["HC_SOCKET"] = previous.socket;
    if (previous.session === undefined) delete process.env["HC_SESSION"]; else process.env["HC_SESSION"] = previous.session;
    rmSync(dir, { recursive: true, force: true });
  }
});

type Handler = (params: Record<string, unknown>) => unknown;

/** A core behind a fake `hc connect`: answers channel 0 from `handlers` and records every stream write. */
class FakeCore implements HcTransport {
  readonly readable: ReadableStream<Uint8Array>;
  readonly exited: Promise<unknown>;
  /** bytes written to each stream channel, and which channels the client closed */
  readonly typed: { channel: number; text: string; }[] = [];
  readonly closed: number[] = [];
  readonly calls: { method: string; params: Record<string, unknown>; }[] = [];
  /** Stream frames bundled with the next RPC response in one pipe read. */
  replyTail: Uint8Array = new Uint8Array(0);
  killed = false;
  acknowledgeClose = true;
  identity = "c1";
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private endExited!: () => void;
  private plain = true;
  private nextChannel = 1;
  private readonly frames = makeFrameReader((frame) => this.onFrame(frame.channel, frame.kind, frame.payload), () => { });

  constructor(readonly handlers: Record<string, Handler>, readonly answerHello = true) {
    this.readable = new ReadableStream({ start: (controller) => { this.controller = controller; } });
    const { promise, resolve } = Promise.withResolvers<unknown>();
    this.exited = promise;
    this.endExited = () => resolve(null);
  }

  write(bytes: Uint8Array): void {
    if (this.plain) {
      this.plain = false;
      if (!this.answerHello) return;
      this.controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ id: 0, jsonrpc: "2.0", result: { generation: 1, framed: true, version: "0.1.14", core: { id: this.identity, name: "lab" }, methods: [], features: [] } })}\n`));
      return;
    }
    this.frames(bytes);
  }

  kill(): void {
    this.killed = true;
    try { this.controller.close(); } catch { /* closed */ }
    this.endExited();
  }

  /** A notification on a stream channel, as hc sends events. */
  notify(channel: number, method: string, params: Record<string, unknown>): void {
    this.data(channel, `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  data(channel: number, text: string): void {
    this.controller.enqueue(encodeFrame(channel, FRAME_DATA, text));
  }

  channel(): number {
    return this.nextChannel++;
  }

  private onFrame(channel: number, kind: number, payload: Uint8Array): void {
    if (channel !== 0) {
      if (kind === FRAME_DATA) this.typed.push({ channel, text: new TextDecoder().decode(payload) });
      if (kind === FRAME_CLOSE) {
        this.closed.push(channel);
        // hc answers a viewer's CLOSE with its own
        if (this.acknowledgeClose) this.controller.enqueue(encodeFrame(channel, FRAME_CLOSE, new Uint8Array(0)));
      }
      return;
    }
    const message = JSON.parse(new TextDecoder().decode(payload)) as { id: number; method: string; params: Record<string, unknown>; };
    this.calls.push({ method: message.method, params: message.params });
    const handler = this.handlers[message.method];
    const reply = handler
      ? (() => { try { return { result: handler(message.params) }; } catch (error) { return { error: { code: -32000, message: String(error), data: { kind: "not_found" } } }; } })()
      : { error: { code: -32601, message: `no ${message.method}`, data: { kind: "unknown_method" } } };
    this.controller.enqueue(Buffer.concat([encodeFrame(0, FRAME_DATA, JSON.stringify({ jsonrpc: "2.0", id: message.id, ...reply })), this.replyTail]));
    this.replyTail = new Uint8Array(0);
  }
}

function terminal(address: string, extra: Partial<HcTerminal> = {}): HcTerminal {
  return { address, cols: 100, rows: 30, cwd: "/home/u", state: "live", ...extra };
}

const LAYOUT = { spaces: [{ id: "s1", name: "api", tabs: [{ id: "s1t1", name: "", root: { type: "row", id: "r", children: [{ type: "block", id: "b1", content: { terminal: "t1" } }] } }] }] };

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
});

for (const method of ["call", "open"] as const) {
  it(`times out ${method} while hc never answers hello and reconnects on the next call`, async () => {
    const cores: FakeCore[] = [];
    const hc = new HcConnection(() => {
      const core = new FakeCore({ ping: () => ({ ok: true }) }, cores.length > 0);
      cores.push(core);
      return core;
    });
    jest.useFakeTimers();
    try {
      const pending = method === "call" ? hc.call("ping", {}, 50)
        : hc.open("events.subscribe", {}, { onData() { }, onClose() { } }, 50);
      const failure = pending.then(() => "resolved", (error: unknown) => error instanceof HcError ? error.kind : "unexpected");
      jest.advanceTimersByTime(50);
      expect(cores[0]?.killed).toBe(true);
      expect(await failure).toBe("timeout");
      expect(await hc.call<{ ok: boolean; }>("ping", {}, 50)).toEqual({ ok: true });
      expect(cores).toHaveLength(2);
    } finally {
      hc.close();
      jest.useRealTimers();
    }
  });
}
async function setup(terminals: HcTerminal[], extra: Record<string, Handler> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ovis-hc-")));
  const socket = join(dir, "herdr.sock");
  const cores: FakeCore[] = [];
  const handlers: Record<string, Handler> = {
    "terminal.list": () => ({ terminals, hidden_finished: 0 }),
    "doc.get": () => ({ value: LAYOUT, version: 1 }),
    "terminal.get": (params) => {
      const found = terminals.find((entry) => entry.address === params["terminal"]);
      if (!found) throw new Error(`no terminal ${String(params["terminal"])}`);
      return { terminal: found };
    },
    "terminal.attach": () => ({ channel: cores.at(-1)!.channel(), terminal: terminals[0] }),
    "terminal.keys": () => ({ turn: 0 }),
    ...extra,
  };
  const hc = new HcConnection(() => {
    const core = new FakeCore(handlers);
    cores.push(core);
    return core;
  });
  const adapter = await startHerdrCoreAdapter(hc, socket);
  cleanups.push(() => { adapter.stop(); hc.close(); rmSync(dir, { recursive: true, force: true }); });
  return { socket, cores, hc };
}

it("never acknowledges uncertain input when the close reply is lost or the connection ends", async () => {
  for (const outcome of ["timeout", "lost"] as const) {
    const core = new FakeCore({ "terminal.attach": () => ({ channel: 1 }) });
    core.acknowledgeClose = false;
    const hc = new HcConnection(() => core);
    const { channel } = await hc.open("terminal.attach", {}, { onData() { }, onClose() { } });
    jest.useFakeTimers();
    try {
      channel.write("one explicit send");
      const pending = channel.close().then(() => "success", (error: unknown) => error instanceof HcError ? error.kind : "unexpected");
      if (outcome === "timeout") jest.advanceTimersByTime(10_001);
      else hc.close();
      expect(await pending).toBe(outcome === "timeout" ? "timeout" : "closed");
      expect(core.typed.map((entry) => entry.text)).toEqual(["one explicit send"]);
      expect(core.calls.filter((call) => call.method === "terminal.attach")).toHaveLength(1);
    } finally { hc.close(); jest.useRealTimers(); }
  }
});

it("refuses a changed core identity before a same-address terminal can receive input", async () => {
  const cores: FakeCore[] = [];
  const hc = new HcConnection(() => {
    const core = new FakeCore({ ping: () => ({ ok: true }), "terminal.send": () => ({ turn: 1 }) });
    core.identity = cores.length ? "replacement-core" : "original-core";
    cores.push(core);
    return core;
  });
  try {
    expect(await hc.call<{ ok: boolean; }>("ping", {})).toEqual({ ok: true });
    hc.close();
    await expect(hc.call("terminal.send", { terminal: "t1", text: "must not reach a different core" })).rejects.toMatchObject({ kind: "bad_hello" });
    expect(cores[1]!.calls).toEqual([]);
  } finally { hc.close(); }
});

it("rejects malformed stream channel replies before typing", async () => {
  for (const channel of [undefined, 0, -1, 1.5]) {
    const core = new FakeCore({ "terminal.attach": () => ({ channel }) });
    const hc = new HcConnection(() => core);
    try {
      await expect(hc.open("terminal.attach", {}, { onData() { }, onClose() { } })).rejects.toMatchObject({ kind: "bad_frame" });
      expect(core.typed).toEqual([]);
    } finally { hc.close(); }
  }
});

it.skipIf(process.platform === "win32")("uses the shared framed core stream at the observer's native grid and holds input on disconnect without a PTY or retry", async () => {
  const { socket, hc, cores } = await setup([terminal("t1", { cols: 100, rows: 30 })]);
  const previousRuntime = process.env["OVIS_RUNTIME"];
  const previousSocket = process.env["HERDR_SOCKET"];
  process.env["OVIS_RUNTIME"] = "herdr-core";
  const adapter = await startRuntime(dirname(socket), { connection: hc });
  try {
    expect(coreConnectionForSocket(adapter!.socketPath)).toBe(hc);
    expect(coreConnectionForSocket("/unrelated.sock")).toBeNull();
    expect(paneWatchSupported()).toBe(false);
    expect(paneWatchSupported("/unrelated.sock")).toBe(true);
    const attachments = new Map<string, PaneAttachment>();
    const ready = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<void>();
    const held: string[] = [];
    const { spawnAttachment } = createSpawnAttachment({
      attachments, retiringAttachments: new Map(), terminalAttach: async () => true, isStopped: () => false,
      closeAttachment: (pane) => { attachments.delete(pane); },
      broadcast: (_pane, message) => {
        if (message.type === "input-ready" && message.ready !== false) ready.resolve();
        if (message.type === "pty-exit") exited.resolve();
      },
      sendOutput: () => { }, reconcileOutput: () => { }, holdPendingPane: (pane) => held.push(pane),
      holdFor: 1, heldRetry: 1, retryFor: 1, relookupFor: 1,
    });
    const attachment = await spawnAttachment("t1", 12, 5, true);
    await ready.promise;
    expect(attachment.ready).toBe(true);
    expect(cores[0]!.calls.filter((call) => call.method === "terminal.attach").map((call) => call.params)).toEqual([{ terminal: "t1", cols: 100, rows: 30 }]);
    expect(attachment.process.write("new explicit raw input")).toBe(true);
    expect(cores[0]!.typed.map((entry) => entry.text)).toEqual(["new explicit raw input"]);
    cores[0]!.kill();
    await exited.promise;
    expect(attachment.ready).toBe(false);
    expect(held).toEqual(["t1"]);
    expect(attachments.size).toBe(0);
    expect(cores).toHaveLength(1);
    expect(attachment.process.write("must not replay")).toBe(false);
  } finally {
    adapter?.stop();
    if (previousRuntime === undefined) delete process.env["OVIS_RUNTIME"]; else process.env["OVIS_RUNTIME"] = previousRuntime;
    if (previousSocket === undefined) delete process.env["HERDR_SOCKET"]; else process.env["HERDR_SOCKET"] = previousSocket;
  }
});

describe.skipIf(process.platform === "win32")("herdr-core adapter", () => {
  it("refuses a second adapter on a live socket and leaves the first serving", async () => {
    const { socket, hc } = await setup([terminal("t1")]);
    await sessionSnapshot(socket);
    await expect((async () => {
      const second = await startHerdrCoreAdapter(hc, socket);
      cleanups.push(() => second.stop());
    })()).rejects.toThrow();
    expect((await sessionSnapshot(socket)).panes.map((pane) => pane.pane_id)).toEqual(["t1"]);
  });

  it("advertises framed terminal attachment without requiring a Node sidecar", async () => {
    const { socket } = await setup([terminal("t1")]);
    expect(await ping(socket)).toEqual({ version: "0.1.14", protocol: 22, terminal_attach: true });
  });

  it("answers herdr's session snapshot with the app's spaces over hc's terminals", async () => {
    const { socket } = await setup([terminal("t1", { status: { app: "claude", state: "blocked" } }), terminal("t2")]);
    const snapshot = await sessionSnapshot(socket);
    expect(snapshot.workspaces.map((w) => w.label)).toEqual(["api", "Other terminals"]);
    expect(snapshot.panes.map((p) => [p.pane_id, p.agent, p.agent_status])).toEqual([["t1", "claude", "blocked"], ["t2", null, "unknown"]]);
  });

  it("types send_text into an attach at the terminal's own grid, and answers once hc took the attach's close", async () => {
    const { socket, cores } = await setup([terminal("t1", { cols: 90, rows: 20 })]);
    await paneSendText("t1", "héllo 한글", socket);
    const core = cores[0]!;
    expect(core.calls.find((call) => call.method === "terminal.attach")?.params).toEqual({ terminal: "t1", cols: 90, rows: 20 });
    expect(core.typed).toEqual([{ channel: 1, text: "héllo 한글" }]);
    expect(core.closed).toEqual([1]);
  });

  it("presses keys in order: typed runs together, runs of mode-dependent keys through hc's encoder", async () => {
    const { socket, cores } = await setup([terminal("t1")]);
    await paneSendKeys("t1", ["Escape", "ctrl+shift+left", "x", "alt+|", "Enter", "c-c", "alt+x"], socket);
    const core = cores[0]!;
    expect(core.typed.map((write) => write.text)).toEqual(["x\x1b|\r"]);
    expect(core.calls.filter((call) => call.method === "terminal.keys").map((call) => call.params["keys"])).toEqual([
      ["escape", "ctrl+shift+left"],
      ["ctrl+c", "alt+x"],
    ]);
    const order = core.calls.map((call) => call.method).filter((method) => method === "terminal.attach" || method === "terminal.keys");
    expect(order).toEqual(["terminal.keys", "terminal.attach", "terminal.keys"]);
  });

  it("preserves an occupied socket path, including non-sockets", async () => {
    const { hc } = await setup([terminal("t1")]);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "fork-hc-occupied-")));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "herdr.sock");
    writeFileSync(path, "unknown work");
    await expect(startHerdrCoreAdapter(hc, path)).rejects.toThrow("occupied");
    expect(readFileSync(path, "utf8")).toBe("unknown work");
  });

  it("fails closed for Pi native identity and refuses unsupported mutations", async () => {
    const { socket, cores } = await setup([terminal("t1", {
      status: { app: "pi", state: "idle" },
      labels: { "agent_session": "/private/guess.jsonl", "herdr:pi": "/private/guess.jsonl" },
    })]);
    const agent = await agentGet("t1", socket);
    expect(agent.agent).toBe("pi");
    expect(agent.agent_session).toBeUndefined();
    expect(agent.state_labels).toBeUndefined();
    for (const method of ["agent.start", "workspace.create", "workspace.close", "tab.create", "tab.close", "pane.close", "pane.split", "pane.focus", "plugin.list"]) {
      await expect(herdrRpc(method, {}, socket)).rejects.toMatchObject({ code: "unsupported" });
    }
    expect(cores[0]!.calls.some((call) => ["terminal.run", "terminal.kill", "terminal.rm"].includes(call.method))).toBe(false);
  });

  it("reads an exact observer-bound Pi parent through the existing subagent owner without exposing native labels", async () => {
    const { socket } = await setup([terminal("t1", {
      status: { app: "pi", state: "idle" },
      foreground: { pid: 2147483600, name: "pi", argv: ["pi"] }
    })]);
    const root = dirname(socket);
    const store = join(root, "sessions");
    const directory = join(root, "pi-subagents");
    mkdirSync(store, { mode: 0o700 }); mkdirSync(directory, { mode: 0o700 });
    const parent = join(store, "parent.jsonl");
    writeFileSync(parent, '{"type":"session","id":"exact-parent"}\n', { mode: 0o600 });
    const tasks = join(store, "parent", "tasks");
    mkdirSync(tasks, { recursive: true, mode: 0o700 });
    const child = join(tasks, "child.jsonl");
    writeFileSync(child, '{"type":"session","id":"child","parentSession":"exact-parent"}\n', { mode: 0o600 });
    writeFileSync(join(directory, piActivityName(parent)), JSON.stringify({
      version: 1, parentFile: parent,
      parentSessionId: "exact-parent", pid: 2147483600, updatedAt: Date.now(), records: [
        { id: "child", type: "scout", description: "fictional child", status: "running", startedAt: Date.now(), toolUses: 0, outputFile: child },
      ]
    }), { mode: 0o600 });
    const previousStore = process.env["PI_CODING_AGENT_SESSION_DIR"];
    const previousSocket = process.env["HERDR_SOCKET"];
    const previousPrivacy = process.env["HERDR_WEB_FORK_PRIVACY"];
    process.env["PI_CODING_AGENT_SESSION_DIR"] = store; process.env["HERDR_SOCKET"] = socket;
    process.env["HERDR_WEB_FORK_PRIVACY"] = "1";
    try {
      expect((await agentGet("t1", socket)).agent_session).toEqual({ source: "herdr-core:pi-observer", agent: "pi", kind: "path", value: parent });
      const owner = await piParentForPane("t1");
      expect(owner).toEqual({ path: parent, id: "exact-parent", pids: [2147483600] });
      const activity = readPiActivity(owner!, root);
      expect(activity.live).toBe(true);
      expect(activity.tasks.map((task) => task.status)).toEqual(["running"]);
      expect(piChildPath(owner!, child)).toBe(child);
      expect(piChildPath({ ...owner!, id: "other-parent" }, child)).toBeNull();
      const presentation = JSON.stringify(await sessionSnapshot(socket), forkBrowserReplacer);
      expect(presentation).not.toContain("agent_session");
      expect(presentation).not.toContain(parent);
      rmSync(join(directory, piActivityName(parent)));
      expect(await piParentForPane("t1")).toBeNull();
    } finally {
      if (previousPrivacy === undefined) delete process.env["HERDR_WEB_FORK_PRIVACY"]; else process.env["HERDR_WEB_FORK_PRIVACY"] = previousPrivacy;
      if (previousStore === undefined) delete process.env["PI_CODING_AGENT_SESSION_DIR"]; else process.env["PI_CODING_AGENT_SESSION_DIR"] = previousStore;
      if (previousSocket === undefined) delete process.env["HERDR_SOCKET"]; else process.env["HERDR_SOCKET"] = previousSocket;
    }
  });

  it("forwards explicit Send and Stop once without treating status as session identity", async () => {
    const { socket, cores } = await setup([terminal("t1", { status: { app: "pi", state: "working" } })], {
      "terminal.send": () => ({ turn: 1 }),
    });
    await agentPrompt("t1", "new manual prompt", socket);
    await paneSendKeys("t1", ["Escape"], socket);
    expect(cores[0]!.calls.filter((call) => call.method === "terminal.send").map((call) => call.params)).toEqual([{ terminal: "t1", text: "new manual prompt" }]);
    expect(cores[0]!.calls.filter((call) => call.method === "terminal.keys").map((call) => call.params)).toEqual([{ terminal: "t1", keys: ["escape"] }]);
  });

  it("refuses what only the Herdr app does, and a pane hc does not have, in herdr's codes", async () => {
    const { socket } = await setup([terminal("t1")]);
    const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof HerdrError ? error.code : String(error)));
    expect(await failure(herdrRpc("pane.split", { pane_id: "t1", direction: "right" }, socket))).toBe("unsupported");
    expect(await failure(paneGet("t9", socket))).toBe("pane_not_found");
    expect(await failure(paneSendText("t9", "x", socket))).toBe("pane_not_found");
  });

  it("streams status for the subscribed panes only, a finish as herdr's exit and close, and ends on hc's missed", async () => {
    let channel = 0;
    const { socket, cores } = await setup([terminal("t1"), terminal("t2")], {
      "events.subscribe": () => {
        channel = cores.at(-1)!.channel();
        return { channel, seq: 1, terminals: [] };
      },
    });
    const frames: EventFrame[] = [];
    const started = Promise.withResolvers<void>();
    const ended = Promise.withResolvers<void>();
    const subscription = subscribeEvents([{ type: "pane.created" }, { type: "pane.agent_status_changed", pane_id: "t1" }], {
      onEvent: (frame) => frames.push(frame),
      onStarted: () => started.resolve(),
      onClose: () => ended.resolve(),
    }, socket);
    cleanups.push(() => subscription.close());
    await started.promise;
    const core = cores[0]!;
    core.notify(channel, "event", { seq: 2, type: "status", terminal: "t2", data: { status: { app: "codex", state: "working" } } });
    core.notify(channel, "event", { seq: 3, type: "status", terminal: "t1", data: { status: { app: "claude-code", state: "working" } } });
    core.notify(channel, "event", { seq: 4, type: "status", terminal: "t1", data: { status: { app: "antigravity", state: "working" } } });
    core.notify(channel, "event", { seq: 5, type: "status", terminal: "t1", data: { status: { app: "omp", state: "error" } } });
    core.notify(channel, "event", { seq: 6, type: "title", terminal: "t1", data: { title: "spinner" } });
    core.notify(channel, "event", { seq: 7, type: "finished", terminal: "t1", data: { reason: "exited", exit_code: 0 } });
    core.notify(channel, "missed", { seq: 10, terminals: [] });
    await ended.promise;
    expect(frames).toEqual([
      // herdr-core's `claude-code` reaches the browser as herdr's `claude`, as in the snapshot
      { event: "pane.agent_status_changed", data: { pane_id: "t1", agent_status: "working", agent: "claude" } },
      { event: "pane.agent_status_changed", data: { pane_id: "t1", agent_status: "working", agent: "agy" } },
      { event: "pane.agent_status_changed", data: { pane_id: "t1", agent_status: "unknown", agent: "omp" } },
      { event: "pane.exited", data: { type: "pane_exited", pane_id: "t1" } },
      { event: "pane.closed", data: { type: "pane_closed", pane_id: "t1" } },
    ]);
    // the subscription that ended lets go of hc's stream too
    expect(core.closed).toContain(channel);
  });

  it("acknowledges before an event bundled with the hc subscribe response", async () => {
    const { socket, cores } = await setup([terminal("t1")], {
      "events.subscribe": () => ({ channel: cores[0]!.channel(), seq: 1, terminals: [] }),
    });
    await sessionSnapshot(socket);
    cores[0]!.replyTail = encodeFrame(1, FRAME_DATA, `${JSON.stringify({ method: "event", params: { type: "created", terminal: "t1" } })}\n`);
    const order: (string | undefined)[] = [];
    const received = Promise.withResolvers<EventFrame>();
    const subscription = subscribeEvents([{ type: "pane.created" }], {
      onStarted: () => order.push("ack"),
      onEvent: (event) => { order.push(event.event); received.resolve(event); },
      onError: (error) => received.reject(error),
    }, socket);
    cleanups.push(() => subscription.close());
    expect(await received.promise).toEqual({ event: "pane.created", data: { type: "pane_created", pane_id: "t1" } });
    expect(order).toEqual(["ack", "pane.created"]);
  });

  it("fails what waited on a line to hc that ended, and opens a new one for the next call", async () => {
    const { socket, cores } = await setup([terminal("t1")]);
    await sessionSnapshot(socket);
    cores[0]!.kill();
    await cores[0]!.exited;
    const snapshot = await sessionSnapshot(socket);
    expect(snapshot.panes.map((pane) => pane.pane_id)).toEqual(["t1"]);
    expect(cores.length).toBe(2);
  });

  for (const newline of ["", "\n"]) {
    it(`closes an oversized event line across frames ${newline ? "with" : "without"} a newline with an error`, async () => {
      let channel = 0;
      const { socket, cores } = await setup([terminal("t1")], {
        "events.subscribe": () => {
          channel = cores.at(-1)!.channel();
          return { channel, seq: 1, terminals: [] };
        },
      });
      const started = Promise.withResolvers<void>();
      const ended = Promise.withResolvers<void>();
      const errors: Error[] = [];
      const frames: EventFrame[] = [];
      const subscription = subscribeEvents([{ type: "pane.created" }], {
        onStarted: () => started.resolve(),
        onClose: () => ended.resolve(),
        onError: (error) => errors.push(error),
        onEvent: (event) => frames.push(event),
      }, socket);
      cleanups.push(() => subscription.close());
      await started.promise;
      const core = cores[0]!;
      core.data(channel, " ".repeat(3 * 1024 * 1024));
      core.data(channel, " ".repeat(1024 * 1024 + 1) + newline);
      await ended.promise;
      expect(errors.map((error) => error instanceof HerdrError ? error.code : error.name)).toEqual(["bad_frame"]);
      expect(frames).toEqual([]);
      expect(core.closed).toEqual([channel]);
    });
  }

});
