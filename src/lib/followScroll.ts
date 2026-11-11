import type { LegendListRef } from "@legendapp/list/react";

const NO_ROW = Object.freeze({});

/** Supersede a waiting follow and finish a started non-initial scroll without moving the view. */
export function dropPendingListScroll(list: Pick<LegendListRef, "scrollToItem"> | null): void {
  void list?.scrollToItem({ item: NO_ROW, animated: false });
}

/**
 * Whether a follow-the-end scroll glides. Streamed output lands a paragraph at a time; while a
 * turn works, each landing glides to the end instead of snapping. A reader who prefers reduced
 * motion, a settled conversation, and a layout the reader changed by hand (a block opened) all
 * keep the instant scroll so nothing visibly travels.
 */
export function followGlides(input: { working: boolean; reducedMotion: boolean; manualLayout?: boolean }): boolean {
  return input.working && !input.reducedMotion && input.manualLayout !== true;
}
