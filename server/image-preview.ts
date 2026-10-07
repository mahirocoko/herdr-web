import { open, realpath, lstat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { validateOwnerAuth } from './security.ts'
import { getHerdrSnapshot } from './herdr-adapter.ts'
import type { ISnapshotResult } from './types.ts'

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024 // 12 MiB
export const MAX_IMAGE_PATH_BYTES = 4096 // 4 KiB
export const MAX_BODY_STREAM_BYTES = 16 * 1024 // 16 KiB
export const MAX_IMAGE_DIMENSION = 8192 // 8192px per axis
export const MAX_IMAGE_PIXELS = 32 * 1024 * 1024 // 32 MP (33,554,432 pixels)

export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp'
])

export interface IResolveSafePathResult {
  ok: boolean
  status?: number
  error?: string
  realPath?: string
  ext?: string
}

export const resolveSafeImagePath = async (
  inputPath: string,
  baseDir?: string | null
): Promise<IResolveSafePathResult> => {
  if (typeof inputPath !== 'string') {
    return { ok: false, status: 400, error: 'Invalid path: must be a string' }
  }

  if (
    inputPath.trim() === '' ||
    Buffer.byteLength(inputPath, 'utf8') > MAX_IMAGE_PATH_BYTES
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid path: length exceeds limit'
    }
  }

  // Reject NUL and ASCII control characters (0x00-0x1F, 0x7F)
  if (/[\x00-\x1F\x7F]/.test(inputPath)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid path: control characters detected'
    }
  }

  // Reject URL schemes like file:// or http://
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(inputPath) ||
    inputPath.startsWith('file:')
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid path: remote URLs or file schemes rejected'
    }
  }

  const ext = path.extname(inputPath).toLowerCase()
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return { ok: false, status: 400, error: 'Unsupported file extension' }
  }

  let resolvedTarget: string
  if (inputPath.startsWith('~/') || inputPath === '~') {
    resolvedTarget = path.resolve(
      os.homedir(),
      inputPath.slice(inputPath === '~' ? 1 : 2)
    )
  } else if (path.isAbsolute(inputPath)) {
    resolvedTarget = path.resolve(inputPath)
  } else {
    if (
      !baseDir ||
      typeof baseDir !== 'string' ||
      baseDir.trim() === '' ||
      !path.isAbsolute(baseDir)
    ) {
      return {
        ok: false,
        status: 400,
        error: 'Relative image path requires active pane context'
      }
    }
    resolvedTarget = path.resolve(baseDir, inputPath)
  }

  // Canonicalize symlinks and test existence
  let real: string
  try {
    real = await realpath(resolvedTarget)
  } catch {
    return {
      ok: false,
      status: 404,
      error: 'Image not found or access denied'
    }
  }

  return { ok: true, realPath: real, ext }
}

export const detectImageMime = (
  buffer: Uint8Array,
  ext: string
): string | null => {
  const normalizedExt = ext.toLowerCase()

  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    normalizedExt === '.png' &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }

  // JPEG magic: FF D8 FF
  if (
    (normalizedExt === '.jpg' || normalizedExt === '.jpeg') &&
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  // WebP magic: 'RIFF' .... 'WEBP'
  if (
    normalizedExt === '.webp' &&
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // 'R'
    buffer[1] === 0x49 && // 'I'
    buffer[2] === 0x46 && // 'F'
    buffer[3] === 0x46 && // 'F'
    buffer[8] === 0x57 && // 'W'
    buffer[9] === 0x45 && // 'E'
    buffer[10] === 0x42 && // 'B'
    buffer[11] === 0x50 // 'P'
  ) {
    return 'image/webp'
  }

  return null
}

export interface IImageDimensions {
  width: number
  height: number
}

/**
 * Pure bounded PNG dimension parser from IHDR chunk.
 * PNG signature: 8 bytes, IHDR chunk length (4), chunk type 'IHDR' (4), width (4 BE), height (4 BE).
 */
export const parsePngDimensions = (
  buffer: Uint8Array
): IImageDimensions | null => {
  if (buffer.length < 24) return null
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    return null
  }
  // Check chunk type 'IHDR' at offset 12
  if (
    buffer[12] !== 0x49 ||
    buffer[13] !== 0x48 ||
    buffer[14] !== 0x44 ||
    buffer[15] !== 0x52
  ) {
    return null
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)
  return { width, height }
}

/**
 * Pure bounded JPEG dimension parser from SOF segments.
 * Loops through markers, finds SOF0..SOF15 (excluding DHT/JPG/DAC), and extracts width/height.
 */
