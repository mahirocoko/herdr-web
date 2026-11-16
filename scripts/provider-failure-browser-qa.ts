/** Real Chat + status paint, fictional GET-only data; no native sessions or provider calls. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import type { ConversationPart, ConversationTurn } from "../shared/protocol.ts";
import type {} from "./provider-failure-fixture.tsx";

const evidence = resolve(process.env.UI_EVIDENCE_DIR || ".agent-state/runtime/upstream-review-tasks/T334-browser");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(evidence, "fixture-"));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let activePage: Page | undefined;
let stage: "failure" | "recovered" | "work" | "next" = "failure";
const failed: ConversationPart = { kind: "text", text: "Error: Fictional provider limit\nNo request was sent by this fixture.", failed: true };
const request: ConversationTurn = { role: "user", ts: null, parts: [{ kind: "text", text: "Fictional request" }] };
function turns(): ConversationTurn[] {
  const parts: ConversationPart[] = stage === "recovered" || stage === "next" ? [failed, { ...failed, text: "Error: Fictional retry limit", failed: true }, { kind: "text", text: "Recovered fictional answer" }]
    : stage === "work" ? [failed, { kind: "tool", name: "read", summary: "Fictional retry", input: "{}", output: "fixture only" }] : [failed];
  return [request, { role: "assistant", ts: null, parts }, ...(stage === "next" ? [{ ...request, parts: [{ kind: "text" as const, text: "Another fictional request" }] }, { role: "assistant" as const, ts: null, parts: [{ kind: "text" as const, text: "Error: Fictional final refusal", failed: true }] }] : [])];
}
async function frames(page: Page): Promise<void> {
  await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame); });
}
async function refresh(page: Page, status: "working" | "failed" | "done"): Promise<void> {
  const response = page.waitForResponse((value) => value.url().includes("/pane/conversation?"));
  await page.evaluate((status) => window.providerFailureQa.refresh(status), status);
  await (await response).finished(); await frames(page);
}
const results: unknown[] = [];
try {
  const build = await Bun.build({ entrypoints: ["scripts/provider-failure-fixture.tsx"], outdir: root, target: "browser", define: { "process.env.NODE_ENV": '"development"' } });
  assert.ok(build.success, String(build.logs));
  const assets = new Set(build.outputs.map((asset) => relative(root, asset.path)));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Read-only fixture", { status: 405 });
    if (url.pathname.endsWith("/pane/conversation")) return Response.json({ source: "codex-transcript", history_id: "fictional-parent", cursor: null, turns: turns() });
    if (url.pathname.endsWith("/pane/prompt")) return Response.json({ prompt: null });
    if (url.pathname.endsWith("/pane/commands")) return Response.json({ commands: [] });
    if (url.pathname === "/") return new Response('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/provider-failure-fixture.css"></head><body><div id="root"></div><script type="module" src="/provider-failure-fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    const asset = url.pathname.slice(1);
    if (!assets.has(asset)) return new Response("Unknown fixture asset", { status: 404 });
    return new Response(Bun.file(join(root, asset)));
  } });
  if (process.argv.includes("--serve-only")) {
    console.log(`Provider fixture: http://127.0.0.1:${server.port}/ (fictional GET-only data)`);
    await new Promise<void>((done) => { process.once("SIGINT", done); process.once("SIGTERM", done); });
  } else {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", locale: "en-US" });
      await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", theme: "dark" })));
      const page = activePage = await context.newPage(); page.setDefaultTimeout(12_000);
      const errors: string[] = [], warnings: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); else if (message.type() === "warning") warnings.push(message.text()); });
      stage = "failure"; await page.goto(`http://127.0.0.1:${server.port}/`);
      const details = page.locator("details.chat-failed-requests");
      await page.getByText("Fictional provider limit", { exact: false }).waitFor(); await frames(page);
      assert.equal(await details.count(), 1); assert.ok(await details.evaluate((node) => (node as HTMLDetailsElement).open));
      assert.equal(await page.locator(".badge-failed").innerText(), "FAILED");
      await page.screenshot({ path: join(evidence, `failure-${width}.png`) });
      // Programmatic default toggles must not become a permanent reader choice.
      await refresh(page, "working"); assert.equal(await details.evaluate((node) => (node as HTMLDetailsElement).open), false);
      await refresh(page, "failed"); assert.equal(await details.evaluate((node) => (node as HTMLDetailsElement).open), true);
      await details.locator("summary").click(); await frames(page);
      assert.equal(await details.evaluate((node) => (node as HTMLDetailsElement).open), false);
      await refresh(page, "working"); await refresh(page, "failed");
      assert.equal(await details.evaluate((node) => (node as HTMLDetailsElement).open), false);
      stage = "work"; await refresh(page, "working");
      assert.equal(await details.evaluate((node) => (node as HTMLDetailsElement).open), false);
      await details.locator("summary").click(); await frames(page);
      assert.equal(await details.evaluate((node) => (node as HTMLDetailsElement).open), true);
      stage = "recovered"; await refresh(page, "done");
      await page.getByText("Recovered fictional answer", { exact: true }).waitFor();
      assert.equal(await details.locator("summary").innerText(), "2 requests failed, then tried again");
      assert.equal(await details.evaluate((node) => (node as HTMLDetailsElement).open), true);
      assert.equal(await page.locator(".badge-done").innerText(), "DONE");
      const composer = page.getByRole("textbox", { name: "Fictional composer" });
      await composer.fill("draft preserved");
      await refresh(page, "done"); assert.equal(await composer.inputValue(), "draft preserved");
      assert.ok(await composer.evaluate((node) => document.activeElement === node));
      await page.screenshot({ path: join(evidence, `recovered-${width}.png`) });
      stage = "next"; await refresh(page, "failed"); await frames(page);
      assert.equal(await details.count(), 2); assert.equal(await details.last().evaluate((node) => (node as HTMLDetailsElement).open), true);
      const geometry = await details.last().evaluate((node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: innerWidth }; });
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1, JSON.stringify(geometry));
      await page.screenshot({ path: join(evidence, `next-failure-${width}.png`) });
      assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
      results.push({ width, defaultsAndReaderChoice: true, retryGrouping: true, nativeStatusPaint: true, composerPreserved: true, geometry, errors, warnings });
      console.log(`PASS ${width}: terminal/retry defaults, reader choice across answer/work, grouped retries, status paint, composer and viewport`);
      await context.close(); activePage = undefined;
    }
    writeFileSync(join(evidence, "report.json"), JSON.stringify({ results, scope: "Fictional real-component browser regression; no provider/native/device or human acceptance" }, null, 2));
  }
} catch (error) {
  if (activePage) await activePage.screenshot({ path: join(evidence, "failure-debug.png") }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true });
}
