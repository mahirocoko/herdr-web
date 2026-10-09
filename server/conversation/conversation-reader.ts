import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { omoAsksAfter, type OmoAsks } from '../omo-ask.ts'
import {
  codexQuestionsAfter,
  unansweredCodexQuestions,
  type ICodexQuestionState,
  type IQueuedQuestion
} from '../codex-questions.ts'

export interface INativePromptEvidence {
  binding: string
  source: IConversationRead['source']
  omo: OmoAsks
  codex: IQueuedQuestion[]
}
import {
  groupContributions,
  reconcileContributions,
  type IConversationContribution,
  type IConversationRead,
  type IConversationToolOutput
} from '../../src/types/conversation.ts'
import {
  nativeContribution,
  nativeRecordedOutput
} from './native-contributions.ts'
import { isAgentPane } from '../security.ts'
import { getHerdrSnapshot } from '../herdr-adapter.ts'
import type { ISnapshotResult, IPane } from '../types.ts'
import { detectImageMime, validateImageDimensions } from '../image-preview.ts'
import {
  resolvePair,
  codexHistoryCandidates,
  isUserCodexHeader,
  type IPairResolution
} from './pair-resolver.ts'
import {
  pairContributions,
  pairImages,
  pairOutputs,
  isPairClear,
  reconcilePairMirrors
} from './pair-parser.ts'
import { pairMetadata } from './pair-metadata.ts'
import { resolveFamily, type IFamilyDeps } from './pi-family-resolver.ts'
import {
  isFamilySource,
  familyContributions,
  familyImages,
  isFamilyClear
} from './pi-family-parser.ts'
import { projectFamilyHistory } from './pi-family-history.ts'

const WINDOW_BYTES = 256 * 1024
/** Whole recorded output is finite and measured in JS UTF-16 code units. */
export const MAX_TOOL_OUTPUT_LENGTH = 2_000_000
/** Includes JSON escaping overhead; no whole-file parsing or content cache. */
export const MAX_NATIVE_ROW_BYTES = 64 * 1024 * 1024
const MAX_NATIVE_HISTORY_VERIFY_BYTES = 512 * 1024 * 1024
const PAGE_CONTRIBUTIONS = 50
const MAX_ROWS = 4096
// Filename-only discovery includes native default/subagent stores. The real
// operator store already contains ~8k entries; content reads remain exact-only.
const MAX_STORE_ENTRIES = 32_768
const cursorKey = crypto.randomBytes(32)
const hash = (data: crypto.BinaryLike) =>
  crypto.createHash('sha256').update(data).digest('hex')

export class ConversationError extends Error {
  readonly status: number
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ConversationError'
    this.status = status
    this.code = code
  }
}
const changed = () =>
  new ConversationError(
    409,
    'Session replaced or invalid cursor',
    'history_changed'
  )
export interface IReadConversationOptions {
  /** Private native prompt consumer; emitted only after all existing descriptor/session fences. */
  promptEvidence?: (evidence: INativePromptEvidence) => void
  before?: string | null
  deps?: IFamilyDeps & {
    fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
    brainRoot?: string
    lettaRoot?: string
  }
}
interface ICursorData {
  endByte: number
  binding: string
  epoch: string
  size: number
  proof: string
  mtime: number
  ctime: number
  output?: {
    kind?: 'image'
    key?: string
    position: number
    end: number
    id: string
    callId?: string
    digest: string
  }
}
interface IObservation {
  epoch: string
  size: number
  proof: string
  mtime: number
  ctime: number
}
// Finite cooperative rewrite checkpoints, never transcript content or a whole-file index.
const observations = new Map<string, IObservation>()
const encodeCursor = (data: ICursorData): string => {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cursorKey, iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final()
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    'base64url'
  )
}
const decodeCursor = (cursor: string): ICursorData | null => {
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null
    const bytes = Buffer.from(cursor, 'base64url')
    if (bytes.length < 29 || bytes.toString('base64url') !== cursor) return null
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      cursorKey,
      bytes.subarray(0, 12)
    )
    decipher.setAuthTag(bytes.subarray(12, 28))
    const data = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final()
      ]).toString('utf8')
    )
    if (
      !Number.isSafeInteger(data.endByte) ||
      data.endByte <= 0 ||
      !Number.isSafeInteger(data.size) ||
      data.size < data.endByte ||
      typeof data.binding !== 'string' ||
      typeof data.epoch !== 'string' ||
      !/^[a-f0-9]{32}$/.test(data.epoch) ||
      typeof data.proof !== 'string' ||
      !Number.isFinite(data.mtime) ||
      !Number.isFinite(data.ctime)
    )
      return null
    return data
  } catch {
    return null
  }
}

interface IOpenedFile {
  fd: number
  file: string
  root: string
  real: string
  stat: fs.Stats
  immutable: boolean
  digest?: string
  head?: { length: number; digest: string }
  physicalSize?: number
  segments?: { file: IOpenedFile; end: number; start?: number }[]
}
const assertPath = (file: string, root: string) => {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new ConversationError(403, 'Transcript unavailable')
  let current = path.resolve(root)
  if (fs.lstatSync(current).isSymbolicLink())
    throw new ConversationError(403, 'Transcript unavailable')
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    if (fs.lstatSync(current).isSymbolicLink())
      throw new ConversationError(403, 'Transcript unavailable')
  }
  const real = fs.realpathSync(file)
  const realRoot = fs.realpathSync(root)
  if (!real.startsWith(realRoot + path.sep))
    throw new ConversationError(403, 'Transcript unavailable')
  return real
}
const openFile = (
  file: string,
  root: string,
  opened: IOpenedFile[],
  immutable = false
): IOpenedFile => {
  const real = assertPath(file, root)
  const before = fs.lstatSync(file)
  if (!before.isFile())
    throw new ConversationError(403, 'Transcript unavailable')
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  )
  const item = { fd, file, root, real, stat: fs.fstatSync(fd), immutable }
  opened.push(item)
  if (!Number.isSafeInteger(item.stat.size) || item.stat.size < 0)
    throw new ConversationError(422, 'Transcript size exceeds supported bounds')
  if (
    !item.stat.isFile() ||
    item.stat.dev !== before.dev ||
    item.stat.ino !== before.ino ||
    assertPath(file, root) !== real
  )
    throw changed()
  return item
}
const readBytes = (
  file: IOpenedFile,
  start: number,
  length: number
): Buffer => {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > WINDOW_BYTES
  )
    throw changed()
  if (file.segments) {
    const chunks: Buffer[] = []
    let base = 0,
      remaining = length,
      position = start
    for (const segment of file.segments) {
      const length = segment.end - (segment.start ?? 0)
      if (position < base + length && remaining > 0) {
        const local = position - base
        const amount = Math.min(remaining, length - local)
        chunks.push(
          readBytes(segment.file, local + (segment.start ?? 0), amount)
        )
        position += amount
        remaining -= amount
      }
      base += segment.end - (segment.start ?? 0)
    }
    if (remaining !== 0) throw changed()
    return Buffer.concat(chunks)
  }
  const buffer = Buffer.alloc(length)
  let count = 0
  while (count < length) {
    const read = fs.readSync(
      file.fd,
      buffer,
      count,
      length - count,
      start + count
    )
    if (!read) throw changed()
    count += read
  }
  return buffer
}
/** Read one bounded native record through the already fenced descriptor. */
const readRowBytes = (file: IOpenedFile, start: number, end: number) => {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > file.stat.size ||
    end - start > MAX_NATIVE_ROW_BYTES + WINDOW_BYTES
  )
    throw new ConversationError(413, 'Native record exceeds read limit')
  const chunks: Buffer[] = []
  for (let offset = start; offset < end; offset += WINDOW_BYTES)
    chunks.push(readBytes(file, offset, Math.min(WINDOW_BYTES, end - offset)))
  return Buffer.concat(chunks)
}