export const parseJpegDimensions = (
  buffer: Uint8Array
): IImageDimensions | null => {
  if (buffer.length < 4) return null
  // JPEG SOI: FF D8
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  let offset = 2
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null
    }
    // Skip fill 0xFF bytes
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset++
    }
    if (offset >= buffer.length) return null

    const marker = buffer[offset++]
    // Standalone markers without payload
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue
    }
    // EOI (End of image) or SOS (Start of scan - frame header must precede SOS)
    if (marker === 0xd9 || marker === 0xda) {
      break
    }

    if (offset + 2 > buffer.length) return null
    const len = (buffer[offset] << 8) | buffer[offset + 1]
    if (len < 2) return null

    // SOF markers:
    // 0xC0..0xC3, 0xC5..0xC7, 0xC9..0xCB, 0xCD..0xCF
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isSof) {
      if (offset + 7 > buffer.length) return null
      const height = (buffer[offset + 3] << 8) | buffer[offset + 4]
      const width = (buffer[offset + 5] << 8) | buffer[offset + 6]
      return { width, height }
    }

    offset += len
  }

  return null
}

/**
 * Pure bounded WebP dimension parser handling VP8 (lossy), VP8L (lossless), and VP8X (extended).
 */
export const parseWebpDimensions = (
  buffer: Uint8Array
): IImageDimensions | null => {
  // RIFF header + 'WEBP' check
  if (buffer.length < 25) return null
  if (
    buffer[0] !== 0x52 || // 'R'
    buffer[1] !== 0x49 || // 'I'
    buffer[2] !== 0x46 || // 'F'
    buffer[3] !== 0x46 || // 'F'
    buffer[8] !== 0x57 || // 'W'
    buffer[9] !== 0x45 || // 'E'
    buffer[10] !== 0x42 || // 'B'
    buffer[11] !== 0x50 // 'P'
  ) {
    return null
  }

  const c0 = buffer[12]
  const c1 = buffer[13]
  const c2 = buffer[14]
  const c3 = buffer[15]

  // 1. VP8 (Lossy): 'VP8 ' (0x56, 0x50, 0x38, 0x20)
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x20) {
    if (buffer.length < 30) return null
    // Frame tag at 20..22; bit 0 must be 0 (keyframe)
    const frameType = buffer[20] & 0x01
    if (frameType !== 0) return null
    // Start code at 23..25 must be 0x9D, 0x01, 0x2A
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
      return null
    }
    const rawW = buffer[26] | (buffer[27] << 8)
    const rawH = buffer[28] | (buffer[29] << 8)
    const width = rawW & 0x3fff
    const height = rawH & 0x3fff
    return { width, height }
  }

  // 2. VP8L (Lossless): 'VP8L' (0x56, 0x50, 0x38, 0x4C)
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x4c) {
    if (buffer.length < 25) return null
    // Signature byte at 20 must be 0x2F
    if (buffer[20] !== 0x2f) return null
    const b0 = buffer[21]
    const b1 = buffer[22]
    const b2 = buffer[23]
    const b3 = buffer[24]
    const val = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    const width = 1 + (val & 0x3fff)
    const height = 1 + ((val >>> 14) & 0x3fff)
    return { width, height }
  }

  // 3. VP8X (Extended): 'VP8X' (0x56, 0x50, 0x38, 0x58)
  if (c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x58) {
    if (buffer.length < 30) return null
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16))
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
    return { width, height }
  }

  return null
}

export interface IValidateDimensionsResult {
  ok: boolean
  dimensions?: IImageDimensions
  error?: string
}

export const validateImageDimensions = (
  buffer: Uint8Array,
  mime: string,
  maxDimension = MAX_IMAGE_DIMENSION,
  maxPixels = MAX_IMAGE_PIXELS
): IValidateDimensionsResult => {
  let dims: IImageDimensions | null = null
  if (mime === 'image/png') {
    dims = parsePngDimensions(buffer)
  } else if (mime === 'image/jpeg') {
    dims = parseJpegDimensions(buffer)
  } else if (mime === 'image/webp') {
    dims = parseWebpDimensions(buffer)
  }

  if (!dims) {
    return {
      ok: false,
      error: 'Invalid or unparseable image dimensions'
    }
  }

  if (dims.width <= 0 || dims.height <= 0) {
    return {
      ok: false,
      error: 'Invalid image dimensions: width and height must be positive'
    }
  }

  if (dims.width > maxDimension || dims.height > maxDimension) {
    return {
      ok: false,
      error: `Image dimension exceeds limit of ${maxDimension}px per axis`
    }
  }

  const pixels = dims.width * dims.height
  if (pixels > maxPixels) {
    return {
      ok: false,
      error: `Image total resolution exceeds limit of ${maxPixels} pixels (32 MP)`
    }
  }

  return { ok: true, dimensions: dims }
}

