import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// Local browser-runner behavior only; upstream deployment policy is not tested here.
import { failureSite, scriptOutcome, selectBrowserScripts, serialBrowserScripts } from "./ci-browser-parallel.ts";

describe("Browser failure sites", () => {
  it("returns no failure for PASS lines", () => {
    expect(failureSite("PASS scripts/ui-regression.ts\nPASS all checks")).toEqual({ site: null, message: null });
  });
  it("reads the first assertion frame after the error", () => {
    const log = `65 | assert(Date.now() < deadline, "input regression timed out");
                                    ^
AssertionError: input regression timed out
 generatedMessage: false,
      at /w/herdr-web-ui/herdr-web-ui/scripts/terminal-input-regression.ts:65:32
      at checkTerminalInput (/w/herdr-web-ui/herdr-web-ui/scripts/terminal-input-regression.ts:81:11)`;
    expect(failureSite(log)).toEqual({ site: "scripts/terminal-input-regression.ts:65", message: "AssertionError: input regression timed out" });
  });
  it("skips Playwright frames for the first script frame", () => {
    const log = `  TimeoutError: waitFor: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.prompt-card') to be detached
      at /w/herdr-web-ui/herdr-web-ui/node_modules/playwright-core/lib/coreBundle.js:57694:13
      at checkSplitView (/w/herdr-web-ui/herdr-web-ui/scripts/split-view-regression.ts:509:13)`;
    expect(failureSite(log)).toEqual({ site: "scripts/split-view-regression.ts:509", message: "TimeoutError: waitFor: Timeout 30000ms exceeded." });
  });
  it("keeps an error with no script frame", () => {
    expect(failureSite("TypeError: broken\n  at /tmp/node_modules/scripts/helper.ts:2:1")).toEqual({ site: null, message: "TypeError: broken" });
  });
});

describe("Browser lane script lists", () => {
  const serial = serialBrowserScripts();

  it("reads every script the serial lane runs, and only those", () => {
    const sh = readFileSync(new URL("./ci-browser.sh", import.meta.url), "utf8");
    const runs = [...sh.matchAll(/^run_script (\S+)/gm)].map((match) => match[1]).filter((script) => script !== "scripts/demo-build.ts");
    expect(serial).toEqual(runs);
    expect(serial).toContain("scripts/ui-regression.ts");
    expect(serial).toContain("scripts/ui-contexts-regression.ts");
    expect(serial).toContain("scripts/sidebar-spacing-demo-regression.ts");
    expect(new Set(serial).size).toBe(serial.length);
  });

  it("calls a script that passed only on its second run flaky, and one that failed again a failure", () => {
    expect(scriptOutcome(0, false)).toBe("pass");
    expect(scriptOutcome(0, true)).toBe("flaky");
    expect(scriptOutcome(1, true)).toBe("fail");
    expect(scriptOutcome(1, false)).toBe("fail");
  });

  it("refuses a script name the serial lane does not run", () => {
    expect(() => selectBrowserScripts(serial, "scripts/missing-regression.ts")).toThrow("scripts/missing-regression.ts");
    expect(() => selectBrowserScripts(serial, undefined, "scripts/missing-regression.ts")).toThrow("scripts/missing-regression.ts");
    expect(selectBrowserScripts(serial, undefined, "scripts/ui-regression.ts")).toEqual(serial.filter((script) => script !== "scripts/ui-regression.ts"));
  });
});

describe("Extracted UI checks", () => {
  it("refuses a direct mobile viewport run in unit mode instead of silently passing", () => {
    // Given a unit run, no browser or herdr fixture is allowed.
    // When the shared helper is invoked directly, it must execute its entrypoint.
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./mobile-viewport-regression.ts", import.meta.url))], {
      encoding: "utf8", timeout: 5_000,
      env: { ...process.env, HERDR_TEST_MODE: "unit" },
    });
    // Then the unit-mode guard rejects the run rather than returning an empty success.
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HERDR_TEST_MODE=unit");
  });

  const moved = [
    "checkPushSettings", "checkWakeLock", "checkSecretInput", "checkTerminalCopy", "checkPaneFind",
    "checkUsageMeters", "checkNotificationStartup", "checkNotificationView", "checkMobileViewport",
    "checkTerminalPinch", "checkMobileTabs", "checkTabMenu", "checkDefaultView",
    "checkComposerReconnect", "checkDroplet", "checkSplitView", "checkTakeOver", "checkAlertSound",
    "checkChatKeepsTerminalSize", "checkPaneSwitchKeepsTerminalSize",
    "checkBackgroundTabKeepsTerminalSize", "checkFocusedWindowReclaimsTerminalSize",
    "checkUpdateNotice", "checkTelemetrySettings",
  ];
  const calls = (source: string) => [...source.matchAll(/\b(check[A-Z]\w*)\(/g)].map((match) => match[1]!);

  it("moves all 24 existing checks exactly once, in order, without removing core input checks", () => {
    const core = calls(readFileSync(new URL("./ui-regression.ts", import.meta.url), "utf8"));
    const contexts = calls(readFileSync(new URL("./ui-contexts-checks.ts", import.meta.url), "utf8"));
    expect(contexts.filter((name) => moved.includes(name))).toEqual(moved);
    expect(core.filter((name) => moved.includes(name))).toEqual([]);
    for (const name of ["checkTerminalInput", "checkSafariIme", "checkHeldDraftPaneSwitch",
      "checkCommandBackspace", "checkCtrlEnter", "checkCommandArrows"]) {
      expect(core.filter((call) => call === name)).toHaveLength(1);
    }
  });

  for (const mode of ["unit", "live"] as const) {
    it(`refuses ${mode} execution before touching a herdr daemon`, () => {
      const root = mkdtempSync(join(tmpdir(), "ui-context-guard-"));
      try {
        const invoked = join(root, "invoked");
        const herdr = join(root, "herdr");
        writeFileSync(herdr, '#!/bin/sh\nprintf called > "$HERDR_GUARD_LOG"\nexit 1\n', { mode: 0o700 });
        const result = spawnSync(process.execPath, [fileURLToPath(new URL("./ui-contexts-regression.ts", import.meta.url))], {
          encoding: "utf8", timeout: 5_000,
          env: {
            ...process.env, TMPDIR: root, XDG_CONFIG_HOME: root,
            HERDR_WEB_HERDR_BIN: herdr, HERDR_GUARD_LOG: invoked,
            HERDR_SOCKET: join(root, "no-parent.sock"),
            HERDR_TEST_MODE: mode === "unit" ? "unit" : "integration",
            HERDR_TEST_LIVE: mode === "live" ? "1" : "",
          },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(result.stderr.toLowerCase()).toContain(mode);
        expect(existsSync(invoked)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
