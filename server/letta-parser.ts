import type {
  ConversationMetadata,
  ConversationPart,
  ConversationTurn,
} from "../shared/protocol.ts";
import { toolSummary } from "./transcript-records.ts";

// A bounded parser building block, not a store reader or input capability.
export const LETTA_PARSE_BYTES = 8 * 1024 * 1024;
export const LETTA_PARSE_ENTRIES = 4096;
const PART_CHARS = 16_000;
const clip = (text: string): string =>
  text.length > PART_CHARS
    ? `${text.slice(0, PART_CHARS - 10)}\n… trimmed`
    : text;

type Message = Record<string, unknown>;
type Tool = Extract<ConversationPart, { kind: "tool" }>;

export function stripLettaRuntimeContext(text: string): string {
  for (const tag of [
    "system-reminder",
    "user_timestamp",
    "terminal_file_link_contract",
    "skill_content",
    "task-notification",
  ]) {
    text = text.replace(
      new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g"),
      "",
    );
  }
  return text.trim();
}

function record(value: unknown): value is Message {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part) =>
        record(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function timestamp(message: Message): string | null {
  const value =
    (record(message.metadata) ? message.metadata.created_at : undefined) ??
    message.timestamp;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Native pi-session-entry snapshots, mapped directly to the source renderer's parts.
 * The caller must supply a bounded, identity-validated window. This does not prove
 * deduplication against snapshots outside that window or establish pagination.
 */
export function parseLettaTranscript(text: string): {
  turns: ConversationTurn[];
  metadata: ConversationMetadata;
} {
  if (Buffer.byteLength(text) > LETTA_PARSE_BYTES)
    throw new Error("Letta parser byte limit exceeded");
  const messages = new Map<string, Message>();
  const lines = text.split("\n");
  let entries = 0;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!;
    if (!line.trim()) continue;
    if (++entries > LETTA_PARSE_ENTRIES)
      throw new Error("Letta parser entry limit exceeded");
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      if (at === lines.length - 1) break; // Only an incomplete append tail may be ignored.
      throw new Error("Invalid Letta transcript record");
    }
    if (
      !record(entry) ||
      entry.type !== "message" ||
      !record(entry.message) ||
      typeof entry.message.id !== "string"
    )
      continue;
    // Updating retains the message's original position, even if its final snapshot
    // is appended after a tool result or after the next message.
    messages.set(entry.message.id, entry.message);
  }

  const turns: ConversationTurn[] = [];
  const tools = new Map<string, Tool>();
  const results = new Map<string, Message>();
  const metadata: ConversationMetadata = {
    model: null,
    reasoning_effort: null,
  };
  let assistant: ConversationTurn | null = null;
  for (const message of messages.values()) {
    if (message.role === "toolResult" && typeof message.toolCallId === "string")
      results.set(message.toolCallId, message);
  }
  for (const message of messages.values()) {
    const ts = timestamp(message);
    if (message.role === "user") {
      const visible = stripLettaRuntimeContext(textContent(message.content));
      const images = Array.isArray(message.content)
        ? message.content.filter(
            (part) => record(part) && part.type === "image",
          ).length
        : 0;
      if (!visible && !images) continue;
      const parts: ConversationPart[] = [];
      if (visible) parts.push({ kind: "text", text: clip(visible) });
      if (images)
        parts.push({
          kind: "notice",
          source: "letta",
          text: `${images} image attachment${images === 1 ? "" : "s"} (preview unavailable)`,
        });
      turns.push({ role: "user", ts, parts });
      assistant = null;
    } else if (message.role === "assistant") {
      if (typeof message.model === "string") metadata.model = message.model;
      if (!assistant) {
        assistant = { role: "assistant", ts, parts: [] };
        turns.push(assistant);
      }
      if (ts) assistant.end_ts = ts;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        const detail =
          typeof message.errorMessage === "string" &&
          message.errorMessage.trim()
            ? message.errorMessage
            : message.stopReason === "error"
              ? "Letta runtime failed; details were not recorded."
              : "Letta generation was interrupted.";
        assistant.parts.push({
          kind: "notice",
          source: "letta-runtime",
          text: clip(detail),
        });
      }
      if (typeof message.content === "string" && message.content.trim())
        assistant.parts.push({ kind: "text", text: clip(message.content) });
      for (const part of Array.isArray(message.content)
        ? message.content
        : []) {
        if (!record(part)) continue;
        if (
          part.type === "text" &&
          typeof part.text === "string" &&
          part.text.trim()
        ) {
          assistant.parts.push({
            kind: "text",
            text: clip(part.text),
            phase:
              message.stopReason === "stop" ? "final_answer" : "commentary",
          });
        } else if (
          part.type === "thinking" &&
          typeof part.thinking === "string" &&
          part.thinking.trim()
        ) {
          assistant.parts.push({ kind: "thinking", text: clip(part.thinking) });
        } else if (
          part.type === "toolCall" &&
          typeof part.id === "string" &&
          typeof part.name === "string"
        ) {
          if (tools.has(part.id)) throw new Error("Ambiguous Letta tool call");
          const input = JSON.stringify(part.arguments ?? {}, null, 2);
          const result = results.get(part.id);
          const tool: Tool = {
            kind: "tool",
            name: part.name,
            summary: toolSummary(
              part.name,
              record(part.arguments) ? part.arguments : {},
            ),
            input: clip(input),
            output: result ? clip(textContent(result.content)) : "",
            ...(result?.isError === true ? { error: true } : {}),
          };
          tools.set(part.id, tool);
          assistant.parts.push(tool);
        }
      }
    }
  }
  return { turns: turns.filter((turn) => turn.parts.length > 0), metadata };
}
