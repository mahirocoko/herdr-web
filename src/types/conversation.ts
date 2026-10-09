/** Browser-safe projection of provider-native conversation records.
 * Turn/part anatomy follows devswha/herdr-web-ui shared/protocol.ts (MIT).
 * File paths, runtime tokens and raw provider envelopes stay on the server.
 */
export type ConversationPart = { nativeKey?: string } & (
  | {
      kind: 'text'
      text: string
      phase?: 'commentary' | 'final_answer'
      truncated?: boolean
    }
  | { kind: 'thinking'; text: string; truncated?: boolean }
  | {
      kind: 'tool'
      id: string
      name: string
      summary: string
      input: string
      output: string
      error?: boolean
      pending: boolean
      truncated?: boolean
      inputTruncated?: boolean
      /** Opaque recorded-output identity; resolved only with pane + sessionKey. */
      outputRef?: string
      outputRevision?: string
      skill?: ISkillActivity
      outputLength?: number
      outputLengthUnit?: 'utf16-code-units'
      outputUnavailable?: 'limit-exceeded'
      images?: Extract<ConversationPart, { kind: 'image' }>[]
    }
  | {
      kind: 'notice'
      text: string
      source?: 'local-command' | 'letta-runtime'
      severity?: 'warning' | 'error'
      truncated?: boolean
    }
  | { kind: 'compact'; text: string; truncated?: boolean }
  | {
      kind: 'image'
      ref: string
      imageRevision?: string
      media_type: string
      width?: number
      height?: number
    }
  | { kind: 'skill'; skill: ISkillActivity }
  | { kind: 'task_result'; tasks: IOmoTaskResult[] }
)

export interface IOmoTaskResult {
  id: string
  title: string
  agent: string | null
  model: string | null
  status: 'completed' | 'cancelled' | 'failed'
  duration_ms: number | null
  turns: number | null
  tool_calls: number | null
  tokens: number | null
  result: string
  result_cut?: boolean
}
export interface IAbandonedBranches {
  count: number
  branches: number
  summary: string | null
}

export interface ISkillActivity {
  name: string
  path?: string
  evidence: 'instructions' | 'invocation'
  status: 'requested' | 'loaded' | 'failed'
}

export interface IConversationTurn {
  id: string
  role: 'user' | 'assistant'
  ts: string | null
  end_ts?: string
  parts: ConversationPart[]
}

export interface IConversationMetadata {
  model: string | null
  reasoning_effort: string | null
  context?: { used: number; window: number | null }
}

export interface IConversationContribution {
  /** Native message/step identity; replacement snapshots retain this ID. */
  id: string
  nativeRecordId?: string
  messageId?: string
  position: number
  sequence?: number
  immediateTool?: boolean
  endByte?: number
  previousId?: string
  ephemeral?: boolean
  role: 'user' | 'assistant' | 'tool-result' | 'activity' | 'notice'
  ts: string | null
  parts: ConversationPart[]
  model?: string | null
  reasoning_effort?: string | null
  duplicateSource?: 'event' | 'response'
  duplicateKey?: string
  turnStart?: string
  nativeTurnId?: string
  skillEventId?: string
  turnEnd?: boolean
  /** Pi-family stopReason=stop closes this assistant message's work block. */
  closesAssistantTurn?: boolean
  reset?: boolean
  result?: {
    callId?: string
    output: string
    error: boolean
    truncated: boolean
    pairing: 'native-id' | 'previous-single'
    outputRef?: string
    outputRevision?: string
    outputLength?: number
    outputLengthUnit?: 'utf16-code-units'
    outputUnavailable?: 'limit-exceeded'
  }
}

/** Reconcile native snapshots before grouping; positions are byte provenance, not file paths. */
export const reconcileContributions = (
  rows: IConversationContribution[]
): IConversationContribution[] => {
  const latest = new Map<string, IConversationContribution>()
  for (const row of rows) {
    const previous = latest.get(row.id)
    if (!previous || row.position >= previous.position) latest.set(row.id, row)
  }
  const ordered = [...latest.values()]
    .map((row) => ({ ...row, parts: row.parts.map((part) => ({ ...part })) }))
    .sort((a, b) => (a.sequence ?? a.position) - (b.sequence ?? b.position))
  // Codex event/response mirrors can straddle older/live page boundaries.
  // Their full-native-body digest is computed privately before display clipping.
  const messages: IConversationContribution[] = []
  const omitted = new Set<IConversationContribution>()
  const paired = new Set<IConversationContribution>()
  for (const row of ordered) {
    if (!row.duplicateSource || !row.duplicateKey) continue
    const previous = messages
      .slice(-8)
      .reverse()
      .find(
        (other) =>
          !paired.has(other) &&
          other.role === row.role &&
          other.duplicateSource !== row.duplicateSource &&
          other.duplicateKey === row.duplicateKey &&
          (other.ts === row.ts ||
            Math.abs(Date.parse(other.ts ?? '') - Date.parse(row.ts ?? '')) <=
              1000)
      )
    if (!previous) {
      messages.push(row)
      continue
    }
    paired.add(previous)
    omitted.add(row)
    const phase = row.parts.find((part) => part.kind === 'text')?.phase
    if (phase)
      previous.parts = previous.parts.map((part) =>
        part.kind === 'text' ? { ...part, phase } : part
      )
    const images = row.parts.filter((part) => part.kind === 'image')
    if (
      images.length &&
      (row.duplicateSource === 'event' ||
        !previous.parts.some((part) => part.kind === 'image'))
    )
      previous.parts = [
        ...images,
        ...previous.parts.filter((part) => part.kind !== 'image')
      ]
  }
  return ordered.filter((row) => !omitted.has(row))
}

