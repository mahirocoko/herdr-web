import type { HerdrPane } from "../shared/protocol.ts";
import { samePendingIdentity, type PendingIdentity } from "./pending-input.ts";

const WARNING =
  "⚠ Interrupted – tell the agent what to do differently. Something went wrong? Use /feedback to report issues.";
const PROCESSING = /\(esc to interrupt[^)]*\)|✦\s*thinking/i;
const RULE = /^\s*─{8,}\s*$/;
const LIFE_MS = 30_000;

export interface LettaStopContext {
  pane: HerdrPane;
  identity: PendingIdentity;
  screen: string;
  generation: number;
}

/** A compatibility witness for one local Stop, NOT a native completion event. */
export interface LettaStopTicket<Owner, Lease> {
  owner: Owner;
  paneId: string;
  lease: Lease;
  identity: PendingIdentity;
  scope: unknown;
  revision: number;
  generation: number;
  prefix: string;
  expires: number;
  phase: "waiting" | "ready" | "claimed";
  activity: number;
}

function lines(screen: string): string[] {
  return screen
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd());
}
function nativeProcessing(screen: string): boolean {
  // An interrupt affordance is live even if a supported layout puts it below the box.
  if (/\(esc to interrupt[^)]*\)/i.test(screen)) return true;
  const rows = lines(screen);
  for (let index = rows.length - 1; index >= 0; index--) {
    if (!RULE.test(rows[index]!)) continue;
    // The owned statusline below the composer keeps its llm_start activity badge
    // for 30 seconds. It is not native processing or completion authority.
    return PROCESSING.test(rows.slice(0, index + 1).join("\n"));
  }
  return PROCESSING.test(screen);
}
function transcript(text: string): string {
  return text.trimEnd().replace(/\n\s*\n/g, "\n\n");
}
function childrenAbsent(pane: HerdrPane): boolean {
  // Missing metadata is unknown, never zero. These are native canonical counters.
  return (
    pane.tokens?.["subagents"] === "0" &&
    pane.tokens?.["subagents_running"] === "0"
  );
}
function bound(context: LettaStopContext): boolean {
  return (
    context.identity.agent === "letta" &&
    context.pane.agent_status === "working" &&
    context.identity.processPid != null &&
    context.identity.processBirth != null &&
    typeof context.pane.tokens?.["letta_scope"] === "string" &&
    childrenAbsent(context.pane)
  );
}
function composer(screen: string, draft: string): { prefix: string } | null {
  const rows = lines(screen);
  let bottom = -1,
    top = -1;
  for (let index = rows.length - 1; index >= 0; index--) {
    if (!RULE.test(rows[index]!)) continue;
    if (bottom < 0) bottom = index;
    else {
      top = index;
      break;
    }
  }
  if (bottom < 2) return null;
  if (
    top < 0 ||
    rows
      .slice(top + 1, bottom)
      .join("\n")
      .trim() !== `›${draft ? ` ${draft}` : ""}`
  )
    return null;
  const status = rows.slice(0, top).join("\n").trimEnd();
  // Only the final standalone terminal-status paragraph, immediately above the box.
  const paragraphs = status.split(/\n\s*\n/);
  if (
    paragraphs
      .at(-1)
      ?.split("\n")
      .map((line) => line.trim())
      .join(" ") !== WARNING
  )
    return null;
  return { prefix: transcript(paragraphs.slice(0, -1).join("\n\n")) };
}

/** No queue and no write authority: callers still use the existing live input guards. */
export class LettaStops<Owner, Lease> {
  private readonly tickets = new Map<string, LettaStopTicket<Owner, Lease>>();
  private readonly epochs = new Map<string, number>();
  private serial = 0;
  constructor(private readonly now: () => number = Date.now) {}

