import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { build } from './demo-build.ts'

const root = join(import.meta.dir, '..')

// Keep the same sequence as scripts/build-site.ts without its marketing/network work.
export const preparePreviewHtml = (input: string): string => {
  let html = input.replace(/\s*<link rel="manifest"[^>]*>/, '')
  html = html.replace(/(href|src)="\/(?!\/)/g, '$1="./')
  if (!html.includes('</head>')) throw new Error('Built demo app has no head')
  html = html.replace(
    '</head>',
    '  <meta name="robots" content="noindex" />\n  </head>'
  )
  if (!/<script type="module"/.test(html))
    throw new Error('Built app has no module script')
  return html.replace(
    /<script type="module"/,
    '<script src="./demo-transport.js"></script>\n    <script type="module"'
  )
}

export const copyPreviewRootAssets = (out: string): void => {
  for (const name of ['favicon.ico', 'favicon.png'])
    copyFileSync(join(root, 'public', name), join(out, name))
  // The source brand also uses origin-absolute icons outside the nested app base.
  cpSync(join(root, 'public/icons'), join(out, 'icons'), { recursive: true })
}

export async function buildPreview(): Promise<void> {
  // Do not borrow enclosing-fork dependencies or reuse a test-hook-enabled shared build.
  for (const name of ['vite', 'react', 'react-dom', '@vitejs/plugin-react']) {
    const resolved = Bun.resolveSync(name, root)
    if (!resolved.startsWith(join(root, 'node_modules') + '/'))
      throw new Error(`Candidate-local dependency missing: ${name}`)
  }
  const out = join(root, '.preview')
  const demo = join(out, 'demo')
  const app = join(demo, 'app')
  await build(app, false)
  writeFileSync(
    join(app, 'index.html'),
    preparePreviewHtml(readFileSync(join(app, 'index.html'), 'utf8'))
  )
  for (const script of new Bun.Glob('assets/*.js').scanSync({ cwd: app })) {
    const file = join(app, script)
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replaceAll('"/icons/', '"./icons/')
    )
  }
  mkdirSync(out, { recursive: true })
  copyFileSync(join(root, 'site/demo/index.html'), join(demo, 'index.html'))
  copyPreviewRootAssets(out)
  const manifest = JSON.parse(
    readFileSync(join(root, 'SOURCE_MANIFEST.json'), 'utf8')
  )
  const files = [
    ...new Bun.Glob('**/*').scanSync({ cwd: out, onlyFiles: true })
  ].sort()
  const sha256 = (file: string) =>
    createHash('sha256').update(readFileSync(file)).digest('hex')
  writeFileSync(
    join(out, 'preview-proof.json'),
    JSON.stringify(
      {
        sourcePin: manifest.pin,
        enclosingForkHead: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8'
        }).trim(),
        testHooks: false,
        sourceManifestSha256: sha256(join(root, 'SOURCE_MANIFEST.json')),
        files: files
          .filter((file) => file !== 'preview-proof.json')
          .map((path) => ({ path, sha256: sha256(join(out, path)) }))
      },
      null,
      2
    ) + '\n'
  )
  console.log(`Static fictional preview: ${out}`)
}

if (import.meta.main) await buildPreview()
