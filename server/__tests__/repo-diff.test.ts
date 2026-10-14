// MIT License - Copyright (c) 2026 devswha
// Synthetic Git cases adapted from dc2f11de server/repo-diff.test.ts.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseRepoPatch } from '../../src/utils/repo-diff-view.ts'
import {
  diffGitEnvironment,
  handleRepoDiffRequest,
  type IRepoDiffOptions
} from '../repo-diff.ts'
let root: string
const git = (...args: string[]) => {
  const result = Bun.spawnSync(
    [
      '/usr/bin/git',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-C',
      root,
      ...args
    ],
    { env: diffGitEnvironment() }
  )
  if (result.exitCode) throw new Error('Synthetic fixture Git failed')
  return result.stdout.toString().trim()
}
const write = (name: string, text: string | Uint8Array) =>
  fs.writeFileSync(path.join(root, name), text)
const snapshot = async () =>
  ({
    panes: [
      {
        pane_id: 'w:p1',
        terminal_id: 't1',
        foreground_cwd: root,
        cwd: '/fake-unused'
      }
    ]
  }) as any
const request = (
  values: Record<string, string> = {},
  headers: Record<string, string> = {}
) =>
  new Request(
    `http://localhost:8787/api/workspace/diff/files?${new URLSearchParams({ pane_id: 'w:p1', ...values })}`,
    { headers: { host: 'localhost:8787', ...headers } }
  )
