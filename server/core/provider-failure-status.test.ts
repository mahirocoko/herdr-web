import { expect, mock, spyOn, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as collector from "../collector.ts";
import * as client from "../herdr/client.ts";
import * as push from "../push.ts";
import * as processStart from "../process-start.ts";
import * as conversation from "../conversation.ts";
import { OmoStatus } from "../omo-status.ts";
import { ClaudeSubagentStatus } from "../claude-subagents.ts";
import { SessionPlans } from "../session-plan.ts";
import { createStatusHub } from "./status.ts";
import type { HerdrPane, SessionSnapshot } from "../../shared/protocol.ts";

test("production resolver tolerates Darwin birth estimates without losing identity or admitting replacements", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-provider-resolver-"));
  const path = join(root, "fictional.jsonl"); writeFileSync(path, '{"type":"header"}\n');
  const pane = { pane_id: "fictional", terminal_id: "fictional-terminal", agent: "claude", agent_status: "idle", cwd: root } as HerdrPane;
  let handlers!: collector.StatusCollectorHandlers;
  let birth = 1000, birthCalls = 0, holdNext: Promise<void> | undefined;
  const pendingStates: string[] = [];
  spyOn(client, "sessionSnapshot").mockImplementation(async () => {
    const copy = structuredClone(pane), gate = holdNext; holdNext = undefined;
    if (gate) await gate;
    return { panes: [copy], agents: [], workspaces: [], tabs: [] } as unknown as SessionSnapshot;
  });
  spyOn(client, "paneGet").mockImplementation(async () => structuredClone(pane));
  spyOn(client, "paneProcessInfo").mockImplementation(async () => ({ pane_id: pane.pane_id, foreground_processes: [{ pid: 321123, name: "claude" }] }));
  spyOn(processStart, "processStartedAt").mockImplementation(() => { birthCalls++; if (process.platform === "darwin") birth += 40; return birth; });
  spyOn(conversation, "claudePaneSession").mockImplementation(async () => ({ pid: 321123, path, sessionId: "fictional" } as any));
  spyOn(collector, "startStatusCollector").mockImplementation((callbacks) => { handlers = callbacks; return { ready: Promise.resolve(), trackPane() {}, stop() {} } as unknown as collector.StatusCollector; });
  spyOn(push, "createPushService").mockImplementation(() => ({ seed() {}, resync() {}, onEnded: async () => {}, onStatus: async () => {} } as unknown as ReturnType<typeof push.createPushService>));
  spyOn(OmoStatus.prototype, "start").mockImplementation(() => {});
  spyOn(ClaudeSubagentStatus.prototype, "start").mockImplementation(() => {});
  spyOn(SessionPlans.prototype, "start").mockImplementation(() => {});
  const hub = createStatusHub({
    options: { stateDir: root, machines: false }, devices: {} as any, clients: new Set(), present: new Set(),
    pending: { status: (_id: string, value: string) => { pendingStates.push(value); }, baseline() {}, forget() {} } as any,
    drainPending() {}, holdPendingPane() {}, usage: { forget() {} } as any, usageLogin: { forget() {} } as any,
  });
  const ticks = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const error = () => appendFileSync(path, JSON.stringify({ type: "assistant", isApiErrorMessage: true, message: { content: [{ type: "text", text: "fictional limit" }], stop_reason: "end_turn" } }) + "\n");
  try {
    await hub.inputSnapshot(); await ticks();
    handlers.onStatus("fictional", "working", "claude"); pane.agent_status = "working";
    let release!: () => void; holdNext = new Promise<void>((done) => { release = done; });
    const oldWorkingRead = hub.inputSnapshot();
    error(); pane.agent_status = "done"; handlers.onStatus("fictional", "done", "claude"); await ticks();
    expect(pendingStates).toContain("failed"); expect(birthCalls).toBeGreaterThanOrEqual(4);
    release(); await oldWorkingRead; await ticks();
    expect((await hub.clientSnapshot()).panes[0]?.agent_status).toBe("failed");
    handlers.onStatus("fictional", "working", "claude"); pane.agent_status = "working";
    birth += 3000; error(); pane.agent_status = "done"; handlers.onStatus("fictional", "done", "claude"); await ticks();
    expect(hub.providerInputHeld("fictional")).toBe(false);
    expect((await hub.clientSnapshot()).panes[0]?.agent_status).toBe("done");
  } finally {
    hub.omo.stop(); hub.gjc.stop(); hub.claudeAgents.stop(); hub.piAgents.stop(); hub.plans.stop(); clearInterval(hub.waitTimer);
    await ticks(); mock.restore(); rmSync(root, { recursive: true, force: true });
  }
});