export interface IReadValidatedImageResult {
  ok: boolean
  status?: number
  error?: string
  buffer?: Buffer
  mime?: string
  dimensions?: IImageDimensions
}

export const readValidatedImage = async (
  realPath: string,
  ext: string,
  maxBytes = MAX_IMAGE_BYTES
): Promise<IReadValidatedImageResult> => {
  // Preflight check: lstat ensures target is a regular file before open.
  // Rejects FIFOs, directories, symlinks, sockets, devices before opening 'r'.
  let stBefore
  try {
    stBefore = await lstat(realPath)
  } catch {
    return {
      ok: false,
      status: 404,
      error: 'Image not found or access denied'
    }
  }

  if (!stBefore.isFile()) {
    return { ok: false, status: 400, error: 'Target is not a regular file' }
  }

  // Open with O_RDONLY | O_NOFOLLOW | O_NONBLOCK
  // O_NOFOLLOW prevents symlink traversal at leaf.
  // O_NONBLOCK prevents hang on special files or race-created FIFOs.
  let fileHandle
  try {
    const flags =
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
    fileHandle = await open(realPath, flags)
  } catch {
    return {
      ok: false,
      status: 404,
      error: 'Image not found or access denied'
    }
  }

  try {
    // fstat via fileHandle.stat()
    const stAfter = await fileHandle.stat()

    if (!stAfter.isFile()) {
      return { ok: false, status: 400, error: 'Target is not a regular file' }
    }

    // Compare dev and ino identity against preflight lstat
    if (stBefore.dev !== stAfter.dev || stBefore.ino !== stAfter.ino) {
      return { ok: false, status: 400, error: 'File replaced during open' }
    }

    if (stAfter.size > maxBytes) {
      return {
        ok: false,
        status: 413,
        error: 'Image exceeds maximum size limit'
      }
    }

    if (stAfter.size === 0) {
      return { ok: false, status: 400, error: 'Image file is empty' }
    }

    // Recheck canonical path on open to defend against concurrent directory replacement / symlink escape
    let currentReal: string
    try {
      currentReal = await realpath(realPath)
    } catch {
      return {
        ok: false,
        status: 404,
        error: 'Image not found or access denied'
      }
    }

    // Verify canonical recheck device and inode match opened file descriptor
    try {
      const canonicalStat = await lstat(currentReal)
      if (
        canonicalStat.dev !== stAfter.dev ||
        canonicalStat.ino !== stAfter.ino
      ) {
        return {
          ok: false,
          status: 400,
          error: 'File identity mismatch after canonical recheck'
        }
      }
    } catch {
      return {
        ok: false,
        status: 404,
        error: 'Image not found or access denied'
      }
    }

    const buf = Buffer.alloc(stAfter.size)
    const { bytesRead } = await fileHandle.read(buf, 0, stAfter.size, 0)
    if (bytesRead !== stAfter.size) {
      return { ok: false, status: 500, error: 'Failed to read complete file' }
    }

    const mime = detectImageMime(buf, ext)
    if (!mime) {
      return {
        ok: false,
        status: 400,
        error: 'File format mismatch: magic bytes do not match extension'
      }
    }

    // Dimension bounds check: 8192px per axis, 32 MP total (defends against decompression bombs)
    const dimResult = validateImageDimensions(buf, mime)
    if (!dimResult.ok) {
      return {
        ok: false,
        status: 400,
        error: dimResult.error || 'Image dimensions exceed allowed limits'
      }
    }

    return {
      ok: true,
      buffer: buf,
      mime,
      dimensions: dimResult.dimensions
    }
  } finally {
    await fileHandle.close()
  }
}

export interface IImagePreviewOptions {
  ownerLogin?: string
  fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
}

