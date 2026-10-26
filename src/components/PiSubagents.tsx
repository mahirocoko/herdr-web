import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, CircleDot, CircleCheck, CircleAlert, CircleSlash, RefreshCw, X } from "lucide-react";
import type { ConversationPart, ConversationTurn, OmoTask, PiSubagentResponse } from "../../shared/protocol.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { ApiError } from "../lib/api.ts";
import { useT, type Translate } from "../lib/i18n.ts";
import { formatElapsed, taskElapsedMs } from "../lib/omoTasks.ts";
import { nativeModalOver, useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { usePageVisible } from "../lib/visibility.ts";
import { Markdown } from "./Markdown.tsx";
import "./PiSubagents.css";

const PiSubagentContext = createContext<(id?: string) => void>(() => {});
export const usePiSubagentView = () => useContext(PiSubagentContext);
const PiActivityContext = createContext<OmoTask[] | null>(null);
type ToolPart = Extract<ConversationPart, { kind: "tool" }>;

/** Split at the original call, not at the end of the Chat or a folded work block. */
export function piWorkItems(parts: ConversationPart[]): { index: number; calls: ToolPart[]; work: ConversationPart[] }[] {
  const groups: { index: number; calls: ToolPart[]; work: ConversationPart[] }[] = [];
  parts.forEach((part, index) => {
    const call = part.kind === "tool" && part.name === "subagent";
    let group = groups.at(-1);
    if (!group || (group.calls.length > 0) !== call) { group = { index, calls: [], work: [] }; groups.push(group); }
    if (call) group.calls.push(part as ToolPart); else group.work.push(part);
  });
  return groups;
}

export function PiSubagentCard({ part, task }: { part: ToolPart; task?: OmoTask }) {
  const t = useT();
  const open = usePiSubagentView();
  let input: Record<string, unknown> = {};
  try { input = JSON.parse(part.input) ?? {}; } catch { /* Recorded summary is still readable. */ }
  const active = task?.status === "running" && task.phase !== "queued";
  const Icon = task?.status === "completed" ? CircleCheck : task?.status === "cancelled" ? CircleSlash
    : !task || task.phase === "unknown" || task.status === "failed" ? CircleAlert : CircleDot;
  const title = task?.title ?? (typeof input.description === "string" ? input.description : part.summary);
  const category = task?.category ?? (typeof input.subagent_type === "string" ? input.subagent_type : "subagent");
  return <button type="button" className={`pi-subagent-card${active ? " is-active" : ""}`} aria-haspopup="dialog" disabled={!part.subagent_id} onClick={() => open(part.subagent_id)}>
    <Icon className="pi-subagent-status-icon" aria-hidden="true" />
    <span className="pi-subagent-card-main"><strong>{title}</strong><span className="pi-subagent-note">{category} · {task ? piTaskWord(task, t) : t(part.error ? "failed" : "Status unknown")}</span></span>
    <ChevronRight aria-hidden="true" />
  </button>;
}

export function PiSubagentCalls({ parts }: { parts: ToolPart[] }) {
  const tasks = useContext(PiActivityContext);
  const t = useT();
  return <ul className="pi-subagent-calls" role="list" aria-label={t("Pi subagents")}>{parts.map((part, index) =>
    <li key={index}><PiSubagentCard part={part} task={tasks?.find((task) => task.detail_id === part.subagent_id && part.subagent_id !== undefined)} /></li>)}</ul>;
}

export function piTaskWord(task: OmoTask, t: (key: string) => string = (key) => key): string {
  if (task.phase === "unknown") return t("Status unknown");
  if (task.phase === "queued") return t("Queued");
  const words = { running: t("Running"), completed: t("done"), failed: t("failed"), cancelled: t("cancelled"), lost: t("lost") };
  return words[task.status];
}

/** One concise, evidence-only status line for the list and detail views. */
export function piTaskSummary(task: OmoTask, t: Translate, now = Date.now()): string {
  const elapsed = taskElapsedMs(task, now);
  return [
    task.category,
    piTaskWord(task, t),
    task.tool_calls === null ? null : t(task.tool_calls === 1 ? "{n} tool call" : "{n} tool calls", { n: task.tool_calls }),
    elapsed === null ? null : formatElapsed(elapsed),
  ].filter((item) => item !== null && item !== "").join(" · ");
}

type PiDetailFailure = "missing" | "changed" | "offline" | "unreadable" | "error";
function piDetailFailure(error: unknown): PiDetailFailure {
  if (!(error instanceof ApiError)) return "error";
  if (error.code === "machine_offline") return "offline";
  if (error.status === 404) return "missing";
  if (error.status === 409 || error.code === "subagent_changed") return "changed";
  if (error.status === 503 || error.code === "subagent_unreadable") return "unreadable";
  return "error";
}

/** Held by the pane, never a virtualized Chat row: opening details preserves Main's scroll. */
export function PiSubagentProvider({ paneId, visible, enabled = false, children }: { paneId: string | null; visible: boolean; enabled?: boolean; children: ReactNode }) {
  const machineId = useMachineId();
  const { fetchPaneOmoActivity } = useMachineApi();
  const pageVisible = usePageVisible();
  const [activity, setActivity] = useState<{ pane: string; machine: string; tasks: OmoTask[] } | null>(null);
  useEffect(() => {
    setActivity(null);
    if (!enabled || !visible || !pageVisible || paneId === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await fetchPaneOmoActivity(paneId);
        if (alive) setActivity({ pane: paneId, machine: machineId, tasks: next.tasks });
      } catch { if (alive) setActivity(null); /* Stale running paint is not authority. */ }
      if (alive) timer = setTimeout(() => void read(), 2000);
    };
    void read();
    return () => { alive = false; clearTimeout(timer); };
  }, [paneId, machineId, enabled, visible, pageVisible, fetchPaneOmoActivity]);
  const tasks = enabled && visible && pageVisible && activity?.pane === paneId && activity.machine === machineId ? activity.tasks : null;
  const [selection, setSelection] = useState<{ pane: string; machine: string; id?: string } | null>(null);
  const fallbackFocus = useRef<HTMLElement | null>(null);
  const open = useCallback((id?: string) => {
    if (paneId === null) return;
    const pane = document.activeElement?.closest(".terminal-stack");
    fallbackFocus.current = pane?.querySelector<HTMLElement>(".bg-tasks-toggle, .composer-text") ?? null;
    setSelection({ pane: paneId, machine: machineId, id });
  }, [paneId, machineId]);
  const close = useCallback(() => {
    setSelection(null);
    // A virtualized opener may have gone away while the dialog stayed open.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body && !nativeModalOver(null)) fallbackFocus.current?.focus({ preventScroll: true });
    });
  }, []);
  useEffect(() => { setSelection(null); }, [paneId, visible, machineId]);
  return <PiSubagentContext.Provider value={open}><PiActivityContext.Provider value={tasks}>{children}</PiActivityContext.Provider>
    {visible && selection?.pane === paneId && selection.machine === machineId && paneId !== null && <PiSubagentDialog key={paneId} paneId={paneId} initialId={selection.id} onClose={close} />}
  </PiSubagentContext.Provider>;
}

