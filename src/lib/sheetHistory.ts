/** Touch surfaces keep separate entries. Back dismisses only the top surface; an underlying
 * Files list keeps its entry while a file is above it. Never refill that entry after user Back:
 * Chromium can skip entries pushed without a new activation after a traversal. */
import { useEffect, useRef } from "react";
import { SHEET_QUERY } from "./sheets.ts";
import { useMediaQuery } from "./useMediaQuery.ts";

const KEY = "herdr-web-ui:sheet";
// A foreign child entry (file, diff, Settings) can be revisited by Forward while its
// underlying sheet stays open. Keep ancestry even without the Navigation API.
const ABOVE = `${KEY}:above`;
/** History participation is not the visual bottom-sheet breakpoint. */
export const BACK_QUERY = `${SHEET_QUERY}, (hover: none) and (pointer: coarse)`;
const LANDING_MS = 1000;
type Back = () => boolean | void;
const open = new Map<string, Back>();
const leaving = new Map<string, ReturnType<typeof setTimeout>>();
const addresses = new Map<string, string>();
// Only a refused traversal that the browser dropped can leave an active sheet unplaced.
const unplaced = new Set<string>();
const run = Math.random().toString(36).slice(2);
let serial = 0;
const ordinal = (id: string | null): number => id?.startsWith(`${run}:`) ? Number(id.slice(run.length + 1)) : NaN;
let pushing = false;
let steppedOff = false;
let heard: PopStateEvent | null = null;
let observed: unknown;
let stepping: { ids: Set<string>; hold: boolean; target?: string; timer: ReturnType<typeof setTimeout> } | null = null;
let restoring: { id: string; state: unknown; key?: string; timer: ReturnType<typeof setTimeout> } | null = null;
/** Announce an existing owner's explicit Close traversal before it runs. New surfaces wait
 * for this landing, rather than being closed by it. One deadline, no traversal retry. */
export function sheetTraversal(run: () => Promise<unknown> | undefined | void, by = 1): void {
  if (stepping) clearTimeout(stepping.timer);
  const navigation = window.navigation;
  const index = navigation?.currentEntry?.index;
  const target = index === undefined ? undefined : navigation?.entries()[index - by]?.key;
  const dropped = (): void => {
    if (stepping !== request) return;
    stepping = null;
    clearTimeout(request.timer);
    for (const id of request.ids) if (open.has(id)) writeEntry(id);
  };
  const request = { ids: new Set<string>(), hold: false, target, timer: setTimeout(dropped, LANDING_MS) };
  stepping = request;
  try { run()?.catch(dropped); } catch { dropped(); }
}

function sheetOf(state: unknown): string | null {
  if (state === null || typeof state !== "object") return null;
  const id = (state as Record<string, unknown>)[KEY];
  return typeof id === "string" ? id : null;
}
function without(state: unknown): unknown {
  if (state === null || typeof state !== "object") return state;
  const { [KEY]: _, ...rest } = state as Record<string, unknown>;
  return rest;
}
function cancelRestore(): void {
  if (restoring) clearTimeout(restoring.timer);
  restoring = null;
}
function writeEntry(id: string, replace = false): void {
  pushing = true;
  const base = without(window.history.state);
  try { window.history[replace ? "replaceState" : "pushState"]({ ...(base !== null && typeof base === "object" ? base : {}), [KEY]: id }, ""); }
  finally { pushing = false; }
  addresses.set(id, window.location.href);
  unplaced.delete(id);
  observed = window.history.state;
  hereKey = window.navigation?.currentEntry?.key;
}
/** A refused Back goes onto the existing entry, not a newly pushed (browser-skippable) one.
 * One attempt only; rejection, a foreign landing or the deadline releases the latch. */
function restore(id: string, state: unknown, key?: string): void {
  cancelRestore();
  const failed = (): void => {
    if (restoring !== request) return;
    cancelRestore();
    if (open.has(id) && sheetOf(window.history.state) !== id) unplaced.add(id);
  };
  const request = { id, state, key, timer: setTimeout(failed, LANDING_MS) };
  restoring = request;
  try {
    const navigation = window.navigation;
    if (key && navigation) {
      const way = navigation.traverseTo(key);
      way.committed?.catch(failed);
      way.finished?.catch(() => {});
    } else window.history.forward();
  } catch { failed(); }
}
let hereKey: string | undefined;

/** A sheet above a history owner defers that owner's reconciliation until it leaves.
 * A refused sheet whose restore dropped still owns the next explicit Back. */
export function sheetOwnsEntry(): boolean {
  const top = [...open.keys()].at(-1);
  return top !== undefined && (sheetOf(window.history.state) === top || restoring?.id === top || unplaced.has(top));
}
/** The app ignores a sheet's own cleanup, or a traversal consumed/held by a surface. */
export function sheetSteppedOff(): boolean { return steppedOff; }
/** Lazy arbitration lets Settings/file listeners ask first regardless of module import order.
 * No listener is prevented from receiving the event. */
export function sheetHolds(event: PopStateEvent): boolean {
  hear(event);
  return steppedOff;
}

export function enterSheet(onBack: Back, reuse: string | null): string {
  const timer = reuse === null ? undefined : leaving.get(reuse);
  if (reuse !== null && timer !== undefined && sheetOf(window.history.state) === reuse) {
    clearTimeout(timer); leaving.delete(reuse); open.set(reuse, onBack); return reuse;
  }
  const id = `${run}:${++serial}`;
  const previous = sheetOf(window.history.state);
  open.set(id, onBack);
  // Only a surface already closing hands its entry to its replacement. Two still-open
  // surfaces stack; this distinction also preserves item-to-pane navigation handoff.
  if (previous !== null && leaving.has(previous)) writeEntry(id, true);
  else if (stepping === null) writeEntry(id);
  stepping?.ids.add(id);
  hereKey = window.navigation?.currentEntry?.key;
  return id;
}

