import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HerdrPane } from "../shared/protocol.ts";
import {
  LETTA_READ_BUDGET_BYTES,
  LETTA_READ_WINDOW_BYTES,
  LettaStoreUnavailable,
  withLettaStore,
} from "./letta-store.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const id = "synthetic-conversation-only";
const scope = createHash("sha256").update(id).digest("hex").slice(0, 16);
const pane: HerdrPane = {
  pane_id: "fixture-pane",
  agent: "letta",
  agent_status: "idle",
  focused: false,
  revision: 1,
  tab_id: "fixture-tab",
  terminal_id: "fixture-terminal",
  workspace_id: "fixture-workspace",
  tokens: { letta_scope: scope },
};
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "letta-store-unit-")));
  roots.push(root);
  const name = Buffer.from(`conversation:${id}`).toString("base64url");
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "conversation.json"), JSON.stringify({ id }));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      schema_version: 2,
      message_format: "pi-session-entry-jsonl",
      provider_stack: "pi-ai",
    }),
  );
  writeFileSync(
    join(dir, "messages.jsonl"),
    JSON.stringify({ type: "session", version: 3, id }) + "\n",
  );
  return { root, dir, name, file: join(dir, "messages.jsonl") };
}
const read = (root: string, native = pane) =>
  withLettaStore(native, root, (store) => ({
    binding: store.binding,
    text: store.read(0, store.size).toString("utf8"),
  }));

test("private native agent=letta + 16 lowercase hex scope resolves without agent_session/cwd", () => {
  const { root } = fixture();
  const result = read(root);
  expect(result.text).toContain('"type":"session"');
  expect(result.binding).toMatch(/^[a-f0-9]{64}$/);
  expect(result.binding).not.toContain(scope);
});
for (const native of [
  { ...pane, agent: "pi" },
  { ...pane, tokens: {} },
  { ...pane, tokens: { letta_scope: scope.toUpperCase() } },
  { ...pane, tokens: { letta_scope: scope + "0" } },
  { ...pane, tokens: { letta_scope: "0".repeat(16) } },
])
  test("missing/malformed/mismatched native scope fails closed", () => {
    const { root } = fixture();
    expect(() => read(root, native as HerdrPane)).toThrow(
      LettaStoreUnavailable,
    );
  });
test("literal-ID directory is never a resolver fallback", () => {
  const { root, dir } = fixture();
  renameSync(dir, join(root, id));
  expect(() => read(root)).toThrow(LettaStoreUnavailable);
});
test("noncanonical base64 directory is rejected", () => {
  const { root, dir, name } = fixture();
  renameSync(dir, join(root, name + "="));
  expect(() => read(root)).toThrow(LettaStoreUnavailable);
});
test("unrelated conversation contents are not opened", () => {
  const { root } = fixture();
  const unrelated = join(
    root,
    Buffer.from("conversation:unrelated").toString("base64url"),
  );
  mkdirSync(unrelated);
  writeFileSync(
    join(unrelated, "conversation.json"),
    "malformed and not consulted",
  );
  expect(read(root).binding).toMatch(/^[a-f0-9]{64}$/);
});
for (const [file, value] of [
  ["conversation.json", { id: "wrong-id" }],
  [
    "manifest.json",
    {
      schema_version: 1,
      message_format: "pi-session-entry-jsonl",
      provider_stack: "pi-ai",
    },
  ],
  [
    "manifest.json",
    { schema_version: 2, message_format: "other", provider_stack: "pi-ai" },
  ],
  [
    "manifest.json",
    {
      schema_version: 2,
      message_format: "pi-session-entry-jsonl",
      provider_stack: "other",
    },
  ],
  ["messages.jsonl", { type: "session", version: 3, id: "wrong" }],
  ["messages.jsonl", { type: "session", version: 2, id }],
] as const)
  test(`rejects unsupported or rebound ${file}`, () => {
    const { root, dir } = fixture();
    writeFileSync(join(dir, file), JSON.stringify(value) + "\n");
    expect(() => read(root)).toThrow(LettaStoreUnavailable);
  });