export const groupContributions = (
  rows: IConversationContribution[]
): IConversationTurn[] => {
  const turns: IConversationTurn[] = []
  const tools = new Map<
    string,
    Extract<ConversationPart, { kind: 'tool' }> | null
  >()
  let assistant: IConversationTurn | null = null
  let startedAt: string | undefined
  let activeTurnId: string | undefined
  const skillEvents = new Set<string>()
  let pending: {
    part: Extract<ConversationPart, { kind: 'tool' }>
    owner: string
    endByte?: number
  } | null = null
  const agentTurn = (row: IConversationContribution) => {
    if (!assistant) {
      assistant = {
        id: row.id,
        role: 'assistant',
        ts: startedAt ?? row.ts,
        parts: []
      }
      turns.push(assistant)
    }
    if (row.ts) assistant.end_ts = row.ts
    return assistant
  }
  const prepared = reconcileContributions(rows).map((row) => ({
    ...row,
    parts: row.parts.map((part, index) => ({
      ...part,
      nativeKey:
        part.kind === 'tool' ? `tool:${part.id}` : `${row.id}:part:${index}`
    }))
  }))
  for (const row of prepared)
    for (const part of row.parts) {
      if (part.kind === 'tool')
        tools.set(part.id, tools.has(part.id) ? null : part)
    }
  for (const row of prepared) {
    if (row.turnStart) {
      startedAt = row.turnStart
      activeTurnId = row.nativeTurnId
    }
    if (row.skillEventId) {
      if (
        (activeTurnId &&
          row.nativeTurnId &&
          row.nativeTurnId !== activeTurnId) ||
        skillEvents.has(row.skillEventId)
      )
        continue
      skillEvents.add(row.skillEventId)
      if (skillEvents.size > 512)
        skillEvents.delete(skillEvents.values().next().value!)
    }
    if (row.turnEnd) {
      const active = turns.at(-1)
      if (active?.role === 'assistant' && row.ts) active.end_ts = row.ts
      startedAt = undefined
    }
    if (row.ephemeral) {
      if (pending && pending.endByte === row.position)
        pending.endByte = row.endByte
      continue
    }
    const immediate = pending
    pending = null
    if (row.role === 'user') {
      turns.push({ id: row.id, role: 'user', ts: row.ts, parts: row.parts })
      assistant = null
    } else if (row.role === 'tool-result' && row.result) {
      const result = row.result
      const adjacent =
        immediate &&
        (row.previousId
          ? row.previousId === immediate.owner
          : immediate.endByte === row.position)
      const tool =
        result.pairing === 'native-id'
          ? tools.get(result.callId ?? '')
          : adjacent
            ? immediate.part
            : null
      if (tool) {
        tool.output = result.output
        tool.error = result.error
        tool.truncated = result.truncated
        tool.pending = false
        tool.outputRef = result.outputRef
        tool.outputRevision = result.outputRevision
        if (tool.skill) tool.skill.status = result.error ? 'failed' : 'loaded'
        tool.outputLength = result.outputLength
        tool.outputLengthUnit = result.outputLengthUnit
        tool.outputUnavailable = result.outputUnavailable
        const images = row.parts.filter((part) => part.kind === 'image')
        if (images.length) tool.images = images
        const active = turns[turns.length - 1]
        if (active?.role === 'assistant' && row.ts) active.end_ts = row.ts
      } else {
        agentTurn(row).parts.push({
          kind: 'notice',
          text: `Unpaired tool output${result.truncated ? ' (truncated)' : ''}:\n${result.output}`
        })
        agentTurn(row).parts.push(
          ...row.parts.filter((part) => part.kind === 'image')
        )
      }
    } else if (row.role === 'assistant') {
      const turn = agentTurn(row)
      const calls: Extract<ConversationPart, { kind: 'tool' }>[] = []
      for (const part of row.parts) {
        const clone = part
        if (row.skillEventId && clone.kind === 'skill') {
          const existing = [...turn.parts]
            .reverse()
            .find(
              (previous) =>
                previous.kind === 'tool' &&
                previous.skill?.path === clone.skill.path
            )
          if (existing?.kind === 'tool' && existing.skill) {
            existing.skill.status = clone.skill.status
            continue
          }
        }
        turn.parts.push(clone)
        if (clone.kind === 'tool') {
          calls.push(clone)
        }
      }
      pending =
        row.immediateTool && calls.length === 1
          ? { part: calls[0], owner: row.id, endByte: row.endByte }
          : null
    } else if (row.parts.length) {
      agentTurn(row).parts.push(...row.parts)
    }
    if (row.closesAssistantTurn) assistant = null
  }
  return turns.filter((turn) => turn.parts.length > 0)
}

export interface IConversationToolOutput {
  ok: true
  paneId: string
  sessionKey: string
  ref: string
  outputRevision?: string
  output: string
  length: number
  lengthUnit: 'utf16-code-units'
}

export interface IConversationRead {
  ok: true
  paneId: string
  source:
    | 'letta-transcript'
    | 'agy-transcript'
    | 'codex-transcript'
    | 'claude-transcript'
    | 'omp-transcript'
    | 'omo-transcript'
    | 'gjc-transcript'
    | 'pi-transcript'
  /** Opaque identity changes when the selected native conversation changes. */
  sessionKey: string
  turns: IConversationTurn[]
  contributions?: IConversationContribution[]
  range?: { startByte: number; endByte: number }
  metadata: IConversationMetadata
  truncated: boolean
  /** Opaque, session-bound cursor. Never a caller-selected file path. */
  before: string | null
  abandoned?: IAbandonedBranches
}
