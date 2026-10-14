// MIT License - Copyright (c) 2026 devswha
// Adapted dc2f11de src/lib/changeTree.test.ts.
import { describe, expect, test } from 'bun:test'
import { changeTree, type ChangeTreeEntry } from '../change-tree.ts'
const outline = (entries: readonly ChangeTreeEntry[]): unknown[] =>
  entries.map((entry) =>
    entry.kind === 'file'
      ? entry.name
      : { [`${entry.name}/`]: outline(entry.entries) }
  )
describe('changed file folder anatomy', () => {
  test('root paths retain source indices', () => {
    expect(changeTree([])).toEqual([])
    expect(changeTree(['a.txt', 'b.txt'])).toEqual([
      { kind: 'file', path: 'a.txt', name: 'a.txt', depth: 0, index: 0 },
      { kind: 'file', path: 'b.txt', name: 'b.txt', depth: 0, index: 1 }
    ])
  })
  test('folders remain at first appearance with files in listing order', () => {
    const tree = changeTree([
      'assets/pic.bin',
      'docs/new.md',
      'src/a.ts',
      'root.txt',
      'src/b.ts',
      'docs/other.md'
    ])
    expect(outline(tree)).toEqual([
      { 'assets/': ['pic.bin'] },
      { 'docs/': ['new.md', 'other.md'] },
      { 'src/': ['a.ts', 'b.ts'] },
      'root.txt'
    ])
  })
  test('single-folder chains compact without losing fold identity or counts', () => {
    const tree = changeTree([
      'apps/web/src/diffs/Tree.tsx',
      'apps/web/src/diffs/logic.ts',
      'apps/web/src/main.tsx',
      'apps/web/fake.txt'
    ])
    expect(outline(tree)).toEqual([
      {
        'apps/web/': [
          { 'src/': [{ 'diffs/': ['Tree.tsx', 'logic.ts'] }, 'main.tsx'] },
          'fake.txt'
        ]
      }
    ])
    expect(tree[0]).toMatchObject({
      kind: 'folder',
      path: 'apps/web',
      depth: 0,
      files: 4
    })
  })
  test('a file breaks a compact chain and Unicode is preserved', () => {
    expect(outline(changeTree(['ไทย/b/c.ts', 'ไทย/d.ts']))).toEqual([
      { 'ไทย/': [{ 'b/': ['c.ts'] }, 'd.ts'] }
    ])
  })
})
