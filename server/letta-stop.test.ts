import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as native from "./herdr/client.ts";
import * as processStart from "./process-start.ts";
import { connectionData } from "./core/connections.ts";
import { PendingInputs } from "./pending-input.ts";
import { LettaStops } from "./letta-stop.ts";
import * as sourceStatus from "./core/status.ts";
import * as collectorModule from "./collector.ts";
import { OmoStatus } from "./omo-status.ts";
import { ClaudeSubagentStatus } from "./claude-subagents.ts";
import { SessionPlans } from "./session-plan.ts";
const realCreateStatusHub = sourceStatus.createStatusHub;
let collectorCallbacks: Parameters<
  typeof collectorModule.startStatusCollector
>[0];
mock.module("./collector.ts", () => ({
  ...collectorModule,
  startStatusCollector: (callbacks: typeof collectorCallbacks) => {
    collectorCallbacks = callbacks;
    return { ready: Promise.resolve(), stop() {} };
  },
}));

const warning =
  "⚠ Interrupted – tell the agent what to do differently. Something went wrong? Use /feedback to report issues.";
const prefix = "› original request";
let turnPrefix = prefix;
const box = (status: string, draft = "") =>
  `${turnPrefix}\n\n${status}\n\n────────────────────\n›${draft ? ` ${draft}` : ""}\n────────────────────\nMahiro Code · local`;
