import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { FileViewer, type FileViewerProps } from "./FileViewer.tsx";
import { SettingsProvider } from "../lib/settings.ts";
import { MachineContext } from "../lib/machineContext.tsx";
import type { FileInfo } from "../../shared/protocol.ts";

const globals = ["IS_REACT_ACT_ENVIRONMENT", "window", "document", "getComputedStyle", "navigator", "fetch", "HTMLElement"];
const saved = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let renderer: ReactTestRenderer | undefined;
type Listener = (event: unknown) => void;
function events() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: Listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); },
    removeEventListener(type: string, listener: Listener) { listeners.get(type)?.delete(listener); },
    fire(type: string, event: unknown = {}) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); },
  };
}
class Element {
  isConnected = true;
  focused = 0;
  focus() { this.focused += 1; doc.activeElement = this; }
}
let win: ReturnType<typeof events>;
let doc: ReturnType<typeof events> & { activeElement: Element | null };
let frameNode: Element;
let requests: string[];
const HTML = "<!doctype html><style>h1 { color: red }</style><h1>Static report</h1><script>document.title = 'ran'</script>";

beforeEach(() => {
  requests = [];
  win = events();
  doc = Object.assign(events(), { activeElement: null as Element | null });
  const style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => "", backgroundColor: "" };
  const listen = { addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    HTMLElement: Element,
    window: Object.assign(win, { focus() {}, location: { pathname: "/" }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ ...listen, matches: false }) }),
    document: Object.assign(doc, { hasFocus: () => true, documentElement: { lang: "", dataset: {}, style }, querySelector: () => null, querySelectorAll: () => [] }),
    getComputedStyle: () => style,
    navigator: { languages: ["en"] },
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://herdr.test");
      requests.push(url.pathname);
      if (url.pathname.endsWith("/fs/stat")) {
        const path = url.searchParams.get("path")!;
        const info: FileInfo = { path, name: path.split("/").pop()!, size: HTML.length, modified: "2026-11-11T00:00:00Z", mime: "text/html", kind: "text" };
        return Response.json(info);
      }
      if (!url.pathname.endsWith("/fs/file")) throw new Error(`Unexpected fixture request: ${url.pathname}`);
      return new Response(HTML, { headers: { "content-type": "text/html" } });
    },
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const frames = (): ReactTestInstance[] => renderer?.root.findAllByType("iframe") ?? [];
const buttons = (label: string) => renderer?.root.findAll((node) => node.type === "button" && node.children.includes(label)) ?? [];
const press = async (label: string) => { await act(async () => buttons(label)[0]!.props["onClick"]()); };
const shown = () => JSON.stringify(renderer?.toJSON());
const tree = (props: Partial<FileViewerProps> = {}, machine = "local") => createElement(SettingsProvider, { children: createElement(MachineContext.Provider, { value: machine, children: createElement(FileViewer, { path: "/w/a.html", paneId: null, onClose() {}, page: true, ...props }) }) });
async function view(props: Partial<FileViewerProps> = {}, machine = "local") {
  await act(async () => {
    if (renderer) renderer.update(tree(props, machine));
    else renderer = create(tree(props, machine), { createNodeMock: (element) => element.type === "iframe" ? (frameNode = new Element()) : null });
  });
  expect(frames()).toHaveLength(1);
}
const sandbox = () => frames()[0]!.props["sandbox"];

test("HTML and CSS use the authenticated renderer without scripts; Run scripts remounts with only allow-scripts", async () => {
  await view();
  const initial = frames()[0]!;
  const initialUrl = initial.props["src"];
  expect(sandbox()).toBe("");
  expect(initial.props["src"]).toBe("/api/fs/file?path=%2Fw%2Fa.html&render=1");
  expect(shown()).toContain("Scripts in this page are off.");
  expect(buttons("Run scripts")).toHaveLength(1);
  await press("Run scripts");
  expect(sandbox()).toBe("allow-scripts");
  expect(frames()[0]).not.toBe(initial);
  expect(frames()[0]!.props["src"]).toBe(initialUrl);
  expect(buttons("Run scripts")).toHaveLength(0);
  expect(requests.every((path) => path === "/api/fs/stat" || path === "/api/fs/file")).toBe(true);
});

test("A → B → A never restores consent, even without a parent key", async () => {
  await view();
  await press("Run scripts");
  await view({ path: "/w/b.html" });
  expect(sandbox()).toBe("");
  await view();
  expect(sandbox()).toBe("");
});

test("closing and reopening the same viewer discards consent", async () => {
  await view();
  await press("Run scripts");
  await act(async () => renderer?.unmount());
  renderer = undefined;
  await view();
  expect(sandbox()).toBe("");
});

test("pane, machine and presentation changes each discard consent in both directions", async () => {
  await view();
  for (const [props, machine] of [[{ paneId: "other" }, "local"], [{}, "other-pc"], [{ page: false, docked: true }, "local"]] as const) {
    await press("Run scripts");
    await view(props, machine);
    expect(sandbox()).toBe("");
    await press("Run scripts");
    await view();
    expect(sandbox()).toBe("");
  }
});

test("Source → Page starts static rather than reviving scripts", async () => {
  await view();
  await press("Run scripts");
  await press("Source");
  expect(frames()).toHaveLength(0);
  await press("Page");
  expect(sandbox()).toBe("");
});

test("a docked unsolicited focus grab revokes scripts, remounts static and returns the keyboard", async () => {
  await view({ page: false, docked: true });
  await press("Run scripts");
  const running = frames()[0];
  const composer = new Element();
  await act(async () => doc.fire("focusin", { target: composer }));
  const shield = renderer!.root.findByProps({ className: "file-viewer-page-frame" });
  expect(shield.props["data-page-shield"]).toBe("");
  doc.activeElement = frameNode;
  await act(async () => win.fire("blur"));
  expect(sandbox()).toBe("");
  expect(frames()[0]).not.toBe(running);
  expect(composer.focused).toBeGreaterThan(0);
  expect(shown()).toContain("This page took the keyboard, so its scripts are off again.");
});

test("Run scripts and an explicit press on the shield allow docked page focus", async () => {
  await view({ page: false, docked: true });
  await press("Run scripts");
  doc.activeElement = frameNode;
  await act(async () => win.fire("blur"));
  expect(sandbox()).toBe("allow-scripts");
  await act(async () => doc.fire("focusin", { target: new Element() }));
  await act(async () => renderer!.root.findByProps({ className: "file-viewer-page-frame" }).props["onClick"]());
  await act(async () => win.fire("blur"));
  expect(frameNode.focused).toBeGreaterThan(0);
  expect(sandbox()).toBe("allow-scripts");
});
