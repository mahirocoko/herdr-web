/**
 * Positive native-composer draft evidence, adapted from upstream shared/input-row.ts at
 * 47e89c00 (#3732), e9d89f3d (#3773) and 4c76778a (#3775). This is not a readiness
 * recognizer: an unknown box, theme or colourless read must retain the existing send path.
 * Only Pi/OmO, Codex and Letta's recorded shapes are included; Claude/Hermes keep their guards.
 */
export const AGENT_INPUT_DRAFT_MESSAGE = "The agent's input box in the terminal holds typed text; send or clear it there, then send this message";

interface ScreenCell {
  char: string;
  dim: boolean;
  italic: boolean;
  inverse: boolean;
  fgDefault: boolean;
}
interface ScreenRow {
  text: string;
  cells: readonly ScreenCell[];
}
export interface DraftScreen {
  rows: readonly ScreenRow[];
  styled: boolean;
}
const RULE = /^─{10,}$/;
const blank = (cell: ScreenCell): boolean => cell.char.trim() === "";
const filled = (screen: DraftScreen): number[] => screen.rows.flatMap((row, index) => row.text.trim() === "" ? [] : [index]);
const BOX_MAX_ROWS = 8;

/** Codex's picker/field hints are not its message composer. */
const CODEX_HINT = /\besc (?:to )?(back|cancel|close|exit|dismiss)\b|\bq close\b|\benter (?:to )?(select|submit|save|continue|open|resume|confirm)\b/;
function codexCells(screen: DraftScreen): readonly ScreenCell[] {
  const rows = filled(screen);
  // A leading number can be the user's list, not a picker. Only independent menu evidence
  // (the inverse selection mark or the hints below) excludes it.
  const at = rows.filter((index) => /^[›»](?: |$)/.test(screen.rows[index]!.text)).at(-1);
  if (at === undefined || screen.rows[at]!.cells[0]?.inverse) return [];
  const below = rows.filter((index) => index > at);
  if (below.some((index) => CODEX_HINT.test(screen.rows[index]!.text) || /^[↑↓]$/.test(screen.rows[index]!.text.trim()))) return [];
  // The model/folder footer proves this is a composer, not a history message. The shortcut
  // hint remains under an empty placeholder, but leaves while the composer holds typed text.
  if (below.length === 0 || below.slice(0, 4).some((index) => screen.rows[index]!.text.includes("? for"))) return [];
  const cells = screen.rows[at]!.cells.slice(2);
  // A multiline draft continues indented below the marked row. The final filled row is
  // the model/folder footer, never draft evidence even when it uses the default foreground.
  const footer = below.at(-1)!;
  for (let index = at + 1; index < footer && index <= at + BOX_MAX_ROWS; index++) {
    const row = screen.rows[index]!;
    if (!row.text.startsWith("  ") || row.cells.some((cell) => !blank(cell) && !cell.fgDefault)) break;
    cells.push(...row.cells);
  }
  return cells;
}

function piCells(screen: DraftScreen): readonly ScreenCell[] {
  const rows = filled(screen);
  const rules = rows.filter((index) => RULE.test(screen.rows[index]!.text));
  const lower = rules.at(-1), upper = rules.at(-2);
  if (lower === undefined || upper === undefined) return [];
  const footer = rows.filter((index) => index > lower);
  if (footer.length < 1 || footer.length > 3 || footer.some((index) => /^\s*→ /.test(screen.rows[index]!.text))) return [];
  const inner = screen.rows.slice(upper + 1, lower);
  // #3773: quoted > and arrow rows in the default foreground can be the user's draft.
  // Only Pi's coloured select cursor plus search field identifies the dialog instead.
  const dialog = inner.some((row) => {
    const at = /^\s*→ /.exec(row.text)?.[0].indexOf("→") ?? -1;
    return at >= 0 && row.cells[at]?.fgDefault === false;
  }) && inner.some((row) => /^\s*>(?: |$)/.test(row.text));
  // A bare search mark alone is not draft evidence; a blank Markdown quote among other
  // typed rows must not suppress the whole draft.
  if (dialog || inner.length === 0 || inner.length > 6 || inner.every((row) => row.text.trim() === "" || row.text.trim() === ">")) return [];
  return inner.flatMap((row) => row.cells);
}

