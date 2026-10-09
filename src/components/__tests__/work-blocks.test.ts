import { describe, expect, it } from 'bun:test'
import type {
  ConversationPart,
  IConversationTurn
} from '../../types/conversation.ts'
import {
  formatWorkDuration,
  isLiveWorkTurn,
  isWaitingWorkTurn,
  splitTurn,
  workFailed,
  workStartsOpen,
  workSummary
} from '../work-blocks.ts'

const tool = (
  name: string,
  summary = name
): Extract<ConversationPart, { kind: 'tool' }> => ({
  kind: 'tool',
  id: name,
  name,
  summary,
  input: '{}',
  output: '',
  pending: false
})
const text = (value: string): Extract<ConversationPart, { kind: 'text' }> => ({
  kind: 'text',
  text: value
})
const thinking = (
  value: string
): Extract<ConversationPart, { kind: 'thinking' }> => ({
  kind: 'thinking',
  text: value
})

describe('splitTurn', () => {
  it('folds every action and the narration between them into the work; the trailing prose is the answer', () => {
    const split = splitTurn([
      thinking('hm'),
      tool('read'),
      text('looking…'),
      tool('edit'),
      text('done'),
      text('really')
    ])
    expect(split.work).toEqual([
      thinking('hm'),
      tool('read'),
      text('looking…'),
      tool('edit')
    ])
    expect(split.answer).toEqual([text('done'), text('really')])
  })

  it('is all answer when the agent only spoke, and drops whitespace-only prose', () => {
    expect(splitTurn([text('  \n'), text('hi')])).toEqual({
      work: [],
      answer: [text('hi')]
    })
  })

  it('is all work when the turn ends on an action (still running)', () => {
    expect(splitTurn([text('on it'), tool('bash')])).toEqual({
      work: [text('on it'), tool('bash')],
      answer: []
    })
  })

  it('keeps commentary inside work even after the last tool or with no tools', () => {
    const narration = {
      ...text('Still investigating'),
      phase: 'commentary' as const
    }
    expect(splitTurn([tool('exec_command'), narration]).answer).toEqual([])
    expect(splitTurn([narration])).toEqual({ work: [narration], answer: [] })
  })

  it('honors an explicit final answer even if a later record contains an action', () => {
    const final = { ...text('Done'), phase: 'final_answer' as const }
    expect(splitTurn([tool('exec_command'), final, tool('cleanup')])).toEqual({
      work: [tool('exec_command'), tool('cleanup')],
      answer: [final]
    })
  })
})

describe('workStartsOpen', () => {
  const commentary = (value: string) => ({
    ...text(value),
    phase: 'commentary' as const
  })
  const final = (value: string) => ({
    ...text(value),
    phase: 'final_answer' as const
  })

  it('is open while the turn runs, whatever it holds', () => {
    expect(workStartsOpen(true, [tool('read'), text('done')])).toBe(true)
    expect(workStartsOpen(true, [tool('bash')])).toBe(true)
  })

  it('folds a settled turn: its answer stays outside the fold', () => {
    expect(
      workStartsOpen(false, [
        thinking('hm'),
        tool('read'),
        text('looking…'),
        tool('edit'),
        text('done')
      ])
    ).toBe(false)
    expect(
      workStartsOpen(false, [
        commentary('Checking.'),
        tool('exec_command'),
        final('All good.')
      ])
    ).toBe(false)
    expect(
      workStartsOpen(false, [
        commentary('Checking.'),
        tool('exec_command'),
        final('Done'),
        tool('cleanup')
      ])
    ).toBe(false)
  })

  it('keeps a settled turn open when its words are followed by an action and no answer', () => {
    expect(workStartsOpen(false, [text('on it'), tool('bash')])).toBe(true)
    expect(
      workStartsOpen(false, [
        tool('read'),
        text('Here is the full answer.'),
        tool('TodoWrite')
      ])
    ).toBe(true)
  })

  it('keeps a settled turn open when it ends in commentary: folding would hide its last text', () => {
    expect(
      workStartsOpen(false, [
        tool('exec_command'),
        commentary('Still investigating')
      ])
    ).toBe(true)
    expect(
      workStartsOpen(false, [commentary('Checking the second request.')])
    ).toBe(true)
    expect(
      workStartsOpen(false, [
        tool('exec_command'),
        commentary('Still investigating'),
        thinking('hm')
      ])
    ).toBe(true)
  })

  it('keeps a settled turn open when commentary comes after its final answer', () => {
    expect(
      workStartsOpen(false, [
        tool('exec_command'),
        final('Done.'),
        commentary('Resumed: still looking')
      ])
    ).toBe(true)
    expect(
      workStartsOpen(false, [
        tool('exec_command'),
        final('Done.'),
        commentary('Resumed'),
        tool('exec_command')
      ])
    ).toBe(true)
  })

  it('stays folded when the turn did nothing readable', () => {
    expect(workStartsOpen(false, [])).toBe(false)
    expect(workStartsOpen(false, [thinking('hm')])).toBe(false)
    expect(workStartsOpen(false, [tool('bash'), text('  ')])).toBe(false)
  })
})

