import { expect, it } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const git = (...args: string[]): string => Bun.spawnSync(["git", ...args], { cwd: root, windowsHide: true }).stdout.toString();

// Shell helpers must remain LF even in a checkout with core.autocrlf=true.
it("checks every shell script out with LF, whatever core.autocrlf says", () => {
  // Audit the actual checkout, including the authorized uncommitted source promotion.
  const scripts = [...new Bun.Glob("{scripts,server}/**/*.sh").scanSync({ cwd: root })].sort();
  expect(scripts).toContain("scripts/preflight.sh");
  const eol = git("-c", "core.autocrlf=true", "check-attr", "-z", "eol", "--", ...scripts).split("\0");
  // -z prints path, attribute, value for each file
  const values = new Map(scripts.map((path) => [path, eol[eol.indexOf(path) + 2]]));
  for (const path of scripts) expect([path, values.get(path)]).toEqual([path, "lf"]);
});
