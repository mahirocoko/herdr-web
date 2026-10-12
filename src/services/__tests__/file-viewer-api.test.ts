import { afterEach, describe, expect, it } from 'bun:test'
import { fileTextPreview } from '../file-viewer-api.ts'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const reply = (bytes: Uint8Array, status = 200) => {
  globalThis.fetch = Object.assign(
    async () => new Response(new Uint8Array(bytes).buffer, { status }),
    { preconnect: originalFetch.preconnect }
  )
}

describe('file text preview envelope', () => {
  it('omits a split UTF-8 fragment only when the file is truncated', async () => {
    const bytes = new TextEncoder().encode('ไทย🙂')
    reply(bytes.slice(0, -1))
    const signal = new AbortController().signal
    expect(await fileTextPreview('ref', signal, true)).toBe('ไทย')
    expect(await fileTextPreview('ref', signal, false)).toBe('ไทย�')
    reply(bytes)
    expect(await fileTextPreview('ref', signal)).toBe('ไทย🙂')
  })
  it('rejects an oversized or stale preview rather than copying it as a file', async () => {
    const signal = new AbortController().signal
    reply(new Uint8Array(65537))
    await expect(fileTextPreview('ref', signal)).rejects.toThrow('envelope')
    reply(new Uint8Array(), 409)
    await expect(fileTextPreview('ref', signal)).rejects.toThrow('reopen')
  })
})
