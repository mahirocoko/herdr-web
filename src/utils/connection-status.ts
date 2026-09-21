import type { ISnapshotStatus } from '@/types/herdr.ts'

export const getConnectionStatusLabel = (status: ISnapshotStatus): string => {
  switch (status) {
    case 'connected':
      return 'Connected'
    case 'loading':
      return 'Connecting'
    case 'reconnecting':
      return 'Reconnecting'
    case 'error':
      return 'Offline'
    case 'empty':
      return 'Empty'
    default:
      return 'Offline'
  }
}

export const getStatusDotClass = (status: ISnapshotStatus): string => {
  switch (status) {
    case 'connected':
      return 'status-dot--connected'
    case 'reconnecting':
    case 'loading':
      return 'status-dot--reconnecting'
    case 'error':
    case 'empty':
      return 'status-dot--error'
    default:
      return 'status-dot--idle'
  }
}
