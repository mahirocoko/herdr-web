import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdtemp,
  rm,
  lstat,
  symlink,
  readFile,
  writeFile
} from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  ImageUploadStore,
  MAX_UPLOAD_BYTES,
  UPLOAD_TTL_MS,
  readUploadBody,
  validateUploadImage
} from '../image-upload.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=',
  'base64'
)
const scope = {
  paneId: 'a:b',
  terminalId: 'terminal',
  agentSessionId: 'session',
  generation: '1'
}
let root: string
let directory: string
let now: number
let store: ImageUploadStore
beforeEach(async () => {
  root = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'herdr-upload-')))
  directory = path.join(root, 'uploads')
  now = Date.now()
  store = new ImageUploadStore(directory, () => now)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('bounded upload storage checkpoint', () => {
  test('opaque ID, private permissions and exact scope preview/remove', async () => {
    const result = await store.upload(png, 'image/png', scope)
    expect(result.imageId).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(result)).not.toContain(directory)
    expect(
      (await lstat(path.join(directory, `${result.imageId}.png`))).mode & 0o777
    ).toBe(0o600)
    expect((await store.preview(result.imageId, scope)).data).toEqual(png)
    for (const changed of [
      { terminalId: 'new' },
      { agentSessionId: 'new' },
      { generation: '2' },
      { paneId: 'a:c' }
    ])
      await expect(
        store.preview(result.imageId, { ...scope, ...changed })
      ).rejects.toThrow('unavailable')
    await expect(
      store.remove(result.imageId, { ...scope, generation: '2' })
    ).rejects.toThrow()
    await store.remove(result.imageId, scope)
    await expect(store.preview(result.imageId, scope)).rejects.toThrow()
  })
  test('freezes caller bytes and scope before asynchronous storage admission', async () => {
    const bytes = Buffer.from(png)
    const target = { ...scope }
    const pending = store.upload(bytes, 'image/png', target)
    bytes.fill(0)
    target.terminalId = 'replacement'
    const result = await pending
    expect((await store.preview(result.imageId, scope)).data).toEqual(png)
    await expect(store.preview(result.imageId, target)).rejects.toThrow()
  })
  test('rejects spoofed magic, SVG, WebP, empty, oversized and incomplete images', () => {
    for (const [data, mime] of [
      [Buffer.from('<svg/>'), 'image/png'],
      [png, 'image/svg+xml'],
      [png, 'image/webp'],
      [Buffer.alloc(0), 'image/png'],
      [Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'image/png'],
      [png.subarray(0, 33), 'image/png']
    ] as const)
      expect(() => validateUploadImage(data, mime)).toThrow()
    const animated = Buffer.concat([
      png.subarray(0, 33),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('acTL'),
      Buffer.alloc(4),
      png.subarray(33)
    ])
    expect(() => validateUploadImage(animated, 'image/png')).toThrow('Animated')
  })
  test('bounds dimensions and body before allocating decoded images', async () => {
    const huge = Buffer.from(png)
    huge.writeUInt32BE(99999, 16)
    expect(() => validateUploadImage(huge, 'image/png')).toThrow()
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'content-length': String(MAX_UPLOAD_BYTES + 1) },
      body: png
    })
    await expect(readUploadBody(request)).rejects.toThrow('limit')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES))
        controller.enqueue(new Uint8Array(1))
        controller.close()
      }
    })
    await expect(
      readUploadBody(
        new Request('http://localhost', { method: 'POST', body: stream })
      )
    ).rejects.toThrow('limit')
  })
  test('rejects path traversal IDs and symlinked uploaded files', async () => {
    const result = await store.upload(png, 'image/png', scope)
    await expect(store.preview('../secret', scope)).rejects.toThrow()
    const location = path.join(directory, `${result.imageId}.png`)
    const outside = path.join(root, 'outside.png')
    await writeFile(outside, png)
    await rm(location)
    await symlink(outside, location)
    await expect(store.preview(result.imageId, scope)).rejects.toThrow()
    await store.remove(result.imageId, scope)
    expect(await readFile(outside)).toEqual(png)
  })
  test('rejects symlink store and malicious manifest without deleting foreign files', async () => {
    await store.startup()
    await writeFile(
      path.join(directory, 'manifest.json'),
      JSON.stringify([{ id: 'a'.repeat(64), file: '../outside.png' }])
    )
    await expect(new ImageUploadStore(directory).startup()).rejects.toThrow(
      'manifest'
    )
    const linked = path.join(root, 'linked')
    await symlink(directory, linked)
    await expect(new ImageUploadStore(linked).startup()).rejects.toThrow(
      'Unsafe'
    )
  })
  test('startup removes only generated crash orphans, preserving foreign entries', async () => {
    await store.startup()
    const orphan = path.join(directory, `${'b'.repeat(64)}.png`)
    const foreign = path.join(directory, 'operator-note.txt')
    await writeFile(orphan, png)
    await writeFile(foreign, 'keep')
    await new ImageUploadStore(directory, () => now).startup()
    await expect(lstat(orphan)).rejects.toThrow()
    expect(await readFile(foreign, 'utf8')).toBe('keep')
  })
  test('restart invalidates IDs but retains agent-readable bytes until the shared 24h TTL', async () => {
    const result = await store.upload(png, 'image/png', scope)
    const restarted = new ImageUploadStore(directory, () => now)
    await restarted.startup()
    await expect(restarted.preview(result.imageId, scope)).rejects.toThrow()
    expect(
      await readFile(path.join(directory, `${result.imageId}.png`))
    ).toEqual(png)
    now += UPLOAD_TTL_MS
    await restarted.startup()
    await expect(
      lstat(path.join(directory, `${result.imageId}.png`))
    ).rejects.toThrow()
  })
  test('body cancellation retires an in-progress stream and body admission is bounded', async () => {
    const abort = new AbortController()
    const request = new Request('http://localhost', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]))
        }
      }),
      signal: abort.signal
    })
    const pending = readUploadBody(request)
    abort.abort()
    await expect(pending).rejects.toThrow('cancelled')
    const releaseA = store.admitBody()
    const releaseB = store.admitBody()
    expect(() => store.admitBody()).toThrow('quota')
    releaseA()
    releaseA()
    releaseB()
    store.admitBody()()
  })
  test('JPEG marker structure requires one supported frame and complete scan, not only SOF magic', () => {
    const sof = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0
    ])
    const jpeg = Buffer.concat([
      sof,
      Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x2b, 0xff, 0xd9])
    ])
    expect(validateUploadImage(jpeg, 'image/jpeg').mime).toBe('image/jpeg')
    expect(() =>
      validateUploadImage(
        Buffer.concat([sof, Buffer.from([0xff, 0xd9])]),
        'image/jpeg'
      )
    ).toThrow('scan')
    expect(() =>
      validateUploadImage(jpeg.subarray(0, jpeg.length - 1), 'image/jpeg')
    ).toThrow()
  })
  test('pre-aborted upload creates no attachment and quotas refuse excess attempts', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(
      store.upload(png, 'image/png', scope, abort.signal)
    ).rejects.toThrow('cancelled')
    for (let index = 0; index < 7; index++)
      await store.upload(png, 'image/png', scope)
    await expect(store.upload(png, 'image/png', scope)).rejects.toThrow('quota')
  })
})
