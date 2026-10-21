import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, CircleDot, CircleCheck, CircleAlert, CircleSlash, X } from "lucide-react";
import type { ConversationPart, ConversationTurn, OmoTask, PiSubagentResponse } from "../../shared/protocol.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { useT } from "../lib/i18n.ts";
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
    {turn.parts.map((part, at) => part.kind === "text" ? <Markdown key={at}>{part.text}</Markdown>
      : part.kind === "tool" ? <details className={`pi-subagent-tool${part.error ? " is-error" : ""}`} key={at}>
        <summary><span><strong>{part.name}</strong>{part.summary && <span className="pi-subagent-note">{part.summary}</span>}</span>{part.error ? <span className="work-row-failed">{t("failed")}</span> : <ChevronRight aria-hidden="true" />}</summary>
        <div className="pi-subagent-tool-body">
          {part.input && <section><h3>{t("Input")}</h3><PiToolArguments input={part.input} /></section>}
          {part.output && <section className={part.error ? "is-error" : undefined}><h3>{t(part.error ? "Error" : "Output")}</h3><pre className="chat-tool-io"><code>{part.output}</code></pre></section>}
        </div>
      </details> : part.kind === "notice" || part.kind === "compact" ? <aside className="pi-subagent-notice" key={at}><Markdown>{part.text}</Markdown></aside> : null)}
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
  const [detail, setDetail] = useState<PiSubagentResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [before, setBefore] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
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
    setDetail(null); setCursor(null); setFailed(false);
    if (!pageVisible) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        if (selected) {
          const next = await api.fetchPiSubagent(paneId, selected, before);
          if (!alive) return;
          setDetail(next);
          setCursor(next.cursor);
        } else {
          const next = await api.fetchPaneOmoActivity(paneId);
          if (!alive) return;
          setTasks(next.tasks.filter((task) => task.detail_id !== undefined));
        }
        setFailed(false);
      } catch { if (alive) setFailed(true); }
      if (alive && before === undefined) timer = setTimeout(() => void read(), 2000);
    };
    void read();
    return () => { alive = false; clearTimeout(timer); };
  }, [paneId, selected, before, api, pageVisible]);
  const choose = (next: string | undefined) => { setBefore(undefined); setSelected(next); };
  const turns = detail?.turns ?? [];
  return createPortal(<div className="modal-scrim pi-subagent-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={surface} className="modal pi-subagent-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
      <header className="modal-header">
        {selected && <button type="button" className="icon-button" aria-label={t("Back to subagents")} onClick={() => choose(undefined)}><ArrowLeft aria-hidden="true" /></button>}
        <h2 className="modal-title" id={`${id}-title`}>{detail?.task.title ?? t("Pi subagents")}</h2>
        <button type="button" ref={close} className="icon-button" aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      <div className="modal-body pi-subagent-body">
        <p className="pi-subagent-note">{t("Read-only · updates from recorded activity")}</p>
        {failed && <p role="status">{t("Couldn't refresh subagents. Previously read activity may be out of date.")}</p>}
        {!failed && (selected ? detail === null : tasks === null) && <p role="status">{t("Loading…")}</p>}
        {!selected && tasks !== null && <ul className="pi-subagent-list" role="list">{tasks.map((task) => <li key={task.id}>
          <button type="button" className="pi-subagent-row" onClick={() => choose(task.detail_id)}>
            <span><strong>{task.title}</strong><span className="pi-subagent-note">{task.category} · {piTaskWord(task, t)}</span></span><ChevronRight aria-hidden="true" />
          </button>
        </li>)}</ul>}
        {!selected && tasks?.length === 0 && <p>{t("No background tasks to show yet")}</p>}
        {selected && detail !== null && <>
          <p className="pi-subagent-note">{detail.task.category} · {piTaskWord(detail.task, t)}</p>
          {detail.task.phase === "unknown" && <p className="pi-subagent-note">{t("Live status unavailable. This transcript does not prove the agent is still running.")}</p>}
          <div className="pi-subagent-pages">
            {cursor && <button type="button" className="btn" onClick={() => setBefore(cursor)}>{t("Load earlier activity")}</button>}
            {before && <button type="button" className="btn" onClick={() => setBefore(undefined)}>{t("Latest activity")}</button>}
          </div>
          <PiSubagentTranscript turns={turns} category={detail.task.category ?? "subagent"} />
          {turns.length === 0 && <p>{t("No recorded activity yet")}</p>}
        </>}
      </div>
    </div>
  </div>, document.body);
}
