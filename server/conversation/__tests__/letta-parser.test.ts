import { describe, expect, test } from 'bun:test'
import {
  parseLettaTranscript,
  stripLettaRuntimeContext
} from '../letta-parser.ts'

const entry = (id: string, role: string, content: unknown, extra = {}) =>
  JSON.stringify({
    type: 'message',
    message: { id, role, content, timestamp: 1000, ...extra }
  })

describe('native Letta conversation projection', () => {
  test('native stream errors survive empty content; quoted warnings do not become runtime events', () => {
    const warning =
      'OpenAI Responses stream completed with an unfinished tool call: ApplyPatch (call_fixture)'
    const parsed = parseLettaTranscript(
      entry('failed', 'assistant', [], {
        stopReason: 'error',
        errorMessage: warning
      })
    )
    expect(parsed.turns[0]?.parts).toEqual([
      {
        kind: 'notice',
        source: 'letta-runtime',
        severity: 'error',
        text: warning
      }
    ])
    const quoted = parseLettaTranscript(
      entry('quoted', 'assistant', [{ type: 'text', text: warning }], {
        stopReason: 'stop'
      })
    )
    expect(quoted.turns[0]?.parts.every((part) => part.kind !== 'notice')).toBe(
      true
    )
    const abort = parseLettaTranscript(
      entry('aborted', 'assistant', [], { stopReason: 'aborted' })
    )
    expect(abort.turns[0]?.parts[0]).toHaveProperty('severity', 'warning')
  })
  test('replacement snapshots move to native insertion tail', () => {
    const { turns } = parseLettaTranscript(
      [
        entry('a', 'assistant', [{ type: 'text', text: 'old' }]),
        entry('u', 'user', [{ type: 'text', text: 'user' }]),
        entry('a', 'assistant', [{ type: 'text', text: 'replacement' }], {
          stopReason: 'stop'
        })
      ].join('\n')
    )
    expect(turns.map((turn) => turn.id)).toEqual(['u', 'a'])
    expect(turns[1].parts[0]).toEqual({
      kind: 'text',
      text: 'replacement',
      phase: 'final_answer'
    })
  })

  test('uses native roles and call IDs, folds commentary but retains final text', () => {
    const text = [
      entry('u1', 'user', [{ type: 'text', text: 'แก้ให้หน่อย' }]),
      entry(
        'a1',
        'assistant',
        [
          { type: 'text', text: 'กำลังตรวจ' },
          {
            type: 'toolCall',
            id: 'c1',
            name: 'read',
            arguments: { path: 'src/app.tsx' }
          }
        ],
        { stopReason: 'toolUse', model: 'gpt-test' }
      ),
      entry('r1', 'toolResult', [{ type: 'text', text: 'native output' }], {
        toolCallId: 'c1',
        isError: false
      }),
      entry('a2', 'assistant', [{ type: 'text', text: 'เรียบร้อย' }], {
        stopReason: 'stop'
      })
    ].join('\n')
    const { turns, metadata } = parseLettaTranscript(text)
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant'])
    expect(turns[1].parts).toEqual([
      { kind: 'text', text: 'กำลังตรวจ', phase: 'commentary' },
      {
        kind: 'tool',
        id: 'c1',
        name: 'read',
        summary: 'src/app.tsx',
        input: '{\n  "path": "src/app.tsx"\n}',
        output: 'native output',
        pending: false,
        error: false,
        truncated: false
      },
      { kind: 'text', text: 'เรียบร้อย', phase: 'final_answer' }
    ])
    expect(metadata).toEqual({ model: 'gpt-test', reasoning_effort: null })
  })

  test('never displays runtime/system/compaction envelopes as human messages', () => {
    const text = [
      JSON.stringify({ type: 'session', id: 'local-conv-test' }),
      JSON.stringify({
        type: 'compaction',
        message: { id: 'compact', role: 'user', content: 'internal summary' }
      }),
      entry('system', 'system', 'secret context'),
      entry(
        'context',
        'user',
        '<skill_content name="skill">internal</skill_content>'
      ),
      entry(
        'u1',
        'user',
        '<user_timestamp>now</user_timestamp>\nจริง\n<terminal_file_link_contract>paths policy</terminal_file_link_contract>\n<system-reminder>private</system-reminder>'
      )
    ].join('\n')
    expect(parseLettaTranscript(text).turns).toEqual([
      {
        id: 'u1',
        role: 'user',
        ts: '1970-01-01T00:00:01.000Z',
        parts: [{ kind: 'text', text: 'จริง' }]
      }
    ])
    expect(stripLettaRuntimeContext('Use `<component>` as an example')).toBe(
      'Use `<component>` as an example'
    )
  })

  test('latest native message snapshot wins, orphan results and partial writes do not invent turns', () => {
    const text = [
      entry('a1', 'assistant', [{ type: 'text', text: 'partial' }]),
      entry('a1', 'assistant', [{ type: 'text', text: 'complete' }], {
        stopReason: 'stop'
      }),
      entry('r1', 'toolResult', [{ type: 'text', text: 'orphan' }], {
        toolCallId: 'missing'
      }),
      '{"type":"message"'
    ].join('\n')
    expect(parseLettaTranscript(text).turns[0].parts).toEqual([
      { kind: 'text', text: 'complete', phase: 'final_answer' }
    ])
  })

  test('image-only user turns remain visible with a truthful capability boundary', () => {
    const result = parseLettaTranscript(
      entry('image', 'user', [
        { type: 'image', mimeType: 'image/png', data: 'synthetic' }
      ])
    )
    expect(result.turns[0].role).toBe('user')
    expect(result.turns[0].parts[0].kind).toBe('notice')
  })
})
