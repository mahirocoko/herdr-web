import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  verifyCandidate,
  verifyPromoted,
  PROMOTION_ADDITIONS,
  PROMOTION_PATCHES,
  PROMOTION_REFERENCES,
  PROMOTION_REMOVALS,
  PROMOTION_RELOCATIONS
} from '../verify-upstream.ts'

const fixture = (run: (root: string, tree: string, manifest: any) => void) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'upstream-audit-')))
  const paths = [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'patches/one.patch',
    'patches/two.patch',
    'scripts/demo-build.ts',
    'src/App.tsx',
    'AGENTS.md',
    'nested/CLAUDE.md',
    '.github/workflows/test.yml',
    '.coderabbit.yaml'
  ]
  const entries = paths.map((path, index) => {
    const data = Buffer.from(`fixture ${path}\n`)
    const blob = createHash('sha1')
      .update(`blob ${data.length}\0`)
      .update(data)
      .digest('hex')
    const disposition = index < 6 ? 'acquired' : 'excluded'
    if (disposition === 'acquired') {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), data)
    }
    return { path, blob, mode: '100644', disposition }
  })
  const manifest = {
    repository: 'https://github.com/devswha/herdr-web-ui',
    pin: 'd918448647e41079c52047ffc96cdaac50ccba32',
    forkPatchAllowlist: ['scripts/demo-build.ts'],
    forkAddedPaths: [
      'AGENTS.md',
      'SOURCE_MANIFEST.json',
      'scripts/preview-build.ts'
    ],
    entries
  }
  writeFileSync(join(root, 'AGENTS.md'), 'fork guard')
  writeFileSync(join(root, 'scripts/preview-build.ts'), 'fork preview')
  writeFileSync(join(root, 'SOURCE_MANIFEST.json'), JSON.stringify(manifest))
  const tree = entries
    .map((entry) => `${entry.mode} blob ${entry.blob}\t${entry.path}\0`)
    .join('')
  try {
    run(root, tree, manifest)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const save = (root: string, manifest: unknown) =>
  writeFileSync(join(root, 'SOURCE_MANIFEST.json'), JSON.stringify(manifest))

test('accepts independently inventoried bytes and the single approved source patch', () => {
  fixture((root, tree) => {
    writeFileSync(join(root, 'scripts/demo-build.ts'), 'approved fork patch')
    expect(verifyCandidate(root, tree)).toMatchObject({
      acquired: 6,
      excluded: 4,
      patched: ['scripts/demo-build.ts'],
      dependencyPatches: 2
    })
  })
})

for (const mutation of [
  (manifest: any) => {
    manifest.entries = []
  },
  (manifest: any) => {
    manifest.entries.pop()
  },
  (manifest: any) => {
    manifest.entries[1] = manifest.entries[0]
  },
  (manifest: any) => {
    manifest.pin = 'unapproved-pin'
  },
  (manifest: any) => {
    manifest.repository = 'https://example.com/forged'
  },
  (manifest: any) => {
    manifest.forkPatchAllowlist.push('src/App.tsx')
  },
  (manifest: any) => {
    manifest.forkAddedPaths.push('extra.ts')
  },
  (manifest: any) => {
    manifest.entries[0].blob = '0'.repeat(40)
  },
  (manifest: any) => {
    manifest.entries[0].mode = '100755'
  },
  (manifest: any) => {
    manifest.entries[0].disposition = 'excluded'
  },
  (manifest: any) => {
    manifest.entries[0].path = '../escape'
  }
]) {
  test(`rejects forged manifest: ${mutation.toString()}`, () => {
    fixture((root, tree, manifest) => {
      mutation(manifest)
      save(root, manifest)
      expect(() => verifyCandidate(root, tree)).toThrow()
    })
  })
}

for (const path of [
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'patches/one.patch',
  'patches/two.patch'
]) {
  test(`requires actual file: ${path}`, () => {
    fixture((root, tree) => {
      rmSync(join(root, path))
      expect(() => verifyCandidate(root, tree)).toThrow('Missing source')
    })
  })
}

test('rejects unexpected additions, changed bytes, and executable mode changes', () => {
  fixture((root, tree) => {
    writeFileSync(join(root, 'extra.ts'), 'extra')
    expect(() => verifyCandidate(root, tree)).toThrow('Unexpected source')
    rmSync(join(root, 'extra.ts'))
    const original = readFileSync(join(root, 'src/App.tsx'))
    writeFileSync(join(root, 'src/App.tsx'), 'changed')
    expect(() => verifyCandidate(root, tree)).toThrow('Unapproved patch')
    writeFileSync(join(root, 'src/App.tsx'), original)
    chmodSync(join(root, 'src/App.tsx'), 0o755)
    expect(() => verifyCandidate(root, tree)).toThrow('Mode mismatch')
  })
})

for (const path of ['SOURCE_MANIFEST.json', 'LICENSE', 'src']) {
  test(`rejects symlink file/parent before reads: ${path}`, () => {
    fixture((root, tree) => {
      rmSync(join(root, path), { recursive: true })
      symlinkSync('/nonexistent-outside-candidate', join(root, path))
      expect(() => verifyCandidate(root, tree)).toThrow('Symlink source')
    })
  })
}

test('rejects unsafe or symlink-mode pinned tree paths', () => {
  fixture((root, tree) => {
    expect(() =>
      verifyCandidate(root, tree.replace('LICENSE', '../LICENSE'))
    ).toThrow('Unsafe source path')
    expect(() =>
      verifyCandidate(root, tree.replace('100644', '120000'))
    ).toThrow('Unsupported Git entry')
  })
})

const promotedFixture = (
  run: (root: string, tree: string, manifest: any) => void
) =>
  fixture((root, tree, manifest) => {
    writeFileSync(
      join(root, 'UPSTREAM_LICENSE'),
      readFileSync(join(root, 'LICENSE'))
    )
    for (const path of ['server', 'src', 'shared', 'public', 'scripts'])
      mkdirSync(join(root, path), { recursive: true })
    for (const path of PROMOTION_ADDITIONS) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      if (!existsSync(join(root, path)))
        writeFileSync(join(root, path), 'fork owner\n')
    }
    manifest.promotion = {
      patches: [...PROMOTION_PATCHES],
      additions: [...PROMOTION_ADDITIONS],
      references: [...PROMOTION_REFERENCES],
      removals: [...PROMOTION_REMOVALS],
      relocations: { ...PROMOTION_RELOCATIONS }
    }
    save(root, manifest)
    run(root, tree, manifest)
  })

