export type FileKind =
  'text' | 'image' | 'video' | 'audio' | 'pdf' | 'binary' | 'directory'
export interface IViewedFile {
  path: string
  name: string
  kind: FileKind
  mime: string
  size: number
  ref?: string
  inlineAllowed?: boolean
  parent?: string
  items?: { path: string; name: string; directory: boolean }[]
  offset?: number
  hasMore?: boolean
}
export type FileViewResult = IViewedFile | { candidates: string[] }
