import { describe, expect, it } from 'bun:test'
import { PromptOccurrences } from '../prompt-occurrence.ts'
import { omoAsksAfter, type OmoAsks } from '../omo-ask.ts'
import type { IActionTargetIdentity } from '../types.ts'

const target: IActionTargetIdentity = {
  paneId: 'p1',
  terminalId: 't1',
  expectedMode: 'blocked-agent',
  agentSessionId: 's1'
}
const call = (id: string, wait = true) => ({
  type: 'message',
  message: {
    role: 'assistant',
    content: [
      {
        type: 'toolCall',
        id,
        name: 'ask_user_question',
        arguments: { waitForAnswer: wait, questions: [] }
      }
    ]
  }
})

describe('observed prompt occurrence fence', () => {
  it('retains one asking across identical reads', () => {
    const owner = new PromptOccurrences()
    const first = owner.publish(
      owner.beginRead(target),
      'full semantic content'
    )
    expect(first).toBe(
      owner.publish(owner.beginRead(target), 'full semantic content')
    )
  })
  it('changes asking after no-prompt, full body change, replacement and restart', () => {
    const owner = new PromptOccurrences()
    const first = owner.publish(
      owner.beginRead(target),
      'body beyond display cap A'
    )
    expect(
      owner.publish(owner.beginRead(target), 'body beyond display cap B')
    ).not.toBe(first)
    owner.publish(owner.beginRead(target), null)
    expect(
      owner.publish(owner.beginRead(target), 'body beyond display cap A')
    ).not.toBe(first)
    expect(
      owner.publish(
        owner.beginRead({ ...target, terminalId: 't2' }),
        'body beyond display cap A'
      )
    ).not.toBe(first)
    expect(
      owner.publish(
        owner.beginRead({ ...target, agentSessionId: 's2' }),
        'body beyond display cap A'
      )
    ).not.toBe(first)
    const other = new PromptOccurrences()
    expect(
      other.publish(other.beginRead(target), 'body beyond display cap A')
    ).not.toBe(first)
  })
  it('does not accept stale IDs or overlapping answers', () => {
    const owner = new PromptOccurrences()
    const id = owner.publish(owner.beginRead(target), 'question')!
    expect(owner.beginAnswer(target, 'stale')).toBeNull()
    expect(
      owner.beginAnswer({ ...target, agentSessionId: 's2' }, id)
    ).toBeNull()
    const ticket = owner.beginAnswer(target, id)!
    expect(owner.stillCurrent(ticket)).toBe(true)
    expect(owner.beginAnswer(target, id)).toBeNull()
  })
  it('suppresses late reads from before, during and after an unknown answer', () => {
    const owner = new PromptOccurrences()
    const before = owner.beginRead(target)
    const id = owner.publish(before, 'question')!
    const answer = owner.beginAnswer(target, id)!
    const during = owner.beginRead(target)
    expect(owner.publish(during, 'question')).toBeNull()
    owner.endAnswer(answer)
    expect(owner.publish(before, 'question')).toBeNull()
    expect(owner.publish(during, 'question')).toBeNull()
    const next = owner.publish(owner.beginRead(target), 'question')!
    expect(next).not.toBe(id)
    expect(owner.beginAnswer(target, id)).toBeNull()
    owner.endAnswer(answer)
    expect(owner.beginAnswer(target, next)).not.toBeNull()
  })
  it('authoritative end stops an in-flight asking and retired panes do not restart an old ID', () => {
    const owner = new PromptOccurrences()
    const id = owner.publish(owner.beginRead(target), 'question')!
    const answer = owner.beginAnswer(target, id)!
    owner.ended(target)
    expect(owner.stillCurrent(answer)).toBe(false)
    owner.retain([])
    expect(owner.publish(owner.beginRead(target), 'question')).not.toBe(id)
  })
})

describe('source native OmO open-call fold', () => {
  it('keeps waiting calls through assistant narration, closes only matching results', () => {
    let open = omoAsksAfter([], call('a'))
    open = omoAsksAfter(open, call('b'))
    open = omoAsksAfter(open, {
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] }
    })
    expect(open.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(
      omoAsksAfter(open, {
        type: 'message',
        message: { role: 'toolResult', toolCallId: 'a' }
      }).map((entry) => entry.id)
    ).toEqual(['b'])
  })
  it('accepted async pending result stays open, error result closes it', () => {
    const open = omoAsksAfter([], call('a', false))
    expect(open[0]?.wait).toBe(false)
    const result = {
      role: 'toolResult',
      toolCallId: 'a',
      details: { accepted: true, status: 'pending' }
    }
    expect(omoAsksAfter(open, { type: 'message', message: result })).toEqual(
      open
    )
    expect(
      omoAsksAfter(open, {
        type: 'message',
        message: { ...result, isError: true }
      })
    ).toEqual([])
  })
  it('settlements and framed native user answers settle exactly one call', () => {
    const open = omoAsksAfter(omoAsksAfter([], call('a')), call('b', false))
    expect(
      omoAsksAfter(open, {
        type: 'custom',
        customType: 'ask-user:settlement',
        data: { requestId: 'b' }
      }).map((entry) => entry.id)
    ).toEqual(['a'])
    expect(
      omoAsksAfter(open, {
        type: 'message',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '[Answer to question a]\nYes' }]
        }
      }).map((entry) => entry.id)
    ).toEqual(['b'])
    expect(
      omoAsksAfter(open, {
        type: 'message',
        message: { role: 'user', content: 'Mention [Answer to question a]\n' }
      })
    ).toEqual(open)
  })
  it('does not open incomplete or unrelated tool calls; recognizes native spelling variants', () => {
    const open: OmoAsks = []
    expect(
      omoAsksAfter(open, {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'a',
              name: 'ask_user_question',
              incomplete: true
            }
          ]
        }
      })
    ).toEqual([])
    const async = omoAsksAfter(open, {
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'a',
            name: 'request_user_input',
            arguments: { wait_for_answer: false }
          }
        ]
      }
    })
    expect(async[0]?.wait).toBe(false)
  })
})
