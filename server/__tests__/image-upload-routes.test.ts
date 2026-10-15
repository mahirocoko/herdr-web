import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../index.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import { ImageUploadStore } from '../image-upload.ts'
import { ImageUploadService } from '../image-upload-service.ts'
import { imagePromptBytes } from '../../src/types/image-upload.ts'
import type { ISnapshotResult } from '../types.ts'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=',
  'base64'
)
const target = {
  paneId: 'ws:p1',
  terminalId: 't1',
  expectedMode: 'agent' as const
}
let root: string
let server: ReturnType<typeof createServer>
let snapshot: ISnapshotResult
let writes: string[]
let reads: number
let screen: string
let failWrite: boolean
beforeEach(async () => {
  root = realpathSync(
    await mkdtemp(path.join(os.tmpdir(), 'herdr-image-routes-'))
  )
  writes = []
  reads = 0
  screen = 'Working on the task'
  failWrite = false
  snapshot = {
    protocol: 22,
    version: '0.9.4',
    workspaces: [],
    tabs: [],
    panes: [
      {
        pane_id: 'ws:p1',
        terminal_id: 't1',
        workspace_id: 'ws',
        tab_id: 'tab',
        agent: 'letta',
        agent_status: 'working',
        cwd: null,
        focused: false,
        tokens: {
          letta_scope: '0123456789abcdef',
          letta_started_at: '1792036096468'
        }
      }
    ]
  }
  server = createServer(0, '127.0.0.1', {
    startPushBridge: false,
    deps: {
      imageUploadDirectory: path.join(root, 'uploads'),
      coordinator: new OperationCoordinator(),
      fetchSnapshot: async () => {
        reads++
        return snapshot
      },
      promptDeps: { readScreen: async () => screen },
      executePrompt: async (_pane, text) => {
        writes.push(text)
        if (failWrite) throw new Error(`native lost ACK ${root}`)
        return { text }
      }
    }
  })
})
afterEach(async () => {
  server.stop(true)
  await rm(root, { recursive: true, force: true })
})
const url = (route: string) => `http://127.0.0.1:${server.port}${route}`
const headers = () => ({
  origin: `http://127.0.0.1:${server.port}`,
  'x-herdr-image-target': JSON.stringify(target)
})
const upload = (data: Buffer = png, mime = 'image/png') =>
  fetch(url('/api/media/uploads'), {
    method: 'POST',
    headers: { ...headers(), 'content-type': mime },
    body: new Uint8Array(data)
  })
const action = (
  imageId: string,
  text = 'Look at this',
  operationId = crypto.randomUUID(),
  type = 'prompt'
) =>
  fetch(url('/api/action'), {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ type, operationId, target, text, imageId })
  })
const image = (id: string, method = 'GET') =>
  fetch(url(`/api/media/uploads/${id}`), { method, headers: headers() })