const validateAppendedRecords = (
  file: IOpenedFile,
  start: number,
  source: IConversationRead['source'],
  original: { id: string; callId?: string; kind?: 'image' }
) => {
  const end = file.stat.size
  if (end - start > MAX_NATIVE_HISTORY_VERIFY_BYTES)
    throw new ConversationError(
      413,
      'Native supersession verification exceeds finite limit'
    )
  let pending = Buffer.alloc(0)
  for (let offset = start; offset < end; offset += WINDOW_BYTES) {
    pending = Buffer.concat([
      pending,
      readBytes(file, offset, Math.min(WINDOW_BYTES, end - offset))
    ])
    if (pending.length > MAX_NATIVE_ROW_BYTES + WINDOW_BYTES) throw changed()
    let first = 0
    for (
      let newline = pending.indexOf(10);
      newline >= 0;
      newline = pending.indexOf(10, first)
    ) {
      const line = new TextDecoder('utf-8', { fatal: true }).decode(
        pending.subarray(first, newline)
      )
      first = newline + 1
      if (!line.trim()) continue
      const row = JSON.parse(line)
      if (
        isFamilySource(source) &&
        (isFamilyClear(row) ||
          (original.kind === 'image' &&
            familyContributions(line, 0).some(
              (contribution) => contribution.id === original.id
            )))
      )
        throw changed()
      if (
        (source === 'codex-transcript' || source === 'claude-transcript') &&
        (isPairClear(row, source) ||
          (original.kind === 'image' &&
            pairContributions(line, start + offset + first, source).some(
              (contribution) => contribution.id === original.id
            )))
      )
        throw changed()
      const outputs =
        source === 'codex-transcript' || source === 'claude-transcript'
          ? pairOutputs(row, source)
          : [nativeRecordedOutput(line, source)].filter(
              (value): value is NonNullable<typeof value> => !!value
            )
      if (
        outputs.some(
          (output) =>
            output.id === original.id ||
            (original.callId && output.callId === original.callId)
        )
      )
        throw changed()
    }
    pending = pending.subarray(first)
  }
  // A valid newline-free last row is already source-visible; a torn row is not.
  if (pending.length) {
    let row: any
    try {
      row = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(pending)
      )
    } catch {
      return
    }
    if (
      isFamilySource(source) &&
      (isFamilyClear(row) ||
        (original.kind === 'image' &&
          familyContributions(JSON.stringify(row), 0).some(
            (contribution) => contribution.id === original.id
          )))
    )
      throw changed()
    if (
      (source === 'codex-transcript' || source === 'claude-transcript') &&
      isPairClear(row, source)
    )
      throw changed()
    const output = nativeRecordedOutput(
      JSON.stringify(row),
      source,
      original.id
    )
    if (
      output &&
      (output.id === original.id ||
        (original.callId && output.callId === original.callId))
    )
      throw changed()
  }
}

const proofAt = (file: IOpenedFile, size: number) =>
  hash(
    Buffer.concat([
      readBytes(file, 0, Math.min(size, 4096)),
      readBytes(file, Math.max(0, size - 4096), Math.min(size, 4096))
    ])
  )
const validateFile = (file: IOpenedFile) => {
  if (assertPath(file.file, file.root) !== file.real) throw changed()
  const named = fs.lstatSync(file.file)
  const current = fs.fstatSync(file.fd)
  if (
    !named.isFile() ||
    named.dev !== file.stat.dev ||
    named.ino !== file.stat.ino ||
    current.dev !== file.stat.dev ||
    current.ino !== file.stat.ino ||
    current.size < file.stat.size
  )
    throw changed()
  if (
    (file.immutable || current.size === file.stat.size) &&
    (current.size !== file.stat.size ||
      current.mtimeMs !== file.stat.mtimeMs ||
      current.ctimeMs !== file.stat.ctimeMs)
  )
    throw changed()
  if (file.digest && hash(readBytes(file, 0, file.stat.size)) !== file.digest)
    throw changed()
  if (
    file.head &&
    hash(readBytes(file, 0, file.head.length)) !== file.head.digest
  )
    throw changed()
}
const readMetadata = (file: string, root: string, opened: IOpenedFile[]) => {
  const item = openFile(file, root, opened, true)
  if (item.stat.size > 64 * 1024)
    throw new ConversationError(422, 'Transcript metadata exceeds limit')
  const bytes = readBytes(item, 0, item.stat.size)
  item.digest = hash(bytes)
  return {
    value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    signature: hash(bytes)
  }
}
const claudeClearBoundary = (file: IOpenedFile, session: string) => {
  if (file.stat.size > MAX_NATIVE_HISTORY_VERIFY_BYTES)
    throw new ConversationError(
      413,
      'Native reset verification exceeds finite limit'
    )
  let pending = Buffer.alloc(0),
    position = 0,
    boundary = 0
  for (let offset = 0; offset < file.stat.size; offset += WINDOW_BYTES) {
    pending = Buffer.concat([
      pending,
      readBytes(file, offset, Math.min(WINDOW_BYTES, file.stat.size - offset))
    ])
    if (pending.length > MAX_NATIVE_ROW_BYTES + WINDOW_BYTES)
      throw new ConversationError(413, 'Native reset row exceeds finite limit')
    let first = 0
    for (
      let newline = pending.indexOf(10);
      newline >= 0;
      newline = pending.indexOf(10, first)
    ) {
      const bytes = pending.subarray(first, newline)
      let row: any
      try {
        row = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        )
      } catch {
        /* torn/malformed row is not session evidence */
      }
      if (row?.sessionId !== undefined && row.sessionId !== session)
        throw new ConversationError(422, 'Native session metadata mismatch')
      if (row && isPairClear(row, 'claude-transcript'))
        boundary = position + newline + 1
      first = newline + 1
    }
    pending = pending.subarray(first)
    position += first
  }
  if (pending.length) {
    let row: any
    try {
      row = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(pending)
      )
    } catch {
      /* incomplete native tail */
    }
    if (row?.sessionId !== undefined && row.sessionId !== session)
      throw new ConversationError(422, 'Native session metadata mismatch')
    if (row && isPairClear(row, 'claude-transcript')) boundary = file.stat.size
  }
  return boundary
}

