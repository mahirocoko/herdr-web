import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as native from "./herdr/client.ts";
import * as processStart from "./process-start.ts";
import * as sourceStatus from "./core/status.ts";
import * as collector from "./collector.ts";
import { connectionData } from "./core/connections.ts";
import { OmoStatus } from "./omo-status.ts";
import { ClaudeSubagentStatus } from "./claude-subagents.ts";
import { SessionPlans } from "./session-plan.ts";
import { draftScreenText } from "../shared/input-draft.ts";
import { nativeDraftScreen } from "../shared/input-draft-fixtures.ts";

// Real Web dispatcher and PendingInputs with in-memory sockets/native reads. No listener,
// attachment, native process, browser, provider, discovery or service lifecycle is launched.
let pane: any, handlers: any, hub: any, callbacks: any;
let colors: string, live: string, pid: number, birth: number;
let writes: string[], events: string[];
let onAnsi: (() => void) | undefined;
let onPaste: (() => void) | undefined;
let failKey = false, providerHeld = false;
let scroll: any;
const realCreateStatusHub = sourceStatus.createStatusHub;
mock.module("./collector.ts", () => ({ ...collector, startStatusCollector: (args: any) => { callbacks = args; return { ready: Promise.resolve(), stop() {} }; } }));
mock.module("./process-start.ts", () => ({ ...processStart, processStartedAt: () => birth }));
mock.module("./herdr/client.ts", () => ({
  ...native,
  paneGet: async () => structuredClone(pane),
  paneProcessInfo: async () => { events.push("process"); return { foreground_processes: [{ pid }] }; },
  paneScrollInfo: async () => scroll,
  paneRead: async (options: any) => {
    events.push(options.format === "ansi" ? "ansi" : "screen");
    if (options.format === "ansi") onAnsi?.();
    return { text: options.format === "ansi" ? colors : live };
  },
  paneSendText: async (_pane: string, text: string, _socket: unknown, allowed: () => boolean) => {
    if (!allowed()) throw new native.HerdrError("cancelled", "guard refused");
    events.push("paste"); writes.push(text); onPaste?.();
  },
  paneSendKeys: async (_pane: string, keys: string[], _socket: unknown, allowed: () => boolean) => {
    if (!allowed()) throw new native.HerdrError("cancelled", "guard refused");
    if (failKey) throw new Error("uncertain key acknowledgment");
    events.push("key"); writes.push(keys.join(","));
  },
}));
mock.module("./core/status.ts", () => ({ createStatusHub: (args: any) => {
  hub = args;
  return { ...realCreateStatusHub(args), inputSnapshot: async () => ({ panes: [structuredClone(pane)] }), clientSnapshot: async () => ({ panes: [structuredClone(pane)] }), providerInputHeld: () => providerHeld, countVisit() {} };
} }));
mock.module("./core/terminals.ts", () => ({
  validGeometry: () => true,
  createTerminalRegistry: () => ({
    attachments: new Map([["p", { cols: 100, rows: 30 }]]), conversations: { stop() {} },
    reconcileOutput() {}, closeAttachment() {}, detachClaimed() {}, dropClaims() {}, poke() {}, drainOutput() {}, terminalFrames: {},
    sight: () => ({ origin: {}, pty: {}, claim: {}, write: () => true, facts: () => ({
      attached: true, origin: true, sameAttachment: true, samePty: true, sameClaim: true,
      claimed: true, member: true, ready: true, held: false, currentHeld: false, mirror: false, cols: 100,
    }) }),
  }),
}));
const { createServer } = await import("./index.ts");
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
async function fixture(agent: string, body = "leftover draft") {
  pid = 123; birth = 1000; writes = []; events = []; onAnsi = undefined; onPaste = undefined; failKey = false; providerHeld = false; scroll = null;
  colors = nativeDraftScreen(agent, body); live = draftScreenText(colors);
  pane = { pane_id: "p", terminal_id: "t", agent, agent_status: "working", revision: 1, tokens: {}, agent_session: { kind: "conversation", source: agent, value: "session" } };
  const serve = spyOn(Bun, "serve").mockImplementation(((config: any) => { handlers = config.websocket; return { port: 0, stop() {} }; }) as any);
  const starts = [spyOn(OmoStatus.prototype, "start").mockImplementation(() => {}), spyOn(ClaudeSubagentStatus.prototype, "start").mockImplementation(() => {}), spyOn(SessionPlans.prototype, "start").mockImplementation(() => {})];
  const directory = mkdtempSync(join(tmpdir(), "agent-input-dispatch-unit-"));
  const server = createServer({ stateDir: directory, terminalAttach: true, machines: false, submitDelayMs: 0, tailnet: { identity: async () => ({ soleLogin: null }) } as any });
  cleanups.push(() => { server.stop(); for (const start of starts) start.mockRestore(); serve.mockRestore(); rmSync(directory, { recursive: true, force: true }); });
  const seen: any[] = [];
  const client = { data: connectionData({ deviceId: undefined, readOnly: false }), readyState: 1, send: (text: string) => { seen.push(JSON.parse(text)); return 1; }, getBufferedAmount: () => 0, close() {} };
  await handlers.open(client);
  callbacks.onBaseline?.([structuredClone(pane)]);
  const send = async (message: any) => handlers.message(client, JSON.stringify({ pane_id: "p", ...message }));
  const submit = async (id: number, delivery = "hold") => {
    await send({ type: "submit", id, text: "Web draft", payload: "Web draft", delivery });
    return seen.find((frame) => frame.type === "submit-result" && frame.id === id);
  };
  const sendNow = async (item: any, id = 100) => {
    await send({ type: "pending-action", id, pending_id: item.id, action: "steer" });
    return seen.find((frame) => frame.type === "pending-result" && frame.id === id);
  };
  return { seen, submit, sendNow, client };
}

