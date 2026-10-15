// MIT License - Copyright (c) 2026 devswha; Copyright (c) 2026 T3 Tools Inc.
// Adapted from herdr-web-ui dc2f11d src/lib/chatScrollMemory.ts (see THIRD_PARTY_NOTICES).
export interface IChatPosition {
  turn: string
  offset: number
  atEnd: boolean
}
export const CHAT_POSITION_STORAGE_KEY = 'herdr_chat_positions_v1'
export const CHAT_POSITION_TTL = 30 * 24 * 60 * 60 * 1000
const MAX_POSITIONS = 100
const MAX_BYTES = 128 * 1024
interface IStoredPosition extends IChatPosition {
  scope: string
  expires: number
}
type PositionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
/** Exact native identities only, never selection or mutation authority. */
export const chatPositionScope = (
  pane: string,
  terminal: string | undefined,
  session: string | undefined,
  source: string | null,
  history: string
) => JSON.stringify([pane, terminal ?? null, session ?? null, source, history])
export interface IChatPositionIdentity {
  paneId: string
  terminalId: string
  agentSessionId: string | null
  source: string
  history: string
}
export const parseChatPositionScope = (
  scope: string
): IChatPositionIdentity | null => {
  try {
    const ids = JSON.parse(scope)
    const id = (value: unknown) =>
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 256 &&
      !/[\x00-\x1f/\\]/.test(value)
    const valid =
      Array.isArray(ids) &&
      ids.length === 5 &&
      id(ids[0]) &&
      id(ids[1]) &&
      (ids[2] === null || id(ids[2])) &&
      /^(letta|agy|codex|claude|omp|omo|gjc|pi)-transcript$/.test(ids[3]) &&
      id(ids[4])
    return valid
      ? {
          paneId: ids[0],
          terminalId: ids[1],
          agentSessionId: ids[2],
          source: ids[3],
          history: ids[4]
        }
      : null
  } catch {
    return null
  }
}
const validScope = (scope: string) => parseChatPositionScope(scope) !== null
const browserStorage = (): PositionStorage | null =>
  typeof window === 'undefined' ? null : window.localStorage
/** Injectable for deterministic fixtures: no HOME, native reads, or text-store access. */
export const createChatPositionStore = (
  storage: () => PositionStorage | null = browserStorage,
  now: () => number = Date.now
) => {
  const positions = new Map<string, IStoredPosition>()
  let loaded = false
  let error = false
  const prune = () => {
    for (const [scope, row] of positions)
      if (row.expires <= now()) positions.delete(scope)
    while (positions.size > MAX_POSITIONS)
      positions.delete(positions.keys().next().value!)
  }
  const load = () => {
    if (loaded) return
    loaded = true
    try {
      const target = storage()
      if (!target) {
        error = true
        return
      }
      const raw = target.getItem(CHAT_POSITION_STORAGE_KEY)
      if (!raw) return
      if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error()
      const rows: unknown = JSON.parse(raw)
      if (!Array.isArray(rows) || rows.length > MAX_POSITIONS) throw new Error()
      for (const value of rows) {
        if (!value || typeof value !== 'object') continue
        const row = value as IStoredPosition
        if (
          !validScope(row.scope) ||
          typeof row.turn !== 'string' ||
          row.turn.length > 256 ||
          /[\x00-\x1f/\\]/.test(row.turn) ||
          !Number.isFinite(row.offset) ||
          Math.abs(row.offset) > 1_000_000 ||
          typeof row.atEnd !== 'boolean' ||
          !Number.isFinite(row.expires) ||
          row.expires <= now() ||
          row.expires > now() + CHAT_POSITION_TTL
        )
          continue
        // Fresh allowlisted object: unknown fields are never retained or rewritten.
        positions.set(row.scope, {
          scope: row.scope,
          turn: row.turn,
          offset: row.offset,
          atEnd: row.atEnd,
          expires: row.expires
        })
      }
      prune()
      if (positions.size !== rows.length) persist()
    } catch {
      error = true
    }
  }
  const persist = () => {
    try {
      const target = storage()
      if (!target) throw new Error()
      const rows = [...positions.values()].filter(
        (row) =>
          validScope(row.scope) &&
          row.turn.length <= 256 &&
          !/[\x00-\x1f/\\]/.test(row.turn)
      )
      const raw = JSON.stringify(rows)
      if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error()
      target.setItem(CHAT_POSITION_STORAGE_KEY, raw)
      error = false
    } catch {
      error = true
    }
  }
  return {
    read: (scope: string): IChatPosition | undefined => {
      load()
      const count = positions.size
      prune()
      if (positions.size !== count) persist()
      const row = positions.get(scope)
      return row
        ? { turn: row.turn, offset: row.offset, atEnd: row.atEnd }
        : undefined
    },
    remember: (scope: string, position: IChatPosition) => {
      load()
      if (
        !Number.isFinite(position.offset) ||
        Math.abs(position.offset) > 1_000_000
      )
        return
      const previous = positions.get(scope)
      if (
        previous &&
        previous.expires > now() &&
        previous.turn === position.turn &&
        previous.offset === position.offset &&
        previous.atEnd === position.atEnd
      )
        return
      positions.delete(scope)
      positions.set(scope, {
        scope,
        turn: position.turn,
        offset: position.offset,
        atEnd: position.atEnd,
        expires: now() + CHAT_POSITION_TTL
      })
      prune()
      persist()
    },
    clear: () => {
      loaded = true
      positions.clear()
      try {
        const target = storage()
        if (!target) throw new Error()
        target.removeItem(CHAT_POSITION_STORAGE_KEY)
        error = false
      } catch {
        error = true
      }
      return !error
    },
    recent: (): IChatPositionIdentity[] => {
      load()
      const count = positions.size
      prune()
      if (positions.size !== count) persist()
      return [...positions.keys()].reverse().flatMap((scope) => {
        const identity = parseChatPositionScope(scope)
        return identity ? [identity] : []
      })
    },
    storageError: () => {
      load()
      return error
    }
  }
}
const positions = createChatPositionStore()
export const rememberChatPosition = positions.remember
export const readChatPosition = positions.read
export const forgetChatPositions = positions.clear
export const chatPositionStorageError = positions.storageError
export const recentChatPositionIdentities = positions.recent
export const chatRestoreIndex = (
  position: IChatPosition | undefined,
  anchors: readonly string[]
): number | null => {
  if (!position || position.atEnd) return null
  const index = anchors.indexOf(position.turn)
  return index < 0 ? null : index
}
export const restoreChatPosition = (
  node: HTMLElement,
  position: IChatPosition
): boolean => {
  const row = [...node.querySelectorAll<HTMLElement>('[data-chat-row]')].find(
    (row) => row.dataset.chatRow === position.turn
  )
  if (!row) return false
  node.scrollTop +=
    row.getBoundingClientRect().top -
    node.getBoundingClientRect().top -
    position.offset
  return true
}

export const captureChatPosition = (
  node: HTMLElement,
  atEnd: boolean
): IChatPosition => {
  const top = node.getBoundingClientRect().top
  const row = [...node.querySelectorAll<HTMLElement>('[data-chat-row]')].find(
    (row) => row.getBoundingClientRect().bottom > top
  )
  return {
    turn: row?.dataset.chatRow ?? '',
    offset: row ? row.getBoundingClientRect().top - top : 0,
    atEnd: atEnd || !row
  }
}
