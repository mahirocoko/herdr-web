import { describe, expect, it } from "bun:test";
import type { ServerMessage } from "../../shared/protocol.ts";
import { ComposerDraftStore } from "./composerDraft.ts";
import { PendingMessageStore } from "./pendingMessages.ts";
import { editPendingMessage } from "./pendingEdit.ts";
import type { HerdrSocket, SubmitResult } from "./ws.ts";
import { MachineSession } from "./machineSession.ts";

function fixture() {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  const store = new PendingMessageStore(() => storage), drafts = new ComposerDraftStore(() => storage);
  const owner = "p1", pane = "p1", scope = "connection-1", draftKey = `herdr-web-ui:composer-draft:${owner}`;
  const row = { id: "pending-1", request_id: 1, text: "recover @uploads/image.png", state: "held" as const, created_at: "2026-10-14T00:00:00Z" };
  store.accept(owner, row, scope);
  let finish!: (answer: SubmitResult) => void;
  const response = new Promise<SubmitResult>((resolve) => { finish = resolve; });
  const listeners = new Set<(frame: ServerMessage) => void>();
  const calls: unknown[] = [];
  const socket = { connected: true, on: (listener: (frame: ServerMessage) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    pendingAction: (pane: string, id: string, action: string) => { calls.push({ pane, id, action }); return response; } };
  let retained = 0;
  const context = { socket, store, drafts, owner, pane, scope, draftKey, retain: () => { retained++; return () => { retained--; }; } };
  const emit = (outcome: "sent" | "discarded" | "withdrawn", id = row.id, paneId = pane) => {
    const frame: ServerMessage = { type: "pending-messages", pane_id: paneId, messages: [], removed: [{ id, outcome }] };
    store.publish(owner, [], paneId === pane ? frame.removed! : [], scope);
    for (const listener of listeners) listener(frame);
  };
  return { ...context, context, row, saved, calls, listeners, finish, emit, retained: () => retained };
}

describe("receipt-bound queue Edit (#2041 scoped port)", () => {
  it("restores once on exact withdrawal, preserving concurrent draft text and attachment mentions", async () => {
    const f = fixture();
    f.drafts.set(f.draftKey, "existing @uploads/other.png");
    const edit = editPendingMessage(f.context, f.row.id);
    expect(f.calls).toEqual([{ pane: "p1", id: "pending-1", action: "withdraw" }]);
    expect(f.retained()).toBe(1);
    expect(f.drafts.read(f.draftKey).text).toBe("existing @uploads/other.png");
    f.drafts.set(f.draftKey, (text) => text + " typed meanwhile");
    f.emit("withdrawn"); f.emit("withdrawn");
    expect(f.drafts.read(f.draftKey).text).toBe("existing @uploads/other.png typed meanwhile\n\nrecover @uploads/image.png");
    // Receipt is sufficient even when the subsequent result is lost.
    f.finish({ ok: false, code: "disconnected", message: "lost result" });
    expect(await edit).toBe(true);
    expect(f.store.read(f.owner)).toEqual([]);
    expect(f.retained()).toBe(0);
    expect(f.listeners.size).toBe(0);
  });

  it("an ok result, ordinary discard, delivery, another ID or another pane never restores text", async () => {
    for (const outcome of ["ok", "sent", "discarded", "other-id", "other-pane"] as const) {
      const f = fixture();
      const edit = editPendingMessage(f.context, f.row.id);
      if (outcome === "sent" || outcome === "discarded") f.emit(outcome);
      if (outcome === "other-id") f.emit("withdrawn", "pending-2");
      if (outcome === "other-pane") f.emit("withdrawn", f.row.id, "p2");
      f.finish({ ok: true });
      expect(await edit).toBe(false);
      expect(f.drafts.read(f.draftKey).text).toBe("");
      expect(f.listeners.size).toBe(0);
    }
  });

  it("refuses uncertain, in-flight, busy, saved-only, disconnected and wrong-scope rows before requesting", async () => {
    for (const kind of ["uncertain", "sending", "resend", "busy", "saved", "offline", "scope"] as const) {
      const f = fixture();
      if (kind === "uncertain" || kind === "sending") f.store.accept(f.owner, { ...f.row, state: kind }, f.scope);
      if (kind === "resend") {
        f.saved.set(`herdr-web-ui:pending:${f.owner}`, JSON.stringify({ messages: [{ ...f.row, resendInFlight: true }] }));
        f.store.refresh(f.owner);
      }
      if (kind === "busy") f.store.begin(f.owner, f.row.id);
      if (kind === "saved") f.store.suspend(f.owner, f.scope);
      if (kind === "offline") f.socket.connected = false;
      if (kind === "scope") f.context.scope = "other-connection";
      expect(await editPendingMessage(f.context, f.row.id)).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });

  it("MachineSession restores a late withdrawal after action timeout with no pane listener", async () => {
    const f = fixture();
    const socket = { ...f.socket, onDisconnect: () => () => {}, setPresence: () => {}, close: () => {} };
    const session = new MachineSession("local", { socket: socket as unknown as HerdrSocket, pendingStore: f.store });
    const receive = (frame: ServerMessage) => { for (const listener of f.listeners) listener(frame); };
    receive({ type: "snapshot", features: [], snapshot: { version: "test", protocol: 22, workspaces: [], tabs: [], panes: [], agents: [], layouts: [] } });
    receive({ type: "pending-messages", pane_id: f.pane, messages: [f.row] });
    f.context.scope = session.scope!;
    const edit = editPendingMessage(f.context, f.row.id);
    f.finish({ ok: false, code: "timeout", message: "action receipt delayed" });
    expect(await edit).toBe(false);
    expect(f.retained()).toBe(0);
    expect(f.store.read(f.owner)).toHaveLength(1);
    f.drafts.set(f.draftKey, "typed after timeout");
    const receipt: ServerMessage = { type: "pending-messages", pane_id: f.pane, messages: [], removed: [{ id: f.row.id, outcome: "withdrawn" }] };
    receive(receipt); receive(receipt);
    expect(f.drafts.read(f.draftKey).text).toBe("typed after timeout\n\nrecover @uploads/image.png");
    expect(f.store.read(f.owner)).toEqual([]);
    expect(f.calls).toHaveLength(1);
    session.close();
  });

  it("disconnect cancels recovery authority and an old-scope receipt keeps retained text", async () => {
    const f = fixture();
    const edit = editPendingMessage(f.context, f.row.id);
    f.finish({ ok: false, code: "timeout", message: "action receipt delayed" });
    await edit;
    f.store.suspend(f.owner, f.scope);
    f.emit("withdrawn");
    expect(f.drafts.read(f.draftKey).text).toBe("");
    expect(f.store.read(f.owner)).toMatchObject([{ text: f.row.text, serverOwned: false }]);
    expect(f.calls).toHaveLength(1);
  });

  it("failed restoration keeps the row rather than deleting the only retained text", () => {
    const f = fixture();
    f.store.recoverWithdrawal(f.owner, f.row.id, f.scope, () => { throw new Error("draft unavailable"); });
    f.emit("withdrawn");
    expect(f.store.read(f.owner).map((row) => row.text)).toEqual([f.row.text]);
  });

  it("an unarmed withdrawal cannot centrally erase retained text", () => {
    const f = fixture();
    f.emit("withdrawn");
    expect(f.store.read(f.owner).map((row) => row.text)).toEqual([f.row.text]);
    expect(f.drafts.read(f.draftKey).text).toBe("");
  });

  it("a refusal or disconnect never copies into the draft or retries", async () => {
    for (const code of ["invalid_pending_action", "pending_not_withdrawable", "disconnected"]) {
      const f = fixture();
      const edit = editPendingMessage(f.context, f.row.id);
      f.finish({ ok: false, code, message: "refused" });
      expect(await edit).toBe(false);
      expect(f.drafts.read(f.draftKey).text).toBe("");
      expect(f.store.read(f.owner)).toHaveLength(1);
      expect(f.calls).toHaveLength(1);
      expect(f.store.isBusy(f.owner, f.row.id)).toBe(false);
    }
  });

  it("draft restoration reads other-tab edits, keeps oversized input and never sends it", () => {
    const f = fixture();
    f.drafts.read(f.draftKey);
    const large = "x".repeat(20_001);
    f.saved.set(f.draftKey, large);
    f.drafts.restorePending(f.draftKey, f.row.text);
    expect(f.drafts.read(f.draftKey).text).toBe(`${large}\n\n${f.row.text}`);
    expect(f.calls).toEqual([]);
  });
});
