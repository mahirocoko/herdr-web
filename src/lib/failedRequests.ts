import type { ConversationPart } from "../../shared/protocol.ts";

type TextPart = Extract<ConversationPart, { kind: "text" }>;
type RequestItem<T> = { kind: "part"; part: T; at: number } | { kind: "failed"; parts: TextPart[]; at: number; followed: boolean };

/** Preserve order, folding only consecutive requests explicitly recorded as failed. */
export function requestItems<T extends ConversationPart>(parts: readonly T[]): RequestItem<T>[] {
  const items: RequestItem<T>[] = [];
  for (let at = 0; at < parts.length; at++) {
    const part = parts[at]!;
    if (part.kind !== "text" || part.failed !== true) { items.push({ kind: "part", part, at }); continue; }
    const failures: TextPart[] = [part];
    const first = at;
    while (parts[at + 1]?.kind === "text" && (parts[at + 1] as TextPart).failed === true) failures.push(parts[++at] as TextPart);
    items.push({ kind: "failed", parts: failures, at: first, followed: at < parts.length - 1 });
  }
  return items;
}
