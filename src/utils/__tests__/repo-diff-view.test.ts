// MIT License - Copyright (c) 2026 devswha
// Style/cache identity adapted from dc2f11de repoDiff/sourceTheme tests.
import { describe, expect, test } from 'bun:test'
import { diffStyleFor } from '../repo-diff-style.ts'
import { contentKey, parseRepoPatch } from '../repo-diff-view.ts'
import { trimPatchContext } from '@pierre/diffs'
describe('installed parser and responsive diff contract', () => {
  test('a narrow reader is unified without losing desktop preference', () => {
    expect(diffStyleFor('split', true)).toBe('unified')
    expect(diffStyleFor('split', false)).toBe('split')
    expect(diffStyleFor('unified', false)).toBe('unified')
  })
  test('worker keys distinguish equal-length content changes', () => {
    expect(contentKey('a', 'one')).not.toBe(contentKey('a', 'two'))
    expect(contentKey('a', 'one')).toBe(contentKey('a', 'one'))
  })
  test('folding uses package context trim and keeps native hunk line coordinates', () => {
    const patch =
      'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,7 +1,7 @@\n a\n b\n c\n-old\n+new\n d\n e\n f\n'
    const full = parseRepoPatch(patch),
      folded = parseRepoPatch(trimPatchContext(patch, 1))
    expect(full?.hunks[0]?.additionStart).toBe(1)
    expect(folded?.hunks[0]?.additionStart).toBe(3)
    expect(folded?.additionLines).toContain('new\n')
    expect(folded?.deletionLines).toContain('old\n')
  })
  test('unsupported or empty input does not fabricate patch rows', () => {
    expect(parseRepoPatch('')).toBeNull()
  })
})
