/**
 * The questions an agent asked the user with its question tool, read from the call's recorded
 * arguments: omp's `ask`, OmO's `ask_user_question` (`request_user_input` under a Codex model) and
 * Claude Code's `AskUserQuestion`, and Pi's `questionnaire`. The chat shows a past call as the questions and options it
 * offered instead of their JSON; it is a record, never another way to answer.
 */

export interface AskedOption {
  label: string;
  description: string | null;
  /** what the option would look like (Claude's and omp's `preview`), shown as written */
  preview: string | null;
}

export interface AskedQuestion {
  header: string | null;
  question: string;
  /** more than one option may be picked */
  multi: boolean;
  /** omp's recommended option, by its index */
  recommended: number | null;
  /** none: the question takes a typed answer */
  options: AskedOption[];
}

const ASK_TOOLS: ReadonlySet<string> = new Set(["ask", "ask_user_question", "request_user_input", "AskUserQuestion", "questionnaire"]);

const optionalText = (value: unknown): value is string | null | undefined => value == null || typeof value === "string";

/** A question tool's questions, or null for another tool or arguments not in a shape it asks with. */
export function askedQuestions(tool: string, args: unknown): AskedQuestion[] | null {
  if (!ASK_TOOLS.has(tool) || args === null || typeof args !== "object") return null;
  const questions = (args as Record<string, unknown>)["questions"];
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const asked: AskedQuestion[] = [];
  for (const value of questions) {
    if (value === null || typeof value !== "object") return null;
    const question = value as Record<string, unknown>;
    const prompt = tool === "questionnaire" ? question["prompt"] : question["question"];
    const header = tool === "questionnaire" ? question["label"] : question["header"];
    if (typeof prompt !== "string" || !prompt.trim() || !optionalText(header)) return null;
    const rawOptions = question["options"] ?? [];
    if (!Array.isArray(rawOptions)) return null;
    const options: AskedOption[] = [];
    for (const item of rawOptions) {
      if (item === null || typeof item !== "object") return null;
      const option = item as Record<string, unknown>;
      if (typeof option["label"] !== "string" || !option["label"].trim() || !optionalText(option["description"]) || !optionalText(option["preview"])) return null;
      options.push({ label: option["label"], description: option["description"] || null, preview: option["preview"] || null });
    }
    // Pi adds this choice by default even when it is absent from the tool arguments.
    // Keep the historical record faithful to the choices actually offered in Terminal.
    if (tool === "questionnaire" && question["allowOther"] !== false) {
      options.push({ label: "Type something.", description: null, preview: null });
    }
    const recommended = question["recommended"];
    asked.push({
      header: header || null,
      question: prompt,
      multi: question["multi"] === true || question["multiSelect"] === true,
      recommended: Number.isInteger(recommended) && (recommended as number) >= 0 && (recommended as number) < options.length ? recommended as number : null,
      options,
    });
  }
  return asked;
}