const read = async (
  values: Record<string, string> = {},
  kind: 'files' | 'file' = 'files',
  options: IRepoDiffOptions = {}
): Promise<{ response: Response; body: any }> => {
  // Ordinary patch fixtures freeze the preceding list, as the browser does.
  if (kind === 'file' && !values.repository_identity) {
    const { path: _path, old_path: _old, ...comparison } = values
    const listed = await read(comparison, 'files', options)
    if (listed.response.status !== 200) return listed
    values = {
      ...values,
      repository_identity: listed.body.repository_identity,
      ...(comparison.scope === 'commit'
        ? { base: listed.body.base, head: listed.body.head }
        : {})
    }
  }
  const response = await handleRepoDiffRequest(request(values), kind, {
    snapshot,
    ...options
  })
  return { response, body: await response.json() }
}
beforeEach(() => {
  root = fs.realpathSync(
    fs.mkdtempSync(path.resolve('.agent-state/tmp/repo-diff-fixture-'))
  )
  git('init', '-q', '-b', 'main')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
const commit = () => {
  git('add', '.')
  git('commit', '-q', '-m', 'fake fixture')
  return git('rev-parse', 'HEAD')
}
describe('authenticated bounded repository comparisons', () => {
  test('FD-derived untracked patches pass the exact installed strict parser', async () => {
    const fixtures = [
      { name: 'empty.txt', text: '', lines: [] },
      { name: 'no-newline.txt', text: 'last', lines: ['last'] },
      { name: 'ไทย.txt', text: 'ไทย\nสอง\n', lines: ['ไทย\n', 'สอง\n'] },
      { name: 'quote"file.txt', text: 'quote\n', lines: ['quote\n'] },
      { name: 'tab\tfile.txt', text: 'tab\n', lines: ['tab\n'] }
    ]
    for (const fixture of fixtures) {
      write(fixture.name, fixture.text)
      const result = await read({ path: fixture.name }, 'file')
      expect(result.response.status).toBe(200)
      expect(result.body.unavailable).toBeNull()
      const parsed = parseRepoPatch(result.body.patch)
      expect(parsed?.type).toBe('new')
      expect(parsed?.additionLines).toEqual(fixture.lines)
      expect(parsed?.hunks.length).toBe(fixture.text === '' ? 0 : 1)
      if (fixture.text !== '')
        expect(parsed?.hunks[0]?.noEOFCRAdditions).toBe(
          !fixture.text.endsWith('\n')
        )
      expect(result.body.file.path).toBe(fixture.name)
    }
  })
  test('installed parser preserves rename/deletion and separated hunks', async () => {
    write('old.txt', 'same\n'.repeat(20))
    write('gone.txt', 'gone\n')
    write('multi.txt', Array.from({ length: 30 }, (_, i) => `${i}\n`).join(''))
    commit()
    git('mv', 'old.txt', 'new.txt')
    git('add', '.')
    fs.rmSync(path.join(root, 'gone.txt'))
    write(
      'multi.txt',
      Array.from(
        { length: 30 },
        (_, i) => `${i === 1 || i === 26 ? 'changed' : i}\n`
      ).join('')
    )
    const rename = parseRepoPatch(
      (
        await read(
          { scope: 'staged', path: 'new.txt', old_path: 'old.txt' },
          'file'
        )
      ).body.patch
    )
    expect(rename).toMatchObject({
      name: 'new.txt',
      prevName: 'old.txt',
      type: 'rename-pure',
      hunks: []
    })
    expect(
      parseRepoPatch((await read({ path: 'gone.txt' }, 'file')).body.patch)
        ?.type
    ).toBe('deleted')
    expect(
      parseRepoPatch((await read({ path: 'multi.txt' }, 'file')).body.patch)
        ?.hunks
    ).toHaveLength(2)
  })
  test('auth and malformed query refuse before any snapshot or Git I/O', async () => {
    let calls = 0
    const probe = async () => {
      calls++
      throw new Error('Must not read')
    }
    const refusedHeaders: Record<string, string>[] = [
      { host: 'evil.example' },
      { origin: 'https://evil.example' },
      { host: 'box.ts.net', 'tailscale-user-login': 'other' }
    ]
    for (const headers of refusedHeaders) {
      expect(
        (
          await handleRepoDiffRequest(request({}, headers), 'files', {
            snapshot: probe,
            ownerLogin: 'owner'
          })
        ).status
      ).toBe(403)
    }
    const malformed: Record<string, string>[] = [
      { scope: 'bad' },
      { cwd: root },
      { pane_id: 'bad' },
      { scope: 'commit', base: '-p', head: 'HEAD' },
      { scope: 'commit', base: 'HEAD..main', head: 'HEAD' },
      { base: 'HEAD' }
    ]
    for (const values of malformed)
      expect(
        (
          await handleRepoDiffRequest(request(values), 'files', {
            snapshot: probe
          })
        ).status
      ).toBe(400)
    for (const name of ['', '../outside', '/etc/passwd', 'a//b', './a', 'a\0'])
      expect(
        (
          await handleRepoDiffRequest(request({ path: name }), 'file', {
            snapshot: probe
          })
        ).status
      ).toBe(400)
    const duplicate = new Request(request().url + '&pane_id=w:p1', {
      headers: { host: 'localhost:8787' }
    })
    expect(
      (await handleRepoDiffRequest(duplicate, 'files', { snapshot: probe }))
        .status
    ).toBe(400)
    expect(calls).toBe(0)
  })
  test('unstaged and untracked are separate from index; counts, deletion, binary and rename', async () => {
    write('keep.txt', 'a\nb\nc\n')
    write('gone.txt', 'bye\n')
    write('old.txt', 'same\n'.repeat(20))
    write('pic.bin', new Uint8Array([0, 1]))
    commit()
    git('mv', 'old.txt', 'new.txt')
    write('staged.txt', 'index\n')
    git('add', '.')
    write('keep.txt', 'a\nB\nc\nd\n')
    fs.rmSync(path.join(root, 'gone.txt'))
    write('untracked.txt', 'one\ntwo')
    write('pic.bin', new Uint8Array([0, 4]))
    const working = await read()
    expect(working.response.status).toBe(200)
    expect(working.body.files.map((f: any) => f.path)).toEqual([
      'gone.txt',
      'keep.txt',
      'pic.bin',
      'untracked.txt'
    ])
    expect(
      working.body.files.find((f: any) => f.path === 'keep.txt')
    ).toMatchObject({ additions: 2, deletions: 1, status: 'modified' })
    const staged = await read({ scope: 'staged' })
    expect(staged.body.files).toContainEqual(
      expect.objectContaining({
        path: 'new.txt',
        old_path: 'old.txt',
        status: 'renamed'
      })
    )
    expect((await read({ path: 'keep.txt' }, 'file')).body.patch).toContain(
      '+B\n'
    )
    expect((await read({ path: 'gone.txt' }, 'file')).body.patch).toContain(
      'deleted file mode'
    )
    expect(
      (await read({ path: 'untracked.txt' }, 'file')).body.patch
    ).toContain('\\ No newline at end of file')
    expect((await read({ path: 'pic.bin' }, 'file')).body.unavailable).toBe(
      'binary'
    )
    expect(
      (
        await read(
          { scope: 'staged', path: 'new.txt', old_path: 'old.txt' },
          'file'
        )
      ).body.patch
    ).toContain('rename from old.txt')
    expect(
      (
        await read(
          { scope: 'staged', path: 'new.txt', old_path: 'gone.txt' },
          'file'
        )
      ).response.status
    ).toBe(400)
    for (const name of ['*.txt', ':(glob)**', 'missing.txt'])
      expect((await read({ path: name }, 'file')).response.status).toBe(404)
    expect(working.response.headers.get('cache-control')).toContain('no-store')
    expect(working.response.headers.get('x-content-type-options')).toBe(
      'nosniff'
    )
  })
  test('two explicit commits freeze hashes and exclude dirty work', async () => {
    write('a.txt', 'one\n')
    const first = commit()
    write('a.txt', 'one\ntwo\n')
    const second = commit()
    write('a.txt', 'dirty\n')
    const result = await read(
      { scope: 'commit', base: 'HEAD~1', head: 'HEAD', path: 'a.txt' },
      'file'
    )
    expect(result.body).toMatchObject({ base: first, head: second })
    expect(result.body.patch).toContain('+two')
    expect(result.body.patch).not.toContain('dirty')
    expect(
      (await read({ scope: 'commit', base: second, head: second })).body.files
    ).toEqual([])
    expect(
      (await read({ scope: 'commit', base: 'missing', head: 'HEAD' })).response
        .status
    ).toBe(404)
  })
  test('empty, unborn staged and nonrepo are truthful', async () => {
    expect((await read()).body.files).toEqual([])
    write('a.txt', 'fake\n')
    git('add', 'a.txt')
    expect((await read({ scope: 'staged' })).body).toMatchObject({
      repository: { unborn: true },
      files: [
        {
          path: 'a.txt',
          status: 'added',
          additions: 1,
          deletions: 0,
          binary: false,
          old_path: null
        }
      ]
    })
    const nonrepo = async () =>
      ({
        panes: [
          {
            pane_id: 'w:p1',
            terminal_id: 't1',
            cwd: '/nonexistent/herdr-fake-nonrepo-fixture'
          }
        ]
      }) as any
    expect(
      (await read({}, 'files', { snapshot: nonrepo })).response.status
    ).toBe(409)
  })
  test('untracked binary, size caps, symlink and symlinked ancestor cannot be read', async () => {
    write('binary', new Uint8Array([0, 2]))
    write('large', 'f'.repeat(300))
    write('fake-secret', 'DO_NOT_SHOW')
    fs.symlinkSync(path.join(root, 'fake-secret'), path.join(root, 'link'))
    expect((await read({ path: 'binary' }, 'file')).body.unavailable).toBe(
      'binary'
    )
    expect(
      (await read({ path: 'large' }, 'file', { maxPatchBytes: 20 })).body
        .unavailable
    ).toBe('too_large')
    expect((await read({ path: 'link' }, 'file')).body.unavailable).toBe(
      'unsupported'
    )
    fs.mkdirSync(path.join(root, 'real'))
    write('real/f.txt', 'FAKE')
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'alias'))
    expect((await read({ path: 'alias/f.txt' }, 'file')).response.status).toBe(
      404
    )
    expect((await read({}, 'files', { maxFiles: 1 })).body.truncated).toBe(true)
    expect((await read({}, 'files', { maxListBytes: 1 })).body.truncated).toBe(
      true
    )
  })
  test('Git does not traverse a replaced tracked directory symlink', async () => {
    fs.mkdirSync(path.join(root, 'dir'))
    write('dir/a.txt', 'original\n')
    commit()
    const outside = root + '-outside'
    fs.mkdirSync(outside)
    try {
      fs.writeFileSync(path.join(outside, 'a.txt'), 'FAKE_OUTSIDE_CONTENT\n')
      fs.rmSync(path.join(root, 'dir'), { recursive: true })
      fs.symlinkSync(outside, path.join(root, 'dir'))
      const result = await read({ path: 'dir/a.txt' }, 'file')
      expect(JSON.stringify(result.body)).not.toContain('FAKE_OUTSIDE_CONTENT')
      expect(result.body.file.status).toBe('deleted')
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
  test('patch cap returns no partial hunk', async () => {
    write('a', 'one\n')
    commit()
    write('a', 'two\n'.repeat(200))
    expect(
      (await read({ path: 'a' }, 'file', { maxPatchBytes: 32 })).body
    ).toMatchObject({ patch: null, unavailable: 'too_large', truncated: true })
  })
  test('inherited Git overrides and external/textconv/fsmonitor helpers never execute', async () => {
    write('a.txt', 'one\n')
    commit()
    write('a.txt', 'two\n')
    const marker = path.join(root, 'HELPER_RAN'),
      helper = path.join(root, 'helper')
    write('helper', `#!/bin/sh\ntouch '${marker}'\n`)
    fs.chmodSync(helper, 0o755)
    git('config', 'diff.evil.command', helper)
    git('config', 'diff.evil.textconv', helper)
    git('config', 'core.fsmonitor', helper)
    git('config', 'filter.evil.clean', helper)
    git('config', 'filter.evil.process', helper)
    git('config', 'filter.evil.required', 'true')
    write('.gitattributes', '*.txt diff=evil filter=evil\n')
    const keys = [
        'GIT_DIR',
        'GIT_CONFIG_COUNT',
        'GIT_CONFIG_KEY_0',
        'GIT_CONFIG_VALUE_0',
        'GIT_EXTERNAL_DIFF'
      ],
      saved = keys.map((k) => process.env[k])
    try {
      process.env.GIT_DIR = '/fake/not-a-repo'
      process.env.GIT_CONFIG_COUNT = '1'
      process.env.GIT_CONFIG_KEY_0 = 'core.fsmonitor'
      process.env.GIT_CONFIG_VALUE_0 = helper
      process.env.GIT_EXTERNAL_DIFF = helper
      expect((await read({ path: 'a.txt' }, 'file')).response.status).toBe(200)
      expect(fs.existsSync(marker)).toBe(false)
    } finally {
      keys.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k]
        else process.env[k] = saved[i]
      })
    }
  })
  test('unsupported inert-attributes capability fails truthfully without unsafe fallback', async () => {
    write('a.txt', 'one\n')
    commit()
    write('a.txt', 'two\n')
    const oldGit = path.join(root, 'old-git')
    write(
      'old-git',
      '#!/bin/sh\nfor arg do\n case "$arg" in --attr-source=*) printf "FAKE_PRIVATE_STDERR" >&2; exit 129;; esac\ndone\nexec /usr/bin/git "$@"\n'
    )
    fs.chmodSync(oldGit, 0o755)
    const result = await read({}, 'files', { git: oldGit })
    expect(result.response.status).toBe(503)
    expect(result.body.error.code).toBe('git_unsupported')
    expect(result.body.error.message).toContain('--attr-source')
    expect(JSON.stringify(result.body)).not.toContain('FAKE_PRIVATE_STDERR')
  })
  test('deadline kills process and errors never leak stderr', async () => {
    const helper = path.join(root, 'slow-git')
    write('slow-git', '#!/bin/sh\nexec sleep 10\n')
    fs.chmodSync(helper, 0o755)
    const result = await read({}, 'files', { git: helper, deadlineMs: 25 })
    expect(result.response.status).toBe(504)
    expect(result.body.error.code).toBe('git_timeout')
    expect(JSON.stringify(result.body)).not.toContain(root)
  })
  test('SHA256 repository uses its own inert empty tree', async () => {
    fs.rmSync(path.join(root, '.git'), { recursive: true })
    git('init', '-q', '--object-format=sha256', '-b', 'main')
    write('a.txt', 'one\n')
    commit()
    write('a.txt', 'two\n')
    expect((await read({ path: 'a.txt' }, 'file')).body.patch).toContain('+two')
  })
  test('metadata attributes fail closed before clean/process helpers, including included config', async () => {
    write('a.txt', 'one\n')
    commit()
    write('a.txt', 'two\n')
    const marker = path.join(root, 'HELPER_RAN')
    write('helper', `#!/bin/sh\ntouch '${marker}'\ncat\n`)
    fs.chmodSync(path.join(root, 'helper'), 0o755)
    write(
      'included-config',
      `[filter "evil"]\n clean = ${path.join(root, 'helper')}\n process = ${path.join(root, 'helper')}\n`
    )
    git('config', 'include.path', path.join(root, 'included-config'))
    const attrs = path.join(root, '.git/info/attributes')
    for (const content of ['*.txt filter=evil\n', '# comment only\n']) {
      fs.writeFileSync(attrs, content)
      const result = await read()
      expect(result.response.status).toBe(409)
      expect(result.body.error.code).toBe('attributes-unsupported')
      expect(fs.existsSync(marker)).toBe(false)
    }
    fs.writeFileSync(attrs, '')
    expect((await read()).response.status).toBe(200)
    fs.rmSync(attrs)
    expect((await read()).response.status).toBe(200)
    for (const target of [
      path.join(root, 'included-config'),
      path.join(root, 'missing')
    ]) {
      fs.symlinkSync(target, attrs)
      expect((await read()).body.error.code).toBe('attributes-unsupported')
      fs.rmSync(attrs)
    }
    fs.mkdirSync(attrs)
    expect((await read()).body.error.code).toBe('attributes-unsupported')
    fs.rmSync(attrs, { recursive: true })
    expect(Bun.spawnSync(['/usr/bin/mkfifo', attrs]).exitCode).toBe(0)
    expect((await read()).body.error.code).toBe('attributes-unsupported')
    fs.rmSync(attrs)
    fs.writeFileSync(attrs, '')
    fs.chmodSync(attrs, 0)
    expect((await read()).body.error.code).toBe('attributes-unsupported')
    fs.chmodSync(attrs, 0o600)
    fs.rmSync(path.join(root, '.git/info'), { recursive: true })
    fs.symlinkSync(root, path.join(root, '.git/info'))
    expect((await read()).body.error.code).toBe('attributes-unsupported')
    fs.rmSync(path.join(root, '.git/info'))
    fs.writeFileSync(path.join(root, '.git/info'), '')
    expect((await read()).body.error.code).toBe('attributes-unsupported')
    expect(fs.existsSync(marker)).toBe(false)
  })
  test('linked worktree gates common metadata and permits canonical gitdir symlink', async () => {
    write('a.txt', 'one\n')
    commit()
    const linked = path.join(root, 'linked')
    git('worktree', 'add', '-q', linked)
    const linkedSnapshot = async () =>
      ({ panes: [{ pane_id: 'w:p1', terminal_id: 't1', cwd: linked }] }) as any
    fs.writeFileSync(path.join(linked, 'a.txt'), 'two\n')
    expect(
      (await read({}, 'files', { snapshot: linkedSnapshot })).response.status
    ).toBe(200)
    write('.git/info/attributes', '# metadata\n')
    expect(
      (await read({}, 'files', { snapshot: linkedSnapshot })).body.error.code
    ).toBe('attributes-unsupported')
    fs.rmSync(path.join(root, '.git/info/attributes'))
    fs.renameSync(path.join(root, '.git'), path.join(root, 'metadata'))
    fs.symlinkSync(path.join(root, 'metadata'), path.join(root, '.git'))
    expect((await read()).response.status).toBe(200)
  })
  test('empty tree replace refs cannot reactivate worktree filters', async () => {
    write('a.txt', 'one\n')
    commit()
    write('.gitattributes', '*.txt filter=evil\n')
    const replacement = git('hash-object', '-w', '.gitattributes')
    const tree = Bun.spawnSync(['/usr/bin/git', '-C', root, 'mktree'], {
      env: diffGitEnvironment(),
      stdin: Buffer.from(`100644 blob ${replacement}\t.gitattributes\n`)
    })
      .stdout.toString()
      .trim()
    git('replace', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', tree)
    write(
      'helper',
      `#!/bin/sh\ntouch '${path.join(root, 'HELPER_RAN')}'\ncat\n`
    )
    fs.chmodSync(path.join(root, 'helper'), 0o755)
    git('config', 'filter.evil.clean', path.join(root, 'helper'))
    write('a.txt', 'two\n')
    expect((await read()).response.status).toBe(200)
    expect(fs.existsSync(path.join(root, 'HELPER_RAN'))).toBe(false)
  })
  test('frozen identity rejects missing token and terminal/session/cwd/repository replacement but allows edits', async () => {
    write('a.txt', 'one\n')
    commit()
    write('a.txt', 'two\n')
    let terminal = 't1',
      session: string | undefined = 's1',
      cwd = root
    const bound = async () =>
      ({
        panes: [{ pane_id: 'w:p1', terminal_id: terminal, cwd }],
        agents: session
          ? [{ target: 'w:p1', agent_session: { value: session } }]
          : []
      }) as any
    const listed = await read({}, 'files', { snapshot: bound })
    const values = {
      path: 'a.txt',
      repository_identity: listed.body.repository_identity
    }
    const patch = () => read(values, 'file', { snapshot: bound })
    expect(
      (
        await handleRepoDiffRequest(request({ path: 'a.txt' }), 'file', {
          snapshot: bound
        })
      ).status
    ).toBe(400)
    write('a.txt', 'ordinary edit\n')
    expect((await patch()).response.status).toBe(200)
    session = 's2'
    expect((await patch()).response.status).toBe(409)
    session = undefined
    expect((await patch()).response.status).toBe(409)
    session = 's1'
    terminal = 't2'
    expect((await patch()).response.status).toBe(409)
    terminal = 't1'
    const other = path.join(root, 'other')
    fs.mkdirSync(other)
    Bun.spawnSync(['/usr/bin/git', '-C', other, 'init', '-q'], {
      env: diffGitEnvironment()
    })
    fs.writeFileSync(path.join(other, 'a.txt'), 'other repository\n')
    cwd = other
    expect((await patch()).response.status).toBe(409)
    cwd = root
    fs.renameSync(path.join(root, '.git'), path.join(root, 'old-metadata'))
    git('init', '-q')
    expect((await patch()).response.status).toBe(409)
  })
  test('commit patches require full list-resolved endpoints and fingerprint', async () => {
    write('a.txt', 'one\n')
    const first = commit()
    write('a.txt', 'two\n')
    const second = commit()
    const listed = await read({ scope: 'commit', base: 'HEAD~1', head: 'HEAD' })
    const values = {
      scope: 'commit',
      base: first,
      head: second,
      path: 'a.txt',
      repository_identity: listed.body.repository_identity
    }
    expect((await read(values, 'file')).response.status).toBe(200)
    expect(
      (await read({ ...values, base: 'HEAD~1' }, 'file')).response.status
    ).toBe(400)
    expect(
      (await read({ ...values, base: second }, 'file')).response.status
    ).toBe(409)
  })
  test('session drift during a read is fenced with pane-first precedence', async () => {
    let calls = 0
    const changing = async () =>
      ({
        panes: [
          {
            pane_id: 'w:p1',
            terminal_id: 't1',
            cwd: root,
            agent_session: { id: ++calls === 1 ? 's1' : 's2' }
          }
        ],
        agents: [{ target: 'w:p1', agent_session: { value: 'fallback' } }]
      }) as any
    expect(
      (await read({}, 'files', { snapshot: changing })).response.status
    ).toBe(409)
  })
  test('pane replacement fences completed read', async () => {
    let calls = 0
    const replaced = async () =>
      ({
        panes: [
          {
            pane_id: 'w:p1',
            terminal_id: ++calls === 1 ? 't1' : 't2',
            cwd: root
          }
        ]
      }) as any
    expect(
      (await read({}, 'files', { snapshot: replaced })).response.status
    ).toBe(409)
  })
})
