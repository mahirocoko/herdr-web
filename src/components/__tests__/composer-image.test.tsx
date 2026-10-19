import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import PromptComposer from '../prompt-composer.tsx'
import type { IComposerImage } from '../../utils/composer-image.ts'
const image = (): IComposerImage => ({
  file: new File(['png'], 'screenshot.png', { type: 'image/png' }),
  target: { paneId: 'ws:p1', terminalId: 't1', expectedMode: 'agent' },
  scope: 'A:0',
  phase: 'ready',
  protected: false,
  abort: new AbortController(),
  preview: 'blob:owned',
  uploaded: {
    imageId: 'a'.repeat(64),
    mime: 'image/png',
    size: 3,
    expiresAt: Date.now() + 86400000,
    imageContextBytes: 200
  }
})
const render = (attached: IComposerImage | null, text = '') =>
  renderToStaticMarkup(
    <PromptComposer
      paneId="ws:p1"
      terminalId="t1"
      draftText={text}
      isBusy={false}
      onSubmitText={async () => {}}
      onQueueText={async () => {}}
      imageAttachment={{
        image: attached,
        allowed: true,
        notice: null,
        onChoose: () => {},
        onRemove: () => {},
        onRetry: () => {}
      }}
    />
  )
const sendButton = (html: string) =>
  html.match(/<button[^>]*aria-label="Send input"[^>]*>/)?.[0] ?? ''
test('real chooser, glyph attachment control and image-alone Send; image Queue explicitly withheld', () => {
  const html = render(image())
  expect(html).toContain('type="file"')
  expect(html).toContain(
    'accept="image/png,image/jpeg,application/pdf,text/plain,'
  )
  expect(html).toContain('Attach image/file context')
  expect(html).toContain('lucide-paperclip')
  expect(html).toContain('Selected image preview')
  expect(html).toContain('Files cannot be held in Web')
  expect(html).toContain('Send ACK is not file-read proof')
  expect(html).toContain('200 / 4096 UTF-8 bytes including file context')
  expect(sendButton(html)).not.toContain('disabled')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Queue<\/button>/)
})
test('upload/error/unknown and combined oversized states fence Send, without inventing progress', () => {
  for (const phase of ['uploading', 'decoding', 'error', 'handled'] as const) {
    const html = render({ ...image(), phase })
    expect(sendButton(html)).toContain('disabled')
    expect(html).not.toContain('%')
  }
  expect(render(image(), 'กก')).toContain(
    '206 / 4096 UTF-8 bytes including file context'
  )
  expect(
    render({ ...image(), phase: 'uploading', uploaded: undefined }, 'กก')
  ).toContain('6 / 4096 UTF-8 bytes (text only; file context not ready)')
  expect(sendButton(render(image(), 'é'.repeat(1949)))).toContain('disabled')
  expect(render({ ...image(), phase: 'uploading' })).toContain(
    'Cancel file upload'
  )
  expect(
    render({ ...image(), phase: 'error', error: 'Expired or unavailable' })
  ).toContain('Retry file')
})
test('general files stay inert even if an obsolete image preview URL remains', () => {
  const attached = image()
  const html = render({
    ...attached,
    file: new File(['%PDF-1.7'], 'รายงาน.pdf', { type: 'application/pdf' }),
    preview: 'blob:must-not-render',
    uploaded: { ...attached.uploaded!, mime: 'application/pdf' }
  })
  expect(html).toContain('รายงาน.pdf')
  expect(html).toContain('application/pdf')
  expect(html).not.toContain('<img')
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('<object')
  expect(html).not.toContain('blob:must-not-render')
  expect(sendButton(html)).not.toContain('disabled')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Queue<\/button>/)
})
test('ordinary agent composers do not gain image affordances implicitly', () => {
  const html = renderToStaticMarkup(
    <PromptComposer
      paneId="ws:p1"
      agentName="codex"
      isBusy={false}
      onSubmitText={async () => {}}
    />
  )
  expect(html).not.toContain('type="file"')
  expect(html).not.toContain('Attach image/file context')
})
