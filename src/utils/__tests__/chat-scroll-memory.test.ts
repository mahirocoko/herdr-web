// MIT License - Copyright (c) 2026 devswha
// Adapted from herdr-web-ui dc2f11d src/lib/chatScrollMemory.test.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  captureChatPosition,
  chatPositionScope,
  chatRestoreIndex,
  forgetChatPositions,
  readChatPosition,
  rememberChatPosition
} from '../chat-scroll-memory.ts'

describe('exact Chat reading memory', () => {
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
  test('bounded cache keeps newest positions and no persistent storage', () => {
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