function PiToolArguments({ input }: { input: string }) {
  let value: unknown;
  try { value = JSON.parse(input); } catch { return <pre className="chat-tool-io"><code>{input}</code></pre>; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return <pre className="chat-tool-io"><code>{input}</code></pre>;
  return <dl className="pi-subagent-arguments">{Object.entries(value).map(([key, entry]) => <div key={key}>
    <dt>{key}</dt><dd>{typeof entry === "string" && ["prompt", "description", "task"].includes(key)
      ? <Markdown>{entry}</Markdown> : <pre><code>{typeof entry === "string" ? entry : JSON.stringify(entry, null, 2)}</code></pre>}</dd>
  </div>)}</dl>;
}

/** Same Markdown/code surfaces as Main, without another interactive Chat/composer. */
export function PiSubagentTranscript({ turns, category }: { turns: ConversationTurn[]; category: string }) {
  const t = useT();
  return <div className="pi-subagent-transcript">{turns.map((turn, index) => <article key={`${turn.ts}:${index}`} className={`pi-subagent-turn chat-turn is-${turn.role}`}>
    <header className="pi-subagent-turn-head"><strong>{turn.role === "user" ? t("Task") : category}</strong>{turn.ts && <time dateTime={turn.ts}>{new Date(turn.ts).toLocaleTimeString()}</time>}</header>
    <div className="pi-subagent-turn-body">{turn.parts.map((part, at) => part.kind === "text" ? <div className="pi-subagent-text" key={at}><Markdown>{part.text}</Markdown></div>
      : part.kind === "tool" ? <details className={`pi-subagent-tool${part.error ? " is-error" : ""}`} key={at}>
        <summary><span className="pi-subagent-tool-summary"><strong>{part.name}</strong>{part.summary && <span className="pi-subagent-note">{part.summary}</span>}</span>{part.error ? <span className="work-row-failed">{t("failed")}</span> : <ChevronRight aria-hidden="true" />}</summary>
        <div className="pi-subagent-tool-body">
          {part.input && <section><h3>{t("Input")}</h3><PiToolArguments input={part.input} /></section>}
          {part.output && <section className={part.error ? "is-error" : undefined}><h3>{t(part.error ? "Error" : "Output")}</h3><pre className="chat-tool-io"><code>{part.output}</code></pre></section>}
        </div>
      </details> : part.kind === "notice" || part.kind === "compact" ? <aside className="pi-subagent-notice" key={at}><Markdown>{part.text}</Markdown></aside> : null)}</div>
  </article>)}</div>;
}

function PiSubagentDialog({ paneId, initialId, onClose }: { paneId: string; initialId?: string; onClose: () => void }) {
  const t = useT();
  const api = useMachineApi();
  const pageVisible = usePageVisible();
  const id = useId();
  const close = useRef<HTMLButtonElement>(null);
  const surface = useFocusTrap<HTMLDivElement>(true, { initialFocus: close });
  const [selected, setSelected] = useState(initialId);
  const [tasks, setTasks] = useState<OmoTask[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [detail, setDetail] = useState<PiSubagentResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailure, setDetailFailure] = useState<PiDetailFailure | null>(null);
  const [before, setBefore] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  usePhoneSheetBack(() => { onClose(); });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || nativeModalOver(surface.current)) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose, surface]);

  useEffect(() => {
    if (selected || !pageVisible) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      setListLoading(true);
      try {
        const next = await api.fetchPaneOmoActivity(paneId);
        if (!alive) return;
        setTasks(next.tasks.filter((task) => task.detail_id !== undefined));
        setListFailed(false);
      } catch { if (alive) setListFailed(true); }
      if (alive) { setListLoading(false); timer = setTimeout(() => void read(), 2000); }
    };
    void read();
    return () => { alive = false; clearTimeout(timer); };
  }, [paneId, selected, api, pageVisible]);

  useEffect(() => {
    if (!selected || !pageVisible) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const mine = ++generation.current;
      setDetailLoading(true);
      try {
        const next = await api.fetchPiSubagent(paneId, selected, before);
        if (!alive || mine !== generation.current) return;
        if (next.task.id !== selected || next.task.detail_id !== selected) {
          setDetail(null); setCursor(null); setDetailFailure("changed");
        } else {
          setDetail(next); setCursor(next.cursor); setDetailFailure(null);
        }
      } catch (error) {
        if (!alive || mine !== generation.current) return;
        const failure = piDetailFailure(error);
        if (failure === "missing" || failure === "changed") { setDetail(null); setCursor(null); }
        setDetailFailure(failure);
      } finally {
        if (alive && mine === generation.current) setDetailLoading(false);
      }
      if (alive && before === undefined) timer = setTimeout(() => void read(), 2000);
    };
    void read();
    return () => { alive = false; generation.current += 1; clearTimeout(timer); };
  }, [paneId, selected, before, refresh, api, pageVisible]);

  const choose = (next: string | undefined) => {
    setBefore(undefined); setCursor(null); setDetail(null); setDetailFailure(null); setSelected(next);
  };
  const showEarlier = () => { if (cursor) { setDetail(null); setDetailFailure(null); setBefore(cursor); } };
  const showLatest = () => { setDetail(null); setDetailFailure(null); setBefore(undefined); };
  const turns = detail?.turns ?? [];
  const failureNotes: Record<PiDetailFailure, [string, string]> = {
    missing: [t("This child is no longer available in the current pane"), t("Go back and open it again from the current task list.")],
    changed: [t("The pane or child identity changed"), t("Go back and open the current child again.")],
    offline: [t("This PC is disconnected"), t("Refresh after it reconnects.")],
    unreadable: [t("The recorded activity can't be read right now"), t("Try Refresh in a moment.")],
    error: [t("Couldn't read the recorded activity"), t("Try Refresh. Previously read activity is kept below.")],
  };
  const readAt = detail?.freshness?.read_at ? new Date(detail.freshness.read_at).toLocaleTimeString() : null;
  return createPortal(<div className="modal-scrim pi-subagent-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={surface} className="modal pi-subagent-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={selected ? detailLoading : listLoading} tabIndex={-1}>
      <header className="modal-header">
        {selected && <button type="button" className="icon-button" aria-label={t("Back to subagents")} onClick={() => choose(undefined)}><ArrowLeft aria-hidden="true" /></button>}
        <h2 className="modal-title" id={`${id}-title`}>{detail?.task.title ?? t("Pi subagents")}</h2>
        {selected && <button type="button" className="icon-button" aria-label={t("Refresh")} title={t("Refresh")} disabled={detailLoading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw aria-hidden="true" /></button>}
        <button type="button" ref={close} className="icon-button" aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      <div className="modal-body pi-subagent-body">
        <p className="pi-subagent-note">{t("Read-only · updates from recorded activity")}</p>
        {!selected && listFailed && <p className="pi-subagent-state is-stale" role="status">{t("Couldn't refresh subagents. Previously read activity may be out of date.")}</p>}
        {!selected && listLoading && tasks === null && <p className="pi-subagent-state" role="status">{t("Loading…")}</p>}
        {!selected && listLoading && tasks !== null && <p className="pi-subagent-refresh" role="status">{t("Refreshing…")}</p>}
        {!selected && tasks !== null && <ul className="pi-subagent-list" role="list">{tasks.map((task) => <li key={task.id}>
          <button type="button" className="pi-subagent-row" onClick={() => choose(task.detail_id)}>
            <span><strong>{task.title}</strong><span className="pi-subagent-note">{piTaskSummary(task, t)}</span></span><ChevronRight aria-hidden="true" />
          </button>
        </li>)}</ul>}
        {!selected && tasks?.length === 0 && <p className="pi-subagent-state">{t("No background tasks to show yet")}</p>}
        {selected && detailLoading && detail === null && <p className="pi-subagent-state" role="status">{t("Loading…")}</p>}
        {selected && detailLoading && detail !== null && <p className="pi-subagent-refresh" role="status">{t("Refreshing…")}</p>}
        {selected && detailFailure !== null && <p className={`pi-subagent-state is-${detail === null ? "error" : "stale"}`} role="status">
          <strong>{failureNotes[detailFailure][0]}</strong><span>{detail === null ? failureNotes[detailFailure][1] : t("Showing the last successful read below.")}</span>
        </p>}
        {selected && detail !== null && <>
          <p className="pi-subagent-summary">{piTaskSummary(detail.task, t)}</p>
          <p className="pi-subagent-freshness">{[
            readAt === null ? null : t("Read at {time}", { time: readAt }),
            detail.freshness?.observer_live ? t("Live observer available") : t("Recorded history"),
          ].filter((item) => item !== null).join(" · ")}</p>
          {detail.task.phase === "unknown" && <p className="pi-subagent-state is-stale">{t("Live status unavailable. This transcript does not prove the agent is still running.")}</p>}
          {detail.bounds?.incomplete && <p className="pi-subagent-state is-bounded">{t("{n} recorded turns are outside this branch view.", { n: detail.bounds.omitted_turns })}</p>}
          {detail.bounds?.has_earlier && <p className="pi-subagent-state is-bounded">{t("This is a bounded page. Load earlier activity to continue.")}</p>}
          {!detail.bounds?.showing_latest && <p className="pi-subagent-state is-bounded">{t("Showing an earlier page of recorded activity.")}</p>}
          <div className="pi-subagent-pages">
            {cursor && <button type="button" className="btn" onClick={showEarlier}>{t("Load earlier activity")}</button>}
            {before && <button type="button" className="btn" onClick={showLatest}>{t("Latest activity")}</button>}
          </div>
          <PiSubagentTranscript turns={turns} category={detail.task.category ?? "subagent"} />
          {turns.length === 0 && <p className="pi-subagent-state">{t("No recorded activity yet")}</p>}
        </>}
      </div>
    </div>
  </div>, document.body);
}
