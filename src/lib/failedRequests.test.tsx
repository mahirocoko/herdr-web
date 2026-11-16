import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatDetails, ChatRowMemoryContext, type ChatRowMemory } from "./chatRowState.tsx";
import { requestItems } from "./failedRequests.ts";
import { indicatorGlyph, knownStatus, paneStatus, rollupStatus, STATUS_WORD } from "./status.ts";
import { statusCounts } from "./paletteSearch.ts";
import { turnRevision } from "./turnRevision.ts";
import type { ConversationPart } from "../../shared/protocol.ts";

const failure: ConversationPart = { kind: "text", text: "fictional refusal", failed: true };
test("request grouping preserves text/tool order and distinguishes terminal errors from retries", () => {
  const parts: ConversationPart[] = [failure, { ...failure }, { kind: "text", text: "Recovered" }];
  const items = requestItems(parts);
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ kind: "failed", at: 0, followed: true, parts: [failure, failure] });
  expect(requestItems([failure])[0]).toMatchObject({ kind: "failed", followed: false });
  expect(requestItems([{ kind: "text", text: "Error: ordinary prose" }])[0]?.kind).toBe("part");
  expect(requestItems([failure, { kind: "tool", name: "read", input: "{}", output: "", summary: "file" }])[0]).toMatchObject({ kind: "failed", followed: true });
});
test("a changed failure flag invalidates the rendered row even when text is unchanged", () => {
  const part = { kind: "text" as const, text: "Fictional provider limit" };
  const turn = { role: "assistant" as const, ts: null, parts: [part] };
  expect(turnRevision(turn)).not.toBe(turnRevision({ ...turn, parts: [{ ...part, failed: true }] }));
  expect(turnRevision(turn)).toBe(turnRevision({ ...turn, parts: [{ ...part, failed: false }] }));
});
test("disclosure defaults follow the current failure only until the reader chooses", () => {
  const memory: ChatRowMemory = { toggles: new Map(), outputs: new Map() };
  const render = (defaultOpen: boolean) => renderToStaticMarkup(createElement(ChatRowMemoryContext.Provider, { value: memory }, createElement(ChatDetails, { memoryKey: "failed:0", defaultOpen }, "Fictional failure")));
  expect(render(true)).toContain('open=""'); expect(render(false)).not.toContain('open=""');
  memory.toggles.set("failed:0", false); expect(render(true)).not.toContain('open=""');
  memory.toggles.set("failed:0", true); expect(render(false)).toContain('open=""');
});
test("failure status is named and distinct from native readiness, without adding palette chips", () => {
  expect(knownStatus("failed")).toBe("failed"); expect(STATUS_WORD.failed).toBe("FAILED");
  expect(indicatorGlyph("failed", "symbols")).toBe("×"); expect(paneStatus({ agent_status: "failed" })).toBe("failed");
  expect(rollupStatus(["done", "failed"])).toBe("failed"); expect(rollupStatus(["blocked", "failed"])).toBe("blocked");
  expect(statusCounts([{ pane_id: "p", agent_status: "failed" } as any])).toEqual({ all: 1, blocked: 0, working: 0, idle: 0, done: 0, waiting: 0 });
});