test('promoted root audits mapped source MIT, complete inventory and runtime UI bytes independently', () => {
  promotedFixture((root, tree) =>
    expect(verifyPromoted(root, tree)).toMatchObject({
      acquired: 6,
      excluded: 4,
      sourceUiByteEqual: true,
      dependencyPatches: 2
    })
  )
})

test('approved active documentation patches do not exempt other Markdown source', () => {
  for (const path of ['INSTALL.md', 'docs/guide.md', 'docs/unapproved.md']) {
    promotedFixture((root, tree, manifest) => {
      const data = Buffer.from('pinned documentation\n')
      const blob = createHash('sha1')
        .update(`blob ${data.length}\0`)
        .update(data)
        .digest('hex')
      manifest.entries.push({
        path,
        blob,
        mode: '100644',
        disposition: 'acquired'
      })
      save(root, manifest)
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), 'rewritten fork documentation\n')
      const candidateTree = tree + `100644 blob ${blob}\t${path}\0`
      if (path === 'docs/unapproved.md') {
        expect(() => verifyPromoted(root, candidateTree)).toThrow(
          'Unapproved promoted source patch'
        )
      } else {
        expect(verifyPromoted(root, candidateTree).patched).toContain(path)
      }
    })
  }
})

test('cleanup policy rejects unauthorized omissions and restored retired owners', () => {
  promotedFixture((root, tree, manifest) => {
    manifest.promotion.removals.push('src/App.tsx')
    save(root, manifest)
    expect(() => verifyPromoted(root, tree)).toThrow('Promoted fork policy mismatch')
  })
  promotedFixture((root, tree, manifest) => {
    manifest.promotion.removals.pop()
    save(root, manifest)
    expect(() => verifyPromoted(root, tree)).toThrow('Promoted fork policy mismatch')
  })
  promotedFixture((root, tree, manifest) => {
    manifest.promotion.relocations['site/demo/history.ts'] = 'scripts/forged.ts'
    save(root, manifest)
    expect(() => verifyPromoted(root, tree)).toThrow('Promoted fork policy mismatch')
  })
  for (const path of ['scripts/build-site.ts', 'telemetry/worker.ts', 'site/demo/history.ts']) {
    promotedFixture((root, tree) => {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), 'restored retired owner')
      expect(() => verifyPromoted(root, tree)).toThrow('Retired upstream surface still present')
    })
  }
})

