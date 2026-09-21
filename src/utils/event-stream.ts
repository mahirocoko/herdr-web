import type { ISnapshotResult } from '../types/herdr.ts'

export type IServerEventMessage =
  | { type: 'snapshot'; data: ISnapshotResult }
  | { type: 'status'; status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' }

export const parseServerEventMessage = (raw: string): IServerEventMessage | null => {
  if (!raw || typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw.trim())
    if (!parsed || typeof parsed !== 'object') return null

    if (parsed.type === 'snapshot' && parsed.data && typeof parsed.data === 'object') {
      return {
        type: 'snapshot',
        data: parsed.data as ISnapshotResult
      }
    }

    if (
      parsed.type === 'status' &&
      (parsed.status === 'connecting' ||
        parsed.status === 'connected' ||
        parsed.status === 'reconnecting' ||
        parsed.status === 'disconnected')
    ) {
      return {
        type: 'status',
        status: parsed.status
      }
    }

    return null
  } catch {
    return null
  }
}
