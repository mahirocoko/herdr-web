import { afterEach, describe, expect, test } from 'bun:test'
import {
  fetchRepoDiffFile,
  fetchRepoDiffFiles,
  repoDiffQuery
} from '../repo-diff-api.ts'
const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})
describe('pane-bound repo diff service', () => {
  test('encodes literal paths and both revisions without accepting browser cwd', () => {
    const target = {
      repositoryIdentity: 'a'.repeat(64),
      paneId: 'w:p1',
      scope: 'commit' as const,
      base: 'HEAD~1',
      head: 'main',
      path: 'dir/ไทย & ?.txt',
      oldPath: 'old.txt'
    }
    const q = repoDiffQuery(target.paneId, target, target)
    expect(q.get('repository_identity')).toBe(target.repositoryIdentity)
    expect(q.get('path')).toBe(target.path)
    expect(q.get('head')).toBe('main')
    expect(q.has('cwd')).toBe(false)
    expect(
      repoDiffQuery('w:p1', {
        scope: 'workspace',
        base: 'ignored',
        head: 'ignored'
      }).has('base')
    ).toBe(false)
  })
  test('forwards cancellation, no-store and errors without treating failure as empty', async () => {
    const controller = new AbortController()
    let options: RequestInit | undefined,
      url = ''
    globalThis.fetch = (async (input: any, init: any) => {
      url = String(input)
      options = init
      return Response.json(
        { error: { code: 'not_a_repository', message: 'Not a repository' } },
        { status: 409 }
      )
    }) as unknown as typeof fetch
    await expect(
      fetchRepoDiffFiles(
        'w:p1',
        { scope: 'workspace', base: null, head: null },
        controller.signal
      )
    ).rejects.toThrow('Not a repository')
    expect(options?.signal).toBe(controller.signal)
    expect(options?.cache).toBe('no-store')
    expect(url).toContain('/api/workspace/diff/files?')
  })
  test('rejects malformed successful payloads', async () => {
    globalThis.fetch = (async () =>
      Response.json({ files: [] })) as unknown as typeof fetch
    await expect(
      fetchRepoDiffFiles(
        'w:p1',
        { scope: 'staged', base: null, head: null },
        new AbortController().signal
      )
    ).rejects.toThrow('Invalid changes response')
    await expect(
      fetchRepoDiffFile(
        {
          repositoryIdentity: 'a'.repeat(64),
          paneId: 'w:p1',
          scope: 'staged',
          base: null,
          head: null,
          path: 'a',
          oldPath: null
        },
        new AbortController().signal
      )
    ).rejects.toThrow('Invalid changes response')
  })
})
