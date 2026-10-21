import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PROMOTION_REMOVALS, PROMOTION_RELOCATIONS } from "./verify-upstream.ts";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("retired distribution owners stay absent and fictional fixtures have one current home", () => {
  for (const path of [...PROMOTION_REMOVALS, ...Object.keys(PROMOTION_RELOCATIONS)])
    expect(existsSync(join(root, path)), path).toBe(false);
  for (const path of Object.values(PROMOTION_RELOCATIONS))
    expect(existsSync(join(root, path)), path).toBe(true);
  expect(existsSync(join(root, "site"))).toBe(false);
  expect(existsSync(join(root, "telemetry"))).toBe(false);
});

test("package and tool-check entrypoints do not depend on retired owners", () => {
  const pkg = JSON.parse(read("package.json"));
  expect(pkg.scripts["build:site"]).toBeUndefined();
  expect(pkg.scripts["build:remote"]).toBeUndefined();
  for (const command of Object.values(pkg.scripts) as string[])
    for (const match of command.matchAll(/\b(scripts\/[\w./-]+\.(?:mjs|ts))\b/g))
      expect(existsSync(join(root, match[1]!)), command).toBe(true);
  for (const file of JSON.parse(read("tsconfig.tools.json")).files)
    expect(existsSync(join(root, file)), file).toBe(true);
});

test("project command shortcuts respect the unit preload and isolated-build boundaries", () => {
  const { items } = JSON.parse(read(".herdr/commands.json"));
  expect(items.find((item: { id: string }) => item.id === "run-tests").fillValue).toBe("bun run test:unit");
  const build = items.find((item: { id: string }) => item.id === "run-build");
  expect(build.fillValue).toContain("--outDir .agent-state/qa/");
  for (const item of items) expect(item.fillValue).not.toMatch(/\bbun test\b/);
});

test("local source imports and URL fixtures resolve after relocation", () => {
  const errors: string[] = [];
  for (const path of new Bun.Glob("{scripts,src,server,shared}/**/*.{ts,tsx}").scanSync({ cwd: root })) {
    // Imports and new URL fixtures, not arbitrary path-like test strings.
    const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|new URL\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
    for (const match of read(path).matchAll(pattern)) {
      const target = match[1]!.split("?")[0]!;
      if (/\.(?:ts|tsx|json|html|sh|ps1|mjs|yml)$/.test(target) &&
          !existsSync(resolve(root, dirname(path), target)))
        errors.push(`${path}: ${target}`);
    }
  }
  expect(errors).toEqual([]);
});

test("relocated fictional transport bundles without native host or marketing assets", async () => {
  const result = await Bun.build({
    entrypoints: [join(root, "scripts/fixtures/demo/transport.ts")],
    target: "browser",
    define: { __APP_VERSION__: JSON.stringify("fixture-check") },
  });
  expect(result.success, result.logs.map(String).join("\n")).toBe(true);
  expect(result.outputs.length).toBeGreaterThan(0);
  const builder = read("scripts/demo-build.ts");
  expect(builder).toContain('join(repo, "scripts/fixtures/demo/transport.ts")');
  const preview = read("scripts/fixtures/demo/index.html");
  expect(preview).not.toContain("../#install");
  expect(preview).not.toContain("github.com/devswha/herdr-web-ui");
  expect(preview).toContain("github.com/mahirocoko/herdr-web");
});

test("old promotion receipts cannot reactivate retired distribution", () => {
  const result = Bun.spawnSync([process.execPath, "scripts/promote-upstream.ts"], {
    cwd: root, env: { ...process.env, HERDR_TEST_MODE: "unit" },
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("One-time promotion is retired after fork cleanup");
});
