import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { projectRoot, requiredVersion, selectBun } from "./bun-project.mjs";

test("selector prefers exact project-local runtime, then PATH, then current executable", () => {
  const options = {
    root: "/fixture space",
    platform: "darwin",
    arch: "arm64",
    current: "/current/bun",
    path: "/old:/exact",
    exists: () => true,
  };
  const local = join(
    options.root,
    ".agent-state/tools/bun",
    requiredVersion,
    "bun-darwin-aarch64/bun",
  );
  expect(selectBun({ ...options, version: () => requiredVersion })).toBe(local);
  expect(
    selectBun({
      ...options,
      version: (binary: string) =>
        binary === join("/exact", "bun") ? requiredVersion : "1.3.11",
    }),
  ).toBe(join("/exact", "bun"));
  expect(
    selectBun({
      ...options,
      version: (binary: string) =>
        binary === options.current ? requiredVersion : "",
    }),
  ).toBe(options.current);
  expect(() => selectBun({ ...options, version: () => "1.3.11" })).toThrow(
    "no runtime was installed or upgraded",
  );
});

test("Windows selection uses bun.exe, semicolon PATH and exact version", () => {
  const checked: string[] = [];
  const selected = selectBun({
    root: "fixture",
    platform: "win32",
    arch: "x64",
    current: "current.exe",
    path: 'old bin;"exact bin"',
    exists: () => true,
    version: (binary: string) => {
      checked.push(binary);
      return binary === join("exact bin", "bun.exe")
        ? requiredVersion
        : "1.3.11";
    },
  });
  expect(selected).toBe(join("exact bin", "bun.exe"));
  expect(checked[0]).toBe(
    join(
      "fixture",
      ".agent-state/tools/bun",
      requiredVersion,
      "bun-windows-x64/bun.exe",
    ),
  );
  expect(checked).toContain(join("old bin", "bun.exe"));
});

test("native dispatch preserves argv, environment, canonical cwd, --bun and exit status", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr bootstrap space "));
  try {
    const script = join(root, "quoted ' & fixture.ts");
    writeFileSync(
      script,
      `console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: process.env.BOOTSTRAP_FIXTURE, path: process.env.PATH, workers: process.env.UNIT_TEST_WORKERS, bun: Bun.version })); process.exitCode = 23;`,
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        join(projectRoot, "scripts/bun-project.mjs"),
        "--bun",
        script,
        "space arg",
        "'quoted'",
        "&;%!",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          BOOTSTRAP_FIXTURE: "kept",
          UNIT_TEST_WORKERS: "1",
        },
      },
    );
    expect(result.exitCode).toBe(23);
    const output = JSON.parse(result.stdout.toString());
    expect(output.args).toEqual(["space arg", "'quoted'", "&;%!"]);
    expect(resolve(output.cwd)).toBe(projectRoot);
    expect(output.env).toBe("kept");
    expect(output.workers).toBe("1");
    expect(output.bun).toBe(requiredVersion);
    expect(output.path.split(delimiter)[0]).toBe(dirname(selectBun()));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.if(process.platform !== "win32")(
  "Unix dispatch forwards termination to its owned fixture child",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "herdr bootstrap signal "));
    try {
      const script = join(root, "signal.ts");
      writeFileSync(
        script,
        `process.on("SIGTERM", () => process.exit(42)); console.log("ready"); setInterval(() => {}, 1000);`,
      );
      const child = Bun.spawn(
        [
          process.execPath,
          join(projectRoot, "scripts/bun-project.mjs"),
          script,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const reader = child.stdout.getReader();
      try {
        const ready = await reader.read();
        expect(new TextDecoder().decode(ready.value)).toContain("ready");
        child.kill("SIGTERM");
        expect(await child.exited).toBe(42);
      } finally {
        reader.releaseLock();
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("ordinary launcher help and invalid arguments do not start the application", () => {
  for (const [args, status, text] of [
    [["--help"], 0, "Usage: bun start"],
    [["--invalid"], 1, "Unknown launcher argument"],
  ] as const) {
    const result = Bun.spawnSync(
      [
        process.execPath,
        join(projectRoot, "scripts/bun-project.mjs"),
        join(projectRoot, "scripts/run-local.ts"),
        ...args,
      ],
      {
        env: { ...process.env, HERDR_TEST_MODE: "1", PORT: "invalid" },
      },
    );
    expect(result.exitCode).toBe(status);
    expect(Buffer.concat([result.stdout, result.stderr]).toString()).toContain(
      text,
    );
  }
});
