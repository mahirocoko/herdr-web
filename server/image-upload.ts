// Server-only upload primitive. Not an HTTP route or native attachment API.
// Route admission, fresh Letta/prompt readiness and action claims remain separate owners.
import { constants } from 'node:fs'
import {
  mkdir,
  lstat,
  open,
  opendir,
  realpath,
  rename,
  unlink
} from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { detectImageMime, validateImageDimensions } from './image-preview.ts'

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
const MAX_FILES = 32
const MAX_STORE_BYTES = 64 * 1024 * 1024
const MAX_MANIFEST_BYTES = 64 * 1024
const ID = /^[a-f0-9]{64}$/
const FILE = /^[a-f0-9]{64}\.(png|jpg)$/
export interface IUploadScope {
  paneId: string
  terminalId: string
  agentSessionId: string
  // Captured browser prompt/selection generation, not permission to send.
  generation: string
}
interface IRecord {
  id: string
  file: string
  mime: string
  size: number
  expiresAt: number
  scope: IUploadScope
}
const scopeKey = (scope: IUploadScope) =>
  JSON.stringify([
    scope.paneId,
    scope.terminalId,
    scope.agentSessionId,
    scope.generation
  ])
const validScope = (scope: IUploadScope) =>
  scope &&
  [
    scope.paneId,
    scope.terminalId,
    scope.agentSessionId,
    scope.generation
  ].every(
    (value) =>
      typeof value === 'string' &&
      value.length > 0 &&
      Buffer.byteLength(value, 'utf8') <= 256 &&
      !/[\x00-\x1f\x7f]/.test(value)
  )

export const readUploadBody = async (request: Request): Promise<Buffer> => {
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_UPLOAD_BYTES))
    throw new Error('Image exceeds upload limit')
  if (!request.body) throw new Error('Missing image body')
  const reader = request.body.getReader()
  let timedOut = false
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  const deadline = setTimeout(() => {
    timedOut = true
    cancel()
  }, 15_000)
  request.signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (request.signal.aborted) throw new Error('Upload cancelled')
      const { done, value } = await reader.read()
      if (request.signal.aborted || timedOut)
        throw new Error('Upload cancelled or timed out')
      if (done) break
      total += value.byteLength
      if (total > MAX_UPLOAD_BYTES)
        throw new Error('Image exceeds upload limit')
      chunks.push(value)
    }
    return Buffer.concat(chunks, total)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    clearTimeout(deadline)
    request.signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

// Deliberately excludes WebP until its animated/extended containers are audited.
// This is structural validation and decoder-allocation bounds, not a decoder or sanitizer.
export const validateUploadImage = (data: Buffer, mime: string) => {
  if (!data.length || data.length > MAX_UPLOAD_BYTES)
    throw new Error('Invalid image size')
  const ext =
    mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : null
  if (
    !ext ||
    detectImageMime(data, ext) !== mime ||
    !validateImageDimensions(data, mime).ok
  )
    throw new Error('Only bounded static PNG or JPEG images are supported')
  if (ext === '.png') {
    let offset = 8
    let imageData = false
    let ended = false
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset)
      if (length > data.length - offset - 12)
        throw new Error('Invalid PNG container')
      const type = data.toString('latin1', offset + 4, offset + 8)
      if (
        !/^[A-Za-z]{4}$/.test(type) ||
        (type[0] === type[0].toUpperCase() &&
          !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type))
      )
        throw new Error('Unsupported PNG chunk')
      if (type === 'IHDR') {
        const depths: Record<number, number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16]
        }
        if (
          offset !== 8 ||
          length !== 13 ||
          !depths[data[25]]?.includes(data[24]) ||
          data[26] !== 0 ||
          data[27] !== 0 ||
          data[28] > 1
        )
          throw new Error('Invalid PNG header')
      }
      if (['acTL', 'fcTL', 'fdAT'].includes(type))
        throw new Error('Animated images are unsupported')
      if (offset === 8 && (type !== 'IHDR' || length !== 13))
        throw new Error('Invalid PNG header')
      if (type === 'IDAT') imageData = true
      offset += length + 12
      if (type === 'IEND') {
        ended = length === 0 && offset === data.length
        break
      }
    }
    if (!ended || !imageData) throw new Error('Incomplete PNG image')
  } else {
    if (data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9)
      throw new Error('Incomplete JPEG image')
    let offset = 2
    let scan = false
    let frames = 0
    while (offset < data.length - 2) {
      if (data[offset++] !== 0xff) throw new Error('Invalid JPEG marker')
      while (data[offset] === 0xff) offset++
      const marker = data[offset++]
      if (offset + 2 > data.length) throw new Error('Invalid JPEG segment')
      const length = data.readUInt16BE(offset)
      if (length < 2 || offset + length > data.length - 2)
        throw new Error('Invalid JPEG segment')
      if (
        marker === 0xe2 &&
        data.toString('ascii', offset + 2, offset + 6) === 'MPF\u0000'
      )
        throw new Error('Multi-picture JPEG unsupported')
      if (marker === 0xc0 || marker === 0xc2) frames++
      else if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        throw new Error('Unsupported JPEG frame')
      if (marker === 0xda) {
        scan = frames === 1 && offset + length < data.length - 2
        break
      }
      offset += length
    }
    if (!scan) throw new Error('Incomplete JPEG scan')
  }
  return { ext, mime }
}

