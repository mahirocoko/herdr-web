/** Actual Settings controls in the existing fictional fixture; never uses a native service. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium, type Locator } from "playwright-core";

const evidence = resolve(process.env.UI_EVIDENCE_DIR || ".agent-state/runtime/adopt-polish/stepper-browser");
mkdirSync(evidence, { recursive: true });
const output = mkdtempSync(join(evidence, "fixture-"));
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const results: unknown[] = [];
const requests: string[] = [];
async function paint(button: Locator) {
  return button.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopColor, color: style.color, opacity: style.opacity, cursor: style.cursor, outline: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
}
try {
  const build = await Bun.build({ entrypoints: ["scripts/sheet-history-fixture.tsx"], outdir: output, target: "browser", define: { "process.env.NODE_ENV": '"development"', "__APP_VERSION__": '"fixture"', "__APP_REVISION__": "null", "__HERDR_TEST_HOOKS__": "false" } });
  assert.ok(build.success, String(build.logs));
  const assets = new Set(build.outputs.map((asset) => relative(output, asset.path)));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}`);
    // No provider, native, account, profile or settings HTTP effects, even if a fixture regresses.
    if (request.method !== "GET") return new Response("No fixture mutations", { status: 405 });
    if (url.pathname === "/") return new Response('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/sheet-history-fixture.css"></head><body><div id="root"></div><script type="module" src="/sheet-history-fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    const asset = url.pathname.slice(1);
    return assets.has(asset) ? new Response(Bun.file(join(output, asset))) : new Response("Unknown fixture path", { status: 404 });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  if (process.argv.includes("--serve-only")) {
    console.log(`Fictional Settings stepper fixture: ${origin}/ (GET-only asset whitelist)`);
    await new Promise<void>((done) => { process.once("SIGINT", done); process.once("SIGTERM", done); });
  } else {
    assert.ok(process.env.CHROME_PATH, "Set CHROME_PATH to an installed Chromium executable; no downloads");
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    for (const theme of ["light", "dark"]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce", locale: "en-US" });
      await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
      await context.addInitScript((theme) => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", theme, uiFontSize: 19 })), theme);
      const page = await context.newPage();
      page.setDefaultTimeout(12_000);
      const errors: string[] = [], warnings: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); else if (message.type() === "warning") warnings.push(message.text()); });
      try {
        await page.goto(origin);
        await page.getByRole("button", { name: "Open actual Settings", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
        const group = dialog.getByRole("group", { name: "Interface font size", exact: true });
        const plus = group.getByRole("button", { name: "Increase interface font size", exact: true });
        const minus = group.getByRole("button", { name: "Decrease interface font size", exact: true });
        const value = group.locator("output");
        assert.equal(await value.textContent(), "19px");
        // This press reaches the maximum: focus must not fall back to body/the dialog.
        await plus.click();
        assert.equal(await value.textContent(), "20px");
        assert.equal(await plus.evaluate((node) => document.activeElement === node), true);
        assert.equal(await plus.getAttribute("disabled"), null);
        assert.equal(await plus.getAttribute("aria-disabled"), "true");
        // Playwright correctly calls aria-disabled buttons disabled: use real keyboard input,
        // and a coordinate click, rather than a forced synthetic locator click.
        await plus.press("Enter");
        await plus.press("Space");
        assert.equal(await value.textContent(), "20px");
        await page.mouse.move(1, 1);
        const rest = await paint(plus);
        assert.equal(rest.opacity, "0.7");
        assert.equal(rest.cursor, "default");
        await plus.hover();
        assert.deepEqual(await paint(plus), rest);
        const bounds = await plus.boundingBox(); assert.ok(bounds);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        assert.deepEqual(await paint(plus), rest);
        await page.mouse.up();
        assert.equal(await value.textContent(), "20px");
        assert.equal(await plus.evaluate((node) => document.activeElement === node), true);
        // Mouse and keyboard can still leave an endpoint and reach the opposite limit.
        await minus.click();
        assert.equal(await value.textContent(), "19px");
        assert.equal(await plus.getAttribute("aria-disabled"), null);
        for (let size = 19; size > 11; size--) await minus.press("Enter");
        assert.equal(await value.textContent(), "11px");
        assert.equal(await minus.evaluate((node) => document.activeElement === node), true);
        assert.equal(await minus.getAttribute("aria-disabled"), "true");
        await minus.press("Enter"); await minus.press("Space");
        assert.equal(await value.textContent(), "11px");
        const focus = await paint(minus);
        assert.notEqual(focus.outline, "none");
        assert.notEqual(focus.outlineWidth, "0px");
        await page.keyboard.press("Tab");
        assert.equal(await plus.evaluate((node) => document.activeElement === node), true);
        await page.keyboard.press("Shift+Tab");
        assert.equal(await minus.evaluate((node) => document.activeElement === node), true);
        const geometry = await group.boundingBox(); assert.ok(geometry);
        assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= viewport.width, "Stepper must fit the viewport");
        await page.screenshot({ path: join(evidence, `${theme}-${viewport.width}.png`) });
        assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
        results.push({ theme, viewport, keyboardAndPointerLimits: true, retainedFocus: true, inertHoverAndActive: true, visibleKeyboardFocus: true, geometry, errors, warnings });
      } catch (error) {
        await page.screenshot({ path: join(evidence, `failure-${theme}-${viewport.width}.png`) }).catch(() => {});
        writeFileSync(join(evidence, "failure.json"), JSON.stringify({ theme, viewport, error: String(error), errors, warnings }, null, 2));
        throw error;
      } finally { await context.close(); }
    }
    assert.ok(requests.every((request) => request.startsWith("GET ")), "No fixture mutations");
    writeFileSync(join(evidence, "report.json"), JSON.stringify({ results, requests }, null, 2));
    console.log(JSON.stringify({ passed: results.length, evidence }, null, 2));
  }
} finally {
  await browser?.close();
  server?.stop(true);
  rmSync(output, { recursive: true, force: true });
}
