import { describe, expect, it } from 'bun:test'
import {
  codexQuestionsAfter,
  unansweredCodexQuestions,
  type ICodexQuestionState
} from '../codex-questions.ts'

const initial = (): ICodexQuestionState => ({ asked: [], answered: new Set() })
const ask = (id: string) => ({
  type: 'response_item',
  payload: {
    type: 'function_call',
    name: 'request_user_input_async',
    call_id: id,
    arguments: JSON.stringify({
      questions: [
        { title: 'Which route?', options: ['A', { label: 'B' }] },
        { question: 'Free reply?' }
      ]
    })
  }
})
const answer = (tool: string, id: string, index: number, role = 'user') => ({
  type: 'response_item',
  payload: {
    type: 'message',
    role,
    content: [
      {
        type: 'input_text',
        text: `<send_user_message_question_reply>${JSON.stringify([{ questionItemId: JSON.stringify([tool, id, index]) }])}</send_user_message_question_reply>`
      }
    ]
  }
})
describe('pure Codex native queue evidence', () => {
  it('preserves native question IDs and oldest-first order including free-form questions', () => {
    const state = codexQuestionsAfter(
      codexQuestionsAfter(initial(), ask('a')),
      ask('b')
    )
    expect(unansweredCodexQuestions(state)).toEqual([
      { key: 'a:0', title: 'Which route?', options: ['A', 'B'] },
      { key: 'a:1', title: 'Free reply?', options: [] },
      { key: 'b:0', title: 'Which route?', options: ['A', 'B'] },
      { key: 'b:1', title: 'Free reply?', options: [] }
    ])
  })
  it('only a matching native async user reply settles its question', () => {
    const state = codexQuestionsAfter(initial(), ask('a'))
    expect(
      unansweredCodexQuestions(
        codexQuestionsAfter(state, answer('request_user_input_async', 'a', 0))
      ).map((question) => question.key)
    ).toEqual(['a:1'])
    for (const row of [
      answer('another_tool', 'a', 0),
      answer('request_user_input_async', 'a', 0, 'assistant'),
      answer('request_user_input_async', 'other-call', 0)
    ])
      expect(unansweredCodexQuestions(codexQuestionsAfter(state, row))).toEqual(
        unansweredCodexQuestions(state)
      )
  })
  it('does not manufacture evidence from unknown or malformed records', () => {
    const state = initial()
    for (const row of [
      null,
      { type: 'event_msg', payload: ask('a').payload },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'request_user_input_async',
          call_id: 'a',
          arguments: '{'
        }
      },
      { type: 'response_item', payload: { ...ask('a').payload, call_id: '' } }
    ])
      expect(codexQuestionsAfter(state, row)).toEqual(state)
  })
})
