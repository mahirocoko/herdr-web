import { describe, expect, test } from 'bun:test'
import {
  corroboratedSubmission,
  isCurrentSubmissionIssue,
  sameSubmissionTarget,
  restoreSubmissions,
  submissionBaseline,
  submissionFailurePhase,
  submissionFailure,
  submissionLabel,
  type IChatSubmission
} from '../chat-submissions.ts'
import type { IConversationContribution } from '../../types/conversation.ts'

const target = {
  paneId: 'pane',
  terminalId: 'terminal',
  expectedMode: 'agent' as const,
  agentSessionId: 'agent-session'
}
const row = (
  id: string,
  position: number,
  text = 'hello'
): IConversationContribution => ({
  id,
  position,
  role: 'user',
  ts: '2026-10-12T08:30:01Z',
  parts: [{ kind: 'text', text }]
})
const record: IChatSubmission = {
  operationId: 'op',
  text: 'hello',
  target,
  generation: 'browser',
  submittedAt: '2026-10-12T08:30:00Z',
  baseline: submissionBaseline('history', [row('old', 10)]),
  phase: 'submitted-awaiting-transcript'
}
const match = (
  records = [record],
  rows = [row('old', 10), row('new', 20)],
  selected = target,
  history = 'history'
) => corroboratedSubmission(record, records, selected, history, rows)

describe('submission evidence, never delivery authority', () => {
  test('rejected 403 persists allowlisted facts, legacy receipts invent no status, unknown stays uncertain', () => {
    const error = Object.assign(new Error('Invalid Origin'), {
      status: 403,
      outcome: 'rejected',
      result: { secret: 'never-store' }
    })
    const failure = submissionFailure(error)
    expect(failure).toEqual({ status: 403, code: 'invalid-origin' })
    const rejected = {
      ...record,
      phase: submissionFailurePhase(error),
      failure
    }
    const restored = restoreSubmissions(
      JSON.stringify([{ ...rejected, failure: { ...failure, secret: 'drop' } }])
    )[0]
    expect(restored.failure).toEqual(failure)
    expect(submissionLabel(restored)).toContain('Invalid Origin')
    expect(submissionLabel(restored)).toContain('configured owner identity')
    expect(submissionLabel(restored)).toContain(
      'Push enrollment is not required'
    )
    expect(
      restoreSubmissions(JSON.stringify([{ ...record, phase: 'rejected' }]))[0]
        .failure
    ).toBeUndefined()
    expect(submissionLabel({ ...rejected, phase: 'uncertain' })).not.toContain(
      'authorized'
    )
    expect(JSON.stringify(failure)).not.toContain('never-store')
  })
  test('mode flips and transient unread history are not proof of stale storage', () => {
    const blocked = { ...target, expectedMode: 'blocked-agent' as const }
    expect(sameSubmissionTarget(target, blocked)).toBe(false)
    expect(
      corroboratedSubmission(record, [record], blocked, 'history', [
        row('new', 20)
      ])
    ).toBeNull()
    expect(
      corroboratedSubmission(record, [record], target, null, [row('new', 20)])
    ).toBeNull()
    expect(match()).toBe('new')
  })
  test('only current live sending and problems remain outside history', () => {
    for (const phase of ['sending', 'uncertain', 'rejected'] as const) {
      const issue = { ...record, phase }
      expect(isCurrentSubmissionIssue(issue, target, 'history')).toBe(true)
      expect(
        isCurrentSubmissionIssue(
          { ...issue, restored: true },
          target,
          'history'
        )
      ).toBe(false)
      expect(isCurrentSubmissionIssue(issue, target, 'replacement')).toBe(false)
      expect(
        isCurrentSubmissionIssue(
          issue,
          { ...target, agentSessionId: 'replacement' },
          'history'
        )
      ).toBe(false)
    }
    expect(isCurrentSubmissionIssue(record, target, 'history')).toBe(false)
    expect(
      isCurrentSubmissionIssue({ ...record, baseline: null }, target, 'history')
    ).toBe(false)
  })
  test('acknowledgement remains awaiting transcript, not execution', () => {
    expect(submissionLabel(record)).toContain('execution not confirmed')
    expect(match([record], [row('old', 10)])).toBeNull()
    expect(match()).toBe('new')
  })
  test('old text and older paginated rows cannot confirm', () => {
    expect(match([record], [row('old', 10), row('older', 2)])).toBeNull()
    expect(
      match([record], [{ ...row('new', 20), ts: '2026-10-12T08:29:00Z' }])
    ).toBeNull()
    expect(match([record], [{ ...row('new', 20), ts: null }])).toBeNull()
  })
  test('exact target and history prevent session replacement confirmation', () => {
    expect(
      match([record], [row('new', 20)], {
        ...target,
        agentSessionId: 'replacement'
      })
    ).toBeNull()
    expect(
      match([record], [row('new', 20)], {
        ...target,
        terminalId: 'replacement'
      })
    ).toBeNull()
    expect(match([record], [row('new', 20)], target, 'replacement')).toBeNull()
  })
  test('identical native rows or repeated submissions are ambiguous', () => {
    expect(match([record], [row('new', 20), row('second', 30)])).toBeNull()
    expect(match([record, { ...record, operationId: 'repeat' }])).toBeNull()
  })
  test('truncation, partial text, or absent frontier cannot corroborate', () => {
    expect(match([record], [row('new', 20, 'hell')])).toBeNull()
    expect(
      match(
        [record],
        [
          {
            ...row('new', 20),
            parts: [{ kind: 'text', text: 'hello', truncated: true }]
          }
        ]
      )
    ).toBeNull()
    expect(
      corroboratedSubmission(
        { ...record, baseline: null },
        [record],
        target,
        'history',
        [row('new', 20)]
      )
    ).toBeNull()
  })
  test('unknown transport keeps uncertain, only explicit rejection is rejected', () => {
    expect(submissionFailurePhase(new Error('network'))).toBe('uncertain')
    expect(submissionFailurePhase({ outcome: 'unknown' })).toBe('uncertain')
    expect(submissionFailurePhase({ outcome: 'rejected' })).toBe('rejected')
    expect(
      corroboratedSubmission(
        { ...record, phase: 'uncertain' },
        [record],
        target,
        'history',
        [row('new', 20)]
      )
    ).toBeNull()
  })
  test('reload preserves inert submitted evidence and makes in-flight uncertain', () => {
    const restored = restoreSubmissions(
      JSON.stringify([
        record,
        { ...record, operationId: 'flight', phase: 'sending' }
      ])
    )
    expect(restored[0].phase).toBe('submitted-awaiting-transcript')
    expect(restored[0].restored).toBe(true)
    expect(restored[1].phase).toBe('uncertain')
    expect(submissionLabel(restored[1])).toContain('never replayed')
    expect(restoreSubmissions('{bad')).toEqual([])
    expect(
      restoreSubmissions(JSON.stringify([{ ...record, target: null }]))
    ).toEqual([])
  })
})