/** Letta (and OmO): only a whole bordered box, including quoted rows starting with its mark. */
function borderedCells(screen: DraftScreen, mark: RegExp): readonly ScreenCell[] | null {
  const rows = filled(screen);
  for (let position = rows.length - 1; position >= 1; position--) {
    const index = rows[position]!;
    const found = mark.exec(screen.rows[index]!.text);
    if (!found || !RULE.test(screen.rows[rows[position - 1]!]!.text)) continue;
    const end = rows.slice(position + 1, position + 1 + BOX_MAX_ROWS).find((row) => RULE.test(screen.rows[row]!.text));
    if (end === undefined || end - index > BOX_MAX_ROWS) return null;
    return [screen.rows[index]!.cells.slice(Array.from(found[0]).length), ...screen.rows.slice(index + 1, end).map((row) => row.cells)].flat();
  }
  return null;
}

export function readsTypedDraft(agent: string | null | undefined): boolean {
  return agent != null && ["pi", "omo", "codex", "letta"].includes(agent);
}

/** Only a visible, default-foreground, non-placeholder character in a positively styled box. */
export function typedDraft(agent: string | null | undefined, screen: DraftScreen): boolean {
  if (!screen.styled || !readsTypedDraft(agent)) return false;
  const omo = borderedCells(screen, /^❯ ?/);
  const cells = agent === "codex" ? codexCells(screen)
    : agent === "letta" ? borderedCells(screen, /^› ?/) ?? []
    : agent === "omo" || omo !== null ? omo ?? [] : piCells(screen);
  return cells.some((cell) => /[^\p{Z}\p{C}]/u.test(cell.char) && cell.fgDefault && !cell.dim && !cell.italic && !cell.inverse);
}

const ESCAPE = /\u001b(?:\[([0-?]*)[ -/]*([@-~])|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
let graphemes: Intl.Segmenter | undefined;
function characters(text: string): string[] {
  if (typeof Intl.Segmenter === "function") graphemes ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return graphemes ? Array.from(graphemes.segment(text), ({ segment }) => segment) : Array.from(text);
}

/** SGR-only pane.read snapshots, not arbitrary cursor-addressed terminal streams. */
export function screenFromAnsi(text: string): DraftScreen {
  let styled = false;
  const rows = text.split("\n").map((line): ScreenRow => {
    const cells: ScreenCell[] = [];
    let dim = false, italic = false, inverse = false, fgDefault = true;
    const draw = (piece: string): void => {
      for (const char of characters(piece.replace(/\r/g, ""))) cells.push({ char, dim, italic, inverse, fgDefault });
    };
    let offset = 0;
    for (const match of line.matchAll(ESCAPE)) {
      draw(line.slice(offset, match.index));
      offset = match.index + match[0].length;
      if (match[2] !== "m") continue;
      const codes = (match[1] || "0").split(";");
      for (let index = 0; index < codes.length; index++) {
        const code = codes[index]!;
        const head = Number(code.split(":")[0] || 0);
        if ([2, 3, 7].includes(head) || (head >= 30 && head <= 38) || (head >= 40 && head <= 48) || (head >= 90 && head <= 97) || (head >= 100 && head <= 107)) styled = true;
        if (head === 38 || head === 48 || head === 58) {
          const span = code.includes(":") ? 0 : codes[index + 1] === "5" ? 2 : codes[index + 1] === "2" ? 4 : 0;
          if (head === 38) fgDefault = false;
          index += span;
        } else if (head === 0) { dim = false; italic = false; inverse = false; fgDefault = true; }
        else if (head === 2) dim = true;
        else if (head === 22) dim = false;
        else if (head === 3) italic = true;
        else if (head === 23) italic = false;
        else if (head === 7) inverse = true;
        else if (head === 27) inverse = false;
        else if (head === 39) fgDefault = true;
        else if ((head >= 30 && head <= 37) || (head >= 90 && head <= 97)) fgDefault = false;
      }
    }
    draw(line.slice(offset));
    return { text: cells.map((cell) => cell.char).join("").trimEnd(), cells };
  });
  return { rows, styled };
}

export const draftScreenText = (text: string): string => screenFromAnsi(text).rows.map((row) => row.text).join("\n").trimEnd();