export class ImageUploadStore {
  private records: IRecord[] = []
  private removed = new Map<string, string>()
  private consumed = new Set<string>()
  private active = new Set<string>() // Restart invalidates browser IDs, not asynchronous agent reads.
  private initialized = false
  private tail: Promise<unknown> = Promise.resolve()
  private admissions: number[] = []
  private pendingUploads = 0
  private bodyAdmissions: number[] = []
  private pendingBodies = 0
  admitBody = () => {
    this.bodyAdmissions = this.bodyAdmissions.filter(
      (time) => time > this.now() - 60_000
    )
    if (this.pendingBodies >= 2 || this.bodyAdmissions.length >= 8)
      throw new Error('Upload body quota reached')
    this.bodyAdmissions.push(this.now())
    this.pendingBodies++
    let released = false
    return () => {
      if (!released) {
        released = true
        this.pendingBodies--
      }
    }
  }
  constructor(
    private directory: string,
    private now: () => number = Date.now
  ) {
    if (!path.isAbsolute(directory))
      throw new Error('Upload store must be absolute')
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn)
    this.tail = result.catch(() => {})
    return result
  }
  private async assertDirectory() {
    const stat = await lstat(this.directory)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      (await realpath(this.directory)) !== this.directory
    )
      throw new Error('Unsafe upload store')
  }
  private async readFile(name: string, limit: number) {
    await this.assertDirectory()
    const file = await open(
      path.join(this.directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > limit)
        throw new Error('Invalid upload file')
      const data = Buffer.alloc(stat.size)
      const result = await file.read(data, 0, data.length, 0)
      if (result.bytesRead !== data.length)
        throw new Error('Incomplete upload file')
      return data
    } finally {
      await file.close()
    }
  }
  private async persist() {
    await this.assertDirectory()
    const temp = `manifest-${randomBytes(16).toString('hex')}.tmp`
    const file = await open(path.join(this.directory, temp), 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(this.records))
    } finally {
      await file.close()
    }
    await rename(
      path.join(this.directory, temp),
      path.join(this.directory, 'manifest.json')
    )
  }
  private async initialize() {
    if (this.initialized) return
    // Parent must already be the established ignored server-state owner; no recursive path creation.
    await mkdir(this.directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
    await this.assertDirectory()
    let raw: Buffer | null = null
    try {
      raw = await this.readFile('manifest.json', MAX_MANIFEST_BYTES)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (raw) {
      const records: unknown = JSON.parse(raw.toString('utf8'))
      if (!Array.isArray(records) || records.length > MAX_FILES)
        throw new Error('Invalid upload manifest')
      const seen = new Set<string>()
      for (const record of records) {
        if (
          !record ||
          !ID.test(record.id) ||
          !FILE.test(record.file) ||
          record.file !==
            `${record.id}.${record.mime === 'image/png' ? 'png' : 'jpg'}` ||
          !['image/png', 'image/jpeg'].includes(record.mime) ||
          !validScope(record.scope) ||
          !Number.isSafeInteger(record.size) ||
          record.size < 1 ||
          record.size > MAX_UPLOAD_BYTES ||
          !Number.isSafeInteger(record.expiresAt) ||
          record.expiresAt > this.now() + UPLOAD_TTL_MS ||
          seen.has(record.id)
        )
          throw new Error('Invalid upload manifest')
        seen.add(record.id)
      }
      if (
        records.reduce((total, record) => total + record.size, 0) >
        MAX_STORE_BYTES
      )
        throw new Error('Invalid upload quota')
      this.records = records
    }
    // Crash recovery only touches generated entries inside this dedicated owner.
    // Enumerate with a hard cap before deleting anything, never recurse or follow links.
    const entries: string[] = []
    const directory = await opendir(this.directory)
    for await (const entry of directory) {
      if (entries.length >= 128)
        throw new Error('Upload store requires inspection')
      entries.push(entry.name)
    }
    const retained = new Set(this.records.map((record) => record.file))
    for (const name of entries) {
      if (
        (FILE.test(name) && !retained.has(name)) ||
        /^manifest-[a-f0-9]{32}\.tmp$/.test(name)
      ) {
        await this.assertDirectory()
        const entry = await lstat(path.join(this.directory, name))
        if (entry.isFile() || entry.isSymbolicLink())
          await unlink(path.join(this.directory, name))
        else throw new Error('Unsafe upload entry')
      }
    }
    this.initialized = true
  }
  private async prune() {
    await this.assertDirectory()
    for (const record of this.records.filter(
      (record) => record.expiresAt <= this.now()
    )) {
      // unlink never follows a leaf symlink; only exact manifest-allowlisted generated names.
      await unlink(path.join(this.directory, record.file)).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
      this.active.delete(record.id)
      this.consumed.delete(record.id)
    }
    this.records = this.records.filter(
      (record) => record.expiresAt > this.now()
    )
    await this.persist()
  }
  startup = () =>
    this.serial(async () => {
      await this.initialize()
      await this.prune()
    })
  upload = async (
    data: Buffer,
    mime: string,
    scope: IUploadScope,
    signal?: AbortSignal
  ) => {
    if (!validScope(scope)) throw new Error('Exact upload scope required')
    if (this.pendingUploads >= 8) throw new Error('Upload queue full')
    const image = validateUploadImage(data, mime)
    // Freeze caller-owned bytes and scope before entering an asynchronous queue.
    data = Buffer.from(data)
    scope = { ...scope }
    this.pendingUploads++
    try {
      return await this.serial(async () => {
        await this.initialize()
        await this.prune()
        this.admissions = this.admissions.filter(
          (time) => time > this.now() - 60_000
        )
        if (
          this.admissions.length >= 8 ||
          this.records.length >= MAX_FILES ||
          this.records.reduce((total, record) => total + record.size, 0) +
            data.length >
            MAX_STORE_BYTES
        )
          throw new Error('Upload quota reached')
        this.admissions.push(this.now())
        if (signal?.aborted) throw new Error('Upload cancelled')
        const id = randomBytes(32).toString('hex')
        const record: IRecord = {
          id,
          file: `${id}${image.ext}`,
          mime,
          size: data.length,
          expiresAt: this.now() + UPLOAD_TTL_MS,
          scope: { ...scope }
        }
        const file = await open(
          path.join(this.directory, record.file),
          'wx',
          0o600
        )
        try {
          await file.writeFile(data)
          await file.close()
          if (signal?.aborted) throw new Error('Upload cancelled')
          this.records.push(record)
          await this.persist()
          if (signal?.aborted) throw new Error('Upload cancelled')
          this.active.add(id)
          return {
            imageId: id,
            mime,
            size: record.size,
            expiresAt: record.expiresAt
          }
        } catch (error) {
          await file.close().catch(() => {})
          this.records = this.records.filter((item) => item.id !== id)
          await unlink(path.join(this.directory, record.file)).catch(() => {})
          await this.persist()
          throw error
        }
      })
    } finally {
      this.pendingUploads--
    }
  }
  private lookup(id: string, scope: IUploadScope) {
    if (!ID.test(id) || !validScope(scope) || !this.active.has(id))
      throw new Error('Image unavailable')
    const record = this.records.find(
      (record) =>
        record.id === id &&
        record.expiresAt > this.now() &&
        scopeKey(record.scope) === scopeKey(scope)
    )
    if (!record) throw new Error('Image unavailable')
    return record
  }
  preview = (id: string, scope: IUploadScope) =>
    this.serial(async () => {
      const record = this.lookup(id, scope)
      const data = await this.readFile(record.file, MAX_UPLOAD_BYTES)
      if (data.length !== record.size) throw new Error('Image unavailable')
      validateUploadImage(data, record.mime)
      return { data, mime: record.mime }
    })
  // Server-only canonical filename; never serialize this return value to HTTP.
  contextPath = (id: string, mime: string) => {
    if (!ID.test(id) || !['image/png', 'image/jpeg'].includes(mime))
      throw new Error('Image unavailable')
    return path.join(
      this.directory,
      `${id}.${mime === 'image/png' ? 'png' : 'jpg'}`
    )
  }
  consume = (id: string, scope: IUploadScope) =>
    this.serial(async () => {
      const record = this.lookup(id, scope)
      if (this.consumed.has(id))
        throw new Error(
          'Image already submitted; upload again for a new explicit Send'
        )
      const data = await this.readFile(record.file, MAX_UPLOAD_BYTES)
      if (data.length !== record.size) throw new Error('Image unavailable')
      validateUploadImage(data, record.mime)
      this.consumed.add(id) // one-shot before any possible native write; unknown cannot resend
      return this.contextPath(id, record.mime)
    })
  remove = (id: string, scope: IUploadScope) =>
    this.serial(async () => {
      if (validScope(scope) && this.removed.get(id) === scopeKey(scope)) return
      const record = this.lookup(id, scope)
      // Removing composer intent must not remove bytes an asynchronous agent may read.
      if (this.consumed.has(id)) return
      await this.assertDirectory()
      await unlink(path.join(this.directory, record.file))
      this.records = this.records.filter((item) => item.id !== id)
      this.active.delete(id)
      this.removed.set(id, scopeKey(scope))
      if (this.removed.size > 64)
        this.removed.delete(this.removed.keys().next().value!)
      await this.persist()
    })
}
