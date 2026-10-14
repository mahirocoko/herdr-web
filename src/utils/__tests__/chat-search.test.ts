// MIT License - Copyright (c) 2026 devswha
// Adapted from herdr-web-ui dc2f11d src/lib/chatSearch.test.ts
import { describe, expect, test } from 'bun:test'
import {
  chatSearchText,
  isChatFindShortcut,
  searchLoadedChatRows
} from '../chat-search.ts'
import type { IConversationTurn } from '@/types/conversation.ts'

describe('literal loaded Chat source', () => {
  test('all non-overlapping offsets, empty queries and offscreen loaded rows', () => {
    const rows = [
      { key: 'first', text: 'alpha alpha' },
      { key: 'offscreen', text: 'alpha' }
    ]
    expect(searchLoadedChatRows(rows, 'alpha')).toEqual({
      matches: [
        { rowKey: 'first', start: 0, end: 5 },
        { rowKey: 'first', start: 6, end: 11 },
        { rowKey: 'offscreen', start: 0, end: 5 }
      ],
      count: 3
    })
    expect(searchLoadedChatRows(rows, '')).toEqual({ matches: [], count: 0 })
    expect(searchLoadedChatRows(rows, 'absent').count).toBe(0)
  })
  test('UTF-16 offsets retain Thai/emoji and case; regex punctuation stays literal', () => {
    expect(
      searchLoadedChatRows(
        [{ key: 'r', text: '😀 Alpha ALPHA ไทย ไทย' }],
        'alpha'
      ).matches
    ).toEqual([
      { rowKey: 'r', start: 3, end: 8 },
      { rowKey: 'r', start: 9, end: 14 }
    ])
    expect(
      searchLoadedChatRows([{ key: 'r', text: 'Alpha alpha' }], 'alpha', true)
        .matches
    ).toEqual([{ rowKey: 'r', start: 6, end: 11 }])
    expect(
      searchLoadedChatRows([{ key: 'r', text: 'ไทย '.repeat(10000) }], 'ไทย')
        .count
    ).toBe(10000)
    expect(
      searchLoadedChatRows([{ key: 'r', text: 'a.*b axxb' }], '.*').matches
    ).toEqual([{ rowKey: 'r', start: 1, end: 3 }])
    expect(
      searchLoadedChatRows([{ key: 'r', text: '[x] \\ $^' }], '[x]').count
    ).toBe(1)
  })
  test('folded tool/thinking/task/skill source searchable without image refs or fetching full output', () => {
    const turn: IConversationTurn = {
      id: 'native',
      role: 'assistant',
      ts: null,
      parts: [
        {
          kind: 'tool',
          id: 'tool',
          pending: false,
          name: 'Read',
          summary: 'file',
          input: '{}',
          output: 'hidden sentinel',
          outputRef: 'opaque-whole-sentinel',
          truncated: true
        },
        { kind: 'thinking', text: 'folded thought' },
        {
          kind: 'skill',
          skill: {
            name: 'instructions',
            status: 'loaded',
            evidence: 'instructions'
          }
        },
        { kind: 'image', media_type: 'image/png', ref: 'image-sentinel' },
        { kind: 'text', text: 'answer' }
      ]
    }
    const text = chatSearchText(turn)
    for (const query of [
      'hidden sentinel',
      'folded thought',
      'instructions',
      'answer'
    ])
      expect(searchLoadedChatRows([{ key: 'native', text }], query).count).toBe(
        1
      )
    for (const query of ['image-sentinel', 'opaque-whole-sentinel'])
      expect(searchLoadedChatRows([{ key: 'native', text }], query).count).toBe(
        0
      )
    expect(chatSearchText({ ...turn, id: 'loaded-chat-limit' })).toBe('')
  })
  test('bounds match storage for pathological one-character queries with truthful limit', () => {
    const result = searchLoadedChatRows(
      [{ key: 'large', text: 'a'.repeat(1000000) }],
      'a'
    )
    expect(result.matches).toHaveLength(10000)
    expect(result.count).toBe(10000)
    expect(result.limited).toBe(true)
  })
  test('platform Mod+F does not steal Ctrl+F on Mac or global modifier shortcuts', () => {
    const event = {
      key: 'f',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false
    }
    expect(isChatFindShortcut(event, true)).toBe(true)
    expect(
      isChatFindShortcut({ ...event, metaKey: false, ctrlKey: true }, true)
    ).toBe(false)
    expect(
      isChatFindShortcut({ ...event, metaKey: false, ctrlKey: true }, false)
    ).toBe(true)
    expect(isChatFindShortcut({ ...event, shiftKey: true }, true)).toBe(false)
    expect(isChatFindShortcut({ ...event, altKey: true }, true)).toBe(false)
  })
})
