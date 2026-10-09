import type { FileViewResult } from '@/types/file-viewer.ts'

export const fileContentUrl = (ref: string, mode?: 'preview' | 'download') => {
  const params = new URLSearchParams({ ref })
  if (mode) params.set(mode, '1')
  return `/api/files/view?${params}`
}
export const openContextFile = async (
  path: string,
  paneId: string,
  signal: AbortSignal,
  offset = 0
): Promise<FileViewResult> => {
  const params = new URLSearchParams({
    path,
    pane_id: paneId,
    offset: String(offset)
  })
  const response = await fetch(`/api/files/view?${params}`, {
    signal,
    cache: 'no-store'
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'File unavailable')
  if (
    Array.isArray(data.candidates) &&
    data.candidates.every((value: unknown) => typeof value === 'string')
  )
    return data
  if (
    typeof data.path !== 'string' ||
    typeof data.name !== 'string' ||
    !['text', 'image', 'video', 'audio', 'pdf', 'binary', 'directory'].includes(
      data.kind
    ) ||
    !Number.isSafeInteger(data.size) ||
    data.size < 0 ||
    (data.kind !== 'directory' && !/^[a-f0-9]{64}$/.test(data.ref))
  )
    throw new Error('Invalid file metadata')
  if (
    data.kind === 'directory' &&
    (!Array.isArray(data.items) ||
      data.items.length > 200 ||
      !data.items.every(
        (item: unknown) =>
          typeof item === 'object' &&
          item !== null &&
          'path' in item &&
          typeof item.path === 'string' &&
          'name' in item &&
          typeof item.name === 'string' &&
          'directory' in item &&
          typeof item.directory === 'boolean'
      ))
  )
    throw new Error('Invalid directory metadata')
  return data
}
export const fileTextPreview = async (ref: string, signal: AbortSignal) => {
  const response = await fetch(fileContentUrl(ref, 'preview'), {
    signal,
    cache: 'no-store'
  })
  if (!response.ok) throw new Error('File changed or unavailable; reopen it')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > 64 * 1024) throw new Error('Invalid text preview envelope')
  // A byte prefix may end inside a Thai/emoji code point; omit only that fragment.
  return new TextDecoder('utf-8').decode(bytes, { stream: true })
}
