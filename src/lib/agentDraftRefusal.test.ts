import { afterEach, expect, it } from "bun:test";
import { AGENT_INPUT_DRAFT_MESSAGE } from "../../shared/input-draft.ts";
import { pendingActionUncertain, submitNotTyped, submitRefusal } from "./compose.ts";
import { setCurrentLanguage } from "./i18n.ts";

afterEach(() => setCurrentLanguage("en"));
it("uses the new plain-language input_draft note without offering Claude-only overrides", () => {
  for (const agent of ["pi", "codex", "letta", null]) {
    expect(submitRefusal("input_draft", AGENT_INPUT_DRAFT_MESSAGE, undefined, undefined, agent)).toBe("Not sent: the agent's input box in the terminal holds typed text. Send or clear it there, then send this message.");
  }
  expect(submitNotTyped("input_draft")).toBe(true);
  expect(pendingActionUncertain("input_draft", "held")).toBe(false);
  // Existing Claude/Hermes results still use their own notes, not the new positive-only one.
  expect(submitRefusal("input_draft", "old server", undefined, undefined, "claude")).toContain("Claude Code");
  expect(submitRefusal("input_draft", "old server", undefined, undefined, "hermes")).toContain("Hermes");
});
it("shows the authored Thai refusal with the same result shape", () => {
  setCurrentLanguage("th");
  expect(submitRefusal("input_draft", AGENT_INPUT_DRAFT_MESSAGE)).toBe("ไม่ได้ส่ง: ช่องพิมพ์ของเอเจนต์ในเทอร์มินัลมีข้อความอยู่ ให้ส่งหรือล้างข้อความตรงนั้นก่อน แล้วค่อยส่งข้อความนี้");
});