  epoch(paneId: string): number {
    return this.epochs.get(paneId) ?? 0;
  }
  invalidate(paneId: string): void {
    this.tickets.delete(paneId);
    this.epochs.set(paneId, ++this.serial);
    if (this.epochs.size > 256)
      this.epochs.delete(this.epochs.keys().next().value!);
  }
  ownerLeft(owner: Owner, paneId?: string): void {
    for (const [pane, ticket] of this.tickets)
      if (ticket.owner === owner && (paneId === undefined || pane === paneId))
        this.invalidate(pane);
  }
  /** Output after a stable warning revokes it, even when the next read looks identical. */
  output(paneId: string): void {
    const ticket = this.tickets.get(paneId);
    if (!ticket) return;
    ticket.activity++;
    if (ticket.phase === "ready") this.invalidate(paneId);
  }
  begin(
    owner: Owner,
    paneId: string,
    lease: Lease,
    context: LettaStopContext,
    epoch = this.epoch(paneId),
  ): LettaStopTicket<Owner, Lease> | null {
    if (this.epoch(paneId) !== epoch) return null;
    this.invalidate(paneId);
    if (!bound(context) || !nativeProcessing(context.screen)) return null;
    const rows = lines(context.screen);
    let processing = -1,
      prompt = -1;
    for (let index = rows.length - 1; index >= 0; index--) {
      if (/\(esc to interrupt[^)]*\)/i.test(rows[index]!)) {
        processing = index;
        break;
      }
    }
    for (let index = processing - 1; index >= 0; index--) {
      if (/^›\s+\S/.test(rows[index]!)) {
        prompt = index;
        break;
      }
    }
    // Historical warnings above the current prompt are part of the bound transcript,
    // not this turn's terminal status. A warning already in this turn cannot be fresh.
    if (
      prompt < 0 ||
      rows
        .slice(prompt, processing)
        .join(" ")
        .replace(/\s+/g, " ")
        .includes(WARNING)
    )
      return null;
    const ticket: LettaStopTicket<Owner, Lease> = {
      owner,
      paneId,
      lease,
      identity: { ...context.identity },
      scope: context.pane.tokens?.["letta_scope"],
      revision: context.pane.revision,
      generation: context.generation,
      prefix: transcript(rows.slice(0, processing).join("\n")),
      expires: this.now() + LIFE_MS,
      phase: "waiting",
      activity: 0,
    };
    this.tickets.set(paneId, ticket);
    return ticket;
  }
  forget(ticket: LettaStopTicket<Owner, Lease>): void {
    if (this.tickets.get(ticket.paneId) === ticket)
      this.invalidate(ticket.paneId);
  }
  expire(): void {
    for (const ticket of this.tickets.values()) this.current(ticket);
  }
  current(ticket: LettaStopTicket<Owner, Lease>): boolean {
    if (this.tickets.get(ticket.paneId) !== ticket) return false;
    if (this.now() >= ticket.expires) {
      this.forget(ticket);
      return false;
    }
    return true;
  }
  waiting(owner: Owner, paneId: string): LettaStopTicket<Owner, Lease> | null {
    const ticket = this.tickets.get(paneId);
    return ticket?.owner === owner &&
      ticket.phase === "waiting" &&
      this.current(ticket)
      ? ticket
      : null;
  }
  matches(
    ticket: LettaStopTicket<Owner, Lease>,
    context: LettaStopContext,
    draft = "",
  ): boolean {
    return (
      this.current(ticket) &&
      context.generation === ticket.generation &&
      bound(context) &&
      samePendingIdentity(ticket.identity, context.identity) &&
      ticket.identity.session === context.identity.session &&
      ticket.scope === context.pane.tokens?.["letta_scope"] &&
      !nativeProcessing(context.screen) &&
      composer(context.screen, draft)?.prefix === ticket.prefix
    );
  }
  arm(
    ticket: LettaStopTicket<Owner, Lease>,
    context: LettaStopContext,
  ): boolean {
    if (ticket.phase !== "waiting" || !this.matches(ticket, context))
      return false;
    ticket.revision = context.pane.revision;
    ticket.phase = "ready";
    return true;
  }
  available(owner: Owner, paneId: string): boolean {
    const ticket = this.tickets.get(paneId);
    return (
      !!ticket &&
      ticket.owner === owner &&
      ticket.phase !== "claimed" &&
      this.current(ticket)
    );
  }
  take(owner: Owner, paneId: string): LettaStopTicket<Owner, Lease> | null {
    const ticket = this.tickets.get(paneId);
    if (
      !ticket ||
      ticket.owner !== owner ||
      ticket.phase !== "ready" ||
      !this.current(ticket)
    )
      return null;
    ticket.phase = "claimed"; // consumed even if a later guard refuses; never reusable
    return ticket;
  }
  valid(
    ticket: LettaStopTicket<Owner, Lease>,
    context: LettaStopContext,
    draft = "",
  ): boolean {
    return (
      ticket.phase === "claimed" &&
      context.pane.revision === ticket.revision &&
      this.matches(ticket, context, draft)
    );
  }
}