test('relocated fixtures remain byte-checked against the original pin', () => {
  promotedFixture((root, tree, manifest) => {
    const path = 'site/demo/fixtures/panes.json'
    const target = PROMOTION_RELOCATIONS[path]!
    const data = Buffer.from('pinned fixture history\n')
    const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
    manifest.entries.push({ path, blob, mode: '100644', disposition: 'acquired' })
    save(root, manifest)
    mkdirSync(dirname(join(root, target)), { recursive: true })
    writeFileSync(join(root, target), data)
    const candidateTree = tree + `100644 blob ${blob}\t${path}\0`
    expect(verifyPromoted(root, candidateTree).dependencyPatches).toBe(2)
    writeFileSync(join(root, target), 'unapproved fixture change')
    expect(() => verifyPromoted(root, candidateTree)).toThrow('Unapproved promoted source patch')
    rmSync(join(root, target))
    expect(() => verifyPromoted(root, candidateTree)).toThrow()
  })
})

test('hardening backports permit only their exact source and test owners', () => {
  const backports = [
    'server/pty/session.ts', 'server/pty/pty-host.mjs', 'server/pty/session.test.ts',
    'server/paste.ts', 'server/paste.test.ts',
    'server/codex-images.ts', 'server/codex-images.test.ts',
    'server/files.ts', 'server/files.test.ts'
  ]
  for (const path of [...backports, 'server/unapproved-hardening.ts']) {
    promotedFixture((root, tree, manifest) => {
      const data = Buffer.from('pinned backend fixture\n')
      const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
      manifest.entries.push({ path, blob, mode: '100644', disposition: 'acquired' })
      save(root, manifest)
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), 'focused hardening backport\n')
      const candidateTree = tree + `100644 blob ${blob}\t${path}\0`
      if (backports.includes(path)) {
        expect(verifyPromoted(root, candidateTree).patched).toContain(path)
      } else {
        expect(() => verifyPromoted(root, candidateTree)).toThrow('Unapproved promoted source patch')
      }
    })
  }
})

test('promoted manifest cannot authorize its own extra UI patch', () => {
  promotedFixture((root, tree, manifest) => {
    manifest.promotion.patches.push('src/App.tsx')
    save(root, manifest)
    expect(() => verifyPromoted(root, tree)).toThrow(
      'Promoted fork policy mismatch'
    )
  })
})

for (const [name, mutate] of [
  [
    'runtime UI mutation',
    (root: string) =>
      writeFileSync(join(root, 'src/App.tsx'), 'unapproved visual change')
  ],
  [
    'unexpected legacy adapter',
    (root: string) =>
      writeFileSync(join(root, 'server/herdr-adapter.ts'), 'retired owner')
  ],
  [
    'unexpected canonical code',
    (root: string) =>
      writeFileSync(join(root, 'src/surprise.ts'), 'unexpected owner')
  ],
  ['retired app directory', (root: string) => mkdirSync(join(root, 'app'))],
  ['unexpected website directory', (root: string) => mkdirSync(join(root, 'site'))],
  ['unexpected receiver directory', (root: string) => mkdirSync(join(root, 'telemetry'))],
  [
    'source mode change',
    (root: string) => chmodSync(join(root, 'src/App.tsx'), 0o755)
  ],
  [
    'manifest symlink',
    (root: string) => {
      writeFileSync(
        join(root, 'copied-manifest'),
        readFileSync(join(root, 'SOURCE_MANIFEST.json'))
      )
      rmSync(join(root, 'SOURCE_MANIFEST.json'))
      symlinkSync(
        join(root, 'copied-manifest'),
        join(root, 'SOURCE_MANIFEST.json')
      )
    }
  ],
  [
    'license content loss despite general patch allowlist',
    (root: string) =>
      writeFileSync(
        join(root, 'THIRD_PARTY_NOTICES.md'),
        'missing license content'
      )
  ],
  [
    'activated excluded automation',
    (root: string) => {
      mkdirSync(join(root, '.github/workflows'), { recursive: true })
      writeFileSync(
        join(root, '.github/workflows/test.yml'),
        'activated upstream workflow'
      )
    }
  ]
] as const)
  test(`promoted root rejects ${name}`, () => {
    promotedFixture((root, tree) => {
      mutate(root)
      expect(() => verifyPromoted(root, tree)).toThrow()
    })
  })