describe('workSummary', () => {
  it('counts by what the reader cares about, singular and plural', () => {
    expect(
      workSummary([
        tool('Edit'),
        tool('Write'),
        tool('read'),
        tool('Bash'),
        tool('WebFetch')
      ])
    ).toBe('2 edits · 1 file read · 1 command · 1 other tool')
  })

  it('is empty for reasoning and prose alone', () => {
    expect(workSummary([thinking('x'), text('y')])).toBe('')
  })

  it('leaves todo updates out of the counts', () => {
    expect(
      workSummary([
        tool('TodoWrite'),
        tool('Edit'),
        tool('update_plan'),
        tool('todo_write'),
        tool('Read')
      ])
    ).toBe('1 edit · 1 file read')
  })
})

describe('formatWorkDuration', () => {
  it('formats seconds, minutes and rejects unknown or negative spans', () => {
    expect(
      formatWorkDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:07.4Z')
    ).toBe('7s')
    expect(
      formatWorkDuration('2026-01-01T00:00:00Z', '2026-01-01T00:01:12Z')
    ).toBe('1m 12s')
    expect(
      formatWorkDuration('2026-01-01T00:00:10Z', '2026-01-01T00:00:00Z')
    ).toBeNull()
    expect(formatWorkDuration(null, '2026-01-01T00:00:00Z')).toBeNull()
  })
})

describe('workFailed', () => {
  const failed: ConversationPart = {
    kind: 'tool',
    id: 'f1',
    name: 'Bash',
    summary: '',
    input: '',
    output: '',
    pending: false,
    error: true
  }

  it('counts the calls that failed, apart from the summary a narrow header cuts short', () => {
    const parts = [tool('Edit'), failed, failed]
    expect(workSummary(parts)).toBe('1 edit · 2 commands')
    expect(workFailed(parts)).toBe(2)
    expect(workFailed([tool('Edit'), thinking('x'), text('y')])).toBe(0)
  })

  it('counts a failed call the summary does not count', () => {
    const parts: ConversationPart[] = [{ ...failed, name: 'TodoWrite' }]
    expect(workSummary(parts)).toBe('')
    expect(workFailed(parts)).toBe(1)
  })
})

describe('isLiveWorkTurn', () => {
  const turn: IConversationTurn = {
    id: 't1',
    role: 'assistant',
    ts: null,
    parts: [],
    end_ts: '2026-09-28T00:00:00Z'
  }

  it('keeps an approval-blocked assistant turn live', () => {
    expect(isLiveWorkTurn(turn, true, 'blocked')).toBe(true)
    expect(
      isLiveWorkTurn({ ...turn, end_ts: undefined }, true, 'blocked')
    ).toBe(true)
    expect(isLiveWorkTurn(turn, true, 'working')).toBe(true)
    expect(isLiveWorkTurn(turn, false, 'blocked')).toBe(false)
    expect(isLiveWorkTurn(turn, true, 'idle')).toBe(false)
    expect(isLiveWorkTurn({ ...turn, role: 'user' }, true, 'blocked')).toBe(
      false
    )
  })

  it('does not title a finished turn as running after a message was sent over it', () => {
    const finished: IConversationTurn = {
      id: 'f1',
      role: 'assistant',
      ts: '2026-09-29T00:00:00Z',
      parts: [],
      end_ts: '2026-09-29T00:00:06Z'
    }
    expect(isLiveWorkTurn(finished, true, 'working', finished)).toBe(false)
    expect(isLiveWorkTurn(finished, true, 'blocked', finished)).toBe(false)
    const untimed: IConversationTurn = { ...finished, ts: null }
    expect(isLiveWorkTurn(untimed, true, 'working', untimed)).toBe(false)
    const next: IConversationTurn = { ...finished, end_ts: undefined }
    expect(isLiveWorkTurn(next, true, 'working', finished)).toBe(true)
    expect(isLiveWorkTurn({ ...untimed }, true, 'working', untimed)).toBe(true)
    expect(isLiveWorkTurn(finished, true, 'working', null)).toBe(true)
    expect(isLiveWorkTurn(finished, true, 'working')).toBe(true)
  })
})

describe('isWaitingWorkTurn', () => {
  it('says the open block waits for the user while the agent is blocked, and only then', () => {
    expect(isWaitingWorkTurn(true, 'blocked')).toBe(true)
    expect(isWaitingWorkTurn(true, 'working')).toBe(false)
    expect(isWaitingWorkTurn(false, 'blocked')).toBe(false)
    expect(isWaitingWorkTurn(true, undefined)).toBe(false)
  })
})