test('real HTTP auth precedes body/snapshot, raw uploads reject unsupported and oversized bodies', async () => {
  for (const method of ['POST', 'GET', 'DELETE']) {
    const result = await fetch(
      url(
        method === 'POST'
          ? '/api/media/uploads'
          : `/api/media/uploads/${'a'.repeat(64)}`
      ),
      {
        method,
        headers: { origin: 'https://evil.example' },
        ...(method === 'POST' ? { body: 'invalid' } : {})
      }
    )
    expect(result.status).toBe(403)
  }
  expect(reads).toBe(0)
  expect((await upload(Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(
    415
  )
  expect((await upload(Buffer.from('<html/>'))).status).toBe(409)
  expect((await upload(Buffer.alloc(8 * 1024 * 1024 + 1))).status).toBe(413)
  expect(writes).toHaveLength(0)
})
test('session-less native Letta runtime uploads, authorized Blob preview, exact byte-cost Send and retained ACK bytes', async () => {
  const response = await upload()
  expect(response.status).toBe(200)
  const uploaded = await response.json()
  expect(JSON.stringify(uploaded)).not.toContain(root)
  expect(JSON.stringify(uploaded)).not.toContain('0123456789abcdef')
  const preview = await image(uploaded.imageId)
  expect(preview.headers.get('cache-control')).toBe('no-store')
  expect(preview.headers.get('x-content-type-options')).toBe('nosniff')
  expect(Buffer.from(await preview.arrayBuffer())).toEqual(png)
  const browserGet = await fetch(
    url(`/api/media/uploads/${uploaded.imageId}`),
    {
      headers: {
        'x-herdr-image-target': JSON.stringify(target),
        'x-herdr-image-origin': `http://127.0.0.1:${server.port}`
      }
    }
  )
  expect(browserGet.status).toBe(200)
  expect(
    (
      await fetch(url(`/api/media/uploads/${uploaded.imageId}`), {
        headers: { 'x-herdr-image-target': JSON.stringify(target) }
      })
    ).status
  ).toBe(403)
  const text = 'ภาพทดสอบ'
  const send = await action(uploaded.imageId, text)
  expect(send.status).toBe(200)
  expect(JSON.stringify(await send.json())).not.toContain(root)
  expect(writes[0]).toStartWith(text + '\n\nImage context')
  expect(writes[0]).toContain('use ViewImage to read')
  expect(imagePromptBytes(writes[0])).toBe(
    imagePromptBytes(text, uploaded.imageContextBytes)
  )
  await image(uploaded.imageId, 'DELETE')
  expect((await image(uploaded.imageId)).status).toBe(200)
  expect(
    (await readdir(path.join(root, 'uploads'))).filter((file) =>
      file.endsWith('.png')
    )
  ).toHaveLength(1)
  expect((await action(uploaded.imageId)).status).toBe(409)
})
test('raw JPEG uses the same authenticated route with structural frame/scan validation', async () => {
  // Minimal structural fixture, not an assertion of full codec decodability.
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xda, 0,
    8, 1, 1, 0, 0, 63, 0, 0x2b, 0xff, 0xd9
  ])
  const result = await upload(jpeg, 'image/jpeg')
  expect(result.status).toBe(200)
  const record = await result.json()
  expect((await image(record.imageId)).headers.get('content-type')).toBe(
    'image/jpeg'
  )
  expect((await upload(jpeg.subarray(0, 15), 'image/jpeg')).status).toBe(409)
  expect((await upload(jpeg, 'image/png')).status).toBe(409)
})
test('runtime replacement without agent session blocks preview/delete/Send; no model inference', async () => {
  const uploaded = await (await upload()).json()
  snapshot.panes[0].tokens!.letta_started_at = '1792036096469'
  expect((await image(uploaded.imageId)).status).toBe(409)
  expect((await image(uploaded.imageId, 'DELETE')).status).toBe(409)
  expect((await action(uploaded.imageId)).status).toBe(409)
  expect(writes).toHaveLength(0)
  snapshot.panes[0].agent = 'codex'
  expect((await upload()).status).toBe(409)
  snapshot.panes[0].agent = 'letta'
  delete snapshot.panes[0].tokens!.letta_scope
  const missing = await upload()
  expect(missing.status).toBe(409)
  expect((await missing.json()).error).toContain('runtime identity unavailable')
})
test('whole UTF-8 boundary is exact; Queue refuses image, operation conflict binds imageId and unknown never resends', async () => {
  const first = await (await upload()).json()
  const second = await (await upload()).json()
  expect(
    (await action(first.imageId, 'a'.repeat(4097 - first.imageContextBytes)))
      .status
  ).toBe(409)
  expect(writes).toHaveLength(0)
  expect(
    (await action(first.imageId, 'x', crypto.randomUUID(), 'held-enqueue'))
      .status
  ).toBe(400)
  const op = crypto.randomUUID()
  failWrite = true
  const exact =
    'é'.repeat(Math.floor((4096 - first.imageContextBytes) / 2)) +
    'a'.repeat((4096 - first.imageContextBytes) % 2)
  const send = await action(first.imageId, exact, op)
  expect(send.status).toBe(502)
  expect((await send.json()).outcome).toBe('unknown')
  expect(Buffer.byteLength(writes[0])).toBe(4096)
  expect((await action(first.imageId, exact, op)).status).toBe(502)
  expect((await action(second.imageId, exact, op)).status).toBe(409)
  expect((await action(first.imageId, exact)).status).toBe(409)
  expect(writes).toHaveLength(1)
  expect((await image(second.imageId)).status).toBe(200)
})
test('unknown prompt readiness blocks upload and Send; explicit unsent DELETE is idempotent', async () => {
  const uploaded = await (await upload()).json()
  screen = ''
  expect((await upload()).status).toBe(409)
  expect((await action(uploaded.imageId)).status).toBe(409)
  screen = 'Working on the task'
  expect((await image(uploaded.imageId, 'DELETE')).status).toBe(200)
  expect((await image(uploaded.imageId, 'DELETE')).status).toBe(200)
  expect((await image(uploaded.imageId)).status).toBe(409)
})
test('abort after save cleans the eventual file; late client cancellation remains explicit DELETE/TTL', async () => {
  const abort = new AbortController()
  const store = new ImageUploadStore(path.join(root, 'cancel-store'))
  const original = store.upload
  store.upload = async (...args) => {
    const result = await original(...args)
    abort.abort()
    return result
  }
  const service = new ImageUploadService(store, {
    snapshot: async () => snapshot,
    ready: async () => true,
    owner: () => undefined
  })
  const result = await service.handle(
    new Request('http://localhost:8787/api/media/uploads', {
      method: 'POST',
      headers: {
        ...headers(),
        host: 'localhost:8787',
        origin: 'http://localhost:8787',
        'content-type': 'image/png'
      },
      body: png,
      signal: abort.signal
    })
  )
  expect(result.status).toBe(409)
  expect(
    (await readdir(path.join(root, 'cancel-store'))).filter((file) =>
      file.endsWith('.png')
    )
  ).toHaveLength(0)
})
test('target replacement after save cleans only the new file before responding', async () => {
  const store = new ImageUploadStore(path.join(root, 'stale-store'))
  const original = store.upload
  store.upload = async (...args) => {
    const result = await original(...args)
    snapshot.panes[0].tokens!.letta_scope = 'fedcba9876543210'
    return result
  }
  const service = new ImageUploadService(store, {
    snapshot: async () => snapshot,
    ready: async () => true,
    owner: () => undefined
  })
  const result = await service.handle(
    new Request('http://localhost:8787/api/media/uploads', {
      method: 'POST',
      headers: {
        ...headers(),
        host: 'localhost:8787',
        origin: 'http://localhost:8787',
        'content-type': 'image/png'
      },
      body: png
    })
  )
  expect(result.status).toBe(409)
  expect(
    (await readdir(path.join(root, 'stale-store'))).filter((file) =>
      file.endsWith('.png')
    )
  ).toHaveLength(0)
  expect(
    JSON.parse(
      await readFile(path.join(root, 'stale-store/manifest.json'), 'utf8')
    )
  ).toEqual([])
})
