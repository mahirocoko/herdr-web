import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
const notices = readFileSync(
  new URL('../../../THIRD_PARTY_NOTICES.md', import.meta.url),
  'utf8'
)
const codeBlocks = [...notices.matchAll(/^```\n([\s\S]*?)\n```$/gm)].map(
  (match) => match[1]
)
describe('exact installed Pierre license text is retained', () => {
  test('Apache license and theme attribution match the installed distribution verbatim', () => {
    const license = readFileSync(
      new URL(
        '../../../node_modules/@pierre/diffs/LICENSE.md',
        import.meta.url
      ),
      'utf8'
    ).trimEnd()
    expect(codeBlocks).toContain(license)
    const themeNotice = readFileSync(
      new URL('../../../node_modules/@pierre/theme/NOTICE.md', import.meta.url),
      'utf8'
    ).trimEnd()
    expect(notices).toContain(themeNotice)
    for (const name of [
      'shiki',
      'diff',
      '@shikijs/vscode-textmate',
      'dequal',
      '@ungap/structured-clone',
      'oniguruma-to-es',
      'oniguruma-parser',
      'regex',
      'regex-recursion',
      'regex-utilities'
    ]) {
      const shipped = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']
        .map(
          (file) =>
            new URL(`../../../node_modules/${name}/${file}`, import.meta.url)
        )
        .find((file) => existsSync(file))
      if (!shipped) throw new Error(`Missing installed license: ${name}`)
      const bundled = readFileSync(shipped, 'utf8').trimEnd()
      // Grouped upstream notices print all per-package copyright lines once.
      const body = bundled.slice(bundled.indexOf('Permission'))
      if (name === 'diff') expect(codeBlocks).toContain(bundled)
      else expect(notices).toContain(body)
    }
    expect(notices).toContain('Copyright (c) 2020 Primer')
    expect(notices).toContain(
      'Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>'
    )
    expect(notices).toContain('Copyright (c) 2026 T3 Tools Inc.')
    expect(notices).toContain('Copyright (c) 2026 devswha')
  })
})
