import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pin = 'd918448647e41079c52047ffc96cdaac50ccba32'
const reference = process.argv[2]
if (!reference) throw new Error('Provide the read-only upstream checkout')
const destination = resolve(import.meta.dir, '../adoption/upstream')
if (existsSync(destination) && readdirSync(destination).length)
  throw new Error('Refusing to overwrite an existing candidate')
const git = (...args: string[]) =>
  execFileSync('git', ['-C', reference, ...args], {
    maxBuffer: 256 * 1024 * 1024
  })
if (
  git('rev-parse', 'HEAD').toString().trim() !== pin ||
  git('status', '--porcelain').length
) {
  throw new Error('Reference must be clean and at the approved pin')
}
const entries = git('ls-tree', '-rz', '--full-tree', pin)
  .toString()
  .split('\0')
  .filter(Boolean)
  .map((row) => {
    const [metadata, path] = row.split('\t')
    const [mode, type, blob] = metadata!.split(' ')
    if (type !== 'blob' || !['100644', '100755'].includes(mode!))
      throw new Error(`Unexpected entry: ${row}`)
    const reason = /(^|\/)(AGENTS\.md|CLAUDE\.md)$/.test(path!)
      ? 'upstream agent instructions are not active in this fork'
      : path!.startsWith('.github/') || path === '.coderabbit.yaml'
        ? 'upstream repository automation is not activated'
        : null
    return {
      path: path!,
      mode: mode!,
      blob: blob!,
      disposition: reason ? 'excluded' : 'acquired',
      reason
    }
  })
mkdirSync(destination, { recursive: true })
const included = entries
  .filter((entry) => entry.disposition === 'acquired')
  .map((entry) => entry.path)
const archive = git('archive', '--format=tar', pin, '--', ...included)
execFileSync('tar', ['-xf', '-', '-C', destination], { input: archive })
writeFileSync(
  resolve(destination, 'SOURCE_MANIFEST.json'),
  JSON.stringify(
    {
      repository: 'https://github.com/devswha/herdr-web-ui',
      pin,
      forkPatchAllowlist: ['scripts/demo-build.ts'],
      forkAddedPaths: [
        'AGENTS.md',
        'SOURCE_MANIFEST.json',
        'scripts/preview-build.ts'
      ],
      entries
    },
    null,
    2
  ) + '\n'
)
console.log(
  JSON.stringify({
    pin,
    acquired: included.length,
    excluded: entries.length - included.length,
    bytes: archive.length
  })
)
