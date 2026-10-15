// MIT License - Copyright (c) 2026 devswha
// Adapted from herdr-web-ui dc2f11d src/lib/chatScrollMemory.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  captureChatPosition,
  restoreChatPosition,
  createChatPositionStore,
  CHAT_POSITION_STORAGE_KEY,
  CHAT_POSITION_TTL,
  chatPositionScope,
  chatRestoreIndex,
  forgetChatPositions,
  readChatPosition,
  rememberChatPosition
} from '../chat-scroll-memory.ts'

describe('exact Chat reading memory', () => {
  test('delayed prepend preserves current Find/manual movement row geometry rather than saved restoration or total height', () => {
    for (const offset of [181.796875, -116]) {
      let rowTop = offset
      const row = {
        dataset: { chatRow: 'qa-turn-40' },
        getBoundingClientRect: () => ({
          top: rowTop - node.scrollTop,
          bottom: rowTop - node.scrollTop + 268
        })
      }
      const node = {
        scrollTop: 0,
        getBoundingClientRect: () => ({ top: 0 }),
        querySelectorAll: () => [row]
      } as unknown as HTMLElement
      const current = captureChatPosition(node, false)
      // Find toolbar/loading changes total height by a different amount than row displacement.
      rowTop += 6090
      expect(restoreChatPosition(node, current)).toBe(true)
      expect(captureChatPosition(node, false)).toEqual(current)
      expect(current.turn).not.toBe('qa-turn-10')
    }
  })
  beforeEach(forgetChatPositions)
  test('A -> B -> A preserves anchor offset and follow intent independently', () => {
    const a = chatPositionScope('p1', 't1', 's1', 'letta-transcript', 'h1')
    const b = chatPositionScope('p2', 't2', 's2', 'letta-transcript', 'h2')
    rememberChatPosition(a, { turn: 'native-a', offset: -25, atEnd: false })
    rememberChatPosition(b, { turn: 'native-b', offset: 0, atEnd: true })
    expect(
      chatRestoreIndex(readChatPosition(a), ['older', 'native-a', 'latest'])
    ).toBe(1)
    expect(readChatPosition(a)?.offset).toBe(-25)
    expect(chatRestoreIndex(readChatPosition(b), ['native-b'])).toBeNull()
    rememberChatPosition(a, { turn: 'latest', offset: 0, atEnd: true })
    expect(
      chatRestoreIndex(readChatPosition(a), ['native-a', 'latest'])
    ).toBeNull()
  })
  test('terminal/session/source/history replacement cannot reuse a saved place', () => {
    const identity = ['p', 't', 's', 'source', 'h'] as const
    const scope = chatPositionScope(...identity)
    rememberChatPosition(scope, {
      turn: 'same-native-id',
      offset: -10,
      atEnd: false
    })
    for (let index = 0; index < identity.length; index++) {
      const changed = [...identity] as [string, string, string, string, string]
      changed[index] = 'replacement'
      expect(readChatPosition(chatPositionScope(...changed))).toBeUndefined()
    }
    expect(chatRestoreIndex(readChatPosition(scope), ['missing'])).toBeNull()
  })
  test('bounded cache keeps newest positions', () => {
    for (let index = 0; index <= 100; index++)
      rememberChatPosition(String(index), {
        turn: 'n',
        offset: 0,
        atEnd: false
      })
    expect(readChatPosition('0')).toBeUndefined()
    expect(readChatPosition('100')).toBeDefined()
    forgetChatPositions()
    expect(readChatPosition('100')).toBeUndefined()
  })
  test('reopen A -> B -> A, expiry, exact history replacement and deletion', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      }
    }
    let time = 1000
    const open = () =>
      createChatPositionStore(
        () => storage,
        () => time
      )
    const a = chatPositionScope('p1', 't1', 's1', 'letta-transcript', 'h1')
    const b = chatPositionScope('p2', 't2', 's2', 'letta-transcript', 'h2')
    open().remember(a, { turn: 'native-a', offset: -25, atEnd: false })
    open().remember(b, { turn: 'native-b', offset: 0, atEnd: true })
    const reopened = open()
    expect(reopened.read(a)?.offset).toBe(-25)
    expect(reopened.read(b)?.atEnd).toBe(true)
    expect(
      reopened.read(
        chatPositionScope('p1', 't1', 's1', 'letta-transcript', 'changed')
      )
    ).toBeUndefined()
    expect(
      reopened.read(
        chatPositionScope('p1', 't1', 's1', 'codex-transcript', 'h1')
      )
    ).toBeUndefined()
    expect(chatRestoreIndex(reopened.read(a), ['native-a'])).toBe(0)
    expect(chatRestoreIndex(reopened.read(a), ['unknown'])).toBeNull()
    expect(
      Object.keys(JSON.parse(data.get(CHAT_POSITION_STORAGE_KEY)!)[0]).sort()
    ).toEqual(['atEnd', 'expires', 'offset', 'scope', 'turn'])
    time += CHAT_POSITION_TTL
    expect(open().read(a)).toBeUndefined()
    expect(reopened.clear()).toBe(true)
    expect(data.has(CHAT_POSITION_STORAGE_KEY)).toBe(false)
    expect(open().read(b)).toBeUndefined()
  })
  test('quota/read/delete failures retain memory and truthfully report failure', () => {
    const store = createChatPositionStore(() => {
      throw new Error('unavailable')
    })
    const scope = chatPositionScope('p', 't', 's', 'letta-transcript', 'h')
    store.remember(scope, { turn: 'n', offset: -2, atEnd: false })
    expect(store.read(scope)?.offset).toBe(-2)
    expect(store.storageError()).toBe(true)
    expect(store.clear()).toBe(false)
    expect(store.read(scope)).toBeUndefined()
  })
  test('malformed and overlarge storage do not restore; durable cap is 100', () => {
    let raw = 'not JSON'
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value
      },
      removeItem: () => {
        raw = ''
      }
    }
    const store = createChatPositionStore(() => storage)
    expect(store.read('unknown')).toBeUndefined()
    expect(store.storageError()).toBe(true)
    for (let i = 0; i <= 100; i++)
      store.remember(
        chatPositionScope(`p${i}`, 't', 's', 'letta-transcript', 'h'),
        { turn: 'n', offset: 0, atEnd: false }
      )
    expect(JSON.parse(raw)).toHaveLength(100)
    expect(
      createChatPositionStore(() => storage).read(
        chatPositionScope('p0', 't', 's', 'letta-transcript', 'h')
      )
    ).toBeUndefined()
    raw = 'x'.repeat(128 * 1024 + 1)
    expect(createChatPositionStore(() => storage).storageError()).toBe(true)
  })
  test('captures first visible actual turn, not header; keeps negative offset', () => {
    const rows = [
      {
        dataset: { chatRow: 'before' },
        getBoundingClientRect: () => ({ top: -100, bottom: 90 })
      },
      {
        dataset: { chatRow: 'visible' },
        getBoundingClientRect: () => ({ top: 75, bottom: 175 })
      }
    ]
    const node = {
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => rows
    } as unknown as HTMLElement
    expect(captureChatPosition(node, false)).toEqual({
      turn: 'visible',
      offset: -25,
      atEnd: false
    })
    expect(captureChatPosition(node, true).atEnd).toBe(true)
  })
})
