import { useRef, useState } from "react";
import { ArrowUp, Copy, Pencil, X } from "lucide-react";
import type { PendingMessageView } from "../lib/pendingMessages.ts";
import { copyText } from "../lib/clipboard.ts";
import { submitNote } from "../lib/compose.ts";
import { useT } from "../lib/i18n.ts";
import "./PendingMessages.css";

interface Props {
  messages: PendingMessageView[];
  active?: boolean;
  connected: boolean;
  /** the pane's agent, which names the input a refusal is about */
  agent?: string | null;
  blocked: boolean;
  unsaved: boolean;
  isBusy: (id: string) => boolean;
  onSendNow: (id: string) => Promise<void>;
  onEdit: (id: string) => Promise<boolean>;
  onDiscard: (id: string) => Promise<void>;
}

/**
 * What a row says of its state. A held message waits for Send now only while this connection
 * holds it on the bridge: a copy restored from storage (another tab's live hold, or one from before
 * a reload) is reviewed first, since the tab that held it may still send it.
 */
export function pendingStatus(message: Pick<PendingMessageView, "state" | "error" | "serverOwned">, busy: boolean, t: (text: string) => string): string {
  if (busy) return t("Sending…");
  if (message.state === "queued") return t("Next turn");
  if (message.state === "held" && !message.error && message.serverOwned) return t("Waits for Send now");
  if (message.state === "uncertain") return t("Not confirmed. Check the terminal before sending again.");
  return t("Held message — review and send");
}

/** A disabled Edit can drop keyboard focus to BODY. Keep recovery scoped to this activation;
 * later input/focus movement cancels it, even if focus subsequently returns to BODY. */
export function pendingEditFocus(target: HTMLButtonElement, keyboard: boolean, active: () => boolean): (edited: boolean) => void {
  const doc = target.ownerDocument, win = doc.defaultView;
  const stack = target.closest(".terminal-stack"), owner = stack?.getAttribute("data-pane-owner");
  if (!win || !stack || doc.activeElement !== target) return () => {};
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  const moved = (event: Event) => { if (event.target !== target && event.target !== doc.body) cancel(); };
  doc.addEventListener("keydown", cancel, true);
  doc.addEventListener("pointerdown", cancel, true);
  doc.addEventListener("input", cancel, true);
  doc.addEventListener("wheel", cancel, true);
  doc.addEventListener("focusin", moved, true);
  win.addEventListener("blur", cancel);
  const cleanup = () => {
    doc.removeEventListener("keydown", cancel, true);
    doc.removeEventListener("pointerdown", cancel, true);
    doc.removeEventListener("input", cancel, true);
    doc.removeEventListener("wheel", cancel, true);
    doc.removeEventListener("focusin", moved, true);
    win.removeEventListener("blur", cancel);
  };
  return (edited) => {
    if (!edited && !keyboard) { cleanup(); return; }
    // Wait for the store's busy=false render. At most two frames; never keep chasing focus.
    const finish = (retry: boolean) => {
      if (cancelled || !active() || !stack.isConnected || stack.getAttribute("data-pane-owner") !== owner
        || (doc.activeElement !== target && doc.activeElement !== doc.body)) { cleanup(); return; }
      if (!edited && target.isConnected && target.disabled && retry) {
        win.requestAnimationFrame(() => finish(false));
        return;
      }
      cleanup();
      if (edited) stack.querySelector<HTMLTextAreaElement>(".composer-text")?.focus({ preventScroll: true });
      else if (target.isConnected && !target.disabled && target.closest(".terminal-stack") === stack)
        target.focus({ preventScroll: true });
    };
    win.requestAnimationFrame(() => finish(true));
  };
}

