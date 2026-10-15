import type { ISnapshotStatus } from '../types/herdr.ts'

// Presentation of existing read state only; not daemon, schema or owner auth proof.
export const snapshotReadNotice = (
  status: ISnapshotStatus,
  error: string | null
): string | null => {
  if (status === 'error')
    return `Herdr snapshot unavailable${error ? `: ${error}.` : '.'} Check that Herdr and the Web server are running, then refresh snapshot.`
  if (status === 'reconnecting')
    return `Snapshot refresh pending — displayed selection may be out of date.${error ? ` Last read: ${error}` : ''} Refresh snapshot to inspect current panes.`
  if (status === 'empty')
    return 'No active Herdr Spaces or panes found. Open a Space in Herdr, then refresh snapshot, or create a New Space here.'
  return null
}

export const promptReadNotice = (
  unknown: boolean,
  error: string | null
): string =>
  unknown
    ? 'Answer outcome unknown. Inspect Terminal before re-reading; Send remains unavailable until current prompt evidence is read.'
    : error
      ? `Current prompt unavailable: ${error} Send remains unavailable. Inspect Terminal or re-read the prompt.`
      : 'Reading current prompt… Send waits for current pane evidence.'
