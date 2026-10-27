import type { ComposerDraftStore } from "./composerDraft.ts";
import { pendingActionUncertain } from "./compose.ts";
import type { PendingMessageStore } from "./pendingMessages.ts";
import type { HerdrSocket } from "./ws.ts";

/** Edit never sends text. Only this connection's exact withdrawal receipt restores it, even if
 * the result frame is lost. An ok result, ordinary discard, delivery or empty snapshot cannot. */
export async function editPendingMessage({ socket, store, drafts, owner, pane, scope, draftKey, retain }: {
  socket: Pick<HerdrSocket, "connected" | "on" | "pendingAction">;
  store: PendingMessageStore;
  drafts: ComposerDraftStore;
  owner: string;
  pane: string;
  scope: string | null;
  draftKey: string;
  retain?: () => () => void;
}, id: string): Promise<boolean> {
  store.refresh(owner);
  const message = store.read(owner).find((row) => row.id === id);
  if (scope === null || !socket.connected || !message?.serverOwned || !store.isOwned(owner, id, scope)
    || message.resendInFlight || !["queued", "held"].includes(message.state) || !store.begin(owner, id)) return false;
  let restored = false;
  // MachineSession publishes receipts before pane listeners. Recovery belongs to that store
  // transaction, not a temporary listener removed when pendingAction times out.
  store.recoverWithdrawal(owner, id, scope, () => {
    if (restored) return;
    drafts.restorePending(draftKey, message.text);
    restored = true;
  });
  let release: (() => void) | undefined;
  try {
    release = retain?.();
    const answer = await socket.pendingAction(pane, id, "withdraw");
    if (!restored && (!answer || !answer.ok)) {
      const code = answer?.code ?? "not_transmitted";
      store.fail(owner, id, { code, message: answer?.message ?? "The edit request did not leave this browser" }, pendingActionUncertain(code, message.state));
    }
  } catch {
    if (!restored) store.fail(owner, id, { code: "disconnected", message: "Check the terminal before sending this message again" }, true);
  } finally {
    release?.();
    store.end(owner, id);
  }
  return restored;
}
