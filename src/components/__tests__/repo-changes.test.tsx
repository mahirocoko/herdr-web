import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  RepoChangeRows,
  RepoChangesTrigger,
  RepoPatchViewer
} from '../repo-changes.tsx'
import {
  fileIconKind,
  STATUS_MARK,
  STATUS_WORD
} from '../repo-change-presentation.tsx'
import { changeTree } from '@/utils/change-tree.ts'
import type { IRepoDiffFile } from '@/types/repo-diff.ts'
describe('Changes canonical reading surface markup', () => {
  test('header entry is discoverable through canonical Button/Dialog trigger', () => {
    const html = renderToStaticMarkup(<RepoChangesTrigger paneId="w:p1" />)
    expect(html).toContain('aria-label="Repository Changes"')
    expect(html).toContain('ui-button--ghost')
    expect(html).toContain('aria-haspopup="dialog"')
  })
  test('reusable opening boundary is pane-bound and labels current versus historical content honestly', () => {
    const html = renderToStaticMarkup(
      <RepoPatchViewer
        target={{
          repositoryIdentity: 'a'.repeat(64),
          paneId: 'w:p1',
          scope: 'commit',
          base: 'a',
          head: 'b',
          path: 'fake<&>.txt',
          oldPath: null
        }}
        onBack={() => {}}
      />
    )
    expect(html).toContain('fake&lt;&amp;&gt;.txt')
    expect(html).toContain('Copy path')
    expect(html).toContain('Copy patch')
    expect(html).toContain('Open current file')
    expect(html).toContain('not a historical blob')
    expect(html).not.toContain('Split view is not available yet')
    expect(html).toContain('Custom Git attributes')
    expect(html).toContain('Loading patch')
    expect(html).toContain('repo-diff-header')
    expect(html).toContain('repo-diff-meta')
    expect(html).toContain('repo-segmented repo-diff-styles')
    expect(html).toContain('aria-label="Fold context"')
    expect(html).toContain('aria-label="Wrap lines"')
  })
  test('source rows align folders and file-kind glyphs with status chips and counts', () => {
    const files: IRepoDiffFile[] = [
      {
        path: 'src/new.tsx',
        old_path: null,
        status: 'untracked',
        additions: 12,
        deletions: 0,
        binary: false
      },
      {
        path: 'src/renamed.json',
        old_path: 'src/old.json',
        status: 'renamed',
        additions: 3,
        deletions: 2,
        binary: false
      },
      {
        path: 'src/deleted.png',
        old_path: null,
        status: 'deleted',
        additions: null,
        deletions: null,
        binary: true
      }
    ]
    const html = renderToStaticMarkup(
      <ul>
        <RepoChangeRows
          entries={changeTree(files.map((file) => file.path))}
          files={files}
          folded={new Set()}
          onToggle={() => {}}
          onOpen={() => {}}
        />
      </ul>
    )
    expect(html).toContain('repo-change-caret')
    expect(html).toContain('repo-change-folder-count')
    expect(html).toContain('--depth:1')
    expect(html).toContain('data-status="untracked" aria-hidden="true">?')
    expect(html).toContain('Untracked')
    expect(html).toContain('data-kind="code"')
    expect(html).toContain('data-kind="json"')
    expect(html).toContain('data-kind="image"')
    expect(html).toContain('Renamed from src/old.json')
    expect(html).toContain('old.json →')
    expect(html).toContain('repo-change-added">+12')
    expect(html).toContain('repo-change-deleted">−2')
    expect(html).toContain('Binary')
    expect(html).not.toContain('+?')
  })
  test('complete source file-name overrides and all Git status words remain available', () => {
    expect(fileIconKind('pnpm-lock.yaml')).toBe('lock')
    expect(fileIconKind('Dockerfile.dev')).toBe('config')
    expect(fileIconKind('.env.local')).toBe('config')
    expect(fileIconKind('a.WASM')).toBe('binary')
    expect(fileIconKind('LICENSE')).toBe('text')
    expect(Object.values(STATUS_MARK)).toEqual([
      'A',
      'D',
      'M',
      'R',
      'C',
      'T',
      'U',
      '?'
    ])
    expect(STATUS_WORD.unmerged).toBe('Conflict')
  })
})
