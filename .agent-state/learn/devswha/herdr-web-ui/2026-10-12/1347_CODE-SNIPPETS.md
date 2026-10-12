# Input and split source patterns

Source: `7f12ec6176ec7f4921ab4a7f1ab31c4ae826e116`. Historical comparison: `54e5a1f67090cb09552d182e7e30dd0ecc314918`.
Read-only reader findings, synthesized by Main. No tests, builds, browser sessions, or runtime verification. These patterns are not local implementation approval.

## IME guards are layered

Owner: `origin/src/components/Composer.tsx`, textarea bindings and `send()`.

```tsx
onCompositionStart={() => { composingRef.current = true; }}
onCompositionEnd={() => { composingRef.current = false; }}
```

The key handler also checks `isComposing` and WebKit's `keyCode === 229`; `send()` rechecks the composition ref. Reuse the defensive layering, not this repo's draft or delivery policy. This is source evidence, not physical Android/iOS proof.

## Unsupported queueing must not become immediate delivery

Owner: `origin/src/lib/ws.ts`, `HerdrSocket.submit`.

```ts
if (delivery === "hold" && !this.canHoldMessages()) delivery = "queue";
if (delivery === "queue" && !this.canQueueMessages()) return { ok: false, code: "pending_input_unsupported", message: "Update this PC to queue messages." };
```

An older queue-capable bridge can fall back from hold to automatic queue delivery, but a bridge without queue capability refuses. Local adaptation would need its own capability contract and visible fallback policy.

## Send now claims an ID instead of resending text

Owner: `origin/src/components/PendingMessages.tsx` and owning pane connection checks.

```ts
void onSendNow(message.id).finally(() => restoreFocus(keyboard, target, stack, owner));
```

Uncertain items are disabled. A restored browser copy is not proof that the current server connection still owns a sendable item. Queue IDs and connection/lease proofs belong to the upstream protocol, not a reusable frontend-only utility.

## Inactive split halves relinquish focus

Owner: `origin/src/components/PaneTerminal.tsx`, active effect.

```tsx
if (active) onRoleAckRef.current?.(observing ? "observe" : "interact");
else {
  termRef.current?.blur();
  if (stackRef.current?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
```

The App-level active slot controls keyboard ownership. Preserve the local app's own focus lifecycle when adapting this idea.

## Deliberate activation, not incidental focus

Owner: `origin/src/App.tsx`, split-slot capture handlers.

```tsx
onPointerDownCapture={active ? undefined : (event) => {
  if (event.button === 0 && !paneContextPress(event, apple) && !(event.target as Element).closest(".pane-slot-action")) activateSlot(slot);
}}
onFocusCapture={active ? undefined : (event) => { if (Date.now() - lastKeyAtRef.current < KEY_FOCUS_MS && !(event.target as Element).closest(".pane-slot-action")) activateSlot(slot, true); }}
```

Keyboard focus activates a half only after a recent key; slot action buttons are excluded. Pure docking transitions live separately in `origin/src/lib/split.ts`, `dockPane`. Browser split slots compose existing Herdr layouts, not a new native layout contract.

## Codex steering boundary

Main independently checked `origin/server/codex-steering.ts` and `origin/shared/protocol.ts`: only explicit Send now may interrupt a working Codex. The parser matches the live steering section's last message, not a quoted scrollback hint. Fresh reads recheck identity/lease/authority, and ambiguous delivery throws an unconfirmed error rather than inviting an automatic resend. Ordinary Send and next-turn queue delivery must remain separate.
