import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { translate } from "../lib/i18n.ts";
import { SettingsProvider } from "../lib/settings.ts";
import { PendingMessages, pendingEditFocus } from "./PendingMessages.tsx";
import type { PendingMessageView } from "../lib/pendingMessages.ts";

const render = (code: string, message: string, languages: string[], serverOwned = true): string => {
  const saved = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: languages });
  try {
    return renderToStaticMarkup(createElement(SettingsProvider, { children: createElement(PendingMessages, {
      messages: [{ id: "p1", request_id: 1, text: "ls", state: "held", created_at: "2026-10-14T00:00:00.000Z", serverOwned, error: { code, message } }],
      connected: true, blocked: false, unsaved: false, isBusy: () => false,
      onSendNow: async () => {}, onEdit: async () => false, onDiscard: async () => {},
    }) }));
  } finally {
    if (saved) Object.defineProperty(navigator, "languages", saved);
    else Reflect.deleteProperty(navigator, "languages");
  }
};

describe("Edit queued message (#2041 scoped port)", () => {
  const row: PendingMessageView = { id: "pending-1", request_id: 1, text: "edit this", state: "queued", created_at: "2026-10-14T00:00:00Z", serverOwned: true };
  const view = (changes: Partial<PendingMessageView> = {}, connected = true, busy = false) => {
    const saved = Object.getOwnPropertyDescriptor(navigator, "languages");
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
    try {
      return renderToStaticMarkup(createElement(SettingsProvider, {
        children: createElement(PendingMessages, { messages: [{ ...row, ...changes }], connected, blocked: false, unsaved: false,
          isBusy: () => busy, onSendNow: async () => {}, onEdit: async () => false, onDiscard: async () => {} }),
      }));
    } finally {
      if (saved) Object.defineProperty(navigator, "languages", saved);
      else Reflect.deleteProperty(navigator, "languages");
    }
  };
  it("names the native edit button with its row and supports Thai", () => {
    expect(view()).toContain('aria-label="Edit queued message: edit this"');
    expect(view({ state: "held" })).toContain('title="Edit queued message"');
    expect(translate("th", "Edit queued message")).toBe("แก้ไขข้อความในคิว");
  });
  it("never offers editing for uncertain, sending or saved-only copies", () => {
    for (const changes of [{ state: "uncertain" as const }, { state: "sending" as const }, { serverOwned: false }]) {
      expect(view(changes)).not.toContain("Edit queued message");
    }
  });
  it("offers row-named Copy message for saved held copies without changing their text", () => {
    const html = view({ state: "held", serverOwned: false });
    expect(html).toContain('aria-label="Copy message: edit this"');
    expect(html).toContain("Copying keeps this message here and does not send it.");
    expect(html).toContain("Check the terminal before manually pasting and sending.");
    expect(html).toContain('class="pending-message-bubble">edit this</div>');
    expect(html).not.toContain("Edit queued message");
    // Ordinary live held/queued rows retain their accepted action anatomy.
    expect(view({ state: "held" })).not.toContain('title="Copy message"');
    expect(view()).toContain('aria-label="Send now: edit this"');
  });
  it("replaces useless Send now/Edit with explicit Copy after expired or withdrawn refusals", () => {
    for (const code of ["pending_not_found", "pending_withdrawn"]) {
      for (const serverOwned of [false, true]) {
        const html = view({ state: "held", serverOwned, error: { code, message: "old ID cannot send" } });
        expect(html).toContain('aria-label="Copy message: edit this"');
        expect(html).not.toContain("pending-message-send");
        expect(html).not.toContain("Edit queued message");
        expect(html).toContain('class="pending-message-bubble">edit this</div>');
      }
    }
  });
  it("keeps recovery available offline and names distinct uncertain rows", () => {
    expect(view({ state: "held", serverOwned: false }, false)).toContain('title="Copy message"');
    expect(view({ state: "uncertain", text: "another row" })).toContain('aria-label="Copy message: another row"');
    const key = "Copying keeps this message here and does not send it. Check the terminal before manually pasting and sending.";
    expect(translate("th", key)).not.toBe(key);
  });
  it("disables the edit button offline, while busy and during a resend", () => {
    for (const html of [view({}, false), view({}, true, true), view({ resendInFlight: true })]) {
      expect(html).toMatch(/title="Edit queued message" disabled=""/);
    }
  });
});

