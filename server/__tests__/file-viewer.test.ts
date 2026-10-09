import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { handleFileViewerRequest } from '../file-viewer.ts'

let root: string
const request = (params: Record<string, string>, extra: RequestInit = {}) =>
  new Request(
    `http://localhost:8787/api/files/view?${new URLSearchParams(params)}`,
    {
      ...extra,
      headers: {
        host: 'localhost:8787',
        ...(extra.headers as Record<string, string>)
      }
    }
  )
const snapshot = async () =>
  ({
    panes: [{ pane_id: 'p', terminal_id: 't', cwd: root, foreground_cwd: root }]
  }) as any
const meta = async (name: string) => {
  const response = await handleFileViewerRequest(
    request({ path: name, pane_id: 'p' }),
    { snapshot }
  )
  expect(response.status).toBe(200)
  return response.json()
}
beforeEach(() => {
  root = fs.mkdtempSync(path.resolve('.agent-state/tmp/file-viewer-fixture-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('owner-selected contextual file reads', () => {
  test('mounted loopback HTTP serves exact ranges and closes its disposable server', async () => {
    fs.writeFileSync(path.join(root, 'http.txt'), 'actual-http-ไทย')
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req) => handleFileViewerRequest(req, { snapshot })
    })
    try {
      const url = new URL('/api/files/view', server.url)
      url.searchParams.set('path', path.join(root, 'http.txt'))
      const info = await (await fetch(url)).json()
      url.search = new URLSearchParams({ ref: info.ref }).toString()
      const response = await fetch(url, { headers: { range: 'bytes=0-5' } })
      expect(response.status).toBe(206)
      expect(await response.text()).toBe('actual')
      expect(response.headers.get('cache-control')).toContain('no-store')
    } finally {
      server.stop(true)
    }
  })
  test('Host/Origin/owner reject before snapshot or path lookup', async () => {
    let calls = 0
    const probe = async () => {
      calls++
      return snapshot()
    }
    const a = await handleFileViewerRequest(
      request(
        { path: 'a', pane_id: 'p' },
        { headers: { host: 'evil.example' } }
      ),
      { snapshot: probe }
    )
    const b = await handleFileViewerRequest(
      request(
        { path: 'a', pane_id: 'p' },
        { headers: { origin: 'https://evil.example' } }
      ),
      { snapshot: probe }
    )
    expect(a.status).toBe(403)
    expect(b.status).toBe(403)
    expect(calls).toBe(0)
  })
  test('Thai text prefix is bounded; download retains full byte stream', async () => {
    const body = 'ไทย🙂\n'.repeat(17000)
    fs.writeFileSync(path.join(root, 'ไทย.log'), body)
    const file = await meta('ไทย.log')
    expect(file.kind).toBe('text')
    const preview = await handleFileViewerRequest(
      request({ ref: file.ref, preview: '1' })
    )
    expect((await preview.arrayBuffer()).byteLength).toBe(64 * 1024)
    const full = await handleFileViewerRequest(
      request({ ref: file.ref, download: '1' })
    )
    expect(await full.text()).toBe(body)
    expect(full.headers.get('content-type')).toStartWith('text/plain')
    expect(full.headers.get('content-disposition')).toStartWith('attachment')
  })
  test('media Range/HEAD/suffix/416 return exact bytes without whole-file buffering', async () => {
    const bytes = Buffer.from(Array.from({ length: 200000 }, (_, i) => i % 256))
    fs.writeFileSync(path.join(root, 'demo.mp4'), bytes)
    const file = await meta('demo.mp4')
    expect(file.kind).toBe('video')
    const range = await handleFileViewerRequest(
      request({ ref: file.ref }, { headers: { range: 'bytes=120-199' } })
    )
    expect(range.status).toBe(206)
    expect(Buffer.from(await range.arrayBuffer())).toEqual(
      bytes.subarray(120, 200)
    )
    expect(range.headers.get('content-range')).toBe('bytes 120-199/200000')
    const head = await handleFileViewerRequest(
      request(
        { ref: file.ref },
        { method: 'HEAD', headers: { range: 'bytes=-10' } }
      )
    )
    expect(head.status).toBe(206)
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')
    const invalid = await handleFileViewerRequest(
      request({ ref: file.ref }, { headers: { range: 'bytes=999999-' } })
    )
    expect(invalid.status).toBe(416)
  })
  test('replaced/symlink-retargeted file cannot reuse old read ref; FIFO never hangs', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'original')
    fs.symlinkSync('a.txt', path.join(root, 'link.txt'))
    const linked = await meta('link.txt')
    fs.renameSync(path.join(root, 'a.txt'), path.join(root, 'old.txt'))
    fs.writeFileSync(path.join(root, 'a.txt'), 'replacement')
    expect(
      (await handleFileViewerRequest(request({ ref: linked.ref }))).status
    ).toBe(409)
    const fifo = path.join(root, 'fifo')
    Bun.spawnSync(['/usr/bin/mkfifo', fifo])
    expect(
      (await handleFileViewerRequest(request({ path: fifo }))).status
    ).toBe(404)
  })
  test('directory paging, exact suffix candidates and changed relative context', async () => {
    fs.mkdirSync(path.join(root, 'one'))
    fs.mkdirSync(path.join(root, 'two'))
    fs.writeFileSync(path.join(root, 'one', 'x.ts'), 'one')
    fs.writeFileSync(path.join(root, 'two', 'x.ts'), 'two')
    fs.writeFileSync(path.join(root, 'notx.ts'), 'wrong')
    const choices = await meta('x.ts')
    expect(choices.candidates).toHaveLength(2)
    for (let i = 0; i < 210; i++)
      fs.writeFileSync(path.join(root, `${i}.txt`), '')
    const dir = await meta(root)
    expect(dir.items).toHaveLength(200)
    expect(dir.hasMore).toBe(true)
    let calls = 0
    const changed = async () =>
      ({
        panes: [
          {
            pane_id: 'p',
            terminal_id: ++calls === 1 ? 't' : 'other',
            cwd: root
          }
        ]
      }) as any
    expect(
      (
        await handleFileViewerRequest(
          request({ path: 'one/x.ts', pane_id: 'p' }),
          { snapshot: changed }
        )
      ).status
    ).toBe(409)
  })
  test('HTML remains plain text; SVG sandbox; PDF/audio type and cancellation', async () => {
    fs.writeFileSync(
      path.join(root, 'a.html'),
      '<script>notExecuted()</script>'
    )
    fs.writeFileSync(
      path.join(root, 'a.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>'
    )
    fs.writeFileSync(path.join(root, 'a.pdf'), '%PDF-1.7\nfixture')
    fs.writeFileSync(path.join(root, 'a.mp3'), 'ID3fixture')
    const html = await meta('a.html'),
      svg = await meta('a.svg'),
      pdf = await meta('a.pdf'),
      audio = await meta('a.mp3')
    expect(html.kind).toBe('text')
    expect(svg.kind).toBe('image')
    expect(svg.inlineAllowed).toBe(true)
    expect(pdf.kind).toBe('pdf')
    expect(audio.kind).toBe('audio')
    const response = await handleFileViewerRequest(request({ ref: svg.ref }))
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    await response.body!.cancel()
    expect(
      (await handleFileViewerRequest(request({ ref: html.ref }))).headers.get(
        'content-type'
      )
    ).toStartWith('text/plain')
  })
  test('tiny oversized SVG and excessive vector complexity keep download, not inline', async () => {
    fs.writeFileSync(
      path.join(root, 'huge.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="100000000" height="100000000"/>'
    )
    fs.writeFileSync(
      path.join(root, 'busy.svg'),
      `<svg>${'<path d="M0 0"/>'.repeat(2100)}</svg>`
    )
    const huge = await meta('huge.svg'),
      busy = await meta('busy.svg')
    expect(huge.inlineAllowed).toBe(false)
    expect(busy.inlineAllowed).toBe(false)
    expect(
      await (
        await handleFileViewerRequest(request({ ref: huge.ref, download: '1' }))
      ).text()
    ).toContain('100000000')
  })
})
