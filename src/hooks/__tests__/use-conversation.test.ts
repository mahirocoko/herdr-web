import { describe, expect, test } from 'bun:test'
import {
  emptyConversation,
  reconcileConversation
} from '../use-conversation.ts'
import type { IConversationRead } from '@/types/conversation.ts'

const page = (
  start: number,
  end: number,
  before: string | null,
  sessionKey = 's'
): IConversationRead => ({
  ok: true,
  paneId: 'p',
  source: 'letta-transcript',
  sessionKey,
  metadata: { model: 'model', reasoning_effort: null },
  truncated: false,
  before,
  turns: Array.from({ length: end - start }, (_, index) => ({
    id: String(start + index),
    role: 'assistant',
    ts: null,
    parts: [{ kind: 'text', text: String(start + index) }]
  }))
})

describe('conversation state owner', () => {
  test('120-turn frontier survives polling and preserves all loaded IDs as latest slides', () => {
    let state = reconcileConversation(
      emptyConversation(),
      page(70, 120, '70'),
      false
    )
    state = reconcileConversation(state, page(20, 70, '20'), true)
    state = reconcileConversation(state, page(70, 120, '70'), false)
    expect(state.before).toBe('20')
    state = reconcileConversation(state, page(0, 20, null), true)
    state = reconcileConversation(state, page(71, 121, '71'), false)
    expect(state.turns.map((turn) => turn.id)).toEqual(
      Array.from({ length: 121 }, (_, i) => String(i))
    )
    expect(state.before).toBeNull()
  })

  test('latest overlapping native snapshots win; older pages cannot revert them', () => {
    let state = reconcileConversation(
      emptyConversation(),
      page(1, 3, '1'),
      false
    )
    const updated = page(2, 4, '2')
    updated.turns[0].parts = [{ kind: 'text', text: 'updated' }]
    state = reconcileConversation(state, updated, false)
    state = reconcileConversation(state, page(0, 3, null), true)
    expect(state.turns.find((turn) => turn.id === '2')?.parts).toEqual([
      { kind: 'text', text: 'updated' }
    ])
    expect(new Set(state.turns.map((turn) => turn.id)).size).toBe(
      state.turns.length
    )
  })

  test('session replacement drops turns and all stale metadata/frontier', () => {
    const old = reconcileConversation(
      emptyConversation(),
      page(0, 50, 'cursor'),
      false
    )
    const replacement = page(90, 91, null, 'replacement')
    replacement.metadata.model = null
    const state = reconcileConversation(old, replacement, false)
    expect(state.turns.map((turn) => turn.id)).toEqual(['90'])
    expect(state.metadata.model).toBeNull()
    expect(state.before).toBeNull()
  })
})
