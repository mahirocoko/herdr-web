import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import QuestionView from '../question-view.tsx'
import {
  snapshotReadNotice,
  promptReadNotice
} from '../../utils/readiness-copy.ts'
import { formatActionErrorMessage } from '../../utils/action-target.ts'

const question = (
  content: string | null,
  error: string | null,
  isLoading = false
) =>
  renderToStaticMarkup(
    createElement(QuestionView, {
      paneId: 'pane',
      content,
      error,
      isLoading,
      onRefresh: () => {},
      onSwitchToStream: () => {}
    })
  )

describe('truthful readiness presentation', () => {
  it('does not invent daemon, schema or authorization diagnoses from read failure', () => {
    const notice = snapshotReadNotice('error', 'Read timed out')!
    expect(notice).toContain('Read timed out')
    expect(notice).toContain('refresh snapshot')
    expect(notice).not.toContain('Failed to connect to Herdr daemon')
    expect(notice).not.toContain('incompatible')
    expect(notice).not.toContain('authorized')
    expect(snapshotReadNotice('loading', null)).toBeNull()
    expect(snapshotReadNotice('connected', null)).toBeNull()
  })
  it('distinguishes retained snapshot from empty native session', () => {
    expect(snapshotReadNotice('reconnecting', null)).toContain(
      'may be out of date'
    )
    expect(snapshotReadNotice('reconnecting', 'read failed')).toContain(
      'read failed'
    )
    expect(snapshotReadNotice('empty', null)).toContain('Open a Space in Herdr')
    expect(snapshotReadNotice('empty', null)).toContain('New Space')
  })
  it('keeps unread and unknown prompts fail-closed with inspection guidance', () => {
    expect(promptReadNotice(false, null)).toContain('Send waits')
    expect(promptReadNotice(false, 'read failed')).toContain(
      'Send remains unavailable'
    )
    expect(promptReadNotice(true, 'other error')).toContain(
      'Inspect Terminal before re-reading'
    )
    expect(promptReadNotice(true, null)).not.toContain('retry sending')
  })
  it('shows the last question with failed-refresh provenance and real recovery controls', () => {
    const html = question('Old question?', 'read failed')
    expect(html).toContain('Old question?')
    expect(html).toContain('not current question evidence')
    expect(html).toContain('Re-read question')
    expect(html).toContain('Inspect Terminal')
    expect(html).toContain('Read-only detection snapshot')
  })
  it('does not interpret empty detection text as input readiness', () => {
    const html = question('', null)
    expect(html).toContain('does not confirm that the agent is ready')
    expect(html).toContain('Re-read question')
    expect(question(null, null, true)).toContain('Loading question snapshot')
    expect(question(null, 'read failed')).toContain('Failed to read question')
  })
  it('uses an actual HTTP denial for action authorization and preserves unknown outcome priority', () => {
    expect(
      formatActionErrorMessage({ status: 403, message: 'Forbidden' })
    ).toContain('configured owner identity')
    expect(
      formatActionErrorMessage({ status: 403, message: 'Invalid Origin' })
    ).toContain('Invalid Origin')
    expect(
      formatActionErrorMessage({ status: 403, message: 'Forbidden' })
    ).toContain('Push enrollment is not required')
    expect(
      formatActionErrorMessage({ status: 403, outcome: 'unknown' })
    ).toContain('Outcome unknown')
    expect(
      formatActionErrorMessage({ status: 502, message: 'Read failed' })
    ).toBe('Read failed')
  })
})