/** Pending text is separate from the transcript; Send now acts on its ID, never on its text. */
export function PendingMessages({ messages, active = true, connected, agent, blocked, unsaved, isBusy, onSendNow, onEdit, onDiscard }: Props) {
  const t = useT();
  const activeRef = useRef(active);
  const focusEpoch = useRef(0);
  if (activeRef.current !== active) focusEpoch.current++;
  activeRef.current = active;
  const rootRef = useRef<HTMLOListElement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const restoreFocus = (keyboard: boolean, target: HTMLButtonElement, stack: Element | null, owner: string | null): void => {
    const root = rootRef.current;
    if (!activeRef.current || !keyboard || target.isConnected || !stack?.isConnected || stack.getAttribute("data-pane-owner") !== owner) return;
    const next = root?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?? stack.querySelector<HTMLTextAreaElement>(".composer-text");
    next?.focus({ preventScroll: true });
  };
  return <ol ref={rootRef} className="pending-messages" aria-label={t("Queued messages")}>
    {unsaved && <li className="pending-message-note" role="status">{t("Queue could not be saved. Keep this tab open or copy the messages before reloading.")}</li>}
    {messages.map((message) => {
      const busy = isBusy(message.id) || message.state === "sending";
      const uncertain = message.state === "uncertain";
      const expired = message.error?.code === "pending_not_found" || message.error?.code === "pending_withdrawn";
      const recoverable = expired || !message.serverOwned && message.state === "held";
      const status = pendingStatus(message, busy, t);
      return <li key={message.id} className="pending-message" data-state={message.state}>
        <div className="pending-message-bubble" aria-busy={busy || undefined}>{message.text}</div>
        <div className="pending-message-meta">
          <span className="pending-message-note" role="status">{status}</span>
          {!uncertain && !expired && <button type="button" className="icon-button pending-message-action pending-message-send"
            aria-label={`${t("Send now")}: ${message.text}`} aria-busy={busy || undefined} title={t("Send now")}
            disabled={!connected || blocked || busy} onClick={(event) => {
              const target = event.currentTarget, keyboard = event.detail === 0, stack = target.closest(".terminal-stack"), owner = stack?.getAttribute("data-pane-owner") ?? null;
              void onSendNow(message.id).finally(() => restoreFocus(keyboard, target, stack, owner));
            }}><ArrowUp aria-hidden="true" /><span>{t("Send now")}</span></button>}
          {!expired && message.serverOwned && (message.state === "queued" || message.state === "held") && <button type="button" className="icon-button pending-message-action"
            aria-label={`${t("Edit queued message")}: ${message.text}`} title={t("Edit queued message")}
            disabled={!connected || busy || message.resendInFlight} onClick={(event) => {
              const epoch = focusEpoch.current;
              const finishFocus = pendingEditFocus(event.currentTarget, event.detail === 0, () => activeRef.current && focusEpoch.current === epoch);
              void onEdit(message.id).then(finishFocus, () => finishFocus(false));
            }}><Pencil aria-hidden="true" /></button>}
          {(uncertain || recoverable) && <button type="button" className="icon-button pending-message-action" aria-label={`${copied === message.id ? t("Copied") : t("Copy message")}: ${message.text}`}
            title={t("Copy message")} onClick={(event) => {
              const text = event.currentTarget.closest(".pending-message")?.querySelector<HTMLElement>(".pending-message-bubble");
              void copyText(message.text, text).then((ok) => { if (ok) setCopied(message.id); });
            }}><Copy aria-hidden="true" /></button>}
          <button type="button" className="icon-button pending-message-action" aria-label={uncertain ? t("Discard saved copy") : t("Discard")}
            title={uncertain ? t("Discard saved copy") : t("Discard")} disabled={busy || message.serverOwned && !connected}
            onClick={(event) => {
              const target = event.currentTarget, keyboard = event.detail === 0, stack = target.closest(".terminal-stack"), owner = stack?.getAttribute("data-pane-owner") ?? null;
              void onDiscard(message.id).finally(() => restoreFocus(keyboard, target, stack, owner));
            }}><X aria-hidden="true" /></button>
        </div>
        {recoverable && <p className="pending-message-note" role="status">{t("Copying keeps this message here and does not send it. Check the terminal before manually pasting and sending.")}</p>}
        {message.error && !uncertain && <p className="pending-message-note" role="status">{(message.error.code === "input_draft" || message.error.code === "held_input" || message.error.code === "not_transmitted") ? submitNote(message.error.code, message.error.message, agent) : t("Not sent: {message}", { message: message.error.message })}</p>}
      </li>;
    })}
  </ol>;
}
