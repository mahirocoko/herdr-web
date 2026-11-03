import { expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agyDatabasePath, forgetAgyState, parseAgyTranscript, withAgyHistory } from "./agy.ts";

it("keeps the recorded skill invocation without its expanded metadata", () => {
  const fixture = readFileSync(new URL("./fixtures/skill-invocations/agy.jsonl", import.meta.url), "utf8");
  const turns = parseAgyTranscript(fixture);
  expect(turns.filter(({ role }) => role === "user").map(({ parts }) => parts)).toEqual([
    [{ kind: "text", text: "/probe-skill hello" }],
  ]);
});

it("opens a ledger larger than 32 MiB on the first read", () => {
  const root = mkdtempSync(join(tmpdir(), "agy-long-ledger-"));
  const path = join(root, "brain", "session", ".system_generated", "logs", "transcript_full.jsonl");
  try {
    mkdirSync(join(root, "conversations"), { recursive: true });
    mkdirSync(join(root, "brain", "session", ".system_generated", "logs"), { recursive: true });
    const content = "x".repeat(11 * 1024 * 1024);
    writeFileSync(path, [0, 1, 2].map((step_index) => JSON.stringify({ step_index, type: "USER_INPUT", status: "DONE", content })).join("\n") + "\n");
    const db = new Database(agyDatabasePath(path));
    try { db.exec("CREATE TABLE steps (idx INTEGER); INSERT INTO steps VALUES (0), (1), (2)"); }
    finally { db.close(); }
    expect(withAgyHistory(path, (projection) => projection.indices)).toEqual([0, 1, 2]);
  } finally { forgetAgyState(path); rmSync(root, { recursive: true, force: true }); }
});

it("keeps raw input when it is not a complete recognized envelope", () => {
  const content = "<USER_REQUEST>\n/probe-skill hello\n</USER_REQUEST>\n<OTHER>raw</OTHER>";
  const turns = parseAgyTranscript(JSON.stringify({ step_index: 0, type: "USER_INPUT", status: "DONE", content }));
  expect(turns[0]?.parts).toEqual([{ kind: "text", text: content }]);
});
