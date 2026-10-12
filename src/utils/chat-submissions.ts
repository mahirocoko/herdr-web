import type { IActionTargetIdentity } from '@/types/herdr.ts'
import type { IConversationContribution } from '@/types/conversation.ts'

export interface ISubmissionBaseline {
  sessionKey: string
  frontier: number
  ids: string[]
}

/** Informational evidence only: this record is never a delivery intent. */
export interface IChatSubmission {
  operationId: string
  text: string
  target: IActionTargetIdentity
  generation: string
  submittedAt: string
  baseline: ISubmissionBaseline | null
  phase: 'sending' | 'submitted-awaiting-transcript' | 'rejected' | 'uncertain'
  restored?: boolean
}

export const submissionFailurePhase = (
  error: unknown
): IChatSubmission['phase'] =>
  error &&
  typeof error === 'object' &&
  'outcome' in error &&
  error.outcome === 'rejected'
    ? 'rejected'
    : 'uncertain'

export const sameSubmissionTarget = (
  a: IActionTargetIdentity,
  b: IActionTargetIdentity | null
): boolean =>
  Boolean(
    b &&
    a.paneId === b.paneId &&
    a.terminalId === b.terminalId &&
    a.agentSessionId === b.agentSessionId &&
    a.expectedMode === b.expectedMode
  )

export const submissionBaseline = (
  sessionKey: string | null,
  rows: IConversationContribution[]
): ISubmissionBaseline | null =>
  sessionKey && rows.length
    ? {
        sessionKey,
        frontier: Math.max(...rows.map((row) => row.sequence ?? row.position)),
        ids: rows.map((row) => row.id)
      }
    : null

/** A unique exact native row beyond the frozen frontier corroborates inclusion,
 * not causation or execution. Missing provenance and identical repeats stay unconfirmed.
 */
export const corroboratedSubmission = (
  record: IChatSubmission,
  records: IChatSubmission[],
  target: IActionTargetIdentity | null,
  sessionKey: string | null,
  rows: IConversationContribution[]
): string | null => {
  const baseline = record.baseline
  if (
    record.phase !== 'submitted-awaiting-transcript' ||
    !baseline ||
    !sameSubmissionTarget(record.target, target) ||
    baseline.sessionKey !== sessionKey
  )
    return null
  if (
    records.filter(
      (other) =>
        other.phase !== 'rejected' &&
        other.text === record.text &&
        sameSubmissionTarget(other.target, record.target) &&
        other.baseline?.sessionKey === sessionKey
    ).length !== 1
  )
    return null
  const matches = rows.filter(
    (row) =>
      row.role === 'user' &&
      row.ts !== null &&
      Date.parse(row.ts) >= Date.parse(record.submittedAt) &&
      (row.sequence ?? row.position) > baseline.frontier &&
      !baseline.ids.includes(row.id) &&
      row.parts.length > 0 &&
      row.parts.every((part) => part.kind === 'text' && !part.truncated) &&
      row.parts
        .map((part) => (part.kind === 'text' ? part.text : ''))
        .join('\n\n') === record.text
  )
  return matches.length === 1 ? matches[0].id : null
}

export const submissionLabel = (record: IChatSubmission): string => {
  const label = {
    sending: 'Sending…',
    'submitted-awaiting-transcript':
      'Submitted — awaiting native transcript; execution not confirmed.',
    rejected: 'Rejected — draft retained; not submitted.',
    uncertain:
      'Outcome uncertain — inspect Terminal before sending again. No automatic retry.'
  }[record.phase]
  return record.restored
    ? `${label} Restored informational copy; never replayed.`
    : label
}

export const restoreSubmissions = (raw: string | null): IChatSubmission[] => {
  if (!raw || new TextEncoder().encode(raw).byteLength > 1024 * 1024) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > 128) return []
    return parsed
      .filter((row): row is IChatSubmission => {
        if (!row || typeof row !== 'object') return false
        const target = row.target
        const baseline = row.baseline
        return (
          typeof row.operationId === 'string' &&
          typeof row.text === 'string' &&
          row.text.length <= 65536 &&
          typeof row.generation === 'string' &&
          typeof row.submittedAt === 'string' &&
          [
            'sending',
            'submitted-awaiting-transcript',
            'rejected',
            'uncertain'
          ].includes(row.phase) &&
          target &&
          typeof target.paneId === 'string' &&
          typeof target.terminalId === 'string' &&
          ['agent', 'blocked-agent', 'shell'].includes(target.expectedMode) &&
          (target.agentSessionId === undefined ||
            typeof target.agentSessionId === 'string') &&
          (baseline === null ||
            (baseline &&
              typeof baseline.sessionKey === 'string' &&
              Number.isFinite(baseline.frontier) &&
              Array.isArray(baseline.ids) &&
              baseline.ids.every((id: unknown) => typeof id === 'string')))
        )
      })
      .map((row) => ({
        operationId: row.operationId,
        text: row.text,
        target: {
          paneId: row.target.paneId,
          terminalId: row.target.terminalId,
          expectedMode: row.target.expectedMode,
          ...(row.target.agentSessionId === undefined
            ? {}
            : { agentSessionId: row.target.agentSessionId })
        },
        generation: row.generation,
        submittedAt: row.submittedAt,
        baseline: row.baseline
          ? {
              sessionKey: row.baseline.sessionKey,
              frontier: row.baseline.frontier,
              ids: [...row.baseline.ids]
            }
          : null,
        restored: true,
        phase: row.phase === 'sending' ? 'uncertain' : row.phase
      }))
  } catch {
    return []
  }
}