const nativeHead = (file: IOpenedFile) => {
  const bytes = readBytes(file, 0, Math.min(file.stat.size, 64 * 1024))
  const newline = bytes.indexOf(10)
  if (newline < 0 && file.stat.size > bytes.length)
    throw new ConversationError(422, 'Native header exceeds limit')
  const length = newline < 0 ? bytes.length : newline + 1
  file.head = { length, digest: hash(bytes.subarray(0, length)) }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, newline < 0 ? bytes.length : newline)
    )
  )
}
/** Source holdsCut/firstOrdinal semantics, descriptor-fenced and finite (512MiB per cut). */
const codexHistoryFile = (
  active: IOpenedFile,
  root: string,
  opened: IOpenedFile[]
) => {
  const chain: { file: IOpenedFile; end: number }[] = [
    { file: active, end: active.stat.size }
  ]
  let current = active
  for (let depth = 0; depth < 32; depth++) {
    const header = nativeHead(current)
    if (!isUserCodexHeader(header)) throw changed()
    const base = header.payload?.history_base
    if (!base || Object.keys(base).length === 0) {
      const segments = chain.reverse()
      const size = segments.reduce((sum, segment) => sum + segment.end, 0)
      if (!Number.isSafeInteger(size)) throw changed()
      return {
        ...active,
        stat: Object.assign(
          Object.create(Object.getPrototypeOf(active.stat)),
          active.stat,
          { size }
        ),
        segments
      }
    }
    const end = base.end_byte_offset,
      ordinal = base.end_ordinal_exclusive
    if (
      !Number.isSafeInteger(end) ||
      end <= 0 ||
      !Number.isSafeInteger(ordinal) ||
      ordinal <= 0 ||
      end > MAX_NATIVE_HISTORY_VERIFY_BYTES
    )
      throw new ConversationError(
        413,
        'Native history cut exceeds finite verification limit'
      )
    const paths = codexHistoryCandidates(root, base.thread_id)
    if (paths.length > 64)
      throw new ConversationError(422, 'Ambiguous native history')
    const holders: IOpenedFile[] = []
    for (const candidate of paths) {
      if (chain.some((segment) => segment.file.file === candidate)) continue
      const file = openFile(candidate, root, opened)
      const candidateHeader = nativeHead(file)
      if (
        !isUserCodexHeader(candidateHeader) ||
        candidateHeader.payload?.id !== base.thread_id ||
        file.stat.size < end ||
        readBytes(file, end - 1, 1)[0] !== 10
      )
        continue
      const firstOrdinal =
        candidateHeader.payload?.history_base?.end_ordinal_exclusive ?? 0
      if (!Number.isSafeInteger(firstOrdinal) || ordinal <= firstOrdinal)
        continue
      let lines = 0
      for (let offset = 0; offset < end; offset += WINDOW_BYTES) {
        const chunk = readBytes(
          file,
          offset,
          Math.min(WINDOW_BYTES, end - offset)
        )
        for (
          let index = chunk.indexOf(10);
          index >= 0;
          index = chunk.indexOf(10, index + 1)
        )
          lines++
      }
      if (lines === ordinal - firstOrdinal) holders.push(file)
    }
    if (holders.length !== 1)
      throw new ConversationError(422, 'Exact native history cut unavailable')
    current = holders[0]
    chain.push({ file: current, end })
  }
  throw new ConversationError(422, 'Native history depth exceeds limit')
}

const snapshotIdentity = (snapshot: ISnapshotResult, pane: IPane) => {
  const agent = snapshot.agents?.find(
    (a) => a.pane_id === pane.pane_id || a.target === pane.pane_id
  )
  if (
    !snapshot.tabs.some(
      (t) => t.tab_id === pane.tab_id && t.workspace_id === pane.workspace_id
    ) ||
    !snapshot.workspaces.some((w) => w.workspace_id === pane.workspace_id) ||
    !pane.terminal_id ||
    !isAgentPane(pane, snapshot.agents)
  )
    throw changed()
  return {
    provider: pane.agent ?? pane.agent_session?.agent ?? agent?.agent,
    session:
      pane.agent_session?.value ??
      pane.agent_session?.id ??
      agent?.agent_session?.value ??
      agent?.agent_session?.id,
    terminal: pane.terminal_id,
    tab: pane.tab_id,
    workspace: pane.workspace_id,
    scope: pane.tokens?.letta_scope,
    source: pane.agent_session?.source
  }
}