const active = box("⠄ Mahiro Code is pondering… (esc to interrupt)");
let screen = active;
let pane: any;
let pid = 123;
let birth = 1000;
let facts: any;
let output: (pane: string) => void;
let handlers: any;
let hub: any;
let writes: string[];
let failStop = false;
let stoppedScreen: string | undefined;
let onPaste: (() => void) | undefined;
let onKeyConnect: (() => void) | undefined;
let beforeTextConnect: (() => void) | undefined;
const cancelled = () => {
  throw new native.HerdrError("cancelled", "guard refused");
};
mock.module("./process-start.ts", () => ({
  ...processStart,
  processStartedAt: () => birth,
}));
mock.module("./herdr/client.ts", () => ({
  ...native,
  paneProcessInfo: async () => ({ foreground_processes: [{ pid }] }),
  paneRead: async () => ({ text: screen }),
  paneSendText: async (
    _pane: string,
    text: string,
    _timeout: unknown,
    allowed: () => boolean,
  ) => {
    beforeTextConnect?.();
    if (!allowed()) cancelled();
    if (text === "\u001b") {
      if (failStop) throw new Error("Stop failed");
      writes.push(text);
      // Preserve the actual pre-Stop transcript; only its active status is replaced.
      const rows = screen.split("\n");
      let processing = -1;
      for (let index = rows.length - 1; index >= 0; index--) {
        if (/\(esc to interrupt[^)]*\)/i.test(rows[index]!)) {
          processing = index;
          break;
        }
      }
      if (processing >= 0)
        turnPrefix = rows.slice(0, processing).join("\n").trimEnd();
      screen = stoppedScreen ?? box(warning);
      output("p");
    } else {
      writes.push(text);
      screen = box(warning, text.slice(6, -6));
      output("p");
      onPaste?.();
    }
  },
  paneSendKeys: async (
    _pane: string,
    keys: string[],
    _timeout: unknown,
    allowed: () => boolean,
  ) => {
    onKeyConnect?.();
    if (!allowed()) cancelled();
    writes.push(keys.join(","));
  },
}));
mock.module("./core/status.ts", () => ({
  createStatusHub: (args: any) => {
    hub = args;
    return {
      ...realCreateStatusHub(args),
      clientSnapshot: async () => ({ panes: [structuredClone(pane)] }),
      countVisit() {},
    };
  },
}));
mock.module("./core/terminals.ts", () => ({
  validGeometry: () => true,
  createTerminalRegistry: (args: any) => {
    output = args.onOutput;
    const origin = {},
      pty = {},
      claim = {};
    return {
      attachments: new Map([["p", { cols: 100, rows: 30 }]]),
      conversations: { stop() {} },
      reconcileOutput() {},
      closeAttachment() {},
      detachClaimed() {
        args.holdPending(currentClient, "p");
      },
      dropClaims() {},
      sight: () => ({
        origin,
        pty,
        claim,
        facts: () => facts,
        write: () => true,
      }),
      poke() {},
      drainOutput() {},
      terminalFrames: {
        detach: (client: any) => args.holdPending(client, "p"),
      },
    };
  },
}));
const { createServer } = await import("./index.ts");
let currentClient: any;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
async function fixture() {
  turnPrefix = prefix;
  stoppedScreen = undefined;
  screen = active;
  pid = 123;
  birth = 1000;
  writes = [];
  failStop = false;
  onPaste = undefined;
  onKeyConnect = undefined;
  beforeTextConnect = undefined;
  pane = {
    pane_id: "p",
    terminal_id: "t",
    agent: "letta",
    agent_status: "working",
    revision: 1,
    tokens: {
      letta_scope: "72ea877b1e4eee52",
      subagents: "0",
      subagents_running: "0",
    },
    agent_session: { kind: "conversation", source: "letta", value: "session" },
  };
  facts = {
    attached: true,
    origin: true,
    sameAttachment: true,
    samePty: true,
    sameClaim: true,
    claimed: true,
    member: true,
    ready: true,
    held: false,
    currentHeld: false,
    mirror: false,
    cols: 100,
  };
  const serve = spyOn(Bun, "serve").mockImplementation(((config: any) => {
    handlers = config.websocket;
    return { port: 0, stop() {} };
  }) as any);
  const directory = mkdtempSync(join(tmpdir(), "letta-stop-unit-"));
  // Use the real hub callbacks, but never start native discovery/polling in this fixture.
  const starts = [
    spyOn(OmoStatus.prototype, "start").mockImplementation(() => {}),
    spyOn(ClaudeSubagentStatus.prototype, "start").mockImplementation(() => {}),
    spyOn(SessionPlans.prototype, "start").mockImplementation(() => {}),
  ];
  const server = createServer({
    stateDir: directory,
    terminalAttach: true,
    machines: false,
    submitDelayMs: 0,
    tailnet: { identity: async () => ({ soleLogin: null }) } as any,
  });
  cleanups.push(() => {
    server.stop();
    for (const start of starts) start.mockRestore();
    serve.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  });
  const seen: any[] = [];
  const client = (currentClient = {
    data: connectionData({ deviceId: undefined, readOnly: false }),
    readyState: 1,
    send: (text: string) => {
      seen.push(JSON.parse(text));
      return 1;
    },
    getBufferedAmount: () => 0,
    close() {},
  });
  await handlers.open(client);
  collectorCallbacks.onBaseline?.([structuredClone(pane)]);
  const send = async (message: any) =>
    handlers.message(client, JSON.stringify({ pane_id: "p", ...message }));
  const submit = async (
    id: number,
    text = "new instruction",
    delivery = "queue",
  ) => {
    await send({ type: "submit", id, text, payload: text, delivery });
    return [...seen]
      .reverse()
      .find((frame) => frame.type === "submit-result" && frame.id === id);
  };
  const stop = async () => {
    await send({ type: "input", stop: true, text: "\u001b" });
    await Bun.sleep(400); // fixed wait: allow both 150ms post-Stop reads before testing an already-armed witness; no native process
  };
  return { send, submit, stop, seen, client };
}

