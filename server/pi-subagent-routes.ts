import { statSync } from "node:fs";
import { badRequest, jsonResponse } from "./http.ts";
import { HistoryChanged, transcriptPage } from "./conversation.ts";
import { piChildPath, piParentForPane, piSubagentTurns, piTaskId, readPiActivity, type PiParent } from "./pi-subagents.ts";

/** This helper runs only after index.ts's normal HTTP ingress/device gates. */
export async function piSubagentResponse(request: Request, stateDir: string, resolveParent: (pane: string) => Promise<PiParent | null> = piParentForPane): Promise<Response> {
  if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
  const url = new URL(request.url);
  const paneId = url.searchParams.get("pane_id");
  const id = url.searchParams.get("id");
  if (!paneId || !id || !/^[a-f0-9]{64}$/.test(id)) return badRequest("invalid_subagent", "pane_id and opaque child id are required");
  const missing = () => jsonResponse({ error: { code: "subagent_unavailable", message: "This child transcript is not available for the current pane" } }, 404, { "cache-control": "no-store" });
  const unreadable = () => jsonResponse({ error: { code: "subagent_unreadable", message: "This child transcript cannot be read right now" } }, 503, { "cache-control": "no-store" });
  const changed = () => jsonResponse({ error: { code: "subagent_changed", message: "The pane or child identity changed while it was being read" } }, 409, { "cache-control": "no-store" });
  try {
    const parent = await resolveParent(paneId);
    if (!parent) return missing();
    const activity = readPiActivity(parent, stateDir);
    const task = activity.tasks.find((t) => t.id === id);
    const record = [...activity.records.values()].find((r) => piTaskId(parent.path, r.id) === id);
    const path = piChildPath(parent, record?.outputFile);
    if (!task || !path) return missing();
    const before = url.searchParams.get("before");
    let page: ReturnType<typeof transcriptPage>;
    try { page = transcriptPage("pi-transcript", path, before ? { before } : {}); }
    catch (error) { return error instanceof HistoryChanged ? changed() : unreadable(); }
    // Revalidate pane binding and child header after the read, not only before it.
    const fresh = await resolveParent(paneId);
    if (!fresh || fresh.path !== parent.path || fresh.id !== parent.id || piChildPath(fresh, record?.outputFile) !== path) return changed();
    let updatedAt: string | null = null;
    try { updatedAt = new Date(statSync(path).mtimeMs).toISOString(); } catch { return unreadable(); }
    // No raw native session metadata or output/image refs into Main's fetch endpoints.
    const turns = piSubagentTurns(page.turns, path).map((turn) => ({ ...turn, parts: turn.parts.filter((p) => p.kind !== "thinking").map((p) => {
      if (p.kind !== "tool") return p.kind === "image" ? { kind: "text" as const, text: "[image]" } : p;
      const { output_ref: _ref, output_size: _size, images: _images, subagent_id: _child, ...part } = p;
      return part;
    }) }));
    const omittedTurns = page.abandoned?.count ?? 0;
    return jsonResponse({ task, turns, cursor: page.cursor ?? null,
      bounds: { has_earlier: page.cursor !== null, showing_latest: before === null, incomplete: omittedTurns > 0, omitted_turns: omittedTurns },
      freshness: { read_at: new Date().toISOString(), transcript_updated_at: updatedAt, revision: page.version, observer_live: activity.live },
      live: activity.live }, 200, { "cache-control": "no-store" });
  } catch { return missing(); }
}