describe("current server/index.ts pending draft delivery", () => {
  it("provider checking/failure holds automatic delivery but does not invent manual unavailability", async () => {
    const f = await fixture("codex", ""); colors = live;
    expect((await f.submit(1, "queue")).ok).toBe(true);
    providerHeld = true; pane.agent_status = "idle"; callbacks.onStatus("p", "idle", "codex");
    for (let round = 0; round < 100; round++) await Promise.resolve();
    expect(writes).toEqual([]);
    const row = hub.pending.list(f.client, "p")[0]; expect(row?.state).toBe("queued");
    expect(await f.sendNow(row)).toMatchObject({ ok: true });
    expect(writes).toEqual(["\u001b[200~Web draft\u001b[201~", "Enter"]);
  });
  it("provider failure appearing after paste withholds Enter and preserves uncertainty without replay", async () => {
    const f = await fixture("codex", ""); colors = live;
    expect((await f.submit(1, "queue")).ok).toBe(true);
    onPaste = () => { providerHeld = true; };
    pane.agent_status = "idle"; callbacks.onStatus("p", "idle", "codex");
    for (let round = 0; round < 100 && hub.pending.list(f.client, "p")[0]?.state !== "uncertain"; round++) await Bun.sleep(5);
    expect(writes).toEqual(["\u001b[200~Web draft\u001b[201~"]);
    expect(hub.pending.list(f.client, "p")[0]?.state).toBe("uncertain");
    providerHeld = false; callbacks.onStatus("p", "idle", "codex");
    expect(await f.sendNow(hub.pending.list(f.client, "p")[0])).toMatchObject({ ok: false });
    expect(writes).toHaveLength(1);
  });
  for (const agent of ["pi", "codex", "letta"]) {
    it(`${agent}: Send now refuses typed text, keeps held row, never pastes or Enters`, async () => {
      const f = await fixture(agent, "  > quoted\n  → literal");
      const queued = await f.submit(1);
      expect(queued.ok).toBe(true);
      const result = await f.sendNow(queued.pending);
      expect(result).toMatchObject({ ok: false, code: "input_draft" });
      expect(writes).toEqual([]);
      expect(hub.pending.list(f.client, "p")).toContainEqual(expect.objectContaining({ text: "Web draft", state: "held", error: expect.objectContaining({ code: "input_draft" }) }));
    });
    it(`${agent}: turn-end automatic delivery also holds a typed draft with zero writes`, async () => {
      const f = await fixture(agent);
      expect((await f.submit(1, "queue")).ok).toBe(true);
      pane.agent_status = "idle";
      callbacks.onStatus("p", "idle", agent);
      for (let round = 0; round < 100 && !hub.pending.list(f.client, "p")[0]?.error; round++) await Bun.sleep(5);
      expect(hub.pending.list(f.client, "p")).toContainEqual(expect.objectContaining({ state: "held", error: expect.objectContaining({ code: "input_draft" }) }));
      expect(writes).toEqual([]);
    });
    it(`${agent}: no-colour/core fallback preserves paste/Enter and last write-guard order`, async () => {
      const f = await fixture(agent);
      colors = live;
      const queued = await f.submit(1);
      pane.agent_status = "idle";
      expect(await f.sendNow(queued.pending)).toMatchObject({ ok: true });
      expect(writes).toEqual(["\u001b[200~Web draft\u001b[201~", "Enter"]);
      for (const write of ["paste", "key"]) expect(events.slice(events.indexOf(write) - 2, events.indexOf(write))).toEqual(["process", "screen"]);
    });
  }
  for (const [agent, body] of [["pi", "review this\n>\n> quoted"], ["codex", "1. review this"]] as const) {
    it(`${agent}: reviewed draft counterexample holds Send now without paste/Enter`, async () => {
      const f = await fixture(agent, body);
      const queued = await f.submit(1);
      expect(await f.sendNow(queued.pending)).toMatchObject({ ok: false, code: "input_draft" });
      expect(writes).toEqual([]);
      expect(hub.pending.list(f.client, "p")).toContainEqual(expect.objectContaining({ state: "held", error: expect.objectContaining({ code: "input_draft" }) }));
    });
    it(`${agent}: reviewed draft counterexample also holds automatic delivery`, async () => {
      const f = await fixture(agent, body);
      expect((await f.submit(1, "queue")).ok).toBe(true);
      pane.agent_status = "idle";
      callbacks.onStatus("p", "idle", agent);
      for (let round = 0; round < 100 && !hub.pending.list(f.client, "p")[0]?.error; round++) await Bun.sleep(5);
      expect(hub.pending.list(f.client, "p")).toContainEqual(expect.objectContaining({ state: "held", error: expect.objectContaining({ code: "input_draft" }) }));
      expect(writes).toEqual([]);
    });
  }
  for (const change of ["session", "pid", "birth", "masked"]) {
    it(`retains ${change} guard after asynchronous ANSI reads`, async () => {
      const f = await fixture("letta", "");
      const queued = await f.submit(1);
      onAnsi = () => {
        if (change === "session") pane.agent_session.value = "replacement";
        if (change === "pid") pid++;
        if (change === "birth") birth += 3000;
        if (change === "masked") live = "Password: ";
      };
      expect(await f.sendNow(queued.pending)).toMatchObject({ ok: false, code: change === "masked" ? "agent_blocked" : "pending_target_changed" });
      expect(writes).toEqual([]);
    });
  }
  it("a scrolled/stale viewport cannot refuse a pending send", async () => {
    const f = await fixture("letta");
    scroll = { offset_from_bottom: 10 };
    live = draftScreenText(nativeDraftScreen("letta", ""));
    const queued = await f.submit(1);
    expect(await f.sendNow(queued.pending)).toMatchObject({ ok: true });
  });
  it("a masked prompt opening after paste still prevents Enter and holds uncertainty without replay", async () => {
    const f = await fixture("letta", "");
    const queued = await f.submit(1);
    onPaste = () => { live = "Password: "; };
    expect(await f.sendNow(queued.pending)).toMatchObject({ ok: false, code: "submit_changed" });
    expect(writes).toEqual(["\u001b[200~Web draft\u001b[201~"]);
    expect(await f.sendNow(queued.pending, 101)).toMatchObject({ ok: false });
    expect(writes).toHaveLength(1);
  });
  it("an uncertain Enter is held, never automatically retried", async () => {
    const f = await fixture("letta", "");
    const queued = await f.submit(1);
    failKey = true;
    expect(await f.sendNow(queued.pending)).toMatchObject({ ok: false, code: "submit_changed" });
    expect(writes).toHaveLength(1);
    failKey = false;
    callbacks.onStatus("p", "idle", "letta");
    // fixed wait: an idle event must not replay the uncertain write during this observation window.
    await Bun.sleep(20);
    expect(writes).toHaveLength(1);
    expect(await f.sendNow(queued.pending, 101)).toMatchObject({ ok: false });
    expect(writes).toHaveLength(1);
  });
});
