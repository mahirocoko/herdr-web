import type { IActionTargetIdentity } from '@/types/herdr.ts'

export interface IHeldMessage {
  operationId: string
  heldId?: string
  text: string
  target: IActionTargetIdentity
  state: string
  restored?: boolean
  error?: string
}
const states = [
  'enqueueing',
  'enqueue-unknown',
  'rejected',
  'held',
  'claimed',
  'sending',
  'discarding',
  'consumed',
  'uncertain',
  'discarded',
  'invalidated'
]
const bytes = (text: string) => new TextEncoder().encode(text).byteLength
export const heldProjection = (value: unknown): IHeldMessage | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, any>
  const target = row.target
  if (
    typeof row.operationId !== 'string' ||
    !/^[a-zA-Z0-9_.:-]{1,128}$/.test(row.operationId) ||
    typeof row.text !== 'string' ||
    bytes(row.text) > 4096 ||
    !states.includes(row.state) ||
    (row.heldId !== undefined &&
      (typeof row.heldId !== 'string' || !/^[a-f0-9]{64}$/.test(row.heldId))) ||
    !target ||
    typeof target.paneId !== 'string' ||
    target.paneId.length > 128 ||
    typeof target.terminalId !== 'string' ||
    target.terminalId.length > 128 ||
    target.expectedMode !== 'agent' ||
    (target.agentSessionId !== undefined &&
      (typeof target.agentSessionId !== 'string' ||
        target.agentSessionId.length > 256))
  )
    return null
  return {
    operationId: row.operationId,
    ...(row.heldId ? { heldId: row.heldId } : {}),
    text: row.text,
    target: {
      paneId: target.paneId,
      terminalId: target.terminalId,
      expectedMode: 'agent',
      ...(target.agentSessionId === undefined
        ? {}
        : { agentSessionId: target.agentSessionId })
    },
    state: row.state
  }
}
export const restoreHeldMessages = (raw: string | null): IHeldMessage[] => {
  if (!raw || bytes(raw) > 1024 * 1024) return []
  try {
    const rows: unknown = JSON.parse(raw)
    if (!Array.isArray(rows) || rows.length > 128) return []
    return rows.flatMap((row) => {
      const parsed = heldProjection(row)
      return parsed
        ? [
            {
              ...parsed,
              restored: true,
              state: [
                'enqueueing',
                'claimed',
                'sending',
                'discarding'
              ].includes(parsed.state)
                ? 'uncertain'
                : parsed.state
            }
          ]
        : []
    })
  } catch {
    return []
  }
}
/** Allowlisted informational fields only; capability and runtime authority can never be serialized. */
export const saveHeldMessages = (records: IHeldMessage[]): string => {
  const raw = JSON.stringify(
    records.slice(-128).flatMap((row) => heldProjection(row) ?? [])
  )
  if (bytes(raw) > 1024 * 1024)
    throw new Error('Held evidence exceeds UTF-8 storage bound')
  return raw
}
