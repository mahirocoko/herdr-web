import { expect, it } from "bun:test";
import { acknowledgeTerminalDraft, readTerminalDraft, setTerminalDraftSending, terminalDraftSending, writeTerminalDraft } from "./terminalDraft.ts";

it("keeps key-shaped terminal lines in memory instead of browser storage", () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    const owner = "privacy:w1:p1";
    writeTerminalDraft(owner, "git status");
    expect(values.get("herdr-web-ui:terminal-line:" + owner)).toBe("git status");
    writeTerminalDraft(owner, "sk-FAKE1234");
    expect(values.has("herdr-web-ui:terminal-line:" + owner)).toBe(false);
    expect(readTerminalDraft(owner)).toBe("sk-FAKE1234");
  } finally {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

it("preserves edits across remounts and confines acknowledgements to the submitting PC/pane", () => {
  const owner = "remote-a:w1:p1";
  const other = "remote-b:w1:p1";
  writeTerminalDraft(owner, "sent");
  writeTerminalDraft(other, "other");
  setTerminalDraftSending(owner, true);
  expect(terminalDraftSending(owner)).toBe(true);
  writeTerminalDraft(owner, "sent plus 한글");
  acknowledgeTerminalDraft(owner);
  setTerminalDraftSending(owner, false);
  expect(readTerminalDraft(owner)).toBe(" plus 한글");
  expect(readTerminalDraft(other)).toBe("other");
});

it("does not erase a replacement even when the user retypes the same text before acknowledgement", () => {
  const owner = "edited:w1:p1";
  writeTerminalDraft(owner, "same text");
  setTerminalDraftSending(owner, true);
  writeTerminalDraft(owner, "");
  writeTerminalDraft(owner, "same text");
  acknowledgeTerminalDraft(owner);
  setTerminalDraftSending(owner, false);
  expect(readTerminalDraft(owner)).toBe("same text");
});
