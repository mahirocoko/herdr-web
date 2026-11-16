import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as native from "../herdr/client.ts";
import * as processStart from "../process-start.ts";
import { createSubmitText, freeAgentInput, InputDraftError, pendingIdentity } from "./composer.ts";
import { AGENT_INPUT_DRAFT_MESSAGE, draftScreenText } from "../../shared/input-draft.ts";
import { nativeDraftScreen } from "../../shared/input-draft-fixtures.ts";

const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });
function fixture(agent: string, body = "leftover draft") {
  let colors = nativeDraftScreen(agent, body);
  let live = draftScreenText(colors);
  let pane: any = { pane_id: "p", terminal_id: "t", agent, agent_status: "idle", agent_session: { kind: "conversation", source: agent, value: "session" } };
  let pid = 123;
  let birth = 1000;
  const writes: string[] = [];
  const reads: string[] = [];
  let scroll: any = null;
  let onRead: ((source: string, format: string) => void) | undefined;
  const spies = [
    spyOn(native, "paneGet").mockImplementation(async () => structuredClone(pane)),
    spyOn(native, "paneProcessInfo").mockImplementation(async () => ({ foreground_processes: [{ pid }] }) as any),
    spyOn(processStart, "processStartedAt").mockImplementation(() => birth),
    spyOn(native, "paneScrollInfo").mockImplementation(async () => scroll),
    spyOn(native, "paneRead").mockImplementation(async (options) => {
      reads.push(`${options.source}:${options.format}`);
      onRead?.(options.source ?? "", options.format ?? "");
      return { text: options.format === "ansi" ? colors : live } as any;
    }),
    spyOn(native, "agentPrompt").mockImplementation(async (_pane, text) => { writes.push(`prompt:${text}`); }),
    spyOn(native, "paneSendText").mockImplementation(async (_pane, text) => { writes.push(`paste:${text}`); }),
    spyOn(native, "paneSendKeys").mockImplementation(async (_pane, keys) => { writes.push(`key:${keys.join(",")}`); }),
  ];
  restores.push(() => { for (const spy of spies) spy.mockRestore(); });
  const submit = createSubmitText({ options: { submitDelayMs: 0 }, lastTyped: new Map(), attachments: new Map([["p", { cols: 80 }]]), terminalAttach: async () => true, SUBMIT_DEADLINE_MS: 5000, TYPED_SETTLE_MS: 0, DRAFT_CLEAR_WAIT_MS: 0, DRAFT_CLEAR_POLL_MS: 0, SUBMIT_DELAY_MS: 0 });
  return {
    writes, reads, pane, spies,
    send: (fromTerminal = false) => submit("p", "Web draft", "Web draft", Date.now(), fromTerminal),
    guard: () => freeAgentInput("p", agent, pendingIdentity(pane), 80),
    colors: (value: string) => { colors = value; }, live: (value: string) => { live = value; },
    scroll: (value: any) => { scroll = value; },
    onRead: (value: typeof onRead) => { onRead = value; },
    pid: () => { pid++; }, birth: () => { birth += 3000; },
  };
}

