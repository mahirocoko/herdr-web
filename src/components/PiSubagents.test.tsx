import { expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BackgroundTasks } from "./BackgroundTasks.tsx";
import { piTaskWord, piWorkItems, PiSubagentCard, PiSubagentCalls, PiSubagentProvider, PiSubagentTranscript } from "./PiSubagents.tsx";
import { paneStatus } from "../lib/status.ts";
import { SettingsProvider } from "../lib/settings.ts";

const render = (child: ReturnType<typeof createElement>) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { languages: ["en"] } });
  try { return renderToStaticMarkup(createElement(SettingsProvider, { children: child })); }
  finally { if (before) Object.defineProperty(globalThis, "navigator", before); else Reflect.deleteProperty(globalThis, "navigator"); }
};
import type { ConversationPart, OmoTask } from "../../shared/protocol.ts";

const task: OmoTask = { id: "opaque", title: "Inspect parser", category: "Explore", status: "running", model: null, started_at: null, ended_at: null, turns: null, tool_calls: null, tokens: null };
const call: Extract<ConversationPart, { kind: "tool" }> = { kind: "tool", name: "subagent", summary: "Read parser", input: '{"description":"Inspect parser","subagent_type":"Explore"}', output: "Agent started in background.", subagent_id: "opaque" };
it("keeps adjacent children grouped exactly between the work before and after their calls", () => {
  const before: ConversationPart = { kind: "text", text: "Dispatch now" };
  const after: ConversationPart = { kind: "tool", name: "read", summary: "Next file", input: "{}", output: "" };
  const groups = piWorkItems([before, call, { ...call, subagent_id: "second" }, after]);
  expect(groups.map((g) => [g.index, g.calls.length, g.work.length])).toEqual([[0, 0, 1], [1, 2, 0], [3, 0, 1]]);
  expect(groups[0]!.work).toEqual([before]);
  expect(groups[2]!.work).toEqual([after]);
  expect(piWorkItems([])).toEqual([]);
});
it("renders each running child inline as a directly clickable card, not a footer history button", () => {
  const html = render(createElement(PiSubagentCard, { part: call, task: { ...task, detail_id: "opaque" } }));
  expect(html).toContain("Inspect parser");
  expect(html).toContain("Explore · Running");
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain("is-active");
  expect(html).not.toContain("View subagents");
  expect(html).not.toContain("Thinking");
});
it("updates the same card to completed, queued, or unknown without invented running paint", () => {
  for (const next of [{ ...task, status: "completed" as const }, { ...task, phase: "queued" as const }, { ...task, status: "lost" as const, phase: "unknown" as const }]) {
    const html = render(createElement(PiSubagentCard, { part: call, task: next }));
    expect(html).not.toContain("is-active");
    expect(html).toContain(piTaskWord(next));
    expect(html).toContain("Inspect parser");
  }
  const missing = render(createElement(PiSubagentCalls, { parts: [call] }));
  expect(missing).toContain("Status unknown");
  expect(missing).not.toContain("is-active");
});
it("does not open an unrelated history list for a call without a verified child reference", () => {
  const html = render(createElement(PiSubagentCard, { part: { ...call, subagent_id: undefined } }));
  expect(html).toContain('disabled=""');
  expect(html).toContain("Status unknown");
});
it("renders child prose/code, structured tool arguments and errors instead of a raw transcript dump", () => {
  const html = render(createElement(PiSubagentTranscript, { category: "Explore", turns: [
    { role: "user", ts: null, parts: [{ kind: "text", text: "Inspect **parser**" }] },
    { role: "assistant", ts: null, parts: [{ kind: "text", text: "## Findings\n\n```ts\nconst ok = true;\n```" },
      { kind: "tool", name: "bash", summary: "Run check", input: '{"command":"bun check","cwd":"/fixture"}', output: "<script>not executable</script>", error: true }] },
  ] }));
  expect(html).toContain("<strong><span>parser</span></strong>");
  expect(html).toContain('data-markdown-heading="2"');
  expect(html).toContain("Findings");
  expect(html).toContain("<code");
  expect(html).toContain("<dt>command</dt>");
  expect(html).toContain("bun check");
  expect(html).toContain("pi-subagent-tool is-error");
  expect(html).toContain("Error</h3>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("&quot;command&quot;");
});
it("exposes Pi history discovery even with no running children", () => {
  const html = render(createElement(BackgroundTasks, { paneId: "pane", count: 0, omo: false, pi: true }));
  expect(html).toContain("bg-tasks-toggle");
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("is-idle");
});
it("shows the existing activity chip and count while Pi children run", () => {
  const html = render(createElement(BackgroundTasks, { paneId: "pane", count: 2, omo: false, pi: true }));
  expect(html).toContain('class="bg-tasks-count"');
  expect(html).toContain(">2</span>");
  expect(html).not.toContain("bg-tasks-toggle is-idle");
});
it("labels queue and missing live evidence without claiming completion or liveness", () => {
  expect(piTaskWord(task)).toBe("Running");
  expect(piTaskWord({ ...task, phase: "queued" })).toBe("Queued");
  expect(piTaskWord({ ...task, status: "lost", phase: "unknown" })).toBe("Status unknown");
  expect(piTaskWord({ ...task, status: "failed" })).toBe("failed");
});
it("keeps Main at rest plus background work distinct from a native working status", () => {
  const native = { agent_status: "done" as const, background_wait: true as const };
  expect(paneStatus(native)).toBe("waiting");
  expect(native.agent_status).toBe("done");
  expect(paneStatus({ ...native, agent_status: "working" })).toBe("working");
});
it("the pane provider does not replace or remount Chat with another interactive session", () => {
  const html = renderToStaticMarkup(createElement(PiSubagentProvider, { paneId: "pane", visible: true, children: createElement("span", null, "Main chat") }));
  expect(html).toBe("<span>Main chat</span>");
});
