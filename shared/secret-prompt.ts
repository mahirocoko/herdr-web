// Match terminal columns rather than JS string length for wrapped secret prompts.
const WIDE = /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{2fffd}\u{30000}-\u{3fffd}\p{Emoji_Presentation}]/u;
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\u200b-\u200f\ufe00-\ufe0f]+$/u;
let graphemes: Intl.Segmenter | undefined;

function displayWidth(text: string): number {
  if (typeof Intl.Segmenter === "function") graphemes ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const clusters = graphemes ? Array.from(graphemes.segment(text), ({ segment }) => segment) : Array.from(text);
  let width = 0;
  for (const cluster of clusters) width += ZERO_WIDTH.test(cluster) ? 0 : WIDE.test(cluster) ? 2 : 1;
  return width;
}

/** Deliberately narrow: prose mentioning passwords must not become an input prompt. */
export function secretPrompt(screen: string, columns = Infinity): string | null {
  const lines = screen.split(/\r?\n/);
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();
  let line = lines.pop()?.trimEnd() ?? "";
  for (;;) {
    const candidate = line.trimStart();
    if (!candidate || candidate.length > 120 || /\?|y\s*\/\s*n/i.test(candidate)) return null;
    if (/^(?:\[sudo\] password for [^:]+|[^\s@]+@[^\s:]+['’]s password|password(?: for [^:]+)?|enter passphrase(?: for key ['’][^\r\n]+['’])?|enter pin(?: for [^:]+)?|(?:repeat|verify|confirm) password):$/i.test(candidate)) return candidate;
    // herdr's screen-diff stream does not preserve xterm's soft-wrap flags. Only
    // continue a row that reached the right edge (a final space can be trimmed).
    const previous = lines.pop()?.trimEnd();
    const width = previous ? displayWidth(previous) : 0;
    if (!previous || width < columns - 1 || width > columns) return null;
    // Keep a continuation's leading space; a wide character may leave a blank last cell.
    line = previous + " ".repeat(columns - width) + line;
  }
}

// A heuristic for terminal drafts, not a guarantee that every credential is recognized.
const KEY_SHAPES = [
  /(?:^|[^A-Za-z0-9])(?:sk|rk)[-_][A-Za-z0-9_-]{4,}/,
  /(?:^|[^A-Za-z0-9])(?:gh[pousr]_|github_pat_|glpat-|xox[abposr]-|hf_|gsk_|r8_|xai-|npm_|pypi-)[A-Za-z0-9_-]{4,}/,
  /(?:^|[^A-Za-z0-9])AIza[A-Za-z0-9_-]{4,}/,
  /(?:^|[^A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{4,}/,
  /(?:^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function looksLikeKey(text: string): boolean {
  if (KEY_SHAPES.some((shape) => shape.test(text))) return true;
  return (text.match(/[A-Za-z0-9/+_]{24,}/g) ?? []).some((run) => /[a-z]/.test(run) && /[A-Z]/.test(run) && !/[a-z]{8}/.test(run)
    && (!run.includes("/") || run.length === 40) && (/\d/.test(run) || run.length >= 40));
}

/** A secret is one line of literal keystrokes; never allow terminal controls. */
export function validSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f-\x9f]/.test(value);
}
