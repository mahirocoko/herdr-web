/** Owned fictional fixture only. Main runs serially; no native/provider service or downloads. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import type {} from "./sheet-history-fixture.tsx";

const evidence = resolve(process.env.UI_EVIDENCE_DIR || ".agent-state/runtime/upstream-review-tasks/T335-browser");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(evidence, "fixture-"));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let activePage: Page | undefined;
let releaseCreate: (() => void) | undefined;
let createCalls = 0;
const repository = { root: "/fictional", branch: "fixture", head: "a".repeat(40), detached: false, unborn: false };
const changed = { path: "fixture.txt", old_path: null, status: "modified", additions: null, deletions: null, binary: true };
const results: unknown[] = [];
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame); });
}
async function back(page: Page): Promise<void> { await page.goBack(); await settle(page); }
async function preserved(page: Page): Promise<void> {
  assert.equal(await page.getByLabel("Fictional draft").inputValue(), "preserved draft");
  assert.equal(await page.getByTestId("pane").textContent(), "b");
  assert.equal(new URL(page.url()).searchParams.get("pane"), "b");
}
try {
  const build = await Bun.build({ entrypoints: ["scripts/sheet-history-fixture.tsx"], outdir: root, target: "browser", define: { "process.env.NODE_ENV": '"development"', "__APP_VERSION__": '"fixture"', "__APP_REVISION__": "null", "__HERDR_TEST_HOOKS__": "false" } });
  assert.ok(build.success, String(build.logs));
  const assets = new Set(build.outputs.map((asset) => relative(root, asset.path)));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    // The only mutation is a held, fictional NewSession response. It runs no commands.
    if (request.method === "POST" && url.pathname === "/api/workspace/create") {
      createCalls++;
      await new Promise<void>((done) => { releaseCreate = done; });
      return Response.json({ workspace_id: "fictional-created", pane_id: "fictional-created-pane", agent_started: false });
    }
    if (request.method !== "GET") return new Response("Not a fixture operation", { status: 405 });
    if (url.pathname === "/api/agents") return Response.json({ agents: [] });
    if (url.pathname === "/api/workspace/directories") return Response.json({ path: "/fictional", parent: null, home: "/fictional", directories: ["child"], files: [{ name: "fixture.txt", size: 24 }], truncated: false });
    if (url.pathname === "/api/fs/stat") return Response.json({ path: "/fictional/fixture.txt", name: "fixture.txt", size: 24, modified: "2026-01-01T00:00:00Z", mime: "text/plain", kind: "text" });
    if (url.pathname === "/api/fs/file") return new Response("Fictional file content.\n", { headers: { "content-type": "text/plain" } });
    if (url.pathname === "/api/workspace/diff/files") return Response.json({ repository, scope: "workspace", base: null, head: null, files: [changed], total: 1, truncated: false, limits: { max_files: 10, max_list_bytes: 10000 } });
    if (url.pathname === "/api/workspace/diff/file") return Response.json({ repository, scope: "workspace", base: null, head: null, file: changed, patch: null, unavailable: "binary", truncated: false, limits: { max_patch_bytes: 10000, context_lines: 3 } });
    if (url.pathname === "/") return new Response('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/sheet-history-fixture.css"></head><body><div id="root"></div><script type="module" src="/sheet-history-fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    const asset = url.pathname.slice(1);
    if (!assets.has(asset)) return new Response("Unknown fixture path", { status: 404 });
    return new Response(Bun.file(join(root, asset)));
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  if (process.argv.includes("--serve-only")) {
    console.log(`T335 fictional fixture: ${origin}/ (GET whitelist + held fictional workspace POST)`);
    await new Promise<void>((done) => { process.once("SIGINT", done); process.once("SIGTERM", done); });
  } else {
    assert.ok(process.env.CHROME_PATH, "Set CHROME_PATH to an already installed Chromium executable; no downloads");
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    for (const spec of [{ width: 390, height: 844, touch: true }, { width: 844, height: 390, touch: true }, { width: 1440, height: 900, touch: false }]) {
      const context = await browser.newContext({ viewport: spec, hasTouch: spec.touch, isMobile: spec.touch, reducedMotion: "reduce", locale: "en-US" });
      await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
      await context.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", theme: "dark" })));
      const errors: string[] = [], warnings: string[] = [];
      const page = activePage = await context.newPage(); page.setDefaultTimeout(12_000);
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); else if (message.type() === "warning") warnings.push(message.text()); });
      const fresh = async (): Promise<void> => { await page.goto(`${origin}/`); await page.getByTestId("pane").waitFor(); await settle(page); };
      const openFiles = async (): Promise<void> => { await page.getByRole("button", { name: "Open Files", exact: true }).click(); await page.getByRole("dialog", { name: "Files", exact: true }).waitFor(); await settle(page); };
      const openFile = async (): Promise<void> => { await page.getByText("fixture.txt", { exact: true }).click(); await page.getByRole("button", { name: "Close file", exact: true }).waitFor(); await settle(page); };
      const confirmation = page.getByRole("alertdialog", { name: "Fictional confirmation", exact: true });
      await fresh(); await openFiles(); await openFile();
      const viewerLength = await page.evaluate(() => history.length);
      await back(page);
      assert.equal(await page.evaluate(() => history.length), viewerLength); // no Back-time refill
      assert.equal(await page.getByRole("button", { name: "Close file", exact: true }).count(), 0);
      assert.equal(await page.getByRole("dialog", { name: "Files", exact: true }).count(), 1);
      if (spec.touch) { await back(page); assert.equal(await page.getByRole("dialog", { name: "Files", exact: true }).count(), 0); await preserved(page); }
      else { await preserved(page); await page.getByRole("button", { name: "Close files", exact: true }).click(); }
      await fresh(); await openFiles(); await openFile();
      await page.getByRole("button", { name: "Close file", exact: true }).click(); await settle(page);
      assert.equal(await page.getByRole("dialog", { name: "Files", exact: true }).count(), 1); await preserved(page);
      // Nested real confirmation over Files; no fixture-native approval/join feature exists.
      await page.evaluate(() => window.sheetQa.confirm()); await confirmation.waitFor(); await settle(page);
      if (spec.touch) { await back(page); assert.equal(await confirmation.count(), 0); assert.equal(await page.getByRole("dialog", { name: "Files", exact: true }).count(), 1); await preserved(page); }
      else { await page.getByRole("button", { name: "Cancel", exact: true }).click(); }
      await fresh(); await openFiles(); await page.getByRole("button", { name: "Changes", exact: true }).click();
      await page.locator(".repo-change").click(); await page.getByRole("button", { name: "Close diff", exact: true }).waitFor();
      await page.getByRole("button", { name: "Close diff", exact: true }).click(); await settle(page); await preserved(page);
      assert.equal(await page.getByRole("dialog", { name: "Files", exact: true }).count(), 1);
      if (spec.touch) {
        // New real confirmation must survive a viewer owner's already-requested Close landing.
        await fresh(); await openFiles(); await openFile();
        await page.evaluate(() => window.sheetQa.closeFileAndConfirm()); await settle(page);
        assert.equal(await confirmation.count(), 1);
        assert.equal(await page.getByRole("button", { name: "Close file", exact: true }).count(), 0);
        await back(page); assert.equal(await confirmation.count(), 0); await preserved(page);
        await fresh(); await openFiles(); await page.getByRole("button", { name: "Changes", exact: true }).click();
        await page.locator(".repo-change").click(); await page.getByRole("button", { name: "Close diff", exact: true }).waitFor();
        await page.evaluate(() => window.sheetQa.closeDiffAndConfirm()); await settle(page);
        assert.equal(await confirmation.count(), 1);
        assert.equal(await page.getByRole("button", { name: "Close diff", exact: true }).count(), 0);
        await back(page); assert.equal(await confirmation.count(), 0); await preserved(page);
      }
      // Actual Back/Forward/reload preserves viewer identity, not closed sheet UI.
      console.log(`CASE ${spec.width}: viewer Forward/reload`);
      await fresh(); await openFiles(); await openFile(); await back(page); await page.goForward(); await settle(page);
      await page.getByRole("button", { name: "Close file", exact: true }).waitFor();
      console.log(`CASE ${spec.width}: viewer reload`);
      await page.reload(); await settle(page);
      await page.getByRole("button", { name: "Close file", exact: true }).waitFor();
      await fresh(); await page.getByRole("button", { name: "Open confirmation", exact: true }).click(); await confirmation.waitFor();
      if (spec.touch) {
        await page.getByRole("button", { name: "Hold fictional action", exact: true }).click();
        await back(page); assert.equal(await confirmation.count(), 1); await preserved(page);
        await page.evaluate(() => window.sheetQa.closeConfirm()); await settle(page);
        await page.getByRole("button", { name: "Open confirmation", exact: true }).click();
        await page.evaluate(() => window.sheetQa.reopen()); await settle(page); await back(page);
        assert.equal(await confirmation.count(), 0); await preserved(page);
      } else {
        const length = await page.evaluate(() => history.length);
        await page.getByRole("button", { name: "Cancel", exact: true }).click(); await settle(page);
        assert.equal(await page.evaluate(() => history.length), length);
        await page.getByRole("button", { name: "Open confirmation", exact: true }).click();
        await back(page); assert.equal(await confirmation.count(), 1);
        assert.equal(await page.getByTestId("pane").textContent(), "a");
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      await fresh(); await page.getByRole("button", { name: "Open menu", exact: true }).click(); await settle(page);
      assert.equal(await page.locator(".row-sheet").count() > 0, spec.width <= 640);
      if (spec.touch) { await back(page); assert.equal(await page.getByText("Nested confirmation", { exact: true }).count(), 0); await preserved(page); }
      else { await page.keyboard.press("Escape"); }
      await fresh(); await page.getByRole("button", { name: "Open New workspace", exact: true }).click();
      const newDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /New workspace/ }) });
      await newDialog.locator('input[maxlength]').fill("fictional draft name");
      await newDialog.getByRole("button", { name: /Browse/, exact: false }).click(); await settle(page);
      if (spec.touch) {
        await back(page); assert.equal(await newDialog.locator(".dir-browser").count(), 0);
        assert.equal(await newDialog.locator('input[maxlength]').inputValue(), "fictional draft name");
        await newDialog.getByRole("button", { name: "Start", exact: true }).click();
        await page.getByRole("button", { name: "Starting…", exact: true }).waitFor();
        await back(page); assert.equal(await newDialog.count(), 1); await preserved(page);
        assert.ok(releaseCreate, "Fictional workspace POST reached the owned fixture"); releaseCreate(); releaseCreate = undefined;
        await newDialog.waitFor({ state: "detached" });
      } else await newDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await settle(page);
      await fresh(); await page.getByRole("button", { name: "Open Settings steps", exact: true }).click();
      await page.getByRole("button", { name: "Appearance step", exact: true }).click();
      await page.getByRole("button", { name: "Nested confirmation", exact: true }).click(); await confirmation.waitFor(); await settle(page);
      if (spec.touch) { await back(page); assert.equal(await confirmation.count(), 0); assert.equal(await page.getByTestId("settings-level").textContent(), "2"); await back(page); assert.equal(await page.getByTestId("settings-level").textContent(), "1"); }
      if (spec.touch) {
        await page.evaluate(() => window.sheetQa.closeSettingsAndConfirm()); await settle(page);
        assert.equal(await confirmation.count(), 1);
        assert.equal(await page.getByRole("dialog", { name: "Fixture Settings", exact: true }).count(), 0);
        await back(page); assert.equal(await confirmation.count(), 0); await preserved(page);
      }
      if (spec.width === 390) {
        // Actual Settings passive effects, not the synchronous controller: a harmless
        // confirmation survives rotation, then Back reconciles the latest wide depth.
        await fresh(); await page.getByRole("button", { name: "Open actual Settings", exact: true }).click();
        const actualSettings = page.getByRole("dialog", { name: "Settings", exact: true });
        await actualSettings.getByRole("tabpanel", { name: "Appearance", exact: true }).waitFor(); await settle(page);
        assert.equal(await page.evaluate(() => history.state?.["herdr-web-ui:settings"]?.depth), 2);
        await page.evaluate(() => window.sheetQa.confirm()); await confirmation.waitFor(); await settle(page);
        await page.screenshot({ path: join(evidence, "settings-confirm-390.png") });
        await confirmation.getByRole("button", { name: "Hold fictional action", exact: true }).click(); await settle(page);
        await page.setViewportSize({ width: 844, height: 390 }); await settle(page);
        assert.equal(await confirmation.count(), 1);
        await page.screenshot({ path: join(evidence, "settings-confirm-844.png") });
        await back(page); assert.equal(await confirmation.count(), 1); // refusal restores before Settings can reconcile
        assert.equal(await page.evaluate(() => typeof history.state?.["herdr-web-ui:sheet"]), "string");
        assert.equal(await page.evaluate(() => history.state?.["herdr-web-ui:settings"]?.depth), 2);
        await page.evaluate(() => window.sheetQa.refuseConfirm()); await settle(page);
        assert.equal(await confirmation.getByRole("button", { name: "Cancel", exact: true }).isEnabled(), true);
        await back(page); assert.equal(await confirmation.count(), 0); assert.equal(await actualSettings.count(), 1);
        assert.equal(await page.evaluate(() => history.state?.["herdr-web-ui:settings"]?.depth), 1);
        await preserved(page);
        await back(page); assert.equal(await actualSettings.count(), 0); await preserved(page);
        await page.setViewportSize({ width: 390, height: 844 });
        // A replacement child mounts before App's parent Close effect records [].
        await fresh(); await page.getByRole("button", { name: "Open actual Settings", exact: true }).click();
        await actualSettings.getByRole("tabpanel", { name: "Appearance", exact: true }).waitFor(); await settle(page);
        await page.evaluate(() => window.sheetQa.closeRealSettingsAndConfirm()); await confirmation.waitFor(); await settle(page);
        assert.equal(await actualSettings.count(), 0);
        await back(page); assert.equal(await confirmation.count(), 0); await preserved(page);
        assert.equal(await page.evaluate(() => history.state?.["herdr-web-ui:settings"] ?? null), null);
      }
      await page.screenshot({ path: join(evidence, `surfaces-${spec.width}.png`) });
      assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
      results.push({ ...spec, errors, warnings, cases: spec.touch ? "Viewer Back/Close/Forward/reload, diff Close, nested/owner-close confirmation, refusal/reopen, menu visual split, NewSession browse/pending, Settings levels, draft/pane preservation" + (spec.width === 390 ? "; real Settings rotation with busy restore and child-before-parent Close" : "") : "Viewer Back/Close/Forward/reload, diff Close, desktop dialog and pane Back, menu visual split, NewSession browse rendering, Settings rendering" });
      console.log(`PASS ${spec.width}: fictional surface/history cases`);
      await context.close(); activePage = undefined;
    }
    writeFileSync(join(evidence, "report.json"), JSON.stringify({ results, createCalls, scope: "Fictional real components; not native/device/independent/human acceptance" }, null, 2));
  }
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: join(evidence, "failure-debug.png") }).catch(() => {});
    const state = await activePage.evaluate(() => ({ url: location.href, state: history.state, text: document.body.innerText })).catch(() => null);
    writeFileSync(join(evidence, "failure-state.json"), JSON.stringify(state, null, 2));
  }
  throw error;
} finally {
  releaseCreate?.(); await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true });
}