describe("real dispatcher: local Letta Stop compatibility witness", () => {
  it.each(["baseline", "resync"])(
    "unchanged real %s callback preserves one fresh witness and held rows",
    async (kind) => {
      const f = await fixture();
      await f.submit(1, "OLD");
      await f.stop();
      const mark = hub.pending.mark("p");
      if (kind === "baseline")
        collectorCallbacks.onBaseline?.([structuredClone(pane)]);
      else collectorCallbacks.onResync?.([structuredClone(pane)], new Set());
      expect(hub.pending.mark("p")).toBe(mark);
      expect((await f.submit(2)).ok).toBe(true);
      await f.submit(2);
      expect(writes).toEqual([
        "\u001b",
        "\u001b[200~new instruction\u001b[201~",
        "Enter",
      ]);
      expect(hub.pending.list(f.client, "p")).toEqual([
        expect.objectContaining({ text: "OLD", state: "held" }),
      ]);
    },
  );
  it("a genuine same-Working event through the real collector callback still cancels the witness", async () => {
    const f = await fixture();
    await f.stop();
    const mark = hub.pending.mark("p");
    collectorCallbacks.onStatus("p", "working", "letta");
    expect(hub.pending.mark("p")).toBeGreaterThan(mark);
    expect((await f.submit(1)).ok).toBe(false);
    expect(writes).toEqual(["\u001b"]);
  });
  it("a changed blocked baseline remains a new generation and refuses input", async () => {
    const f = await fixture();
    await f.stop();
    const mark = hub.pending.mark("p");
    pane.agent_status = "blocked";
    collectorCallbacks.onBaseline?.([structuredClone(pane)]);
    expect(hub.pending.mark("p")).toBeGreaterThan(mark);
    expect((await f.submit(1)).ok).toBe(false);
    expect(writes).toEqual(["\u001b"]);
  });
  for (const status of ["idle", "done"])
    for (const event of [false, true]) {
      it(`native ${status} supersedes a ready witness (${event ? "event" : "snapshot"})`, async () => {
        const f = await fixture();
        await f.stop();
        pane.agent_status = status;
        if (event) hub.pending.status("p", status);
        expect((await f.submit(1)).ok).toBe(true);
        expect(writes).toEqual([
          "\u001b",
          "\u001b[200~new instruction\u001b[201~",
          "Enter",
        ]);
      });
    }
  it.each(["input", "keys", "secret"])(
    "rejected observer %s cannot revoke the owner's ready witness",
    async (type) => {
      const f = await fixture();
      await f.stop();
      const seen: any[] = [];
      const observer = {
        ...f.client,
        data: connectionData({ deviceId: undefined, readOnly: true }),
        send: (text: string) => {
          seen.push(JSON.parse(text));
          return 1;
        },
      };
      await handlers.open(observer);
      await handlers.message(
        observer,
        JSON.stringify({
          type,
          pane_id: "p",
          id: 99,
          text: "x",
          keys: ["Enter"],
          prompt: "Password:",
          secret: "x",
        }),
      );
      expect(seen.some((frame) => frame.code === "read_only")).toBe(true);
      expect((await f.submit(1)).ok).toBe(true);
      expect(writes).toEqual([
        "\u001b",
        "\u001b[200~new instruction\u001b[201~",
        "Enter",
      ]);
    },
  );
  it("an immediate post-Stop manual Send is not silently orphaned as a queued row", async () => {
    const f = await fixture();
    await f.send({ type: "input", stop: true, text: "\u001b" });
    const reply = await f.submit(1);
    expect(reply.pending).toBeUndefined();
    expect(reply.ok).toBe(true);
    expect(writes).toEqual([
      "\u001b",
      "\u001b[200~new instruction\u001b[201~",
      "Enter",
    ]);
  });
  it("post-Stop Send waits for the native interrupt affordance to disappear", async () => {
    const f = await fixture();
    stoppedScreen = `${box(warning)}\n(esc to interrupt)`;
    await f.send({ type: "input", stop: true, text: "\u001b" });
    const result = f.submit(1);
    await Bun.sleep(450); // fixed wait: keep native processing visible beyond the initial two 150ms reads to exercise delayed readiness
    screen = box(warning);
    output("p");
    const reply = await result;
    expect(reply.ok).toBe(true);
    expect(reply.pending).toBeUndefined();
    expect(writes).toEqual([
      "\u001b",
      "\u001b[200~new instruction\u001b[201~",
      "Enter",
    ]);
  });
  it("unsettled Stop times out explicitly without queuing the new request", async () => {
    const f = await fixture();
    stoppedScreen = `${box(warning)}\n(esc to interrupt)`;
    await f.send({ type: "input", stop: true, text: "\u001b" });
    const reply = await f.submit(1);
    expect(reply.ok).toBe(false);
    expect(reply.code).toBe("input_not_ready");
    expect(reply.pending).toBeUndefined();
    expect(hub.pending.list(f.client, "p")).toEqual([]);
    expect(writes).toEqual(["\u001b"]);
  });
  it.each(["input", "keys", "secret"])(
    "wrong-claim rejected %s cannot revoke another owner's witness",
    async (type) => {
      const f = await fixture();
      await f.stop();
      const other = {
        ...f.client,
        data: connectionData({ deviceId: undefined, readOnly: false }),
      };
      await handlers.open(other);
      facts.sameClaim = false;
      facts.member = false;
      await handlers.message(
        other,
        JSON.stringify({
          type,
          pane_id: "p",
          id: 99,
          text: "x",
          keys: ["Enter"],
          prompt: "Password:",
          secret: "x",
        }),
      );
      facts.sameClaim = true;
      facts.member = true;
      expect((await f.submit(1)).ok).toBe(true);
      expect(writes).toEqual([
        "\u001b",
        "\u001b[200~new instruction\u001b[201~",
        "Enter",
      ]);
    },
  );
  it.each(["identity", "claim", "uncertain"])(
    "native idle cannot bypass a changed %s guard",
    async (change) => {
      const f = await fixture();
      await f.stop();
      pane.agent_status = "idle";
      hub.pending.status("p", "idle");
      if (change === "identity") pid++;
      if (change === "claim") facts.sameClaim = false;
      if (change === "uncertain") {
        const old = hub.pending.enqueue(
          f.client,
          "p",
          99,
          "UNTOUCHABLE",
          {},
          { agent: "letta", terminalId: "t", session: "s" },
        );
        hub.pending.claim(old, false);
        hub.pending.settle(old, { code: "uncertain", message: "check" }, true);
      }
      expect((await f.submit(1)).ok).toBe(false);
      expect(writes).toEqual(["\u001b"]);
    },
  );
  it("sends one NEW request once, preserves working, holds old rows and ignores duplicate submit id", async () => {
    const f = await fixture();
    await f.submit(1, "OLD");
    expect(writes).toEqual([]);
    await f.stop();
    expect(writes).toEqual(["\u001b"]); // witness alone never sends
    expect(
      f.seen.some((frame) =>
        frame.messages?.some(
          (row: any) => row.text === "OLD" && row.state === "held",
        ),
      ),
    ).toBe(true);
    expect((await f.submit(2)).ok).toBe(true);
    expect((await f.submit(2)).ok).toBe(true);
    expect(writes).toEqual([
      "\u001b",
      "\u001b[200~new instruction\u001b[201~",
      "Enter",
    ]);
    expect(pane.agent_status).toBe("working");
    expect(hub.pending.current("p")).toBe("working");
    await f.submit(3, "LATER");
    expect(writes.length).toBe(3); // one witness, not a general idle override
  });
  it.each([
    "old warning",
    "quoted warning",
    "composer while working",
    "no our Stop",
    "failed Stop",
  ])("zero paste for %s", async (kind) => {
    const f = await fixture();
    if (kind === "old warning")
      screen = box(
        `${warning}\n\n⠄ Mahiro Code is pondering… (esc to interrupt)`,
      );
    if (kind === "quoted warning") screen = box(`› ${warning}`);
    if (kind === "composer while working") screen = box("model still working");
    if (kind === "no our Stop") screen = box(warning);
    if (kind === "failed Stop") failStop = true;
    if (kind !== "no our Stop") await f.stop();
    await f.submit(1);
    expect(writes.filter((text) => text.startsWith("\u001b[200~"))).toEqual([]);
  });
  it.each([
    "terminal",
    "pid",
    "birth",
    "session",
    "claim",
    "attachment",
    "pty",
    "member",
    "held",
    "readOnly",
    "children",
    "unknown children",
    "approval",
    "secret",
    "native output",
    "native event",
    "detach",
  ])("refuses changed %s before paste", async (change) => {
    const f = await fixture();
    await f.stop();
    if (change === "terminal") pane.terminal_id = "other";
    if (change === "pid") pid++;
    if (change === "birth") birth += 5000;
    if (change === "session") pane.agent_session.value = "other";
    if (change === "claim") facts.sameClaim = false;
    if (change === "attachment") facts.sameAttachment = false;
    if (change === "pty") facts.samePty = false;
    if (change === "member") facts.member = false;
    if (change === "held") facts.currentHeld = true;
    if (change === "readOnly") f.client.data.readOnly = true;
    if (change === "children") pane.tokens.subagents_running = "1";
    if (change === "unknown children") delete pane.tokens.subagents_running;
    if (change === "approval") pane.agent_status = "blocked";
    if (change === "secret") screen = "Password: █";
    if (change === "native output") output("p");
    if (change === "native event") hub.pending.status("p", "working");
    if (change === "detach") await f.send({ type: "detach" });
    await f.submit(1);
    expect(writes).toEqual(["\u001b"]);
  });
  it("wrong owner cannot consume another connection's witness", async () => {
    const f = await fixture();
    await f.stop();
    const other = {
      ...f.client,
      data: connectionData({ deviceId: undefined, readOnly: false }),
    };
    await handlers.open(other);
    await handlers.message(
      other,
      JSON.stringify({
        type: "submit",
        pane_id: "p",
        id: 9,
        text: "OTHER",
        payload: "OTHER",
        delivery: "queue",
      }),
    );
    expect(writes).toEqual(["\u001b"]);
  });
  it("checks the guarded paste connection and the actual Enter connection", async () => {
    const f = await fixture();
    await f.stop();
    beforeTextConnect = () => {
      facts.sameClaim = false;
    };
    expect((await f.submit(1)).ok).toBe(false);
    expect(writes).toEqual(["\u001b"]);
  });
  it.each(["new activity", "approval", "secret", "claim", "key connect"])(
    "no Enter after a paste race: %s",
    async (change) => {
      const f = await fixture();
      await f.stop();
      onPaste = () => {
        if (change === "new activity")
          screen = box("new native turn (esc to interrupt)", "new instruction");
        if (change === "approval") pane.agent_status = "blocked";
        if (change === "secret") screen = "Password: █";
        if (change === "claim") facts.sameClaim = false;
        if (change === "key connect")
          onKeyConnect = () => {
            output("p");
          };
      };
      const reply = await f.submit(1);
      expect(reply.ok).toBe(false);
      expect(reply.code).toBe("submit_changed");
      expect(writes.length).toBe(2);
      expect(writes).not.toContain("Enter");
      await f.submit(1);
      expect(writes.length).toBe(2); // uncertain receipt never retries
    },
  );
  it("Stop then new turn then old warning cannot authorize again", async () => {
    const f = await fixture();
    await f.stop();
    output("p");
    screen = active;
    hub.pending.status("p", "working");
    screen = box(warning);
    await f.submit(1);
    expect(writes).toEqual(["\u001b"]);
  });
  it("disconnect/reconnect and wrong-pane requests cannot recover", async () => {
    const f = await fixture();
    await f.stop();
    await f.send({
      type: "submit",
      pane_id: "other",
      id: 1,
      text: "wrong",
      payload: "wrong",
      delivery: "queue",
    });
    handlers.close(f.client);
    const other = {
      ...f.client,
      data: connectionData({ deviceId: undefined, readOnly: false }),
    };
    await handlers.open(other);
    await handlers.message(
      other,
      JSON.stringify({
        type: "submit",
        pane_id: "p",
        id: 2,
        text: "new",
        payload: "new",
        delivery: "queue",
      }),
    );
    expect(writes).toEqual(["\u001b"]);
  });
  it("permits one fresh Stop recovery below a new prompt despite an earlier identical warning", async () => {
    const f = await fixture();
    await f.submit(1, "OLD");
    turnPrefix = `${prefix}\n\n${warning}\n\n› new request`;
    screen = box("⠄ Mahiro Code is pondering… (esc to interrupt)");
    await f.stop();
    expect(screen).toBe(box(warning));
    expect(screen.split(warning).length - 1).toBe(2);
    expect(writes).toEqual(["\u001b"]);
    expect((await f.submit(2)).ok).toBe(true);
    await f.submit(2);
    expect(writes).toEqual([
      "\u001b",
      "\u001b[200~new instruction\u001b[201~",
      "Enter",
    ]);
    expect(hub.pending.list(f.client, "p")).toEqual([
      expect.objectContaining({ text: "OLD", state: "held" }),
    ]);
    hub.pending.status("p", "idle");
    expect(hub.pending.next("p")).toBeNull();
  });
  it("supports own Stop A then new turn B then own Stop B without reusing A", async () => {
    const f = await fixture();
    await f.stop();
    expect((await f.submit(1, "turn B")).ok).toBe(true);
    turnPrefix = `${prefix}\n\n${warning}\n\n› turn B`;
    screen = box("⠄ Mahiro Code is pondering… (esc to interrupt)");
    output("p");
    hub.pending.status("p", "working");
    await f.stop();
    expect((await f.submit(2, "turn C")).ok).toBe(true);
    expect(writes).toEqual([
      "\u001b",
      "\u001b[200~turn B\u001b[201~",
      "Enter",
      "\u001b",
      "\u001b[200~turn C\u001b[201~",
      "Enter",
    ]);
  });
  it("new B activity with only A's old warning cannot reuse A without a new owned Stop", async () => {
    const f = await fixture();
    await f.stop();
    turnPrefix = `${prefix}\n\n${warning}\n\n› turn B`;
    screen = box("⠄ Mahiro Code is pondering… (esc to interrupt)");
    output("p");
    hub.pending.status("p", "working");
    screen = box(""); // only A's old warning remains above B; no new Stop or status warning
    await f.submit(1, "NOT AUTHORIZED");
    expect(writes).toEqual(["\u001b"]);
  });
  it("an old warning cannot masquerade as a fresh warning when Stop adds none", async () => {
    const f = await fixture();
    turnPrefix = `${prefix}\n\n${warning}\n\n› turn B`;
    screen = box("⠄ Mahiro Code is pondering… (esc to interrupt)");
    stoppedScreen = box("");
    await f.stop();
    await f.submit(1);
    expect(writes).toEqual(["\u001b"]);
  });
  it("does not mistake a timed statusline thinking badge for native processing", async () => {
    const f = await fixture();
    stoppedScreen = `${box(warning)} · ✦ thinking`;
    await f.stop();
    await f.submit(1);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toBe("\u001b");
    // The existing dispatcher selects plain or bracketed paste from terminal mode.
    expect([
      "new instruction",
      "\u001b[200~new instruction\u001b[201~",
    ]).toContain(writes[1]!);
    expect(writes[2]).toBe("Enter");
  });
  it("still refuses a native interrupt affordance below the composer", async () => {
    const f = await fixture();
    stoppedScreen = `${box(warning)} · ✦ thinking\n(esc to interrupt)`;
    await f.stop();
    await f.submit(1);
    expect(writes).toEqual(["\u001b"]);
  });
  it("a held-delivery preference remains a hold, not an implicit send", async () => {
    const f = await fixture();
    await f.stop();
    const reply = await f.submit(1, "HOLD", "hold");
    expect(reply.pending.state).toBe("held");
    expect(writes).toEqual(["\u001b"]);
  });
});

