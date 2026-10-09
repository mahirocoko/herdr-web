import { describe, expect, test } from 'bun:test'
import { parseAgyTranscript, stripAgyRuntimeContext } from '../agy-parser.ts'

const step = (
  step_index: number,
  type: string,
  source: string,
  extra: Record<string, unknown> = {}
) =>
  JSON.stringify({
    step_index,
    type,
    source,
    status: 'DONE',
    created_at: '2026-10-08T04:00:00.000Z',
    ...extra
  })

describe('native Agy conversation projection', () => {
  test('invalid single call cannot turn thinking into a result', () => {
    const { turns } = parseAgyTranscript(
      [
        step(1, 'PLANNER_RESPONSE', 'MODEL', {
          thinking: 'reason',
          tool_calls: [{}]
        }),
        step(2, 'GENERIC', 'MODEL', { content: 'unpaired', status: 'ERROR' })
      ].join('\n')
    )
    expect(turns[0].parts).toEqual([
      { kind: 'thinking', text: 'reason' },
      { kind: 'notice', text: 'unpaired' }
    ])
  })

  test('unknown activity breaks pairing; ephemeral bookkeeping does not', () => {
    for (const type of ['UNKNOWN', 'EPHEMERAL_MESSAGE']) {
      const { turns } = parseAgyTranscript(
        [
          step(1, 'PLANNER_RESPONSE', 'MODEL', {
            tool_calls: [{ name: 'read', args: { TargetFile: 'a.ts' } }]
          }),
          step(2, type, 'MODEL'),
          step(3, 'GENERIC', 'MODEL', { content: 'result' })
        ].join('\n')
      )
      const tool = turns[0].parts[0]
      expect(tool.kind).toBe('tool')
      if (tool.kind !== 'tool') throw new Error('missing tool')
      expect(tool.pending).toBe(type === 'UNKNOWN')
      expect(tool.output).toBe(type === 'UNKNOWN' ? '' : 'result')
      expect(tool.summary).toBe('a.ts')
    }
  })

  test('uses native roles and pairs single tool result unambiguously', () => {
    const text = [
      step(0, 'USER_INPUT', 'USER_EXPLICIT', {
        content: 'ตรวจเช็คไฟล์หน่อย'
      }),
      step(1, 'PLANNER_RESPONSE', 'MODEL', {
        thinking: 'กำลังตรวจสอบ codebase',
        content: 'เดี๋ยวลองรันคำสั่งดู',
        tool_calls: [
          { name: 'run_command', args: { CommandLine: 'git status' } }
        ],
        model: 'gemini-3.8-flash-high'
      }),
      step(2, 'GENERIC', 'MODEL', {
        content: 'On branch main\nnothing to commit'
      }),
      step(3, 'PLANNER_RESPONSE', 'MODEL', {
        content: 'ทุกอย่างเรียบร้อยดีครับ'
      })
    ].join('\n')

    const { turns, metadata } = parseAgyTranscript(text)
    expect(turns.length).toBe(2)
    expect(turns[0].role).toBe('user')
    expect(turns[0].parts).toEqual([
      { kind: 'text', text: 'ตรวจเช็คไฟล์หน่อย' }
    ])

    expect(turns[1].role).toBe('assistant')
    expect(turns[1].parts).toEqual([
      { kind: 'thinking', text: 'กำลังตรวจสอบ codebase' },
      {
        kind: 'tool',
        id: 'tool-1-0',
        name: 'run_command',
        summary: 'git status',
        input: '{\n  "CommandLine": "git status"\n}',
        output: 'On branch main\nnothing to commit',
        pending: false,
        error: false,
        truncated: false
      },
      { kind: 'text', text: 'เดี๋ยวลองรันคำสั่งดู', phase: 'commentary' },
      { kind: 'text', text: 'ทุกอย่างเรียบร้อยดีครับ', phase: 'final_answer' }
    ])
    expect(metadata.model).toBe('gemini-3.8-flash-high')
  })

  test('deduplicates rows by step_index and ignores trailing malformed lines', () => {
    const text = [
      step(0, 'USER_INPUT', 'USER_EXPLICIT', { content: 'เก่า' }),
      step(0, 'USER_INPUT', 'USER_EXPLICIT', { content: 'ใหม่' }),
      '{"incomplete'
    ].join('\n')

    const { turns } = parseAgyTranscript(text)
    expect(turns.length).toBe(1)
    expect(turns[0].parts[0]).toEqual({ kind: 'text', text: 'ใหม่' })
  })

  test('suppresses EPHEMERAL_MESSAGE, SYSTEM_SDK, and MemFS injection tags', () => {
    const text = [
      step(0, 'EPHEMERAL_MESSAGE', 'SYSTEM_SDK', {
        content: 'sdk context'
      }),
      step(1, 'USER_INPUT', 'USER_EXPLICIT', {
        content: [
          '<identity>You are Antigravity</identity>',
          '<user_rules>rule 1</user_rules>',
          '<USER_REQUEST>ช่วยเขียนโค้ดหน่อย</USER_REQUEST>',
          '<ADDITIONAL_METADATA>meta</ADDITIONAL_METADATA>',
          '[MemFS Active Memory]\nmemory content'
        ].join('\n')
      })
    ].join('\n')

    const { turns } = parseAgyTranscript(text)
    expect(turns.length).toBe(1)
    expect(turns[0].parts).toEqual([
      { kind: 'text', text: 'ช่วยเขียนโค้ดหน่อย' }
    ])
    expect(stripAgyRuntimeContext('ordinary <component> tag')).toBe(
      'ordinary <component> tag'
    )
  })

  test('renders multi-tool or unpaired GENERIC outputs as truthful notices', () => {
    const text = [
      step(0, 'USER_INPUT', 'USER_EXPLICIT', { content: 'รันพร้อมกัน 2 อัน' }),
      step(1, 'PLANNER_RESPONSE', 'MODEL', {
        tool_calls: [
          { name: 'task_a', args: {} },
          { name: 'task_b', args: {} }
        ]
      }),
      step(2, 'GENERIC', 'MODEL', {
        content: 'result a and b'
      })
    ].join('\n')

    const { turns } = parseAgyTranscript(text)
    expect(turns.length).toBe(2)
    const assistant = turns[1]
    expect(assistant.parts.length).toBe(3)
    // 2 tool parts with pending: true
    expect(assistant.parts[0].kind).toBe('tool')
    expect((assistant.parts[0] as any).pending).toBe(true)
    expect(assistant.parts[1].kind).toBe('tool')
    expect((assistant.parts[1] as any).pending).toBe(true)
    // Unpaired output is a notice
    expect(assistant.parts[2]).toEqual({
      kind: 'notice',
      text: 'result a and b'
    })
  })

  test('marks tool error when GENERIC status is ERROR', () => {
    const text = [
      step(0, 'USER_INPUT', 'USER_EXPLICIT', { content: 'test' }),
      step(1, 'PLANNER_RESPONSE', 'MODEL', {
        tool_calls: [{ name: 'fail_tool', args: {} }]
      }),
      step(2, 'GENERIC', 'MODEL', {
        content: 'command exited with code 1',
        status: 'ERROR'
      })
    ].join('\n')

    const { turns } = parseAgyTranscript(text)
    const tool = turns[1].parts[0] as any
    expect(tool.kind).toBe('tool')
    expect(tool.error).toBe(true)
    expect(tool.pending).toBe(false)
  })
})
