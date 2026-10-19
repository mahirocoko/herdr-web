/** What an update brings, read from the CHANGELOG.md and release-summaries.json of the release it installs. */
import { readSummary, RELEASES_LIMIT, type ReleaseNote, type ReleaseSummary, type UpdateNotes } from "../shared/update.ts";

/** `## [0.3.52] - 2026-10-06`; `## [Unreleased]` is no release. */
const SECTION = /^## \[(\d+\.\d+\.\d+)\](?:\s+-\s+(\S+))?\s*$/;
/** `[0.3.52]: https://…`, the compare links under the last section */
/** Where a section ends: the heading of any release (a pre-release, a linked one) or of Unreleased. */
const BOUNDARY = /^## \[(?:unreleased|\d+\.\d+\.\d+[^\]]*)\]/i;
const LINK_DEFINITION = /^\[[^\]]+\]:\s/;
/**
 * Notes are read in a Settings box, not as the whole history: a jump over many releases names
 * the rest by count. Characters, since it bounds what is read, not what is sent.
 */
export const NOTES_BUDGET = 48_000;
/** Where a release tells itself as patch notes, a few short lines per language, beside CHANGELOG.md. */
export const SUMMARIES_FILE = "release-summaries.json";

function triple(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Positive when `a` is the later version. */
function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Positive when `a` is the later version; null when either is not `X.Y.Z`. */
export function compareVersions(a: string, b: string): number | null {
  const first = triple(a), second = triple(b);
  return first && second ? compare(first, second) : null;
}

/**
 * release-summaries.json as a release wrote it:
 * `{ "0.3.53": { "en": { "new": ["…"], "improved": ["…"], "fixed": ["…"] }, "ko": { … }, … } }`.
 * It is text from a Git remote, like the changelog: what is not a version with lines in a
 * language the app has is left out, and a file that is not JSON holds no summary.
 */
export function releaseSummaries(text: string): Map<string, ReleaseSummary> {
  const found = new Map<string, ReleaseSummary>();
  let written: unknown;
  try { written = JSON.parse(text); } catch { return found; }
  if (typeof written !== "object" || written === null || Array.isArray(written)) return found;
  for (const [version, entry] of Object.entries(written)) {
    const summary = triple(version) ? readSummary(entry) : undefined;
    if (summary) found.set(version, summary);
  }
  return found;
}

function sections(changelog: string): ReleaseNote[] {
  const found: ReleaseNote[] = [];
  let open: { version: string; date: string | null; lines: string[] } | null = null;
  const close = () => {
    if (open) found.push({ version: open.version, date: open.date, notes: open.lines.join("\n").trim() });
    open = null;
  };
  for (const line of changelog.split(/\r?\n/)) {
    // a release or Unreleased opens the next section; another level-two heading (`## Migration`,
    // `## [Migration](https://…)`) belongs to the notes
    if (BOUNDARY.test(line)) {
      close();
      const match = SECTION.exec(line);
      if (match) open = { version: match[1]!, date: match[2] ?? null, lines: [] };
    } else if (open && !LINK_DEFINITION.test(line)) open.lines.push(line);
  }
  close();
  return found;
}

/** What a release's summary adds to an answer, as it travels. */
function summarySize(summary: ReleaseSummary | undefined): number {
  return summary ? JSON.stringify(summary).length : 0;
}

/**
 * The sections of every release after `current`, up to `latest`, newest first. With no known
 * running version, the latest release alone. A release without a section, or with an empty one,
 * is left out, and a version the changelog names twice is told once, by its first section. A
 * release named in `summaries` carries its summary; the budget counts the sections and the
 * summaries both, and an answer names at most RELEASES_LIMIT releases: the rest are counted.
 */
export function releaseNotes(
  changelog: string, current: string | null, latest: string, budget = NOTES_BUDGET,
  summaries: ReadonlyMap<string, ReleaseSummary> = new Map(),
): Omit<UpdateNotes, "revision"> {
  const to = triple(latest);
  if (!to) return { releases: [], omitted: 0 };
  const from = current === null ? null : triple(current);
  const seen = new Set<string>();
  const wanted = sections(changelog)
    .filter((section) => {
      const version = triple(section.version)!;
      if (section.notes === "" || compare(version, to) > 0 || seen.has(section.version)) return false;
      seen.add(section.version);
      return from ? compare(version, from) > 0 : compare(version, to) === 0;
    })
    .sort((a, b) => compare(triple(b.version)!, triple(a.version)!))
    .map((section) => {
      const summary = summaries.get(section.version);
      return summary ? { ...section, summary } : section;
    });
  const releases: ReleaseNote[] = [];
  let used = 0;
  for (const section of wanted) {
    const size = section.notes.length + summarySize(section.summary);
    // the newest release is always told, within the budget: its summary first, since that is
    // what tells the release, and its notes cut at a line to the room the summary leaves; a
    // summary that alone is over the budget is left out, and the notes get the budget
    if (releases.length === 0 && size > budget) {
      const { summary: written, ...told } = section;
      const summary = written && summarySize(written) < budget ? written : undefined;
      const room = budget - summarySize(summary);
      const cut = section.notes.lastIndexOf("\n", room);
      const notes = section.notes.length > room ? `${section.notes.slice(0, cut > 0 ? cut : room).trimEnd()}\n\n…` : section.notes;
      releases.push(summary ? { ...told, summary, notes } : { ...told, notes });
      break;
    }
    if (releases.length === RELEASES_LIMIT || used + size > budget) break;
    releases.push(section);
    used += size;
  }
  return { releases, omitted: wanted.length - releases.length };
}
