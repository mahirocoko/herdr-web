import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import {
  resolveSafeImagePath,
  readValidatedImage,
  detectImageMime,
  parsePngDimensions,
  parseJpegDimensions,
  parseWebpDimensions,
  validateImageDimensions,
  handleImagePreviewRequest,
  MAX_IMAGE_BYTES
} from '../image-preview.ts'
import type { ISnapshotResult } from '../types.ts'

describe('server/image-preview', () => {
  let tempDir: string
  let realTempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'herdr-preview-test-'))
    realTempDir = realpathSync(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  // Helper to build a valid PNG IHDR buffer
  const createPngBuffer = (
    w: number,
    h: number,
    customPayload?: number
  ): Buffer => {
    const buf = Buffer.alloc(33)
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0) // magic
    buf.writeUInt32BE(13, 8) // IHDR length
    buf.write('IHDR', 12, 4, 'ascii') // chunk type
    buf.writeUInt32BE(w, 16)
    buf.writeUInt32BE(h, 20)
    buf.set([0x08, 0x02, 0x00, 0x00, customPayload ?? 0x00], 24)
    buf.writeUInt32BE(0, 29) // CRC
    return buf
  }

  // Helper to build a valid JPEG SOF0 buffer
  const createJpegBuffer = (w: number, h: number): Buffer => {
    const buf = Buffer.alloc(23)
    buf.set([0xff, 0xd8], 0) // SOI
    buf.set([0xff, 0xc0], 2) // SOF0
    buf.writeUInt16BE(17, 4) // SOF length
    buf[6] = 8 // precision
    buf.writeUInt16BE(h, 7) // height
    buf.writeUInt16BE(w, 9) // width
    buf.set([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1], 11)
    buf.set([0xff, 0xd9], 21) // EOI
    return buf
  }

  // Helper to build a valid WebP VP8L buffer
  const createWebpBuffer = (w: number, h: number): Buffer => {
    const buf = Buffer.alloc(25)
    buf.write('RIFF', 0, 4, 'ascii')
    buf.writeUInt32LE(17, 4)
    buf.write('WEBP', 8, 4, 'ascii')
    buf.write('VP8L', 12, 4, 'ascii')
    buf.writeUInt32LE(5, 16) // chunk size
    buf[20] = 0x2f // signature
    const val = (w - 1) | ((h - 1) << 14)
    buf.writeUInt32LE(val >>> 0, 21)
    return buf
  }

  const createMockSnapshot = (panes: any[] = []): ISnapshotResult => ({
    workspaces: [],
    tabs: [],
    panes,
    protocol: 22,
    version: '0.9.3'
  })

  describe('Dimension parsers and bounds', () => {
    it('parses valid PNG dimensions', () => {
      const buf = createPngBuffer(480, 300)
      const dims = parsePngDimensions(buf)
      expect(dims).toEqual({ width: 480, height: 300 })
      const val = validateImageDimensions(buf, 'image/png')
      expect(val.ok).toBe(true)
      expect(val.dimensions).toEqual({ width: 480, height: 300 })
    })

    it('parses valid JPEG dimensions', () => {
      const buf = createJpegBuffer(640, 480)
      const dims = parseJpegDimensions(buf)
      expect(dims).toEqual({ width: 640, height: 480 })
      const val = validateImageDimensions(buf, 'image/jpeg')
      expect(val.ok).toBe(true)
      expect(val.dimensions).toEqual({ width: 640, height: 480 })
    })

    it('parses valid WebP dimensions', () => {
      const buf = createWebpBuffer(320, 240)
      const dims = parseWebpDimensions(buf)
      expect(dims).toEqual({ width: 320, height: 240 })
      const val = validateImageDimensions(buf, 'image/webp')
      expect(val.ok).toBe(true)
      expect(val.dimensions).toEqual({ width: 320, height: 240 })
    })

    it('rejects oversized PNG dimensions (> 8192px per axis)', () => {
      const buf = createPngBuffer(8193, 100)
      const val = validateImageDimensions(buf, 'image/png')
      expect(val.ok).toBe(false)
      expect(val.error).toContain('dimension exceeds limit of 8192px per axis')
    })

    it('rejects oversized JPEG dimensions (> 8192px per axis)', () => {
      const buf = createJpegBuffer(100, 9000)
      const val = validateImageDimensions(buf, 'image/jpeg')
      expect(val.ok).toBe(false)
      expect(val.error).toContain('dimension exceeds limit of 8192px per axis')
    })

    it('rejects oversized WebP dimensions (> 8192px per axis)', () => {
      const buf = createWebpBuffer(8500, 100)
      const val = validateImageDimensions(buf, 'image/webp')
      expect(val.ok).toBe(false)
      expect(val.error).toContain('dimension exceeds limit of 8192px per axis')
    })

    it('rejects total resolution exceeding 32 MP limit', () => {
      const buf = createPngBuffer(8000, 5000)
      const val = validateImageDimensions(buf, 'image/png')
      expect(val.ok).toBe(false)
      expect(val.error).toContain(
        'total resolution exceeds limit of 33554432 pixels (32 MP)'
      )
    })

    it('fails closed on truncated or corrupted headers', () => {
      const truncated = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      const val = validateImageDimensions(truncated, 'image/png')
      expect(val.ok).toBe(false)
      expect(val.error).toContain('Invalid or unparseable image dimensions')
    })
  })

  describe('readValidatedImage & FIFO security', () => {
    it('detects PNG magic bytes and matches .png extension', () => {
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
      ])
      expect(detectImageMime(pngBytes, '.png')).toBe('image/png')
      expect(detectImageMime(pngBytes, '.jpg')).toBe(null)
    })

    it('rejects directories before data read', async () => {
      const subDir = path.join(realTempDir, 'folder.png')
      await mkdir(subDir)

      const res = await readValidatedImage(subDir, '.png')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
      expect(res.error).toContain('not a regular file')
    })

    it('rejects FIFO / named pipe immediately without hanging', async () => {
      const fifoPath = path.join(realTempDir, 'pipe.png')
      try {
        execSync(`mkfifo "${fifoPath}"`)
      } catch {
        return
      }

      let timedOut = false
      const timeoutPromise = new Promise<{
        ok: false
        status: number
        error: string
      }>((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true
          resolve({
            ok: false,
            status: 504,
            error: 'Timed out waiting for FIFO read'
          })
        }, 1000)
        timer.unref()
      })

      const readPromise = readValidatedImage(fifoPath, '.png')
      const res = await Promise.race([readPromise, timeoutPromise])

      expect(timedOut).toBe(false)
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
      expect(res.error).toContain('Target is not a regular file')
    })

    it('rejects file exceeding size limit', async () => {
      const largeFile = path.join(realTempDir, 'large.png')
      await writeFile(largeFile, Buffer.alloc(MAX_IMAGE_BYTES + 10))

      const res = await readValidatedImage(largeFile, '.png')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(413)
      expect(res.error).toContain('exceeds maximum size limit')
    })

    it('reads valid PNG file and returns buffer, mime, and dimensions', async () => {
      const validPng = path.join(realTempDir, 'sample.png')
      const content = createPngBuffer(200, 150)
      await writeFile(validPng, content)

      const res = await readValidatedImage(validPng, '.png')
      expect(res.ok).toBe(true)
      expect(res.mime).toBe('image/png')
      expect(res.buffer).toEqual(content)
      expect(res.dimensions).toEqual({ width: 200, height: 150 })
    })

    it('rejects decompression bomb dimension headers even within 12MiB file limit', async () => {
      const bombFile = path.join(realTempDir, 'bomb.png')
      const content = createPngBuffer(10000, 10000)
      await writeFile(bombFile, content)

      const res = await readValidatedImage(bombFile, '.png')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
      expect(res.error).toContain(
        'Image dimension exceeds limit of 8192px per axis'
      )
    })
  })

  describe('resolveSafeImagePath', () => {
    it('rejects control characters or NUL byte', async () => {
      const res = await resolveSafeImagePath('test\0.png')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
    })

    it('rejects URLs or file scheme', async () => {
      const res = await resolveSafeImagePath('file:///etc/passwd.png')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
    })

    it('rejects unsupported extensions', async () => {
      const res = await resolveSafeImagePath('test.svg')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
    })

    it('resolves valid absolute path outside app directory', async () => {
      const imgPath = path.join(realTempDir, 'outside-absolute.png')
      await writeFile(imgPath, createPngBuffer(100, 100))

      const res = await resolveSafeImagePath(imgPath)
      expect(res.ok).toBe(true)
      expect(res.realPath).toBe(imgPath)
      expect(res.ext).toBe('.png')
    })

    it('resolves valid relative image path using baseDir and allows OS normal .. traversal', async () => {
      const subDirA = path.join(realTempDir, 'sub-a')
      const subDirB = path.join(realTempDir, 'sub-b')
      await mkdir(subDirA)
      await mkdir(subDirB)

      const targetPath = path.join(subDirB, 'target.png')
      await writeFile(targetPath, createPngBuffer(50, 50))

      // From subDirA, resolve ../sub-b/target.png
      const res = await resolveSafeImagePath('../sub-b/target.png', subDirA)
      expect(res.ok).toBe(true)
      expect(res.realPath).toBe(targetPath)
    })

    it('rejects relative path when baseDir is missing or non-absolute', async () => {
      const res1 = await resolveSafeImagePath('relative.png')
      expect(res1.ok).toBe(false)
      expect(res1.status).toBe(400)
      expect(res1.error).toContain(
        'Relative image path requires active pane context'
      )

      const res2 = await resolveSafeImagePath('relative.png', 'relative/dir')
      expect(res2.ok).toBe(false)
      expect(res2.status).toBe(400)
    })

    it('rejects non-existent file with 404', async () => {
      const res = await resolveSafeImagePath(
        path.join(realTempDir, 'non-existent.png')
      )
      expect(res.ok).toBe(false)
      expect(res.status).toBe(404)
    })
  })

  describe('handleImagePreviewRequest', () => {
    it('rejects GET requests with 405 Method Not Allowed', async () => {
      const req = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'GET'
      })
      const res = await handleImagePreviewRequest(req)
      expect(res.status).toBe(405)
    })

    it('rejects unauthorized origin with 403 before snapshot or file access', async () => {
      let snapshotCalled = false
      const mockFetchSnapshot = async (): Promise<ISnapshotResult> => {
        snapshotCalled = true
        return createMockSnapshot([])
      }

      const req = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://malicious.evil',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: 'test.png' })
      })
      const res = await handleImagePreviewRequest(req, {
        fetchSnapshot: mockFetchSnapshot
      })
      expect(res.status).toBe(403)
      expect(snapshotCalled).toBe(false)
    })

    it('cancels stream and returns 413 when body stream exceeds 16 KiB', async () => {
      const largePayload = JSON.stringify({
        path: 'a'.repeat(20 * 1024)
      })

      const req = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: largePayload
      })

      const res = await handleImagePreviewRequest(req)
      expect(res.status).toBe(413)
      const data = await res.json()
      expect(data.error).toBe('Payload exceeds limit')
    })

    it('serves authorized absolute valid image outside app dir without calling fetchSnapshot', async () => {
      const testFile = path.join(realTempDir, 'pic-outside.png')
      const content = createPngBuffer(120, 80)
      await writeFile(testFile, content)

      let snapshotCalled = false
      const mockFetchSnapshot = async (): Promise<ISnapshotResult> => {
        snapshotCalled = true
        return createMockSnapshot([])
      }

      const req = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: testFile })
      })

      const res = await handleImagePreviewRequest(req, {
        fetchSnapshot: mockFetchSnapshot
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')

      const buf = await res.arrayBuffer()
      expect(Buffer.from(buf).equals(content)).toBe(true)
      expect(snapshotCalled).toBe(false) // Absolute path needs no snapshot
    })

    it('relative same filename in Dir A and Dir B returns distinct bytes based on native cwd', async () => {
      const dirA = path.join(realTempDir, 'dir-a')
      const dirB = path.join(realTempDir, 'dir-b')
      await mkdir(dirA)
      await mkdir(dirB)

      const contentA = createPngBuffer(100, 100, 0x11)
      const contentB = createPngBuffer(100, 100, 0x22)
      await writeFile(path.join(dirA, 'chart.png'), contentA)
      await writeFile(path.join(dirB, 'chart.png'), contentB)

      const mockSnapshot: ISnapshotResult = createMockSnapshot([
        {
          pane_id: 'pane-a',
          workspace_id: 'w1',
          tab_id: 't1',
          cwd: dirA,
          agent_status: 'idle',
          focused: true
        },
        {
          pane_id: 'pane-b',
          workspace_id: 'w1',
          tab_id: 't2',
          cwd: dirB,
          agent_status: 'idle',
          focused: false
        }
      ])
      const fetchSnapshot = async () => mockSnapshot

      // Request with pane-a
      const reqA = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: 'chart.png', paneId: 'pane-a' })
      })
      const resA = await handleImagePreviewRequest(reqA, { fetchSnapshot })
      expect(resA.status).toBe(200)
      const bufA = Buffer.from(await resA.arrayBuffer())
      expect(bufA.equals(contentA)).toBe(true)

      // Request with pane-b
      const reqB = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: 'chart.png', paneId: 'pane-b' })
      })
      const resB = await handleImagePreviewRequest(reqB, { fetchSnapshot })
      expect(resB.status).toBe(200)
      const bufB = Buffer.from(await resB.arrayBuffer())
      expect(bufB.equals(contentB)).toBe(true)

      // Prove bytes are distinct
      expect(bufA.equals(bufB)).toBe(false)
    })

    it('prefers foreground_cwd over cwd as canonical owner', async () => {
      const dirFg = path.join(realTempDir, 'dir-fg')
      const dirFallback = path.join(realTempDir, 'dir-fallback')
      await mkdir(dirFg)
      await mkdir(dirFallback)

      const contentFg = createPngBuffer(100, 100, 0xaa)
      const contentFallback = createPngBuffer(100, 100, 0xbb)
      await writeFile(path.join(dirFg, 'doc.png'), contentFg)
      await writeFile(path.join(dirFallback, 'doc.png'), contentFallback)

      const mockSnapshot: ISnapshotResult = createMockSnapshot([
        {
          pane_id: 'pane-mixed',
          workspace_id: 'w1',
          tab_id: 't1',
          foreground_cwd: dirFg,
          cwd: dirFallback,
          agent_status: 'idle',
          focused: true
        }
      ])
      const fetchSnapshot = async () => mockSnapshot

      const req = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: 'doc.png', paneId: 'pane-mixed' })
      })
      const res = await handleImagePreviewRequest(req, { fetchSnapshot })
      expect(res.status).toBe(200)
      const buf = Buffer.from(await res.arrayBuffer())
      expect(buf.equals(contentFg)).toBe(true)
    })

    it('denies relative path with missing paneId or forged caller CWD', async () => {
      const mockSnapshot: ISnapshotResult = createMockSnapshot([
        {
          pane_id: 'pane-valid',
          workspace_id: 'w1',
          tab_id: 't1',
          cwd: realTempDir,
          agent_status: 'idle',
          focused: true
        }
      ])
      const fetchSnapshot = async () => mockSnapshot

      // Missing paneId for relative path -> 400
      const reqMissing = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: 'relative.png' })
      })
      const resMissing = await handleImagePreviewRequest(reqMissing, {
        fetchSnapshot
      })
      expect(resMissing.status).toBe(400)

      // Forged caller CWD does not bypass missing/invalid pane
      const reqForged = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          path: 'relative.png',
          cwd: realTempDir,
          workspace: 'fake',
          root: realTempDir
        })
      })
      const resForged = await handleImagePreviewRequest(reqForged, {
        fetchSnapshot
      })
      expect(resForged.status).toBe(400)
    })

    it('denies relative path on native failure or missing pane context', async () => {
      // Native failure (fetchSnapshot throws) -> 404
      const fetchSnapshotError = async () => {
        throw new Error('Socket disconnected')
      }
      const reqFail = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: 'relative.png', paneId: 'pane-missing' })
      })
      const resFail = await handleImagePreviewRequest(reqFail, {
        fetchSnapshot: fetchSnapshotError
      })
      expect(resFail.status).toBe(404)

      // Pane not found in snapshot -> 404
      const fetchSnapshotEmpty = async (): Promise<ISnapshotResult> =>
        createMockSnapshot([])
      const reqMissing = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: 'relative.png', paneId: 'pane-missing' })
      })
      const resMissingPane = await handleImagePreviewRequest(reqMissing, {
        fetchSnapshot: fetchSnapshotEmpty
      })
      expect(resMissingPane.status).toBe(404)
    })

    it('retains negative validation on wrong magic, SVG, and control chars', async () => {
      const fakePng = path.join(realTempDir, 'fake.png')
      await writeFile(fakePng, '<html><body>Not an image</body></html>')

      const reqMagic = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: fakePng })
      })
      const resMagic = await handleImagePreviewRequest(reqMagic)
      expect(resMagic.status).toBe(400)

      // SVG rejected
      const reqSvg = new Request('http://127.0.0.1:8787/api/media/image', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ path: 'icon.svg' })
      })
      const resSvg = await handleImagePreviewRequest(reqSvg)
      expect(resSvg.status).toBe(400)
    })
  })
})
