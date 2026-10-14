// MIT License - Copyright (c) 2026 devswha
// Strict Pierre parser/style/cache identity adapted from dc2f11de RepoDiff/sourceTheme/repoDiff.
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
export const contentKey = (name: string, text: string) => {
  let hash = 0x811c9dc5
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${name}:${text.length}:${(hash >>> 0).toString(16)}`
}
export const parseRepoPatch = (text: string): FileDiffMetadata | null =>
  parsePatchFiles(text, contentKey('repo-diff', text), true)[0]?.files[0] ??
  null
export const keepEmptyRows = (shadow: ShadowRoot) => {
  for (const span of shadow.querySelectorAll<HTMLElement>('[data-line] > span'))
    if (span.textContent === '' && span.firstElementChild === null)
      span.append(document.createElement('br'))
}
