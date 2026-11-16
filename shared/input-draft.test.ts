import { describe, expect, it } from "bun:test";
import { readsTypedDraft, screenFromAnsi, typedDraft } from "./input-draft.ts";

import { nativeDraftScreen } from "./input-draft-fixtures.ts";

describe("positive native draft evidence", () => {
  for (const agent of ["pi", "codex", "letta", "omo"]) {
    const draft = (body: string) => typedDraft(agent, screenFromAnsi(nativeDraftScreen(agent, body)));
    it(`${agent}: typed vs placeholder/suggestion/cursor and no-colour`, () => {
      expect(draft("leftover draft")).toBe(true);
      expect(draft("")).toBe(false);
      for (const body of ["\u001b[2msuggested prompt\u001b[0m", "\u001b[90msuggested prompt\u001b[0m", "\u001b[3mplaceholder\u001b[0m", "\u001b[7mx\u001b[0m\u200b\u200c"]) expect(draft(body)).toBe(false);
      const plain = nativeDraftScreen(agent, "typed or undimmed placeholder").replace(/\u001b\[[0-9;]*m/g, "");
      for (const text of [plain, `\u001b[0m${plain}`, `\u001b[H${plain}`]) expect(typedDraft(agent, screenFromAnsi(text))).toBe(false);
    });
    it(`${agent}: multiline, blank-first, quoted and indented input`, () => {
      expect(draft("  > quoted\n  → literal arrow\n  code()")).toBe(true);
      expect(draft("\n  > quote on second row")).toBe(true);
    });
  }
  it("Pi blank Markdown quotes and Codex numbered-list drafts remain positive evidence", () => {
    expect(typedDraft("pi", screenFromAnsi(nativeDraftScreen("pi", "review this\n>\n> quoted")))).toBe(true);
    expect(typedDraft("codex", screenFromAnsi(nativeDraftScreen("codex", "1. review this")))).toBe(true);
  });
  it("Pi bare search and coloured search/select menus are not drafts", () => {
    for (const body of [">", ">\n  \u001b[36m→ option\u001b[0m", "> search\n  \u001b[36m→ option\u001b[0m"]) {
      expect(typedDraft("pi", screenFromAnsi(nativeDraftScreen("pi", body)))).toBe(false);
    }
  });
  it("Pi-labelled OmO's bare empty mark is not typed Pi text", () => {
    const empty = nativeDraftScreen("omo", "").replace("❯ ", "❯");
    expect(typedDraft("pi", screenFromAnsi(empty))).toBe(false);
    expect(typedDraft("pi", screenFromAnsi(nativeDraftScreen("omo", "typed")))).toBe(true);
  });
  it("Codex's plain footer is not draft evidence under a dim suggestion", () => {
    expect(typedDraft("codex", screenFromAnsi("› \u001b[2msuggestion\u001b[0m\n  model · /fictional"))).toBe(false);
  });
  it("Pi's coloured select cursor is a dialog, not a quoted draft (#3773)", () => {
    expect(typedDraft("pi", screenFromAnsi(nativeDraftScreen("pi", "> search\n  \u001b[36m→ option\u001b[0m")))).toBe(false);
    expect(typedDraft("pi", screenFromAnsi(nativeDraftScreen("pi", "> quote\n  → literal")))).toBe(true);
  });
  it("Letta quoted mark is a continuation, not a new box (#3773/#3775)", () => {
    expect(typedDraft("letta", screenFromAnsi(nativeDraftScreen("letta", "first\n› quoted\nlast")))).toBe(true);
  });
  it("Codex shortcut placeholders, numbered choices, inverse marks and fields are not drafts", () => {
    for (const text of ["› Ask anything\n  ? for shortcuts", "› 1. Yes\n  esc cancel", "› 1. Yes, proceed (y)\n  2. No (esc)\nPress enter to confirm or esc to cancel", "› 1. Model\n  2. Other model\nenter to select · esc to close", "\u001b[7m›\u001b[0m choice\n  model", "› rename\n  enter submit · esc back", "› historical message"]) {
      expect(typedDraft("codex", screenFromAnsi(`\u001b[90mhistory\u001b[0m\n${text}`))).toBe(false);
    }
  });
  it("unknown boxes, agents and unrecorded foreground themes prove nothing", () => {
    expect(readsTypedDraft("claude")).toBe(false);
    expect(readsTypedDraft("hermes")).toBe(false);
    expect(readsTypedDraft("unknown")).toBe(false);
    expect(typedDraft("pi", screenFromAnsi("\u001b[90mnot a box\u001b[0m"))).toBe(false);
    expect(typedDraft("letta", screenFromAnsi(nativeDraftScreen("letta", "\u001b[38:2::200:201:202mthemed text\u001b[0m")))).toBe(false);
    expect(typedDraft("letta", screenFromAnsi(nativeDraftScreen("letta", "\u001b[48;2;1;2;3m\u001b[7mx\u001b[0m\u200b")))).toBe(false);
  });
});