const readWindow = (
  file: IOpenedFile,
  endByte: number,
  source: IConversationRead['source'],
  issueOutputRef: (
    position: number,
    end: number,
    line: string,
    resultId?: string
  ) => string | undefined,
  issueImageRef?: (
    position: number,
    end: number,
    line: string,
    id: string,
    key: string
  ) => string | undefined,
  floorByte = 0,
  taskTitles: ReadonlyMap<string, string> = new Map()
) => {
  const ordinaryStart = Math.max(floorByte, endByte - WINDOW_BYTES)
  let start = ordinaryStart
  // Recover a native row crossing the ordinary tail window (images/outputs can
  // legitimately exceed it). Reverse reads are chunked and strictly finite.
  if (start > 0 && readBytes(file, start - 1, 1)[0] !== 10) {
    const floor = Math.max(floorByte, start - MAX_NATIVE_ROW_BYTES)
    let scan = start
    while (scan > floor) {
      const low = Math.max(floor, scan - WINDOW_BYTES)
      const chunk = readBytes(file, low, scan - low)
      const newline = chunk.lastIndexOf(10)
      if (newline >= 0) {
        start = low + newline + 1
        break
      }
      if (low === 0) {
        start = 0
        break
      }
      scan = low
    }
  }
  let buffer =
    endByte > start ? readRowBytes(file, start, endByte) : Buffer.alloc(0)
  if (start < ordinaryStart) {
    const rowEnd = buffer.indexOf(10)
    try {
      const candidate = new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(0, rowEnd < 0 ? buffer.length : rowEnd)
      )
      // Widen only for an actual recorded output. Ordinary rows retain the
      // established byte-window/cross-page context behavior.
      if (
        !nativeRecordedOutput(candidate, source) &&
        !(isFamilySource(source)
          ? familyImages(JSON.parse(candidate)).length
          : (source === 'codex-transcript' || source === 'claude-transcript') &&
            pairImages(JSON.parse(candidate), source).length)
      )
        throw new Error('not native asset')
    } catch {
      buffer = buffer.subarray(ordinaryStart - start)
      start = ordinaryStart
    }
  }
  let first = 0
  let before = start
  let truncated = false
  if (start > 0 && readBytes(file, start - 1, 1)[0] !== 10) {
    const newline = buffer.indexOf(10)
    if (newline < 0) {
      first = buffer.length
      truncated = true
    } else {
      first = newline + 1
      before = first === buffer.length ? start : start + first
      if (first === buffer.length) truncated = true
    }
  }
  let last = buffer.length
  // A cursor inside an oversized row cannot make its partial suffix a complete record.
  if (endByte < file.stat.size && last > first && buffer[last - 1] !== 10) {
    last = Math.max(first, buffer.lastIndexOf(10) + 1)
    truncated = true
  }
  const contributions: IConversationContribution[] = []
  let rowStart = first
  let rows = 0
  let prior: IConversationContribution | null = null
  while (rowStart < last) {
    let rowEnd = buffer.indexOf(10, rowStart)
    if (rowEnd < 0 || rowEnd > last) rowEnd = last
    const position = start + rowStart
    try {
      const line = new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(rowStart, rowEnd)
      )
      if (line.trim()) {
        const nativeRows =
          source === 'codex-transcript' || source === 'claude-transcript'
            ? pairContributions(line, position, source)
            : isFamilySource(source)
              ? familyContributions(line, position, taskTitles)
              : [nativeContribution(line, position, source)]
        for (const contribution of nativeRows) {
          if (contribution) {
            contribution.endByte = start + Math.min(rowEnd + 1, last)
            for (const part of contribution.parts)
              if (part.kind === 'image') {
                const ref = issueImageRef?.(
                  position,
                  start + rowEnd,
                  line,
                  contribution.id,
                  part.ref
                )
                if (ref) {
                  part.imageRevision = hash(
                    Buffer.from(`${contribution.id}:${part.ref}:${line}`)
                  )
                  part.ref = ref
                } else
                  contribution.parts = contribution.parts.filter(
                    (candidate) => candidate !== part
                  )
              }
            if (contribution.reset) {
              contributions.length = 0
              before = 0
            }
            if (contribution.result) {
              const recorded = nativeRecordedOutput(
                line,
                source,
                contribution.id
              )
              if (recorded) {
                contribution.result.outputRevision = hash(
                  JSON.stringify([
                    recorded.id,
                    recorded.callId,
                    hash(Buffer.from(line))
                  ])
                )
                contribution.result.outputLength = recorded.output.length
                contribution.result.outputLengthUnit = 'utf16-code-units'
                if (
                  recorded.output.length > MAX_TOOL_OUTPUT_LENGTH ||
                  rowEnd - rowStart > MAX_NATIVE_ROW_BYTES
                )
                  contribution.result.outputUnavailable = 'limit-exceeded'
                else if (contribution.result.truncated)
                  contribution.result.outputRef = issueOutputRef(
                    position,
                    start + rowEnd,
                    line,
                    recorded.id
                  )
              }
            }
            if (source === 'agy-transcript') contribution.previousId = prior?.id
            if (contribution.ephemeral) {
              if (prior) prior.endByte = contribution.endByte
            } else prior = contribution
            if (contribution.parts.length > 64) {
              contribution.parts = [
                ...contribution.parts.slice(0, 64),
                { kind: 'notice', text: 'Native row parts truncated in Chat.' }
              ]
              truncated = true
            }
            if (
              contribution.result?.truncated ||
              contribution.parts.some(
                (part) =>
                  ('truncated' in part && part.truncated) ||
                  (part.kind === 'tool' && part.inputTruncated)
              )
            )
              truncated = true
            contributions.push(contribution)
          } else if (source === 'agy-transcript') {
            const native = JSON.parse(line)
            if (
              prior &&
              (native.type === 'EPHEMERAL_MESSAGE' ||
                native.source === 'SYSTEM_SDK' ||
                native.source === 'SYSTEM')
            )
              prior.endByte = start + Math.min(rowEnd + 1, last)
            else prior = null
          }
        }
      }
    } catch {
      prior = null
      truncated = true
      contributions.push({
        id: `bounded-row-${position}`,
        position,
        role: 'notice',
        ts: null,
        parts: [
          {
            kind: 'notice',
            text: 'Malformed, partial or oversized native row omitted in Chat.'
          }
        ]
      })
    }
    rows++
    if (rows >= MAX_ROWS && rowEnd < last) {
      // Keep the newest finite row window; earlier byte material remains pageable.
      contributions.length = 0
      before = start + rowEnd + 1
      rows = 0
      truncated = true
    }
    rowStart = rowEnd + 1
  }
  const unique = reconcileContributions(
    source === 'codex-transcript'
      ? reconcilePairMirrors(contributions)
      : contributions
  ).sort((a, b) => a.position - b.position)
  const retained = unique.slice(-PAGE_CONTRIBUTIONS)
  if (unique.length > retained.length) before = retained[0].position
  if (!retained.some((row) => row.parts.length > 0 || row.result) && before > 0)
    truncated = true
  if (truncated)
    retained.push({
      id: `window-notice-${start}-${endByte}`,
      position: endByte,
      role: 'notice',
      ts: null,
      parts: [
        {
          kind: 'notice',
          text: 'Bounded transcript window (256 KiB; native output/image row projection up to 64 MiB): native data was clipped, omitted or contains no visible chat. Whole recorded output is available only up to 2000000 UTF-16 code units. Earlier messages remain available when a cursor is present.'
        }
      ]
    })
  return {
    contributions: retained,
    before: Math.min(before, endByte - 1),
    truncated,
    start,
    buffer,
    digest: hash(buffer)
  }
}

