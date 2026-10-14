// MIT License - Copyright (c) 2026 devswha
// Adapted from dc2f11de lib/turnChangedFiles, toolVerbs and shared/patch.
import type { ConversationPart } from '@/types/conversation.ts'
import type { IRepoDiffFileList, IRepoDiffTarget } from '@/types/repo-diff.ts'
import { patchText } from './chat-tool-details.ts'

/** Exact edit/write tools only. A successful shell script is not proof it applied a quoted patch. */
export const turnChangedFiles = (
  parts: readonly ConversationPart[]
): string[] => {
  const files = new Set<string>()
  for (const part of parts) {
    if (
      part.kind !== 'tool' ||
      part.error !== false ||
      part.pending ||
      part.inputTruncated ||
      ('arguments_omitted' in part && part.arguments_omitted)
    )
      continue
    if (
      ![
        'edit',
        'multiedit',
        'notebookedit',
        'apply_patch',
        'patch',
        'write'
      ].includes(part.name.toLowerCase())
    )
      continue
    let patch = part.input.trimStart().startsWith('*** Begin Patch')
      ? patchText(part.input)
      : null
    if (patch === null) {
      let args: unknown
      try {
        args = JSON.parse(part.input)
      } catch {
        continue
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) continue
      for (const key of ['file_path', 'notebook_path', 'path']) {
        const path = Reflect.get(args, key)
        if (typeof path === 'string' && path.trim()) files.add(path.trim())
      }
      for (const key of ['patch', 'input']) {
        const value = Reflect.get(args, key)
        if (
          typeof value === 'string' &&
          value.trimStart().startsWith('*** Begin Patch')
        )
          patch = patchText(value)
        if (patch !== null) break
      }
    }
    if (patch !== null && patch.trimEnd().endsWith('*** End Patch')) {
      for (const match of patch.matchAll(
        /^\*\*\* (?:(?:Update|Add|Delete) File|Move to): (.+)$/gm
      )) {
        if (match[1]?.trim()) files.add(match[1].trim())
      }
    }
  }
  return [...files]
}

/** No guessed cwd; absolute paths must be contained by the authorized listing root. */
export const repositoryTurnPath = ({
  path,
  cwd,
  root
}: {
  path: string
  cwd: string | null
  root: string
}): string | null => {
  if (
    path.startsWith('~') ||
    /[\x00-\x1f\x7f\\]/.test(path) ||
    !root.startsWith('/')
  )
    return null
  if (!path.startsWith('/') && !cwd?.startsWith('/')) return null
  const normalize = (value: string) => {
    const segments: string[] = []
    for (const segment of value.split('/')) {
      if (segment === '.' || !segment) continue
      if (segment === '..') segments.pop()
      else segments.push(segment)
    }
    return `/${segments.join('/')}`
  }
  const target = normalize(path.startsWith('/') ? path : `${cwd}/${path}`)
  const prefix = `${normalize(root).replace(/\/$/, '')}/`
  return target.startsWith(prefix) ? target.slice(prefix.length) || null : null
}

export const turnPatchTarget = (
  paneId: string,
  path: string,
  cwd: string | null,
  list: IRepoDiffFileList
): IRepoDiffTarget | null => {
  const relative = repositoryTurnPath({ path, cwd, root: list.repository.root })
  if (!relative) return null
  const file = list.files.find(
    (item) => item.path === relative || item.old_path === relative
  )
  return file
    ? {
        paneId,
        repositoryIdentity: list.repository_identity,
        scope: list.scope,
        base: list.base,
        head: list.head,
        path: file.path,
        oldPath: file.old_path
      }
    : null
}