// Only the hub runs: native subscriptions, all process RPC and Push delivery are replaced.
test("hub suppresses false Done while keeping manual/native input status separate", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-provider-hub-"));
  const path = join(root, "fictional.jsonl"); writeFileSync(path, '{"type":"header"}\n');
  const pane = { pane_id: "fictional", terminal_id: "fictional-terminal", agent: "codex", agent_status: "idle", cwd: root } as HerdrPane;
  let handlers!: collector.StatusCollectorHandlers;
  let resolverGate: Promise<void> = Promise.resolve();
  const alerts: string[] = [], queued: string[] = [];
  spyOn(client, "sessionSnapshot").mockImplementation(async () => ({ panes: [pane], agents: [], workspaces: [], tabs: [] } as unknown as SessionSnapshot));
  spyOn(client, "paneGet").mockImplementation(async () => pane);
  spyOn(client, "paneProcessInfo").mockImplementation(async () => ({ pane_id: "fictional", foreground_processes: [] }));
  spyOn(collector, "startStatusCollector").mockImplementation((callbacks) => {
    handlers = callbacks;
    return { ready: Promise.resolve(), trackPane() {}, stop() {} } as unknown as collector.StatusCollector;
  });
  spyOn(push, "createPushService").mockImplementation(() => ({
    seed() {}, resync() {}, onEnded: async () => {}, onStatus: async (_pane: string, status: string) => { alerts.push(status); },
  } as unknown as ReturnType<typeof push.createPushService>));
  const hub = createStatusHub({
    options: { stateDir: root, machines: false, providerFailure: { resolve: async () => { await resolverGate; return { path, identity: "fictional-process:1" }; } } },
    devices: { any: () => false } as any, clients: new Set(), present: new Set(),
    pending: { status: (_id: string, status: string) => { queued.push(status); }, baseline() {}, forget() {} } as any,
    drainPending() {}, holdPendingPane() {}, usage: { forget() {} } as any, usageLogin: { forget() {} } as any,
  });
  const ticks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  try {
    await hub.inputSnapshot(); await ticks();
    handlers.onStatus("fictional", "working", "codex"); pane.agent_status = "working";
    appendFileSync(path, JSON.stringify({ type: "event_msg", payload: { type: "task_started", turn_id: "parent" } }) + "\n" + JSON.stringify({ type: "event_msg", payload: { type: "task_complete", turn_id: "parent", error: { message: "fictional refusal" } } }) + "\n");
    let release!: () => void; resolverGate = new Promise((done) => { release = done; });
    alerts.length = 0; queued.length = 0;
    pane.agent_status = "done"; handlers.onStatus("fictional", "done", "codex");
    expect(hub.providerInputHeld("fictional")).toBe(true);
    expect((await hub.inputSnapshot()).panes[0]?.agent_status).toBe("done");
    expect((await hub.clientSnapshot()).panes[0]?.agent_status).toBe("unknown");
    expect(alerts).not.toContain("done"); expect(queued).not.toContain("done");
    release(); await ticks();
    expect((await hub.clientSnapshot()).panes[0]?.agent_status).toBe("failed");
    expect(hub.providerInputHeld("fictional")).toBe(true);
    expect(alerts).not.toContain("done"); expect(queued).not.toContain("done");
    handlers.onStatus("fictional", "working", "codex"); pane.agent_status = "working";
    expect(hub.providerInputHeld("fictional")).toBe(false);
    expect((await hub.clientSnapshot()).panes[0]?.agent_status).toBe("working");
  } finally {
    hub.omo.stop(); hub.gjc.stop(); hub.claudeAgents.stop(); hub.piAgents.stop(); hub.plans.stop(); clearInterval(hub.waitTimer);
    await ticks(); mock.restore(); rmSync(root, { recursive: true, force: true });
  }
});