const readInternal = async (
  paneId: string,
  options: IReadConversationOptions,
  opened: IOpenedFile[],
  outputRequest?: {
    history: string
    ref: string
    token: ICursorData
    result?: IConversationToolOutput
    imageResult?: {
      bytes: Buffer
      mediaType: string
      width: number
      height: number
    }
    imageProof?: { file: IOpenedFile; digest: string }
  }
): Promise<IConversationRead> => {
  if (!/^[a-zA-Z0-9_:-]{1,128}$/.test(paneId))
    throw new ConversationError(400, 'Invalid pane')
  const cursor = options.before ? decodeCursor(options.before) : null
  if (options.before && (!cursor || cursor.output)) throw changed()
  const fetchSnapshot = options.deps?.fetchSnapshot ?? getHerdrSnapshot
  const snapshot = await fetchSnapshot(5000)
  const pane = snapshot.panes.find((p) => p.pane_id === paneId)
  if (!pane) throw new ConversationError(404, `Pane '${paneId}' not found`)
  if (!isAgentPane(pane, snapshot.agents))
    throw new ConversationError(400, `Pane '${paneId}' is not an agent pane`)
  const identity = snapshotIdentity(snapshot, pane)
  const home = process.env.HOME || os.homedir()
  let root: string
  let nativePath: string
  let source: IConversationRead['source']
  let metadataSignature = ''
  let session: string
  let pairResolution: IPairResolution | undefined
  let nativeWitnessBudget = MAX_NATIVE_HISTORY_VERIFY_BYTES
  let familyResolution: Awaited<ReturnType<typeof resolveFamily>> = null
  let familyMetadata:
    import('../../src/types/conversation.ts').IConversationMetadata | undefined
  if (
    ['omp', 'omo', 'gjc', 'pi', 'claude'].includes(identity.provider ?? '') &&
    (!options.deps?.fetchSnapshot || options.deps.nativeRpc)
  ) {
    familyResolution = await resolveFamily(
      paneId,
      pane.foreground_cwd || pane.cwd || '',
      identity.session,
      options.deps ?? {},
      (nativeFile, nativeRoot) =>
        nativeHead(openFile(nativeFile, nativeRoot, opened)),
      (nativeFile, nativeRoot) =>
        readMetadata(nativeFile, nativeRoot, opened).value,
      (nativeFile, nativeRoot) => {
        const item = openFile(nativeFile, nativeRoot, opened, true)
        if (item.stat.size > 8192) throw changed()
        const bytes = readBytes(item, 0, item.stat.size)
        item.digest = hash(bytes)
        return {
          text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          mtime: item.stat.mtimeMs
        }
      },
      snapshot.panes,
      (nativeFile, nativeRoot) => {
        const item = openFile(nativeFile, nativeRoot, opened, true)
        if (item.stat.size > nativeWitnessBudget)
          throw new ConversationError(
            413,
            'Native witness exceeds finite request budget'
          )
        nativeWitnessBudget -= item.stat.size
        let pending = Buffer.alloc(0),
          title: string | null = null
        for (let offset = 0; offset < item.stat.size; offset += WINDOW_BYTES) {
          pending = Buffer.concat([
            pending,
            readBytes(
              item,
              offset,
              Math.min(WINDOW_BYTES, item.stat.size - offset)
            )
          ])
          if (pending.length > MAX_NATIVE_ROW_BYTES + WINDOW_BYTES)
            throw changed()
          let first = 0
          for (
            let newline = pending.indexOf(10);
            newline >= 0;
            newline = pending.indexOf(10, first)
          ) {
            const line = pending.subarray(first, newline)
            if (line.includes('"title"')) {
              try {
                const row = JSON.parse(
                  new TextDecoder('utf-8', { fatal: true }).decode(line)
                )
                const value =
                  row.type === 'session'
                    ? row.title
                    : row.type === 'header_patch'
                      ? row.patch?.title
                      : undefined
                if (typeof value === 'string' && value.trim())
                  title = value.trim()
              } catch {}
            }
            first = newline + 1
          }
          pending = pending.subarray(first)
        }
        let tail = readBytes(
          item,
          Math.max(0, item.stat.size - 64 * 1024),
          Math.min(item.stat.size, 64 * 1024)
        )
        if (item.stat.size > tail.length)
          tail = tail.subarray(tail.indexOf(10) + 1)
        return {
          title,
          text: new TextDecoder('utf-8', { fatal: true }).decode(tail)
        }
      }
    )
  }
  if (familyResolution) {
    root = familyResolution.root
    nativePath = familyResolution.file
    source = familyResolution.source
    session = familyResolution.session
    metadataSignature = hash(familyResolution.signature)
  } else if (identity.provider === 'codex' || identity.provider === 'claude') {
    if (
      options.deps?.fetchSnapshot &&
      options.deps.fetchSnapshot !== getHerdrSnapshot &&
      !options.deps.nativeRpc
    )
      throw new ConversationError(
        404,
        'No supported agent transcript or injected native authority found for pane'
      )
    pairResolution = await resolvePair(
      paneId,
      identity.provider,
      identity.session,
      options.deps ?? {},
      (nativeFile, nativeRoot) => {
        return nativeHead(openFile(nativeFile, nativeRoot, opened))
      },
      (nativeFile, nativeRoot) =>
        readMetadata(nativeFile, nativeRoot, opened).value
    )
    root = pairResolution.root
    nativePath = pairResolution.file
    source = pairResolution.source
    session = pairResolution.session
    metadataSignature = hash(pairResolution.signature)
  } else if (
    (pane.agent_session?.source === 'herdr:antigravity_cli' ||
      identity.provider === 'agy') &&
    typeof identity.session === 'string'
  ) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        identity.session
      )
    )
      throw new ConversationError(400, 'Invalid Agy session ID format')
    source = 'agy-transcript'
    session = identity.session
    root =
      options.deps?.brainRoot ??
      path.join(home, '.gemini/antigravity-cli/brain')
    nativePath = path.join(
      root,
      session,
      '.system_generated/logs/transcript.jsonl'
    )
  } else {
    if (
      identity.provider !== 'letta' ||
      !identity.scope ||
      !/^[0-9a-f]{16}$/.test(identity.scope)
    )
      throw new ConversationError(
        404,
        'No supported agent transcript or session found for pane'
      )
    source = 'letta-transcript'
    root =
      options.deps?.lettaRoot ??
      path.join(home, '.letta/lc-local-backend/conversations')
    let match: string | null = null
    session = ''
    const directory = fs.opendirSync(root)
    try {
      for (let count = 0; ; count++) {
        const entry = directory.readSync()
        if (!entry) break
        if (count >= MAX_STORE_ENTRIES)
          throw new ConversationError(
            422,
            'Conversation store enumeration limit exceeded'
          )
        if (!/^[A-Za-z0-9_+-]+={0,2}$/.test(entry.name)) continue
        const decoded = Buffer.from(entry.name, 'base64url').toString('utf8')
        if (!decoded.startsWith('conversation:')) continue
        if (Buffer.from(decoded).toString('base64url') !== entry.name)
          throw new ConversationError(422, 'Noncanonical conversation store')
        const id = decoded.slice(13)
        if (hash(id).slice(0, 16) !== identity.scope) continue
        if (match)
          throw new ConversationError(422, 'Ambiguous conversation store')
        match = entry.name
        session = id
      }
    } finally {
      directory.closeSync()
    }
    if (!match)
      throw new ConversationError(
        404,
        'Letta conversation not found for scope fingerprint'
      )
    const dir = path.join(root, match)
    const conversation = readMetadata(
      path.join(dir, 'conversation.json'),
      root,
      opened
    )
    if (conversation.value.id !== session)
      throw new ConversationError(422, 'Letta conversation.json id mismatch')
    if (!fs.existsSync(path.join(dir, 'manifest.json')))
      throw new ConversationError(404, 'Transcript manifest missing')
    const manifest = readMetadata(path.join(dir, 'manifest.json'), root, opened)
    if (
      manifest.value.schema_version !== 2 ||
      manifest.value.message_format !== 'pi-session-entry-jsonl' ||
      manifest.value.provider_stack !== 'pi-ai'
    )
      throw new ConversationError(
        422,
        'Unsupported Letta transcript manifest schema'
      )
    metadataSignature = conversation.signature + manifest.signature
    nativePath = path.join(dir, 'messages.jsonl')
  }
  let file = fs.existsSync(nativePath)
    ? openFile(nativePath, root, opened)
    : null
  if (source === 'codex-transcript' && file) {
    file = codexHistoryFile(file, root, opened)
    metadataSignature += hash(
      JSON.stringify(
        file.segments?.map((segment, index, segments) => ({
          dev: segment.file.stat.dev,
          ino: segment.file.stat.ino,
          end: index === segments.length - 1 ? null : segment.end,
          head: segment.file.head?.digest
        }))
      )
    )
  }
  if (source === 'letta-transcript' && file) {
    const headerBytes = readBytes(file, 0, Math.min(file.stat.size, 4096))
    const newline = headerBytes.indexOf(10)
    let header: any
    try {
      header = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          headerBytes.subarray(0, newline < 0 ? headerBytes.length : newline)
        )
      )
    } catch {
      throw new ConversationError(422, 'Invalid transcript header')
    }
    if (
      header.type !== 'session' ||
      header.version !== 3 ||
      header.id !== session
    )
      throw new ConversationError(422, 'Invalid transcript header')
  }
  let familyFloor = 0
  let taskTitles: ReadonlyMap<string, string> = new Map()
  let abandoned:
    import('../../src/types/conversation.ts').IAbandonedBranches | undefined
  if (isFamilySource(source) && file) {
    const projection = projectFamilyHistory(
      file.stat.size,
      (start, length) => readBytes(file!, start, length),
      source === 'pi-transcript'
    )
    familyMetadata = projection.metadata
    familyFloor = projection.floor
    taskTitles = projection.taskTitles
    abandoned = projection.abandoned
    if (projection.segments) {
      const physical = file
      physical.immutable = true
      const segments = projection.segments.map((segment) => ({
        file: physical,
        ...segment
      }))
      const size = segments.reduce(
        (sum, segment) => sum + segment.end - segment.start,
        0
      )
      metadataSignature += hash(
        JSON.stringify(
          segments.map((segment, index) => [
            segment.start,
            index === segments.length - 1 ? null : segment.end
          ])
        )
      )
      file = {
        ...physical,
        physicalSize: physical.stat.size,
        stat: Object.assign(
          Object.create(Object.getPrototypeOf(physical.stat)),
          physical.stat,
          { size }
        ),
        segments
      }
    }
  }
  const clearBoundary =
    source === 'claude-transcript' && file
      ? claudeClearBoundary(file, session)
      : familyFloor
  const baseBinding = hash(
    JSON.stringify({
      paneId,
      source,
      identity,
      session,
      dev: file?.stat.dev,
      ino: file?.stat.ino,
      metadataSignature,
      clearBoundary,
      rootIdentity: hash(root)
    })
  )
  const size = file?.stat.size ?? 0
  const proof = file ? proofAt(file, size) : ''
  const previous = observations.get(baseBinding)
  if (
    file &&
    previous &&
    (size < previous.size ||
      proofAt(file, previous.size) !== previous.proof ||
      (size === previous.size &&
        (file.stat.mtimeMs !== previous.mtime ||
          file.stat.ctimeMs !== previous.ctime)))
  ) {
    observations.delete(baseBinding)
    throw changed()
  }
  const epoch =
    previous?.epoch ??
    cursor?.epoch ??
    (file ? crypto.randomBytes(16).toString('hex') : '0'.repeat(32))
  const binding = hash(baseBinding + epoch)
  if (
    cursor &&
    (!file ||
      cursor.binding !== binding ||
      cursor.size > size ||
      cursor.endByte > size ||
      proofAt(file, cursor.size) !== cursor.proof ||
      (size === cursor.size &&
        (file.stat.mtimeMs !== cursor.mtime ||
          file.stat.ctimeMs !== cursor.ctime)))
  )
    throw changed()
  if (file) {
    observations.delete(baseBinding)
    observations.set(baseBinding, {
      epoch,
      size,
      proof,
      mtime: file.stat.mtimeMs,
      ctime: file.stat.ctimeMs
    })
    while (observations.size > 32)
      observations.delete(observations.keys().next().value!)
  }
  // Replay exact complete native rows on the selected history/active branch, never guessed files.
  let promptOmo: OmoAsks = []
  let promptCodex: ICodexQuestionState = { asked: [], answered: new Set() }
  if (
    options.promptEvidence &&
    file &&
    (source === 'codex-transcript' ||
      source === 'omo-transcript' ||
      source === 'pi-transcript')
  ) {
    if (size - clearBoundary > MAX_NATIVE_HISTORY_VERIFY_BYTES)
      throw new ConversationError(413, 'Prompt evidence exceeds finite limit')
    let pending = Buffer.alloc(0)
    for (let offset = clearBoundary; offset < size; offset += WINDOW_BYTES) {
      pending = Buffer.concat([
        pending,
        readBytes(file, offset, Math.min(WINDOW_BYTES, size - offset))
      ])
      let first = 0
      for (
        let newline = pending.indexOf(10);
        newline >= 0;
        newline = pending.indexOf(10, first)
      ) {
        const bytes = pending.subarray(first, newline)
        first = newline + 1
        if (bytes.length > MAX_NATIVE_ROW_BYTES)
          throw new ConversationError(
            413,
            'Prompt native row exceeds finite limit'
          )
        let row: any
        try {
          row = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          )
        } catch {
          continue
        }
        if (source === 'codex-transcript')
          promptCodex = codexQuestionsAfter(promptCodex, row)
        else promptOmo = omoAsksAfter(promptOmo, row)
      }
      pending = pending.subarray(first)
      if (pending.length > MAX_NATIVE_ROW_BYTES)
        throw new ConversationError(
          413,
          'Prompt native row exceeds finite limit'
        )
    }
  }
  const end = cursor?.endByte ?? size
  let outputProof: { start: number; end: number; digest: string } | undefined
  if (outputRequest) {
    const token = outputRequest.token
    const record = token.output!
    // Append-stable prefix + row proof. Appended superseding results/context
    // resets are checked separately in a finite UTF-8-safe native-row scan.
    if (
      !file ||
      outputRequest.history !== binding ||
      token.binding !== binding ||
      token.epoch !== epoch ||
      token.size > size ||
      proofAt(file, token.size) !== token.proof ||
      (token.size === size &&
        (token.mtime !== file.stat.mtimeMs ||
          token.ctime !== file.stat.ctimeMs))
    )
      throw changed()
    validateAppendedRecords(file, record.end, source, record)
    const bytes = readRowBytes(file, record.position, record.end)
    if (hash(bytes) !== record.digest) throw changed()
    const line = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (record.kind === 'image') {
      if (
        source !== 'codex-transcript' &&
        source !== 'claude-transcript' &&
        !isFamilySource(source)
      )
        throw changed()
      const row = JSON.parse(line)
      const native = (
        isFamilySource(source) ? familyImages(row) : pairImages(row, source)
      ).find((image) => image.key === record.key)
      if (
        !native ||
        !(
          isFamilySource(source)
            ? familyContributions(line, record.position)
            : pairContributions(line, record.position, source)
        ).some((contribution) => contribution.id === record.id)
      )
        throw changed()
      let imageBytes: Buffer
      if (native.inline) {
        if (
          native.value.length > (8 * 1024 * 1024 * 4) / 3 + 4 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(native.value)
        )
          throw new ConversationError(413, 'Native image exceeds limit')
        imageBytes = Buffer.from(native.value, 'base64')
        if (imageBytes.toString('base64') !== native.value)
          throw new ConversationError(422, 'Native image unavailable')
      } else {
        if (native.value.length > 4096)
          throw new ConversationError(422, 'Native image unavailable')
        let imageOwner = file
        if (file.segments) {
          let base = 0
          for (const segment of file.segments) {
            if (
              record.position >= base &&
              record.position < base + segment.end
            ) {
              imageOwner = segment.file
              break
            }
            base += segment.end - (segment.start ?? 0)
          }
        }
        const headerBytes = readBytes(
          imageOwner,
          0,
          Math.min(imageOwner.stat.size, 64 * 1024)
        )
        const newline = headerBytes.indexOf(10)
        const header = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            headerBytes.subarray(0, newline)
          )
        )
        const cwd = header.payload?.cwd
        if (
          header.type !== 'session_meta' ||
          typeof cwd !== 'string' ||
          !path.isAbsolute(cwd)
        )
          throw changed()
        const attachment = path.resolve(cwd, native.value)
        const imageFile = openFile(
          attachment,
          path.dirname(attachment),
          opened,
          true
        )
        if (imageFile.stat.size <= 0 || imageFile.stat.size > 8 * 1024 * 1024)
          throw new ConversationError(413, 'Native image exceeds limit')
        imageBytes = readRowBytes(imageFile, 0, imageFile.stat.size)
        outputRequest.imageProof = { file: imageFile, digest: hash(imageBytes) }
      }
      if (!imageBytes.length || imageBytes.length > 8 * 1024 * 1024)
        throw new ConversationError(413, 'Native image exceeds limit')
      const ext =
        native.mediaType === 'image/png'
          ? '.png'
          : native.mediaType === 'image/jpeg'
            ? '.jpg'
            : '.webp'
      const gif =
        native.mediaType === 'image/gif' &&
        /^GIF8[79]a$/.test(imageBytes.subarray(0, 6).toString('ascii')) &&
        imageBytes.length >= 10
      const mediaType = gif ? 'image/gif' : detectImageMime(imageBytes, ext)
      if (!mediaType || mediaType !== native.mediaType)
        throw new ConversationError(422, 'Native image unavailable')
      const dimensions = gif
        ? {
            width: imageBytes.readUInt16LE(6),
            height: imageBytes.readUInt16LE(8)
          }
        : validateImageDimensions(imageBytes, mediaType).dimensions
      if (
        !dimensions ||
        dimensions.width <= 0 ||
        dimensions.height <= 0 ||
        dimensions.width > 8192 ||
        dimensions.height > 8192 ||
        dimensions.width * dimensions.height > 32 * 1024 * 1024
      )
        throw new ConversationError(422, 'Native image unavailable')
      outputRequest.imageResult = {
        bytes: imageBytes,
        mediaType,
        ...dimensions
      }
    } else {
      const native = nativeRecordedOutput(line, source, record.id)
      if (!native || native.id !== record.id || native.callId !== record.callId)
        throw changed()
      if (native.output.length > MAX_TOOL_OUTPUT_LENGTH)
        throw new ConversationError(
          413,
          'Recorded output exceeds 2000000 UTF-16 code units'
        )
      outputRequest.result = {
        ok: true,
        paneId,
        sessionKey: binding,
        ref: outputRequest.ref,
        outputRevision: hash(
          JSON.stringify([native.id, native.callId, record.digest])
        ),
        output: native.output,
        length: native.output.length,
        lengthUnit: 'utf16-code-units'
      }
    }
    outputProof = {
      start: record.position,
      end: record.end,
      digest: record.digest
    }
  }
  const window =
    file && !outputRequest
      ? readWindow(
          file,
          end,
          source,
          (position, rowEnd, line, resultId) => {
            const native = nativeRecordedOutput(line, source, resultId)
            if (
              !native ||
              native.id.length > 256 ||
              (native.callId?.length ?? 0) > 128
            )
              return undefined
            return encodeCursor({
              endByte: rowEnd,
              binding,
              epoch,
              size,
              proof,
              mtime: file.stat.mtimeMs,
              ctime: file.stat.ctimeMs,
              output: {
                position,
                end: rowEnd,
                id: native.id,
                callId: native.callId,
                digest: hash(Buffer.from(line))
              }
            })
          },
          (position, rowEnd, line, id, key) => {
            if (
              id.length > 128 ||
              key.length > 200 ||
              rowEnd - position > MAX_NATIVE_ROW_BYTES
            )
              return undefined
            return encodeCursor({
              endByte: rowEnd,
              binding,
              epoch,
              size,
              proof,
              mtime: file.stat.mtimeMs,
              ctime: file.stat.ctimeMs,
              output: {
                kind: 'image',
                key,
                position,
                end: rowEnd,
                id,
                digest: hash(Buffer.from(line))
              }
            })
          },
          clearBoundary,
          taskTitles
        )
      : null
  const metadataHeadBytes =
    file &&
    (source === 'codex-transcript' || source === 'claude-transcript') &&
    !outputRequest
      ? readBytes(
          file,
          clearBoundary,
          Math.min(Math.max(0, file.stat.size - clearBoundary), 64 * 1024)
        )
      : undefined
  if (pairResolution) await pairResolution.validate()
  if (familyResolution) await familyResolution.validate()
  const post = await fetchSnapshot(5000)
  const postPane = post.panes.find((p) => p.pane_id === paneId)
  if (
    !postPane ||
    JSON.stringify(snapshotIdentity(post, postPane)) !==
      JSON.stringify(identity)
  )
    throw changed()
  try {
    for (const item of opened) validateFile(item)
    if (
      file &&
      metadataHeadBytes &&
      hash(readBytes(file, clearBoundary, metadataHeadBytes.length)) !==
        hash(metadataHeadBytes)
    )
      throw changed()
    if (
      outputRequest?.imageProof &&
      hash(
        readRowBytes(
          outputRequest.imageProof.file,
          0,
          outputRequest.imageProof.file.stat.size
        )
      ) !== outputRequest.imageProof.digest
    )
      throw changed()
    if (
      file &&
      ((outputRequest &&
        (file.physicalSize !== undefined
          ? fs.fstatSync(file.fd).size === file.physicalSize
            ? size
            : -1
          : file.segments
            ? file.segments
                .slice(0, -1)
                .reduce((sum, segment) => sum + segment.end, 0) +
              fs.fstatSync(file.fd).size
            : fs.fstatSync(file.fd).size) !== size) ||
        proofAt(file, size) !== proof ||
        (window &&
          hash(
            window.buffer.length
              ? readRowBytes(
                  file,
                  window.start,
                  window.start + window.buffer.length
                )
              : Buffer.alloc(0)
          ) !== window.digest) ||
        (outputProof &&
          hash(readRowBytes(file, outputProof.start, outputProof.end)) !==
            outputProof.digest))
    )
      throw changed()
    if (!file && fs.existsSync(nativePath)) throw changed()
  } catch {
    observations.delete(baseBinding)
    throw changed()
  }
  const contributions = window?.contributions ?? []
  const model =
    [...contributions].reverse().find((row) => row.model)?.model ?? null
  let metadata: import('../../src/types/conversation.ts').IConversationMetadata =
    {
      ...(familyMetadata?.context ? { context: familyMetadata.context } : {}),
      model: familyMetadata?.model ?? model,
      reasoning_effort:
        familyMetadata?.reasoning_effort ??
        [...contributions].reverse().find((row) => row.reasoning_effort)
          ?.reasoning_effort ??
        null
    }
  if (
    (source === 'codex-transcript' || source === 'claude-transcript') &&
    file &&
    !outputRequest
  ) {
    const head = new TextDecoder().decode(metadataHeadBytes)
    metadata = pairMetadata(
      new TextDecoder().decode(window?.buffer ?? Buffer.alloc(0)),
      source,
      pairMetadata(head, source)
    )
  }
  const before =
    window && window.before > clearBoundary
      ? encodeCursor({
          endByte: window.before,
          binding,
          epoch,
          size,
          proof,
          mtime: file!.stat.mtimeMs,
          ctime: file!.stat.ctimeMs
        })
      : null
  options.promptEvidence?.({
    binding,
    source,
    omo: promptOmo,
    codex: unansweredCodexQuestions(promptCodex)
  })
  return {
    ok: true,
    paneId,
    source,
    sessionKey: binding,
    contributions,
    range: window ? { startByte: window.start, endByte: end } : undefined,
    turns: groupContributions(contributions),
    metadata,
    ...(abandoned ? { abandoned } : {}),
    truncated: window?.truncated ?? false,
    before
  }
}