it("expires a witness and accepts the observed native triple-blank transcript spacing", () => {
  let now = 0;
  const stops = new LettaStops<object, object>(() => now);
  const owner = {},
    lease = {};
  const context: any = {
    pane: {
      ...pane,
      agent_status: "working",
      tokens: {
        letta_scope: "72ea877b1e4eee52",
        subagents: "0",
        subagents_running: "0",
      },
    },
    identity: {
      agent: "letta",
      terminalId: "t",
      session: null,
      processPid: 123,
      processBirth: 1000,
    },
    generation: 0,
    screen: `✻ Interpreted for 1m 14s\n\n\n${active}`,
  };
  const ticket = stops.begin(owner, "p", lease, context)!;
  expect(ticket).not.toBeNull();
  expect(
    stops.arm(ticket, {
      ...context,
      screen: `✻ Interpreted for 1m 14s\n\n\n${box(warning)}`,
    }),
  ).toBe(true);
  now = 30_000;
  expect(stops.take(owner, "p")).toBeNull();
  expect((stops as any).tickets.size).toBe(0); // expired owner/lease/transcript are released
  const replacement = stops.begin(owner, "p", lease, context)!;
  stops.forget(ticket); // an old observer's cleanup must not remove the replacement
  expect(stops.current(replacement)).toBe(true);
  now = 60_000;
  stops.expire();
  expect((stops as any).tickets.size).toBe(0);
});

it("interrupt review never releases in-flight or uncertain delivery or mutates their bytes", () => {
  const pending = new PendingInputs<object, object>(() => {});
  const owner = {},
    identity = { agent: "letta", terminalId: "t", session: "s" };
  const item = pending.enqueue(owner, "p", 1, "UNTOUCHABLE", {}, identity);
  pending.status("p", "idle");
  expect(pending.claim(item, true)).toBe(true);
  pending.committing(item);
  expect(pending.interruptReview("p", true)).toBe(false);
  expect(item.message.state).toBe("sending");
  pending.settle(item, { code: "uncertain", message: "check" }, true);
  const before = JSON.stringify(item.message);
  expect(pending.interruptReview("p", true)).toBe(false);
  expect(JSON.stringify(item.message)).toBe(before);
  expect(pending.next("p")).toBeNull();
});
