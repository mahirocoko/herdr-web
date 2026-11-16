import { afterAll, expect, it } from "bun:test";

const original = Object.getOwnPropertyDescriptor(globalThis, "window");
const KEY = "herdr-web-ui:sheet";
const entries: Array<{ key: string; state: Record<string, unknown>; href: string }> = [
  { key: "a", state: { foreign: { keep: true } }, href: "/?pane=a" },
  { key: "b", state: { foreign: { keep: true } }, href: "/?pane=b" },
];
let at = 1, next = 0, delay = false, reject = false, dropped = false, holdRestore = false;
const pendingRestores: Array<() => void> = [];
const listeners: Array<(event: PopStateEvent) => void> = [];
function go(by: number): void {
  if (dropped) return;
  const target = at + by;
  if (!entries[target] || target === at) return;
  const land = (): void => {
    at = Math.min(target, entries.length - 1);
    const event = { state: entries[at]!.state } as PopStateEvent;
    for (const listener of listeners) listener(event);
  };
  if (delay) setTimeout(land, 10); else queueMicrotask(land);
}
const history = {
  get state() { return entries[at]!.state; },
  pushState(state: Record<string, unknown>, _title: string, href?: string) {
    entries.splice(at + 1); entries.push({ key: `new-${++next}`, state, href: href ?? entries[at]!.href }); at++;
  },
  replaceState(state: Record<string, unknown>, _title: string, href?: string) { entries[at] = { ...entries[at]!, state, href: href ?? entries[at]!.href }; },
  back: () => go(-1), forward: () => go(1), go,
};
const fake = {
  history,
  get location() { return { href: entries[at]!.href }; },
  navigation: {
    get currentEntry() { return { key: entries[at]!.key, index: at }; },
    entries: () => entries.map((entry, index) => ({ key: entry.key, index })),
    traverseTo(key: string) {
      const target = entries.findIndex((entry) => entry.key === key);
      if (reject || target < 0) return { committed: Promise.reject(new Error("fictional dropped traversal")) };
      if (holdRestore) return { committed: new Promise<void>((resolve, reject) => pendingRestores.push(() => {
        const currentTarget = entries.findIndex((entry) => entry.key === key);
        if (currentTarget < 0) reject(new Error("fictional target replaced"));
        else { go(currentTarget - at); resolve(); }
      })) };
      go(target - at);
      return { committed: Promise.resolve() };
    },
  },
  addEventListener(type: string, listener: (event: PopStateEvent) => void) { if (type === "popstate") listeners.push(listener); },
};
(globalThis as unknown as { window: unknown }).window = fake;
const { enterSheet, leaveSheet, sheetHolds, sheetTraversal } = await import("./sheetHistory.ts");
const consumed: boolean[] = [];
listeners.push((event) => consumed.push(sheetHolds(event)));
const settled = () => new Promise((done) => setTimeout(done, 25));
afterAll(() => { if (original) Object.defineProperty(globalThis, "window", original); else delete (globalThis as { window?: unknown }).window; });

it("a file/diff Close landing belongs to its owner, not a sheet opened while it travels", async () => {
  for (const owner of ["file-preview", "repo-diff"]) {
    history.pushState({ ...history.state, [`herdr-web-ui:${owner}`]: { fictional: true } }, "");
    let closed = 0;
    delay = true;
    sheetTraversal(() => history.back());
    const id = enterSheet(() => { closed++; }, null);
    await settled(); delay = false;
    expect(closed).toBe(0);
    expect(consumed.at(-1)).toBe(false); // the viewer still reads its Close landing
    expect(history.state[KEY]).toBe(id);
    expect(history.state[`herdr-web-ui:${owner}`]).toBeUndefined();
    history.back(); await settled(); expect(closed).toBe(1);
    leaveSheet(id);
  }
});

it("a two-level Settings Close preserves a concurrently opened sheet and foreign state", async () => {
  history.pushState({ ...history.state, settings: 1 }, "");
  history.pushState({ ...history.state, settings: 2 }, "");
  delay = true;
  sheetTraversal(() => history.go(-2), 2);
  let closed = 0;
  const id = enterSheet(() => { closed++; }, null);
  await settled(); delay = false;
  expect(closed).toBe(0); expect(history.state[KEY]).toBe(id);
  expect(history.state.foreign).toEqual({ keep: true });
  history.back(); await settled(); expect(closed).toBe(1); leaveSheet(id);
});

it("rejected owner traversal releases its witness once, then explicit Back closes the new surface", async () => {
  let closed = 0;
  sheetTraversal(() => Promise.reject(new Error("fictional refusal")));
  const id = enterSheet(() => { closed++; }, null);
  await settled();
  expect(history.state[KEY]).toBe(id);
  history.back(); await settled(); expect(closed).toBe(1); leaveSheet(id);
});

it("a busy restore rejection cannot consume the next accepted Back's underlying cursor", async () => {
  let busy = true, asked = 0;
  const id = enterSheet(() => { asked++; return busy ? false : undefined; }, null);
  reject = true; history.back(); await settled();
  expect(asked).toBe(1); expect(at).toBe(1);
  reject = false; busy = false;
  history.back(); await settled();
  expect(asked).toBe(2); expect(at).toBe(1);
  expect(history.state.foreign).toEqual({ keep: true });
  leaveSheet(id);
});

it("foreign navigation invalidates an in-flight refused restore without resurrecting the old sheet", async () => {
  const id = enterSheet(() => false, null);
  holdRestore = true;
  history.back(); await settled();
  expect(pendingRestores.length).toBe(1);
  history.back(); await settled(); // an unrelated landing overtakes the held restore
  leaveSheet(id);
  history.pushState({ foreign: "new explicit pane" }, "", "/?pane=c");
  holdRestore = false;
  for (const finish of pendingRestores.splice(0)) finish();
  await settled();
  expect(history.state).toEqual({ foreign: "new explicit pane" });
  expect(fake.location.href).toBe("/?pane=c");
});

it("closing and reopening during a held busy restore cannot give the new sheet the old callback", async () => {
  const old = enterSheet(() => false, null);
  holdRestore = true;
  history.back(); await settled();
  leaveSheet(old);
  let closed = 0;
  const current = enterSheet(() => { closed++; }, null);
  holdRestore = false;
  for (const finish of pendingRestores.splice(0)) finish();
  await settled();
  expect(history.state[KEY]).toBe(current); expect(closed).toBe(0);
  history.back(); await settled(); expect(closed).toBe(1); leaveSheet(current);
});

it("reload strips only a stale sheet marker and preserves foreign/deep-link state", async () => {
  history.replaceState({ [KEY]: "previous-load:1", foreign: { keep: true } }, "", "/?pane=c&custom=kept");
  const reload = "./sheetHistory.ts?reload=fixture";
  await import(reload);
  expect(history.state).toEqual({ foreign: { keep: true } });
  expect(fake.location.href).toBe("/?pane=c&custom=kept");
});