/** Only an opaque token issued for an actual native result row can reach the fd. */
export const readPaneToolOutput = async (
  paneId: string,
  history: string,
  ref: string,
  options: Pick<IReadConversationOptions, 'deps'> = {}
): Promise<IConversationToolOutput> => {
  const token = decodeCursor(ref)
  const record = token?.output
  if (
    !/^[a-f0-9]{64}$/.test(history) ||
    !token ||
    !record ||
    record.kind === 'image' ||
    !Number.isSafeInteger(record.position) ||
    !Number.isSafeInteger(record.end) ||
    record.position < 0 ||
    record.end <= record.position ||
    record.end > token.size ||
    record.end - record.position > MAX_NATIVE_ROW_BYTES ||
    typeof record.id !== 'string' ||
    record.id.length > 256 ||
    (record.callId !== undefined &&
      (typeof record.callId !== 'string' || record.callId.length > 128)) ||
    typeof record.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  )
    throw changed()
  const opened: IOpenedFile[] = []
  const request = {
    history,
    ref,
    token,
    result: undefined as IConversationToolOutput | undefined
  }
  try {
    await readInternal(paneId, options, opened, request)
    if (!request.result) throw changed()
    return request.result
  } catch (error) {
    if (error instanceof ConversationError) throw error
    throw new ConversationError(422, 'Recorded output unavailable')
  } finally {
    for (const file of opened) fs.closeSync(file.fd)
  }
}

