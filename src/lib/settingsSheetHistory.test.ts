import { afterAll, expect, it } from "bun:test";

const original = Object.getOwnPropertyDescriptor(globalThis, "window");
const KEY = "herdr-web-ui:sheet";
const entries: Array<{ key: string; state: Record<string, unknown> }> = [{ key: "base", state: { draft: "preserved", foreign: { keep: true } } }];
let at = 0, serial = 0, native = false;
const listeners: Array<(event: PopStateEvent) => void> = [];
const pending: Array<() => void> = [];
const history = {
  get state() { return entries[at]!.state; },
  pushState(state: Record<string, unknown>) { entries.splice(at + 1); entries.push({ key: `entry-${++serial}`, state }); at++; },
  replaceState(state: Record<string, unknown>) { entries[at] = { ...entries[at]!, state }; },
  go(by: number) {
    const target = at + by;
    if (!entries[target] || target === at) return;
    pending.push(() => { at = target; const event = { state: entries[at]!.state } as PopStateEvent; for (const listener of listeners) listener(event); });
  },
  back() { this.go(-1); },
  forward() { this.go(1); },
};
const navigation = {
  get currentEntry() { return { key: entries[at]!.key, index: at }; },
  entries: () => entries.map((entry, index) => ({ key: entry.key, index })),
  traverseTo(key: string) { history.go(entries.findIndex((entry) => entry.key === key) - at); return { committed: Promise.resolve() }; },
};
const fake = {
  history,
  get location() { return { href: "/?pane=b" }; },
  get navigation() { return native ? navigation : undefined; },
  addEventListener(type: string, listener: (event: PopStateEvent) => void) { if (type === "popstate") listeners.push(listener); },
};
(globalThis as unknown as { window: unknown }).window = fake;
const { enterSheet, leaveSheet } = await import("./sheetHistory.ts");
const { recordSettings, settingsLevels, settingsEntry } = await import("./settingsHistory.ts");
function land(): void {
  for (let count = 0; pending.length > 0; count++) {
    if (count > 8) throw new Error("Unbounded fictional traversal");
    pending.shift()!();
  }
}
afterAll(() => { if (original) Object.defineProperty(globalThis, "window", original); else delete (globalThis as { window?: unknown }).window; });

for (const mode of ["fallback", "Navigation API"] as const) {
  it(`${mode}: rotation defers Settings reconciliation until its top confirmation closes`, () => {
    native = mode === "Navigation API";
    recordSettings(settingsLevels(true, "devices", false));
    let closed = 0;
    const id = enterSheet(() => { closed++; }, null);
    const before = at;
    recordSettings(settingsLevels(false, "devices", false));
    expect(pending.length).toBe(0); expect(at).toBe(before); expect(history.state[KEY]).toBe(id);
    history.back(); land();
    expect(closed).toBe(1);
    expect(settingsEntry(history.state)).toEqual({ page: "devices", keyBar: false, depth: 1 });
    expect(history.state).toMatchObject({ draft: "preserved", foreign: { keep: true } });
    leaveSheet(id);
    recordSettings([]); land();
    expect(settingsEntry(history.state)).toBeNull();
  });

  it(`${mode}: deferred rotation cannot rewind under a busy confirmation's restoration`, () => {
    native = mode === "Navigation API";
    recordSettings(settingsLevels(true, "devices", false));
    let busy = true, asked = 0;
    const id = enterSheet(() => { asked++; return busy ? false : undefined; }, null);
    recordSettings(settingsLevels(false, "devices", false));
    history.back(); pending.shift()!();
    expect(asked).toBe(1);
    expect(pending.length).toBe(1); // only the restore, never a concurrent Settings rewind
    land();
    expect(history.state[KEY]).toBe(id); expect(asked).toBe(1);
    busy = false; history.back(); land();
    expect(asked).toBe(2);
    expect(settingsEntry(history.state)).toEqual({ page: "devices", keyBar: false, depth: 1 });
    leaveSheet(id); recordSettings([]); land();
  });

  it(`${mode}: child-before-parent Close effect preserves its replacement and then removes Settings`, () => {
    native = mode === "Navigation API";
    recordSettings(settingsLevels(true, "remote", false));
    let closed = 0;
    // The replacement's child passive effect precedes App's parent recordSettings([]).
    const id = enterSheet(() => { closed++; }, null);
    recordSettings([]);
    expect(pending.length).toBe(0); expect(history.state[KEY]).toBe(id);
    history.back(); land();
    expect(closed).toBe(1); expect(settingsEntry(history.state)).toBeNull();
    expect(history.state).toMatchObject({ draft: "preserved", foreign: { keep: true } });
    leaveSheet(id);
  });
}