export const handleImagePreviewRequest = async (
  req: Request,
  options: IImagePreviewOptions = {}
): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Method Not Allowed' }),
      {
        status: 405,
        headers: { 'content-type': 'application/json' }
      }
    )
  }

  const hostHeader = req.headers.get('host')
  const originHeader = req.headers.get('origin')

  // Auth BEFORE any filesystem, body reading, or native RPC/snapshot
  const auth = validateOwnerAuth(
    req,
    hostHeader,
    originHeader,
    options.ownerLogin,
    {
      requireOrigin: true
    }
  )

  if (!auth.allowed) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: auth.error || 'Forbidden: unauthorized'
      }),
      {
        status: auth.status,
        headers: { 'content-type': 'application/json' }
      }
    )
  }

  const cType = (req.headers.get('content-type') || '').toLowerCase()
  if (!cType.includes('application/json')) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Content-Type must be application/json'
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const cLen = req.headers.get('content-length')
  if (cLen) {
    const len = parseInt(cLen, 10)
    if (!Number.isNaN(len) && len > MAX_BODY_STREAM_BYTES) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Payload exceeds limit' }),
        { status: 413, headers: { 'content-type': 'application/json' } }
      )
    }
  }

  // Stream bounded body: cancel stream if exceeding MAX_BODY_STREAM_BYTES (16 KiB)
  if (!req.body) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing request body' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        totalBytes += value.length
        if (totalBytes > MAX_BODY_STREAM_BYTES) {
          await reader.cancel('Payload too large')
          return new Response(
            JSON.stringify({ ok: false, error: 'Payload exceeds limit' }),
            { status: 413, headers: { 'content-type': 'application/json' } }
          )
        }
        chunks.push(value)
      }
    }
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Failed to read request body' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const bodyBuffer = Buffer.concat(chunks)
  // Check UTF-8 byte cap: 4096 bytes
  if (bodyBuffer.length > MAX_IMAGE_PATH_BYTES) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Payload exceeds limit' }),
      { status: 413, headers: { 'content-type': 'application/json' } }
    )
  }

  let body: unknown
  try {
    const text = bodyBuffer.toString('utf8')
    body = JSON.parse(text)
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid JSON body' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('path' in body) ||
    typeof (body as { path: unknown }).path !== 'string'
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Missing or invalid "path" field in request body'
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const inputPath = (body as { path: string }).path
  if (Buffer.byteLength(inputPath, 'utf8') > MAX_IMAGE_PATH_BYTES) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Path exceeds maximum length' }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    )
  }

  const isAbsoluteOrHome =
    inputPath.startsWith('~/') ||
    inputPath === '~' ||
    path.isAbsolute(inputPath)

  let baseDir: string | null = null

  if (!isAbsoluteOrHome) {
    const paneId = (body as { paneId?: unknown }).paneId
    if (typeof paneId !== 'string' || paneId.trim() === '') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Relative image path requires active pane context'
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    }

    const fetchSnapshot = options.fetchSnapshot ?? getHerdrSnapshot
    let snapshot: ISnapshotResult
    try {
      snapshot = await fetchSnapshot(3000)
    } catch {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Pane context unavailable'
        }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      )
    }

    if (!snapshot || !Array.isArray(snapshot.panes)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Pane context unavailable'
        }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      )
    }

    const matchingPanes = snapshot.panes.filter(
      (p) => p && p.pane_id === paneId.trim()
    )
    if (matchingPanes.length !== 1) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Pane not found or access denied'
        }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      )
    }

    const pane = matchingPanes[0]
    // Canonical owner: native IPane.foreground_cwd (nonnull absolute) fallback IPane.cwd
    const fgCwd =
      typeof pane.foreground_cwd === 'string' &&
      pane.foreground_cwd.trim() !== '' &&
      path.isAbsolute(pane.foreground_cwd)
        ? pane.foreground_cwd.trim()
        : null

    const fallbackCwd =
      typeof pane.cwd === 'string' &&
      pane.cwd.trim() !== '' &&
      path.isAbsolute(pane.cwd)
        ? pane.cwd.trim()
        : null

    const authoritativeCwd = fgCwd ?? fallbackCwd
    if (!authoritativeCwd) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Pane working directory unavailable'
        }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      )
    }

    baseDir = authoritativeCwd
  }

  const safePathResult = await resolveSafeImagePath(inputPath, baseDir)
  if (!safePathResult.ok || !safePathResult.realPath || !safePathResult.ext) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: safePathResult.error || 'Access denied'
      }),
      {
        status: safePathResult.status || 400,
        headers: { 'content-type': 'application/json' }
      }
    )
  }

  const readResult = await readValidatedImage(
    safePathResult.realPath,
    safePathResult.ext
  )
  if (!readResult.ok || !readResult.buffer || !readResult.mime) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: readResult.error || 'Failed to read image'
      }),
      {
        status: readResult.status || 400,
        headers: { 'content-type': 'application/json' }
      }
    )
  }

  return new Response(new Uint8Array(readResult.buffer), {
    status: 200,
    headers: {
      'content-type': readResult.mime,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  })
}
