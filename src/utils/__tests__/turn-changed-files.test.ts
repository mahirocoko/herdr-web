// MIT License - Copyright (c) 2026 devswha
import { describe, expect, it } from 'bun:test'
import {
  repositoryTurnPath,
  turnChangedFiles,
  turnPatchTarget
} from '../turn-changed-files.ts'
import type { ConversationPart } from '@/types/conversation.ts'
import type { IRepoDiffFileList } from '@/types/repo-diff.ts'
const tool = (
  name: string,
  input: string,
  overrides = {}
): ConversationPart => ({
  kind: 'tool',
  id: 'x',
  name,
  input,
  output: 'Edited narrative.ts',
  summary: 'Edited summary.ts',
  error: false,
  pending: false,
  ...overrides
})
describe('turn edit metadata (adapted upstream tests)', () => {
  it('collects only exact successful edit/write calls, deduplicated in order', () => {
    expect(
      turnChangedFiles([
        tool('Read', '{"path":"read.ts"}'),
        tool('Edit', '{"file_path":"a.ts"}'),
        tool('MultiEdit', '{"file_path":"a.ts"}'),
        tool('write', '{"path":"new.md"}'),
        tool('NotebookEdit', '{"notebook_path":"n.ipynb"}'),
        tool('Edit', '{"path":"failed"}', { error: true }),
        tool('mcp__write', '{"path":"unknown"}'),
        { kind: 'text', text: 'Edited prose.md' }
      ])
    ).toEqual(['a.ts', 'new.md', 'n.ipynb'])
  })
  it('rejects pending, unknown success, omitted/truncated arguments and malformed JSON', () => {
    expect(
      turnChangedFiles([
        tool('Edit', '{"path":"a"}', { pending: true }),
        tool('Edit', '{"path":"a"}', { error: undefined }),
        tool('Edit', '{"path":"a"}', { arguments_omitted: true }),
        tool('Edit', '{"path":"a"}', { inputTruncated: true }),
        tool('Edit', '{'),
        tool('Write', 'null'),
        tool('Edit', '{"path":12}'),
        tool('Write', '{"path":"  "}')
      ])
    ).toEqual([])
  })
  it('uses patch file grammar and both sides of moves, not quoted shell narrative', () => {
    const patch =
      '*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n@@\n-a\n+b\n*** Add File: added.ts\n+x\n*** Delete File: deleted.ts\n*** End Patch'
    expect(turnChangedFiles([tool('apply_patch', patch)])).toEqual([
      'old.ts',
      'new.ts',
      'added.ts',
      'deleted.ts'
    ])
    expect(
      turnChangedFiles([tool('apply_patch', JSON.stringify({ patch }))])
    ).toEqual(['old.ts', 'new.ts', 'added.ts', 'deleted.ts'])
    expect(
      turnChangedFiles([
        tool('exec', `await tools.apply_patch(${JSON.stringify(patch)})`),
        tool('apply_patch', patch.replace('*** End Patch', ''))
      ])
    ).toEqual([])
  })
})
describe('current authorized repository mapping', () => {
  it('contains absolute/relative paths and refuses missing base, siblings, escapes and special paths', () => {
    expect(
      repositoryTurnPath({ path: '/repo/src/a.ts', cwd: null, root: '/repo' })
    ).toBe('src/a.ts')
    expect(
      repositoryTurnPath({ path: '../a.ts', cwd: '/repo/src', root: '/repo' })
    ).toBe('a.ts')
    for (const path of [
      '../outside',
      '/repo-other/a',
      '~/a',
      'a\\b',
      'a\u0000b'
    ])
      expect(
        repositoryTurnPath({ path, cwd: '/repo', root: '/repo' })
      ).toBeNull()
    expect(
      repositoryTurnPath({ path: 'a.ts', cwd: null, root: '/repo' })
    ).toBeNull()
  })
  it('hands through the exact listing fingerprint and rename destination; missing current path has no fabricated target', () => {
    const list: IRepoDiffFileList = {
      repository_identity: 'authorized-fresh',
      repository: {
        root: '/repo',
        branch: null,
        head: null,
        detached: false,
        unborn: true
      },
      scope: 'workspace',
      base: null,
      head: null,
      files: [
        {
          path: 'new.ts',
          old_path: 'old.ts',
          status: 'renamed',
          additions: 1,
          deletions: 1,
          binary: false
        }
      ],
      total: 1,
      truncated: false,
      limits: { max_files: 100, max_list_bytes: 1000 }
    }
    expect(turnPatchTarget('pane', '/repo/old.ts', null, list)).toEqual({
      paneId: 'pane',
      repositoryIdentity: 'authorized-fresh',
      scope: 'workspace',
      base: null,
      head: null,
      path: 'new.ts',
      oldPath: 'old.ts'
    })
    expect(turnPatchTarget('pane', '/repo/gone.ts', null, list)).toBeNull()
  })
})
