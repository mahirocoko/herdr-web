# Concrete source patterns — refreshed study

Source: `54e5a1f67090cb09552d182e7e30dd0ecc314918`, 2026-10-06. Baseline: `b498e7f053de3ac30318ac7d88b6fd21865edadf`. Reader: task_2 (patterns); Main consolidated. Prior source-pattern notes were recovered by Main from the personal workspace. No installs, tests, builds, browser or live runtime checks. Excerpts are selected fragments, not complete implementations or adoption-ready copies.

## 1. Interpret typed answers without typing arbitrary text into a menu

`src/lib/promptAnswer.ts` lines36–48:

```ts
if (prompt.multi_select) {
  const indices = value.split(/[\s,]+/).filter(Boolean).map(byNumber);
  return indices.every((index) => index !== null) ? { option_indices: [...new Set(indices as number[])] } : null;
}
const numbered = byNumber(value);
if (numbered !== null) return { option_index: numbered };
const lower = value.toLowerCase();
```

Subsequent branches match canonical labels/bound letters, then return custom_text only when the prompt has a custom option. Option-only prompts refuse unmatched free text. Pure interpretation does not replace server-side asking freshness and key semantics.

## 2. Prompt routing owns stale-card errors instead of retrying blind

`src/components/PaneTerminal.tsx` lines1431–1444, selected fragment:

```tsx
const choice = answerFromText(answering, text);
if (choice === null) return answerRefusal(answering);
if (needsConfirmation(answering, choice)) {
  setPendingAnswer({ pane, promptId: answering.id, answer: choice });
  return true;
}
```

The next branch calls answerPanePrompt with pane/prompt identity, refreshes prompt state on success or error, and translates409 into “question changed; check and answer again.” Approval/plan/menu selections wait for explicit confirmation. Normal input retains socket.submit(); KeyBar retains term.input(). Adding a generic second send route would erase those owners.

## 3. IME and focus policy are part of submission semantics

`src/components/Composer.tsx` lines686–689:

```tsx
const onKeyDown = useCallback(
  (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // an IME keeps its keys; WebKit can send the committing Enter after compositionend, as key code 229
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
```

`PromptCard.tsx` lines69–99 captures press origin and returns focus only after a still-current answer if focus has not moved elsewhere. Touch/pen does not raise the mobile keyboard. Prompt polling is independent of the status badge: idle does not establish that no question waits.

## 4. Scroll ownership distinguishes manual motion from browser layout pullback

`src/lib/tabStripScroll.ts` lines19–23:

```ts
export function stripScrolled(was: StripScroll, left: number, max: number): StripScroll {
  if (left === was.at) return was;
  if (was.at !== null && left < was.at && left >= max - 1) return { at: left, moved: was.moved };
  return { at: left, moved: true };
}
```

Browser pullback to a new scroll end after layout shrinks is not automatically user intent. Other movement marks manual scrolling. Tab opening resets auto-follow; font changes preserve an existing user scroll. This is a concrete state owner rather than a blanket scrollTo on every render.

## 5. Customizable KeyBar is an allowlisted preference, not arbitrary key scripts

`src/lib/keys.ts` lines13–21:

```ts
export type KeyBarExtra = "alt" | "shift-tab" | "home-end" | "page-up-down" | "ctrl-d" | "ctrl-z" | "pipe" | "tilde" | "slash";
export const KEY_BAR_EXTRAS: readonly KeyBarExtra[] = ["alt", "shift-tab", "home-end", "page-up-down", "ctrl-d", "ctrl-z", "pipe", "tilde", "slash"];

export function sanitizeKeyBarExtras(value: unknown, fallback: readonly KeyBarExtra[]): KeyBarExtra[] {
  if (!Array.isArray(value)) return [...fallback];
  return KEY_BAR_EXTRAS.filter((extra) => value.includes(extra));
}
```

Unknown/duplicate preferences are filtered into canonical order. Settings persists only these known slots; taps still flow through the existing xterm route. It is not a user-defined native Quick Commands system.

## 6. Streaming diagnostic filtering carries tail state across reads

`server/attach-output.ts` lines19–25:

```ts
push(data: string): string {
  const text = this.tail + data;
  this.tail = "";
  const full = text.lastIndexOf(TAKEN);
  if (full !== -1 && /^[\r\n]{0,4}$/.test(text.slice(full + TAKEN.length))) {
    this.tail = text.slice(full);
    return text.slice(0, full);
```

Remaining branches retain partial diagnostic suffixes across read boundaries. The server decides whether to discard/flush that tail based on whether the attachment actually exited due to take-over. This filters terminal attach diagnostics, not user-file attachments.

## 7. Codex filtering precedes cross-source message pairing

`server/codex.ts` lines202–215, selected fragment:

```ts
const body = role === "user" ? questionReply(text) ?? text
  : withoutMemoryCitations(text);
if (!body.trim() && images.length === 0) return;
const duplicate = messages.slice(-8).reverse().find((other) => !other.paired && other.role === role && other.text === body
  && other.source !== source && (other.ts === ts || Math.abs(Date.parse(other.ts) - Date.parse(ts)) <= 1000));
```

Pairing happens after Codex-specific metadata filtering. Empty metadata-only assistant text drops; image-only turns remain. The helper distinguishes metadata from literal examples in code/quoted contexts. #514 is unreleased at this pinned HEAD despite package0.3.52; do not assume installed release has this behavior.

## Reuse boundary

These are source patterns and test intent, not runtime results. Preserve native attachment generations, prompt identity, input-specific IME/focus and explicit no-auto-replay semantics. Adaptation into local herdr-web needs its own approved contract and producer/consumer checks.