export const readPaneNativeImage = async (
  paneId: string,
  history: string,
  ref: string,
  options: Pick<IReadConversationOptions, 'deps'> = {}
) => {
  const token = decodeCursor(ref)
  const record = token?.output
  if (
    !/^[a-f0-9]{64}$/.test(history) ||
    !token ||
    !record ||
    record.kind !== 'image' ||
    typeof record.key !== 'string' ||
    record.key.length > 200 ||
    typeof record.id !== 'string' ||
    record.id.length > 256 ||
    !Number.isSafeInteger(record.position) ||
    !Number.isSafeInteger(record.end) ||
    record.position < 0 ||
    record.end <= record.position ||
    record.end > token.size ||
    record.end - record.position > MAX_NATIVE_ROW_BYTES ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  )
    throw changed()
  const opened: IOpenedFile[] = []
  const request = {
    history,
    ref,
    token,
    imageResult: undefined as
      | { bytes: Buffer; mediaType: string; width: number; height: number }
      | undefined
  }
  try {
    await readInternal(paneId, options, opened, request)
    if (!request.imageResult) throw changed()
    return request.imageResult
  } catch (error) {
    if (error instanceof ConversationError) throw error
    throw new ConversationError(422, 'Native image unavailable')
  } finally {
    for (const file of opened) fs.closeSync(file.fd)
  }
}

export const readPaneConversation = async (
  paneId: string,
  options: IReadConversationOptions = {}
): Promise<IConversationRead> => {
  const opened: IOpenedFile[] = []
  try {
    return await readInternal(paneId, options, opened)
  } catch (error) {
    if (error instanceof ConversationError) throw error
    throw new ConversationError(422, 'Transcript unavailable')
  } finally {
    for (const file of opened) fs.closeSync(file.fd)
  }
}