export function leaveSheet(id: string): void {
  unplaced.delete(id);
  if (!open.delete(id)) return;
  // Keep only the bounded in-flight landing witness, not authority to retry or reopen it.
  // A late restoration is consumed once even if this sheet closed in the meantime.
  leaving.set(id, setTimeout(() => {
    leaving.delete(id);
    const address = addresses.get(id); addresses.delete(id);
    if (sheetOf(window.history.state) !== id) return;
    if (window.location.href !== address) window.history.replaceState(without(window.history.state), "");
    else {
      if (stepping) clearTimeout(stepping.timer);
      const request = { ids: new Set<string>(), hold: true, timer: setTimeout(() => { if (stepping === request) stepping = null; }, LANDING_MS) };
      stepping = request;
      window.history.back();
    }
  }, 0));
}

function hear(event: PopStateEvent): void {
  if (heard === event) return;
  heard = event;
  steppedOff = false;
  const previous = observed;
  const leftKey = hereKey;
  observed = event.state;
  hereKey = window.navigation?.currentEntry?.key;
  const landed = sheetOf(event.state);
  const returned = restoring;
  cancelRestore();
  if (returned && (returned.key ? returned.key === hereKey : sheetOf(event.state) === returned.id)) {
    steppedOff = true;
    if (!open.has(returned.id) && sheetOf(event.state) === returned.id) {
      window.history.replaceState(without(event.state), "");
      observed = window.history.state;
    }
    return;
  }
  if (returned && open.has(returned.id)) unplaced.add(returned.id);
  const step = stepping;
  if (step) clearTimeout(step.timer);
  stepping = null;
  if (step && (step.target === undefined || step.target === hereKey)) {
    steppedOff = step.hold;
    // Programmatic cleanup does not consume browser activation. Only sheets opened during
    // that cleanup need their entry moved to its landing; the others already have entries.
    for (const id of step.ids) if (open.has(id)) writeEntry(id);
    return;
  }
  // A foreign landing is not owned just because an earlier Close was pending.
  if (step) for (const id of step.ids) if (open.has(id)) writeEntry(id);
  const top = [...open.keys()].at(-1);
  const from = sheetOf(previous);
  // A file/Settings entry closing onto a live sheet is not Back out of that sheet.
  // A refuser whose restore was dropped still gets first refusal over that owner.
  const retired = landed !== null && !open.has(landed) && !leaving.has(landed);
  const forwardOntoRetired = retired && ordinal(landed) > ordinal(from);
  const ancestors = event.state !== null && typeof event.state === "object" ? (event.state as Record<string, unknown>)[ABOVE] : null;
  const intoChild = top !== undefined && Array.isArray(ancestors) && ancestors.includes(top);
  if (top !== undefined && !forwardOntoRetired && !intoChild && (from === top || unplaced.has(top))) {
    const onBack = open.get(top)!;
    steppedOff = true;
    if (onBack() === false) restore(top, previous, leftKey);
    else {
      // A dropped restore can leave the cursor below this surface. Consuming its next
      // explicit Back must restore the underlying cursor as well as preserving the UI.
      if (unplaced.has(top) && leftKey !== undefined) restore(top, previous, leftKey);
      open.delete(top); unplaced.delete(top); addresses.delete(top);
    }
    return;
  }
  // Retired sheet entries never reopen UI on Forward/reload. Do not blindly traverse past
  // them: the next entry may be a live file, Settings page, foreign entry, or the boundary.
  if (retired) {
    window.history.replaceState(without(event.state), "");
    observed = window.history.state;
  }
}

if (typeof window !== "undefined") {
  const history = window.history;
  const push = history.pushState.bind(history);
  history.pushState = ((state: unknown, ...rest: [string, (string | URL | null)?]) => {
    if (pushing) return push(state, ...rest);
    cancelRestore();
    const pending = stepping;
    if (pending) clearTimeout(pending.timer);
    stepping = null;
    const id = sheetOf(history.state);
    // An item from a surface that is leaving hands its entry to the navigation. A live
    // underlying surface (Files) keeps its own entry, with the viewer pushed above it.
    const base = without(state);
    const parents = [...open.keys()].filter((entry) => !leaving.has(entry));
    const child = parents.length > 0 && base !== null && typeof base === "object" ? { ...base, [ABOVE]: parents } : base;
    if (id !== null && leaving.has(id)) history.replaceState(child, ...rest);
    else push(child, ...rest);
    observed = history.state;
    hereKey = window.navigation?.currentEntry?.key;
    // An explicit new navigation invalidates an older Close. Still-visible surfaces that
    // waited for it get an entry here, never on that obsolete traversal's behalf.
    if (pending) for (const waiting of pending.ids) if (open.has(waiting)) writeEntry(waiting);
  }) as History["pushState"];
  if (sheetOf(history.state) !== null) history.replaceState(without(history.state), "");
  observed = history.state;
  hereKey = window.navigation?.currentEntry?.key;
  window.addEventListener("popstate", hear);
  // No automatic join/approval surface exists in this fork. Keep current consumers' manual
  // entry creation; do not add a second gesture/activation owner for absent upstream shells.
}

export function useSheetHistory(active: boolean, onBack: Back): void {
  const latest = useRef(onBack); latest.current = onBack;
  const id = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const entry = enterSheet(() => latest.current(), id.current); id.current = entry;
    return () => leaveSheet(entry);
  }, [active]);
}

/** Touch/coarse landscape participates without changing any component's visual breakpoint. */
export function usePhoneSheetBack(onBack: Back, active = true): void {
  useSheetHistory(useMediaQuery(BACK_QUERY) && active, onBack);
}