describe("Edit keyboard focus recovery", () => {
  function focusFixture(keyboard = true) {
    const frames: FrameRequestCallback[] = [];
    const win = Object.assign(new EventTarget(), { requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } });
    const body = {}, elsewhere = {};
    const doc = Object.assign(new EventTarget(), { defaultView: win, body, activeElement: body as object });
    let owner = "pane-1", active = true, buttonFocus = 0, composerFocus = 0;
    const stack = { isConnected: true, getAttribute: () => owner, querySelector: () => ({ focus: () => { composerFocus++; } }) };
    const button = { ownerDocument: doc, isConnected: true, disabled: false, closest: () => stack,
      focus: () => { buttonFocus++; doc.activeElement = button; } };
    doc.activeElement = button;
    const finish = pendingEditFocus(button as unknown as HTMLButtonElement, keyboard, () => active);
    // Browser disabling the busy button may silently return focus to BODY.
    button.disabled = true; doc.activeElement = body;
    const frame = () => { const pending = frames.splice(0); for (const callback of pending) callback(0); };
    const move = () => {
      doc.activeElement = elsewhere;
      const event = new Event("focusin"); Object.defineProperty(event, "target", { value: elsewhere }); doc.dispatchEvent(event);
      doc.activeElement = body;
    };
    return { button, stack, doc, win, finish, frame, move, setOwner: (value: string) => { owner = value; },
      deactivate: () => { active = false; }, counts: () => [buttonFocus, composerFocus] };
  }
  it("restores the same connected Edit after refusal and the busy render, without scrolling", () => {
    const f = focusFixture();
    f.finish(false); f.frame();
    expect(f.counts()).toEqual([0, 0]);
    f.button.disabled = false; f.frame();
    expect(f.counts()).toEqual([1, 0]);
  });
  it("never steals focus after later input, focus movement or leaving the window", () => {
    for (const action of ["keydown", "pointerdown", "input", "wheel", "focus", "blur"]) {
      const f = focusFixture();
      if (action === "focus") f.move();
      else if (action === "blur") f.win.dispatchEvent(new Event("blur"));
      else f.doc.dispatchEvent(new Event(action));
      f.button.disabled = false; f.finish(false); f.frame();
      expect(f.counts()).toEqual([0, 0]);
    }
  });
  it("does not recover pointer activation, inactive panes, replaced owners or disconnected targets", () => {
    for (const condition of ["pointer", "inactive", "owner", "target", "stack", "disabled"]) {
      const f = focusFixture(condition !== "pointer");
      f.button.disabled = condition === "disabled";
      if (condition === "inactive") f.deactivate();
      if (condition === "owner") f.setOwner("pane-2");
      if (condition === "target") f.button.isConnected = false;
      if (condition === "stack") f.stack.isConnected = false;
      f.finish(false); f.frame(); f.frame();
      expect(f.counts()).toEqual([0, 0]);
    }
  });
  it("honors cancellation between settlement and render, including successful Edit", () => {
    for (const edited of [false, true]) {
      const f = focusFixture();
      f.finish(edited); f.move(); f.button.disabled = false; f.frame();
      expect(f.counts()).toEqual([0, 0]);
    }
    for (const keyboard of [true, false]) {
      const f = focusFixture(keyboard);
      f.button.isConnected = false; f.finish(true); f.frame();
      expect(f.counts()).toEqual([0, 1]);
    }
  });
});

describe("a pending row's refusal note", () => {
  it("says a held-input refusal in the reader's language, not the raw English reason", () => {
    const held = translate("th", "Not sent: send or discard the held input first.");
    expect(held).not.toBe("Not sent: send or discard the held input first.");
    const html = render("held_input", "send or discard the held input first", ["th"]);
    expect(html).toContain(held);
    expect(html).not.toContain("send or discard the held input first");
  });

  it("keeps Send now on a saved copy whose send never left the browser, and says it was not sent (regression #541)", () => {
    const note = translate("th", "Not sent: the connection dropped before this message left. Send it again.");
    expect(note).not.toBe("Not sent: the connection dropped before this message left. Send it again.");
    const html = render("not_transmitted", "the connection dropped before this message was sent", ["th"], false);
    expect(html).toContain(note);
    expect(html).toContain("pending-message-send");
    expect(html).not.toContain("the connection dropped before this message was sent");
  });

  it("keeps the server's reason for other refusals", () => {
    expect(render("agent_blocked", "the agent is busy", ["en"])).toContain("Not sent: the agent is busy");
  });
});