test("oversized metadata and unterminated headers fail closed", () => {
  const { root, dir, file } = fixture();
  writeFileSync(
    join(dir, "conversation.json"),
    JSON.stringify({ id, extra: "x".repeat(65536) }),
  );
  expect(() => read(root)).toThrow(LettaStoreUnavailable);
  writeFileSync(join(dir, "conversation.json"), JSON.stringify({ id }));
  writeFileSync(file, JSON.stringify({ type: "session", version: 3, id }));
  expect(() => read(root)).toThrow(LettaStoreUnavailable);
});
for (const target of [
  "root",
  "directory",
  "conversation.json",
  "manifest.json",
  "messages.jsonl",
])
  test(`rejects symlink ${target}`, () => {
    const { root, dir, name } = fixture();
    if (target === "root") {
      const alias = root + "-alias";
      roots.push(alias);
      symlinkSync(root, alias);
      expect(() => read(alias)).toThrow(LettaStoreUnavailable);
    } else {
      const path = target === "directory" ? dir : join(dir, target);
      const moved =
        target === "directory" ? join(root, "saved") : join(dir, "saved");
      renameSync(path, moved);
      symlinkSync(moved, target === "directory" ? join(root, name) : path);
      expect(() => read(root)).toThrow(LettaStoreUnavailable);
    }
  });
for (const target of ["messages.jsonl", "conversation.json", "manifest.json"])
  test(`revalidates ${target} after consumption`, () => {
    const { root, dir } = fixture();
    expect(() =>
      withLettaStore(pane, root, () => {
        const path = join(dir, target);
        const old = readFileSync(path);
        renameSync(path, path + ".old");
        writeFileSync(path, old);
        return "must not escape";
      }),
    ).toThrow(LettaStoreUnavailable);
  });
test("append during read fails closed, next read revalidates successfully", () => {
  const { root, file } = fixture();
  expect(() =>
    withLettaStore(pane, root, () => {
      appendFileSync(file, "{}\n");
      return "torn";
    }),
  ).toThrow(LettaStoreUnavailable);
  expect(read(root).text).toContain("{}\n");
});
test("window, aggregate byte and range limits are enforced", () => {
  const { root, file } = fixture();
  appendFileSync(file, " ".repeat(LETTA_READ_WINDOW_BYTES));
  expect(() =>
    withLettaStore(pane, root, (store) =>
      store.read(0, LETTA_READ_WINDOW_BYTES + 1),
    ),
  ).toThrow(LettaStoreUnavailable);
  expect(() =>
    withLettaStore(pane, root, (store) => store.read(-1, 1)),
  ).toThrow(LettaStoreUnavailable);
  expect(() =>
    withLettaStore(pane, root, (store) => store.read(store.size, 1)),
  ).toThrow(LettaStoreUnavailable);
  expect(() =>
    withLettaStore(pane, root, (store) => {
      for (
        let n = 0;
        n <= LETTA_READ_BUDGET_BYTES / LETTA_READ_WINDOW_BYTES;
        n++
      )
        store.read(0, LETTA_READ_WINDOW_BYTES);
    }),
  ).toThrow(LettaStoreUnavailable);
});
test("scope rebinding during consumption fails closed", () => {
  const { root } = fixture();
  const native = { ...pane, tokens: { letta_scope: scope } };
  expect(() =>
    withLettaStore(native, root, () => {
      native.tokens.letta_scope = "0".repeat(16);
    }),
  ).toThrow(LettaStoreUnavailable);
});
test("async consumers cannot outlive descriptor validation", () => {
  const { root } = fixture();
  expect(() =>
    withLettaStore(pane, root, () => Promise.resolve("not a synchronous read")),
  ).toThrow(LettaStoreUnavailable);
});
test("directory name enumeration has a finite entry bound", () => {
  const { root } = fixture();
  for (let n = 0; n < 32768; n++)
    writeFileSync(join(root, `unrelated-${n}`), "");
  expect(() => read(root)).toThrow(LettaStoreUnavailable);
});
test("failure messages never serialize raw identity or local paths", () => {
  const { root, dir } = fixture();
  writeFileSync(join(dir, "conversation.json"), "invalid JSON");
  try {
    read(root);
    throw new Error("expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(LettaStoreUnavailable);
    const serialized = String(error);
    for (const privateValue of [root, dir, id, scope])
      expect(serialized).not.toContain(privateValue);
  }
});
