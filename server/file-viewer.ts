// MIT License - Copyright (c) 2026 devswha
// File jobs adapted from pinned5979118 file-view.ts; auth/FD streaming are local.
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { validateOwnerAuth } from './security.ts'
import { getHerdrSnapshot } from './herdr-adapter.ts'
import { isInlineSvg } from './svg-inline.ts'
import {
  validateImageDimensions,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS
} from './image-preview.ts'
import type { IViewedFile, FileKind } from '../src/types/file-viewer.ts'

const TEXT_BYTES = 64 * 1024
const PAGE_SIZE = 200
interface IFileLease {
  path: string
  stat: fs.Stats
  mime: string
  kind: FileKind
  expires: number
}
const leases = new Map<string, IFileLease>()
interface IFileOptions {
  ownerLogin?: string
  snapshot?: typeof getHerdrSnapshot
  home?: string
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  })
const same = (a: fs.Stats, b: fs.Stats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs
const open = (name: string) => {
  const fd = fs.openSync(
    name,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  )
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) throw new Error('Not a regular file')
    return { fd, stat }
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}
const classify = (
  name: string,
  fd: number
): { kind: FileKind; mime: string; inlineAllowed?: boolean } => {
  const mime = Bun.file(name).type.split(';')[0] || 'application/octet-stream'
  if (mime.startsWith('image/')) {
    if (mime === 'image/svg+xml') {
      const size = fs.fstatSync(fd).size
      if (size > 256 * 1024)
        return { kind: 'image', mime, inlineAllowed: false }
      const bytes = Buffer.alloc(size)
      const read = fs.readSync(fd, bytes, 0, size, 0)
      return {
        kind: 'image',
        mime,
        inlineAllowed: read === size && isInlineSvg(bytes, size)
      }
    }
    const header = Buffer.alloc(64 * 1024)
    const count = fs.readSync(fd, header, 0, header.length, 0)
    const bytes = header.subarray(0, count)
    const gif =
      mime === 'image/gif' &&
      count >= 10 &&
      /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
        ? { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
        : null
    return {
      kind: 'image',
      mime,
      inlineAllowed:
        Boolean(
          gif &&
          gif.width > 0 &&
          gif.height > 0 &&
          gif.width <= MAX_IMAGE_DIMENSION &&
          gif.height <= MAX_IMAGE_DIMENSION &&
          gif.width * gif.height <= MAX_IMAGE_PIXELS
        ) || validateImageDimensions(bytes, mime).ok
    }
  }
  if (mime.startsWith('video/')) return { kind: 'video', mime }
  if (mime.startsWith('audio/')) return { kind: 'audio', mime }
  if (mime === 'application/pdf') return { kind: 'pdf', mime }
  const sample = Buffer.alloc(8192)
  const count = fs.readSync(fd, sample, 0, sample.length, 0)
  return {
    kind: sample.subarray(0, count).includes(0) ? 'binary' : 'text',
    mime
  }
}
const candidates = (cwd: string, suffix: string) => {
  const queue = [cwd],
    found: string[] = []
  let count = 0
  while (queue.length && count < 5000 && found.length < 30) {
    const dir = fs.opendirSync(queue.shift()!)
    try {
      let entry: fs.Dirent | null
      while ((entry = dir.readSync()) && count++ < 5000) {
        if (
          entry.isSymbolicLink() ||
          ['.git', 'node_modules', '.ssh', '.aws'].includes(entry.name)
        )
          continue
        const file = path.join(dir.path, entry.name)
        if (entry.isDirectory()) queue.push(file)
        else if (entry.isFile()) {
          const relative = path.relative(cwd, file).split(path.sep).join('/')
          if (relative === suffix || relative.endsWith(`/${suffix}`))
            found.push(file)
        }
      }
    } finally {
      dir.closeSync()
    }
  }
  return found
}

export const handleFileViewerRequest = async (
  req: Request,
  options: IFileOptions = {}
): Promise<Response> => {
  const auth = validateOwnerAuth(
    req,
    req.headers.get('host'),
    req.headers.get('origin'),
    options.ownerLogin,
    { requireOrigin: false }
  )
  if (!auth.allowed)
    return json({ error: auth.error ?? 'Unauthorized' }, auth.status)
  if (!['GET', 'HEAD'].includes(req.method))
    return json({ error: 'Method not allowed' }, 405)
  const url = new URL(req.url),
    q = url.searchParams
  if (
    [...q.keys()].some(
      (k) =>
        !['path', 'pane_id', 'offset', 'ref', 'download', 'preview'].includes(
          k
        ) || q.getAll(k).length !== 1
    )
  )
    return json({ error: 'Invalid file request' }, 400)
  try {
    if (q.has('ref')) {
      if (q.has('path') || q.has('pane_id') || q.has('offset'))
        return json({ error: 'Invalid file request' }, 400)
      const lease = leases.get(q.get('ref')!)
      if (!lease || lease.expires < Date.now())
        return json({ error: 'File view expired; reopen the file' }, 409)
      const opened = open(lease.path)
      const { fd, stat } = opened
      if (!same(stat, lease.stat)) {
        fs.closeSync(fd)
        return json({ error: 'File changed; reopen the file' }, 409)
      }
      let start = 0,
        end =
          q.get('preview') === '1' && lease.kind === 'text'
            ? Math.min(stat.size, TEXT_BYTES) - 1
            : stat.size - 1
      const range = req.headers.get('range')
      if (range && q.get('preview') === '1') {
        fs.closeSync(fd)
        return json({ error: 'Preview and Range cannot be combined' }, 400)
      }
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2])) {
          fs.closeSync(fd)
          return new Response(null, {
            status: 416,
            headers: {
              'content-range': `bytes */${stat.size}`,
              'cache-control': 'no-store'
            }
          })
        }
        if (!match[1]) {
          const length = Number(match[2])
          if (!Number.isSafeInteger(length) || length <= 0) {
            fs.closeSync(fd)
            return new Response(null, {
              status: 416,
              headers: {
                'content-range': `bytes */${stat.size}`,
                'cache-control': 'no-store'
              }
            })
          }
          start = Math.max(0, stat.size - length)
          end = stat.size - 1
          if (!length) start = stat.size
        } else {
          start = Number(match[1])
          end = match[2]
            ? Math.min(Number(match[2]), stat.size - 1)
            : stat.size - 1
        }
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          start > end ||
          start >= stat.size
        ) {
          fs.closeSync(fd)
          return new Response(null, {
            status: 416,
            headers: {
              'content-range': `bytes */${stat.size}`,
              'cache-control': 'no-store'
            }
          })
        }
      }
      const headers = new Headers({
        'content-type':
          lease.kind === 'text' ? 'text/plain; charset=utf-8' : lease.mime,
        'content-length': String(Math.max(0, end - start + 1)),
        'accept-ranges': 'bytes',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': `${q.get('download') === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(path.basename(lease.path))}`
      })
      if (lease.kind !== 'pdf')
        headers.set(
          'content-security-policy',
          "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
        )
      if (range)
        headers.set('content-range', `bytes ${start}-${end}/${stat.size}`)
      if (req.method === 'HEAD') {
        fs.closeSync(fd)
        return new Response(null, { status: range ? 206 : 200, headers })
      }
      let closed = false
      const close = () => {
        if (!closed) {
          closed = true
          fs.closeSync(fd)
          req.signal.removeEventListener('abort', close)
        }
      }
      req.signal.addEventListener('abort', close, { once: true })
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          try {
            if (closed || req.signal.aborted) {
              close()
              controller.close()
              return
            }
            if (!same(fs.fstatSync(fd), stat))
              throw new Error('File changed during read')
            if (start > end) {
              close()
              controller.close()
              return
            }
            const bytes = new Uint8Array(Math.min(64 * 1024, end - start + 1))
            const read = fs.readSync(fd, bytes, 0, bytes.length, start)
            if (!read) throw new Error('File ended during read')
            if (!same(fs.fstatSync(fd), stat))
              throw new Error('File changed during read')
            start += read
            controller.enqueue(bytes.subarray(0, read))
            if (start > end) {
              close()
              controller.close()
            }
          } catch (error) {
            close()
            controller.error(error)
          }
        },
        cancel: close
      })
      return new Response(body, { status: range ? 206 : 200, headers })
    }
    const input = q.get('path')?.trim()
    if (
      !input ||
      Buffer.byteLength(input) > 4096 ||
      /[\x00-\x1f\x7f]/.test(input) ||
      q.has('preview') ||
      q.has('download')
    )
      return json({ error: 'Invalid file path' }, 400)
    let cwd: string | null = null
    const paneId = q.get('pane_id')
    let identity: string | null = null
    if (paneId) {
      const snapshot = await (options.snapshot ?? getHerdrSnapshot)(3000)
      const pane = snapshot.panes.find((p) => p.pane_id === paneId)
      if (!pane) return json({ error: 'Pane unavailable' }, 404)
      cwd = pane.foreground_cwd || pane.cwd || null
      identity = JSON.stringify([pane.terminal_id, cwd])
    }
    const home = options.home ?? os.homedir()
    const name =
      input === '~'
        ? home
        : input.startsWith('~/')
          ? path.resolve(home, input.slice(2))
          : path.isAbsolute(input)
            ? path.resolve(input)
            : cwd
              ? path.resolve(cwd, input)
              : null
    if (!name) return json({ error: 'Relative paths require a pane' }, 400)
    let actual: string
    try {
      actual = fs.realpathSync(name)
    } catch {
      if (
        cwd &&
        !path.isAbsolute(input) &&
        !input.startsWith('~') &&
        !input.startsWith('../')
      ) {
        const found = candidates(cwd, input)
        if (found.length !== 1) {
          if (paneId && identity) {
            const post = (
              await (options.snapshot ?? getHerdrSnapshot)(3000)
            ).panes.find((p) => p.pane_id === paneId)
            if (
              !post ||
              JSON.stringify([
                post.terminal_id,
                post.foreground_cwd || post.cwd || null
              ]) !== identity
            )
              return json({ error: 'Pane changed; reopen the file' }, 409)
          }
          return json(
            found.length ? { candidates: found } : { error: 'File not found' },
            found.length ? 200 : 404
          )
        }
        actual = fs.realpathSync(found[0]!)
      } else return json({ error: 'File not found' }, 404)
    }
    if (paneId && identity) {
      const post = (
        await (options.snapshot ?? getHerdrSnapshot)(3000)
      ).panes.find((p) => p.pane_id === paneId)
      if (
        !post ||
        JSON.stringify([
          post.terminal_id,
          post.foreground_cwd || post.cwd || null
        ]) !== identity
      )
        return json({ error: 'Pane changed; reopen the file' }, 409)
    }
    const stat = fs.lstatSync(actual)
    if (stat.isDirectory()) {
      const offset = Number(q.get('offset') ?? '0')
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 32000)
        return json({ error: 'Invalid directory page' }, 400)
      const items: NonNullable<IViewedFile['items']> = [],
        dir = fs.opendirSync(actual)
      let count = 0,
        entry: fs.Dirent | null
      try {
        while ((entry = dir.readSync()) && count <= offset + PAGE_SIZE) {
          if (count++ < offset) continue
          items.push({
            path: path.join(actual, entry.name),
            name: entry.name,
            directory: entry.isDirectory()
          })
        }
      } finally {
        dir.closeSync()
      }
      return json({
        path: actual,
        name: path.basename(actual),
        parent: path.dirname(actual),
        kind: 'directory',
        mime: '',
        size: 0,
        items: items.slice(0, PAGE_SIZE),
        offset,
        hasMore: items.length > PAGE_SIZE
      } satisfies IViewedFile)
    }
    const file = open(actual)
    try {
      if (!same(stat, file.stat))
        return json({ error: 'File changed; reopen the file' }, 409)
      const type = classify(actual, file.fd),
        ref = crypto.randomBytes(32).toString('hex')
      leases.set(ref, {
        path: actual,
        stat: file.stat,
        ...type,
        expires: Date.now() + 30 * 60 * 1000
      })
      while (leases.size > 128) leases.delete(leases.keys().next().value!)
      return json({
        path: actual,
        name: path.basename(actual),
        parent: path.dirname(actual),
        size: file.stat.size,
        ...type,
        ref
      } satisfies IViewedFile)
    } finally {
      fs.closeSync(file.fd)
    }
  } catch {
    return json({ error: 'File unavailable' }, 404)
  }
}
