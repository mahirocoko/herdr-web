/** Fictional SGR-only unit screens; no native capture or provider session. */
const rule = "─".repeat(30);
const border = `\u001b[90m${rule}\u001b[0m`;
export const nativeDraftScreen = (agent: string, body: string): string => agent === "codex"
  ? `› ${body}\n\u001b[2m  model · /fictional\u001b[0m`
  : agent === "pi" ? `${border}\n${body}\n${border}\n/fictional\nmodel · context`
    : `${border}\n${agent === "omo" ? "❯" : "›"} ${body}\n${border}\nmodel · /fictional`;