describe("current createSubmitText native draft guard (no native transport)", () => {
  for (const agent of ["pi", "codex", "letta", "omo"]) {
    it(`${agent}: refuses with input_draft and zero prompt/paste/Enter`, async () => {
      const f = fixture(agent, "  > quoted\n  → literal arrow");
      const error = await f.send().catch((error) => error);
      expect(error).toBeInstanceOf(InputDraftError);
      expect(error).toMatchObject({ code: "input_draft", message: AGENT_INPUT_DRAFT_MESSAGE, draft: null, box: null });
      expect(f.writes).toEqual([]);
    });
    it(`${agent}: placeholder and core/no-colour retain existing prompt delivery`, async () => {
      const f = fixture(agent, "\u001b[2msuggestion\u001b[0m");
      await f.send();
      f.colors(draftScreenText(nativeDraftScreen(agent, "undimmed placeholder")));
      f.live(draftScreenText(nativeDraftScreen(agent, "undimmed placeholder")));
      await f.send();
      expect(f.writes).toEqual(["prompt:Web draft", "prompt:Web draft"]);
    });
  }
  for (const [agent, body] of [["pi", "review this\n>\n> quoted"], ["codex", "1. review this"]] as const) {
    it(`${agent}: review counterexample refuses with zero prompt/paste/Enter`, async () => {
      const f = fixture(agent, body);
      await expect(f.send()).rejects.toMatchObject({ code: "input_draft", draft: null, box: null });
      expect(f.writes).toEqual([]);
    });
  }
  for (const [agent, screen] of [
    ["pi", nativeDraftScreen("pi", "> search\n  \u001b[36m→ option\u001b[0m")],
    ["pi", nativeDraftScreen("pi", ">")],
    ["codex", "\u001b[90mApproval\u001b[0m\n› 1. Yes, proceed (y)\n  2. No (esc)\nPress enter to confirm or esc to cancel"],
    ["codex", "\u001b[90mModels\u001b[0m\n› 1. Model\n  2. Other model\nenter to select · esc to close"],
  ] as const) {
    it(`${agent}: real search/choice menu is not draft evidence`, async () => {
      const f = fixture(agent);
      f.colors(screen); f.live(draftScreenText(screen));
      await f.guard(); // This helper is not permission to send into a menu; existing prompt guards own that.
      expect(f.writes).toEqual([]);
    });
  }
  it("scrolled viewport, stale colours and live text changing during reads are not positive evidence", async () => {
    const f = fixture("letta");
    f.scroll({ offset_from_bottom: 20 });
    await f.send();
    f.scroll({ offset_from_bottom: 0 });
    f.live(draftScreenText(nativeDraftScreen("letta", "")));
    await f.send(); // same scroll position does not permit colours whose text differs
    f.onRead((source) => { if (source === "visible") f.live(`changed ${f.reads.length}`); });
    await f.send();
    expect(f.writes).toEqual(["prompt:Web draft", "prompt:Web draft", "prompt:Web draft"]);
    expect(f.reads.length).toBeLessThan(40);
  });
  for (const change of ["terminal", "session", "agent", "pid", "birth", "masked"]) {
    it(`refuses ${change} replacement after awaited screen reads`, async () => {
      const f = fixture("letta", "");
      f.onRead((source) => {
        if (source !== "visible") return;
        if (change === "terminal") f.pane.terminal_id = "replacement";
        if (change === "session") f.pane.agent_session.value = "replacement";
        if (change === "agent") f.pane.agent = "codex";
        if (change === "pid") f.pid();
        if (change === "birth") f.birth();
        if (change === "masked") f.live("Password: ");
      });
      await expect(f.send()).rejects.toMatchObject({ code: change === "masked" ? "agent_blocked" : "pending_target_changed" });
      expect(f.writes).toEqual([]);
    });
  }
  it("the terminal keyboard lane remains literal, not Chat draft refusal", async () => {
    const f = fixture("letta");
    await f.send(true);
    expect(f.writes).toEqual(["paste:Web draft", "key:Enter"]);
    expect(f.reads).toEqual([]);
  });
  it("an unsupported agent is not read by the new guard", async () => {
    const f = fixture("unknown");
    await f.guard();
    expect(f.reads).toEqual([]);
  });
  it.each(["claude", "hermes"])("%s keeps its existing strong unknown-box refusal", async (agent) => {
    const f = fixture(agent);
    const unreadable = agent === "claude" ? `${"─".repeat(30)}\n❯ unreadable clipped box` : "unreadable input box";
    f.live(unreadable);
    f.colors(unreadable);
    await expect(f.send()).rejects.toMatchObject({ code: "input_draft" });
    expect(f.writes).toEqual([]);
  });
});
