/** Disposable rendered regressions: real components, fictional HTTP only, no native sessions/provider calls. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import type { ConversationTurn, OmoTask, PiSubagentResponse } from "../shared/protocol.ts";
import { fileInfo, fileResponse } from "../server/file-view.ts";
import type {} from "./preview-scroll-fixture.tsx";

const evidence = resolve(process.env.UI_EVIDENCE_DIR || ".agent-state/runtime/preview-scroll-qa");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(evidence, "fixture-"));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let activePage: Page | undefined;
let revision = 0;
const task: OmoTask = { id: "fixture-child", detail_id: "fixture-child", title: "Fixture review", category: "verifier", model: null, status: "completed", started_at: null, ended_at: null, turns: 2, tool_calls: 1, tokens: null };
const html = `<!doctype html><html><head><style>h1 { color: rgb(20, 80, 120); }</style></head><body><h1>Static fixture</h1><p id="status">static</p><input aria-label="Page input"><script>document.querySelector('#status').textContent = 'scripts ran'; addEventListener('message', event => { if(event.data === 'grab') { document.querySelector('input').focus(); window.focus(); } });</script></body></html>`;
for (const name of ["a", "b"]) writeFileSync(join(root, `${name}.html`), html);
function turn(index: number): ConversationTurn {
  const parts: ConversationTurn["parts"] = [{ kind: "text", text: `ROW-${index}\n\n${"Paragraph content. ".repeat(Math.abs(index) % 5 + 1)}${index === 199 ? `\n\nREVISION-${revision}` : ""}` }];
  if (index === 199) parts.unshift({ kind: "tool", name: "Read", input: "{}", summary: "Newest expandable output", output: "Expanded line\n".repeat(130) });
  if (index === 197) parts.unshift({ kind: "tool", name: "subagent", input: JSON.stringify({ description: task.title }), summary: task.title, subagent_id: task.id, output: "Recorded completion" });
  return { role: index % 2 ? "assistant" : "user", ts: null, parts };
}
async function frames(page: Page, count = 12): Promise<void> {
  await page.evaluate(async (count) => { for (let n = 0; n < count; n++) await new Promise(requestAnimationFrame); }, count);
}
async function atEnd(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const view = document.querySelector(".chat-view");
    return view && view.scrollHeight - view.clientHeight - view.scrollTop <= 1;
  });
}
async function top(page: Page): Promise<number> { return page.locator(".chat-view").evaluate((view) => view.scrollTop); }
async function refresh(page: Page): Promise<void> {
  const response = page.waitForResponse((response) => response.url().includes("/pane/conversation?") && !new URL(response.url()).searchParams.has("before"));
  await page.evaluate(() => window.previewScrollQa.refresh());
  await (await response).finished();
  await frames(page);
}
const results: unknown[] = [];
try {
  const build = await Bun.build({ entrypoints: ["scripts/preview-scroll-fixture.tsx"], outdir: root, target: "browser", define: { "process.env.NODE_ENV": '"development"' } });
  assert.ok(build.success, String(build.logs));
  const assets = new Set(build.outputs.map((output) => relative(root, output.path)));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Read-only fixture", { status: 405 });
    if (url.pathname === "/api/fs/stat" || url.pathname === "/api/fs/file") {
      const name = url.searchParams.get("path");
      if (name !== "/fixture/a.html" && name !== "/fixture/b.html") return new Response("Missing", { status: 404 });
      const info = fileInfo(join(root, name.endsWith("a.html") ? "a.html" : "b.html"))!;
      if (url.pathname.endsWith("/stat")) return Response.json({ ...info, path: name });
      return fileResponse(info, false, url.searchParams.get("render") === "1");
    }
    if (url.pathname.endsWith("/pane/commands")) return Response.json({ commands: [] });
    if (url.pathname.endsWith("/pane/prompt")) return Response.json({ prompt: null });
    if (url.pathname.endsWith("/pane/omo-tasks")) return Response.json({ tasks: [task], runs: [], server_time: new Date().toISOString() });
    if (url.pathname.endsWith("/pane/pi-subagent")) {
      const detail: PiSubagentResponse = { task, turns: [{ role: "assistant", ts: null, parts: [{ kind: "text", text: `## Recorded review\n\n${"Readable child activity.\n\n".repeat(70)}\n\n\`\`\`ts\nconst answer = 42;\n\`\`\`` }] }], cursor: null,
        bounds: { has_earlier: false, showing_latest: true, incomplete: false, omitted_turns: 0 }, freshness: { read_at: new Date().toISOString(), transcript_updated_at: null, revision: "fixture", observer_live: false }, live: false };
      return Response.json(detail);
    }
    if (url.pathname.endsWith("/pane/conversation")) {
      const older = url.searchParams.has("before");
      return Response.json({ source: "pi-transcript", history_id: "fixture-parent", cursor: older ? null : "older:0", turns: Array.from({ length: older ? 20 : 200 }, (_, index) => turn(older ? index - 20 : index)) });
    }
    if (url.pathname === "/html" || url.pathname === "/chat") return new Response('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/preview-scroll-fixture.css"></head><body><div id="root"></div><script type="module" src="/preview-scroll-fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    const asset = url.pathname.slice(1);
    if (url.pathname === "/icons/pi.svg") return new Response(Bun.file("public/icons/pi.svg"));
    if (!assets.has(asset)) { console.warn("Missing fixture asset:", url.pathname); return new Response("Missing fixture asset", { status: 404 }); }
    return new Response(Bun.file(join(root, asset)));
  } });
  if (process.argv.includes("--serve-only")) {
    console.log(`Preview/scroll fixture ready at http://127.0.0.1:${server.port} (/html, /chat; fictional GET-only data)`);
    await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  } else {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", locale: "en-US" });
      await context.addInitScript(() => { if (window === window.top) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", theme: "dark" })); });
      const page = await context.newPage();
      activePage = page;
      page.setDefaultTimeout(12_000);
      const errors: string[] = [], warnings: string[] = [], expectedBlocks: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (!["error", "warning"].includes(message.type())) return;
        if (message.text().includes("Blocked script execution") && message.text().includes("allow-scripts")) expectedBlocks.push(message.text());
        else (message.type() === "error" ? errors : warnings).push(message.text());
      });
      await page.goto(`http://127.0.0.1:${server.port}/html`);
      const frame = page.locator("iframe.file-viewer-page");
      const content = page.frameLocator("iframe.file-viewer-page");
      await content.locator("#status").waitFor();
      assert.equal(await frame.getAttribute("sandbox"), "");
      assert.equal(await content.locator("#status").textContent(), "static");
      assert.equal(await content.locator("h1").evaluate((heading) => getComputedStyle(heading).color), "rgb(20, 80, 120)");
      await page.getByRole("button", { name: "Run scripts", exact: true }).click();
      await content.getByText("scripts ran", { exact: true }).waitFor();
      assert.equal(await frame.getAttribute("sandbox"), "allow-scripts");
      // Explicit entry following Run scripts is allowed.
      await content.getByRole("textbox", { name: "Page input" }).focus();
      assert.equal(await frame.getAttribute("data-page-scripts"), "on");
      await page.getByRole("textbox", { name: "Fixture composer" }).focus();
      await page.locator("[data-page-shield]").waitFor();
      // This runs the fixture page's real script, not a synthetic parent blur/focus event.
      await frame.evaluate((node) => (node as HTMLIFrameElement).contentWindow!.postMessage("grab", "*"));
      await page.getByText("This page took the keyboard, so its scripts are off again.", { exact: true }).waitFor();
      assert.equal(await frame.getAttribute("sandbox"), "");
      assert.ok(await page.getByRole("textbox", { name: "Fixture composer" }).evaluate((input) => document.activeElement === input));
      await page.keyboard.type("kept in composer");
      assert.equal(await page.getByRole("textbox", { name: "Fixture composer" }).inputValue(), "kept in composer");
      await page.getByRole("button", { name: "Run scripts", exact: true }).click();
      await content.getByText("scripts ran", { exact: true }).waitFor();
      await page.evaluate(() => window.previewScrollQa.file("/fixture/b.html"));
      await page.locator('iframe[title="b.html"]').waitFor();
      assert.equal(await frame.getAttribute("sandbox"), "");
      await page.evaluate(() => window.previewScrollQa.file("/fixture/a.html"));
      await page.locator('iframe[title="a.html"]').waitFor();
      assert.equal(await frame.getAttribute("sandbox"), "");
      await page.getByRole("button", { name: "Run scripts", exact: true }).click();
      await content.getByText("scripts ran", { exact: true }).waitFor();
      await page.evaluate(() => window.previewScrollQa.file(null));
      await frame.waitFor({ state: "detached" });
      await page.evaluate(() => window.previewScrollQa.file("/fixture/a.html"));
      await frame.waitFor();
      assert.equal(await frame.getAttribute("sandbox"), "");
      await page.reload(); await frame.waitFor();
      assert.equal(await frame.getAttribute("sandbox"), "");
      await page.screenshot({ path: join(evidence, `preview-static-${width}.png`) });
      console.log(`PASS ${width}: static HTML/CSS, explicit scripts, real unsolicited focus recovery, A→B→A/close/reload reset`);

      revision = 0;
      await page.goto(`http://127.0.0.1:${server.port}/chat`);
      await page.getByText("REVISION-0", { exact: true }).waitFor();
      await atEnd(page);
      const latest = page.locator("[data-chat-row]").filter({ hasText: "ROW-199" });
      await latest.locator(".work-block-head").click();
      await latest.locator(".work-row-head").waitFor();
      const jump = page.getByRole("button", { name: /Jump to latest|New messages/ });
      await jump.click(); await atEnd(page); await frames(page);
      // Reopen at the physical end so Jump starts a list scroll with no native move to finish it early.
      await latest.locator(".work-block-head").dispatchEvent("click");
      await latest.locator(".work-block-head").dispatchEvent("click");
      // Force the ordering from #3622: unfold the row in the frame after the list starts its end scroll.
      await latest.locator(".work-row-head").evaluate((button) => {
        const view = button.closest(".chat-view")!;
        const observation: { from: number | null; done: boolean } = { from: null, done: false };
        Object.assign(window, { unfoldDuringListScroll: observation });
        const original = Element.prototype.scrollTo;
        Element.prototype.scrollTo = function (this: Element, ...args: [ScrollToOptions?] | [number, number]) {
          (original as (this: Element, ...args: unknown[]) => void).apply(this, args);
          if (this !== view || typeof args[0] !== "object" || args[0].behavior !== "auto") return;
          Element.prototype.scrollTo = original;
          requestAnimationFrame(() => {
            observation.from = view.scrollTop;
            button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
            observation.done = true;
          });
        };
      });
      await jump.click();
      await latest.locator('.work-row-head[aria-expanded="true"]').waitFor();
      await frames(page, 20);
      const from = await page.evaluate(() => (window as unknown as { unfoldDuringListScroll: { from: number | null } }).unfoldDuringListScroll.from);
      assert.ok(from !== null && Math.abs(await top(page) - from) <= 1, `unfold during an active end-scroll: ${from} -> ${await top(page)}`);
      assert.equal(await jump.count(), 1);
      console.log(`PASS ${width}: unfold during the list's started follow holds the reader (reduced motion)`);
      await jump.click(); await atEnd(page);
      for (let n = 1; n <= 8; n++) {
        revision = n; await refresh(page); await page.getByText(`REVISION-${n}`, { exact: true }).waitFor(); await atEnd(page);
      }
      await page.evaluate(() => window.previewScrollQa.page(-1));
      await frames(page);
      const reading = await top(page);
      revision++; await refresh(page);
      assert.ok(Math.abs(await top(page) - reading) <= 1, "output does not move a reader away from the end");
      // #3650: model a native end jump whose scroll event is still pending when a grown row measures.
      const measurement = await page.locator(".chat-view").evaluate(async (view) => {
        const row = [...view.querySelectorAll<HTMLElement>("[data-chat-row]")].at(-1);
        if (!row) throw new Error("Measurement target was not mounted");
        const delayScroll = (event: Event) => event.stopImmediatePropagation();
        view.addEventListener("scroll", delayScroll, true);
        row.style.paddingBottom = "160px";
        view.scrollTop = view.scrollHeight;
        const target = view.scrollTop;
        try { for (let n = 0; n < 8; n++) await new Promise(requestAnimationFrame); }
        finally { view.removeEventListener("scroll", delayScroll, true); }
        const landed = view.scrollTop;
        const gap = view.scrollHeight - view.clientHeight - landed;
        view.dispatchEvent(new Event("scroll"));
        row.style.paddingBottom = "";
        return { target, landed, gap };
      });
      assert.ok(measurement.landed >= measurement.target - 1 && measurement.gap <= 1, `measurement must not rewind an unheard end jump: ${JSON.stringify(measurement)}`);
      await frames(page);
      if (await jump.count()) await jump.click();
      await atEnd(page);
      // Loading an older page remains supported; the full virtual QA checks its pixel anchor.
      await page.locator(".chat-view").evaluate((view) => { view.scrollTop = 0; });
      await page.getByText("beginning of conversation", { exact: true }).waitFor({ state: "attached" });
      await frames(page);
      assert.ok(await page.locator("[data-chat-row]").count() < 80, "virtualization remains bounded");
      // Pi detail is held outside virtual rows. Reading/closing it must not move the parent chat.
      await jump.click(); await atEnd(page);
      const card = page.locator(".pi-subagent-card");
      await card.scrollIntoViewIfNeeded(); await frames(page);
      const parentTop = await top(page);
      await card.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("heading", { name: "Recorded review" }).waitFor();
      const detail = dialog.locator(".pi-subagent-body");
      await detail.evaluate((node) => { node.scrollTop = 400; });
      assert.ok(await detail.evaluate((node) => node.scrollTop) > 0);
      assert.ok(Math.abs(await top(page) - parentTop) <= 1);
      assert.equal(await dialog.locator("textarea, input").count(), 0, "Pi details remain read-only");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await frames(page);
      assert.ok(Math.abs(await top(page) - parentTop) <= 1, "closing Pi details preserves Main's reading position");
      await page.screenshot({ path: join(evidence, `chat-preserved-${width}.png`) });
      assert.deepEqual(errors, [], "unexpected browser console/page errors");
      assert.deepEqual(warnings, [], "unexpected browser warnings");
      results.push({ width, errors, warnings, expectedSandboxBlocks: expectedBlocks.length });
      console.log(`PASS ${width}: stream/end, reading away, older page, Pi card/detail scrolling; no unexpected console warnings/errors`);
      await context.close();
    }
    writeFileSync(join(evidence, "results.json"), JSON.stringify(results, null, 2));
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(evidence, "failed.png") });
    console.error(await activePage.evaluate(() => ({
      hook: (window as unknown as { unfoldDuringListScroll?: unknown }).unfoldDuringListScroll,
      scroll: document.querySelector(".chat-view")?.scrollTop,
      expanded: [...document.querySelectorAll(".work-row-head")].map((node) => ({ expanded: node.getAttribute("aria-expanded"), rect: node.getBoundingClientRect().toJSON() })),
    })));
  }
  throw error;
} finally {
  await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true });
}
