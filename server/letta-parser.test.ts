import { describe, expect, test } from "bun:test";
import {
  LETTA_PARSE_BYTES,
  LETTA_PARSE_ENTRIES,
  parseLettaTranscript,
  stripLettaRuntimeContext,
} from "./letta-parser.ts";

const message = (
  id: string,
  role: string,
  content: unknown,
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({ type: "message", message: { id, role, content, ...extra } });
const parse = (...rows: string[]) =>
  parseLettaTranscript(rows.join("\n") + "\n");
const text = (value: string) => [{ type: "text", text: value }];

describe("Letta native snapshots to source conversation parts", () => {
  test("latest complete snapshot wins without moving original message order", () => {
    const answer = parse(
      message("u", "user", text("question")),
      message("a", "assistant", text("partial")),
      message("u2", "user", text("next")),
      message("a", "assistant", text("complete")),
    );
    expect(answer.turns.map((turn) => turn.parts)).toEqual([
      [{ kind: "text", text: "question" }],
      [{ kind: "text", text: "complete", phase: "commentary" }],
      [{ kind: "text", text: "next" }],
    ]);
  });
  test("half-written append cannot replace a complete snapshot", () => {
    const answer = parseLettaTranscript(
      message("a", "assistant", text("complete")) +
        '\n{"type":"message","message":{"id":"a"',
    );
    expect(answer.turns[0]?.parts[0]).toMatchObject({
      kind: "text",
      text: "complete",
    });
  });
  test("malformed interior records fail closed", () => {
    expect(() =>
      parse("{broken", message("a", "assistant", text("later"))),
    ).toThrow("Invalid Letta transcript record");
  });
  test("only known runtime envelopes are stripped; ordinary Markdown and XML survive", () => {
    const ordinary =
      "# Title\n<example>ordinary XML</example>\n```xml\n<custom>code</custom>\n```";
    const envelopes = [
      "system-reminder",
      "user_timestamp",
      "terminal_file_link_contract",
      "skill_content",
      "task-notification",
    ]
      .map((tag) => `<${tag} source="runtime">private runtime</${tag}>`)
      .join("\n");
    expect(stripLettaRuntimeContext(envelopes + "\n" + ordinary)).toBe(
      ordinary,
    );
    expect(parse(message("u", "user", text(envelopes))).turns).toEqual([]);
  });
  test("system, compaction and provider context never become chat", () => {
    expect(
      parse(
        message("s", "system", text("hidden")),
        JSON.stringify({ type: "compaction", summary: "hidden" }),
        JSON.stringify({ type: "model_change", model: "hidden" }),
      ).turns,
    ).toEqual([]);
  });
  test("pure runtime users do not split assistant work", () => {
    expect(
      parse(
        message("a", "assistant", text("first")),
        message(
          "runtime",
          "user",
          text("<system-reminder>hidden</system-reminder>"),
        ),
        message("b", "assistant", text("last")),
      ).turns,
    ).toHaveLength(1);
  });
  test("tool results pair only by exact call ID, including revised snapshots", () => {
    const answer = parse(
      message("a", "assistant", [
        {
          type: "toolCall",
          id: "call-a",
          name: "Bash",
          arguments: { command: "true" },
        },
        { type: "toolCall", id: "call-b", name: "Read", arguments: {} },
      ]),
      message("wrong", "toolResult", text("wrong"), { toolCallId: "call" }),
      message("result", "toolResult", text("old"), { toolCallId: "call-a" }),
      message("result", "toolResult", text("actual"), {
        toolCallId: "call-a",
        isError: true,
      }),
    );
    expect(answer.turns[0]?.parts).toMatchObject([
      { kind: "tool", name: "Bash", output: "actual", error: true },
      { kind: "tool", name: "Read", output: "" },
    ]);
    expect(JSON.stringify(answer)).not.toContain("call-a");
  });
  test("duplicate native tool IDs fail closed", () => {
    expect(() =>
      parse(
        message("a", "assistant", [
          { type: "toolCall", id: "same", name: "one" },
          { type: "toolCall", id: "same", name: "two" },
        ]),
      ),
    ).toThrow("Ambiguous Letta tool call");
  });
  test("native empty-content errors remain visible, quoted warnings are ordinary text", () => {
    const answer = parse(
      message("a", "assistant", [], {
        stopReason: "error",
        errorMessage: "Actual runtime failure",
      }),
      message("u", "user", text("continue")),
      message("b", "assistant", text('Quoted: "errorMessage: warning"'), {
        stopReason: "stop",
      }),
    );
    expect(answer.turns[0]?.parts).toEqual([
      {
        kind: "notice",
        source: "letta-runtime",
        text: "Actual runtime failure",
      },
    ]);
    expect(answer.turns[2]?.parts).toEqual([
      {
        kind: "text",
        text: 'Quoted: "errorMessage: warning"',
        phase: "final_answer",
      },
    ]);
  });
  test("abort and missing error details retain truthful notices", () => {
    expect(
      parse(message("a", "assistant", [], { stopReason: "aborted" })).turns[0]
        ?.parts[0],
    ).toMatchObject({
      kind: "notice",
      text: "Letta generation was interrupted.",
    });
    expect(
      parse(message("a", "assistant", [], { stopReason: "error" })).turns[0]
        ?.parts[0],
    ).toMatchObject({
      kind: "notice",
      text: "Letta runtime failed; details were not recorded.",
    });
  });
  test("images have honest notices, never invented fetch refs", () => {
    const answer = parse(
      message("u", "user", [{ type: "image", data: "not-a-fetch-reference" }]),
    );
    expect(answer.turns[0]?.parts).toEqual([
      {
        kind: "notice",
        source: "letta",
        text: "1 image attachment (preview unavailable)",
      },
    ]);
    expect(JSON.stringify(answer)).not.toContain("not-a-fetch-reference");
  });
  test("model, thinking and timestamps use existing source fields", () => {
    const answer = parse(
      message("a", "assistant", [{ type: "thinking", thinking: "reasoning" }], {
        model: "fixture-model",
        timestamp: "2026-10-19T00:00:00Z",
      }),
    );
    expect(answer.metadata).toEqual({
      model: "fixture-model",
      reasoning_effort: null,
    });
    expect(answer.turns[0]).toMatchObject({
      ts: "2026-10-19T00:00:00.000Z",
      end_ts: "2026-10-19T00:00:00.000Z",
      parts: [{ kind: "thinking", text: "reasoning" }],
    });
  });
  test("byte and record budgets reject overflow rather than silently claim full history", () => {
    expect(() =>
      parseLettaTranscript(" ".repeat(LETTA_PARSE_BYTES + 1)),
    ).toThrow("byte limit");
    expect(() =>
      parseLettaTranscript("{}\n".repeat(LETTA_PARSE_ENTRIES + 1)),
    ).toThrow("entry limit");
  });
  test("text and tool fields are capped at 16000 characters", () => {
    const answer = parse(
      message("u", "user", text("x".repeat(16001))),
      message("a", "assistant", [
        {
          type: "toolCall",
          id: "c",
          name: "tool",
          arguments: { large: "x".repeat(16001) },
        },
      ]),
      message("r", "toolResult", text("y".repeat(16001)), { toolCallId: "c" }),
    );
    const user = answer.turns[0]!.parts[0]!;
    const tool = answer.turns[1]!.parts[0]!;
    expect(user.kind === "text" && user.text.length).toBe(16000);
    expect(tool.kind === "tool" && tool.input.length).toBe(16000);
    expect(tool.kind === "tool" && tool.output.length).toBe(16000);
  });
});
