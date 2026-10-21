import { expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

const root = resolve(import.meta.dir, '..')
const activeDocs = [
  'README.md',
  'INSTALL.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'AGENTS.md',
  'DESIGN.md',
  'docs/guide.md',
  'docs/development.md',
  'docs/upstream-parity.md',
  'docs/app-updates.md',
  'docs/remote-pcs.md',
  'docs/brand/README.md',
]
const scripts: Record<string, string> = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
).scripts
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')

// Bounded to current guides, not pinned references with their original relative URLs.
function defects(path: string, text: string): string[] {
  const errors: string[] = []
  const links = [...text.matchAll(/\[([^\]]+)\]\(([^\s)]+)\)/g)].map(
    (match) => ({ label: match[1]!, href: match[2]! }),
  )
  for (const match of text.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm))
    links.push({ label: '', href: match[1]! })
  for (const { label, href } of links) {
    if (/^https?:/.test(href)) {
      // Upstream blob/tree links are valid provenance, not support destinations.
      if (
        /github\.com\/devswha\/herdr-web-ui\/(issues|pulls|security)(\/|$)/.test(
          href,
        )
      )
        errors.push(`upstream support route: ${href}`)
      continue
    }
    if (/^[a-z]+:/i.test(href)) continue
    const [file, anchor] = decodeURIComponent(href).split('#')
    const target = resolve(root, dirname(path), file || path.split('/').at(-1)!)
    if (target !== root && !target.startsWith(root + sep)) {
      errors.push(`outside repository: ${href}`)
      continue
    }
    if (!existsSync(target)) {
      errors.push(`missing local path: ${href}`)
      continue
    }
    if (target === resolve(root, 'LICENSE') && /\bMIT\b/i.test(label))
      errors.push('MIT label points to fork Apache license')
    if (anchor && statSync(target).isFile()) {
      const headings = [
        ...readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm),
      ]
      const counts = new Map<string, number>()
      const anchors = headings.map((match) => {
        const base = slug(match[1]!)
        const count = counts.get(base) || 0
        counts.set(base, count + 1)
        return count ? `${base}-${count}` : base
      })
      if (!anchors.includes(anchor)) errors.push(`missing anchor: ${href}`)
    }
  }
  for (const match of text.matchAll(
    /\bbun (?:scripts\/bun-project\.mjs )?run ([\w:-]+)/g,
  ))
    if (!Object.hasOwn(scripts, match[1]!))
      errors.push(`missing package script: ${match[1]}`)
  for (const match of text.matchAll(/\bbun (scripts\/[\w./-]+\.(?:mjs|ts))\b/g))
    if (!existsSync(resolve(root, match[1]!)))
      errors.push(`missing command owner: ${match[1]}`)
  for (const line of text.split('\n'))
    if (/\bbun test\b/.test(line) && !/never|do not|not the safe/i.test(line))
      errors.push('bare native-preloaded test command outside a warning')
  return errors
}

test('current fork guides resolve local links/anchors and actual command owners', () => {
  const errors = activeDocs.flatMap((path) =>
    defects(path, readFileSync(resolve(root, path), 'utf8')).map(
      (error) => `${path}: ${error}`,
    ),
  )
  expect(errors).toEqual([])
})

test('regression examples distinguish broken support/license/path claims from provenance', () => {
  expect(defects('README.md', '[MIT license](LICENSE)')).toContain(
    'MIT label points to fork Apache license',
  )
  expect(
    defects(
      'README.md',
      '[Report](https://github.com/devswha/herdr-web-ui/issues/new)',
    ),
  ).toHaveLength(1)
  expect(
    defects('README.md', '[Guide](docs/not-a-real-guide.md)'),
  ).toHaveLength(1)
  expect(
    defects('README.md', '[Setup](INSTALL.md#not-a-real-heading)'),
  ).toHaveLength(1)
  expect(defects('README.md', 'bun run not-a-real-script')).toHaveLength(1)
  expect(defects('README.md', 'bun test')).toHaveLength(1)
  expect(defects('README.md', 'Never run bare `bun test`.')).toEqual([])
  expect(
    defects(
      'README.md',
      '[Pinned source](https://github.com/devswha/herdr-web-ui/blob/d918448647e41079c52047ffc96cdaac50ccba32/README.md)',
    ),
  ).toEqual([])
  expect(
    defects(
      'README.md',
      '[MIT](UPSTREAM_LICENSE) [Issues](https://github.com/mahirocoko/herdr-web/issues)',
    ),
  ).toEqual([])
})
