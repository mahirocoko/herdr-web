import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolveSurfaceMode } from '../utils/surface-mode.ts'
import { isAgentPane } from '../utils/workspace-helpers.ts'

// Execute the production selection effect, including its metadata guard and refs.
const source = readFileSync(new URL('../app.tsx', import.meta.url), 'utf8')
const marker = '    // Do not consume the selection transition'
const start = source.indexOf(marker)
const end = source.indexOf('\n  }, [', start)
if (start < 0 || end < 0)
  throw new Error('Production selection effect not found')
const run = new Function(
  'selectedPane',
  'selectedPaneId',
  'snapshot',
  'isSelectedPaneBlocked',
  'viewMode',
  'prevPaneIdRef',
  'prevBlockedRef',
  'setViewMode',
  'resolveSurfaceMode',
  'isAgentPane',
  source.slice(start, end)
)

test('late pane metadata does not consume the initial agent Chat transition', () => {
  const paneRef = { current: null as string | null }
  const blockedRef = { current: false }
  let mode = 'stream'
  const update = (pane: unknown, blocked = false) =>
    run(
      pane,
      'agent',
      { agents: [] },
      blocked,
      mode,
      paneRef,
      blockedRef,
      (next: string) => {
        mode = next
      },
      resolveSurfaceMode,
      isAgentPane
    )
  update(undefined)
  expect(paneRef.current).toBeNull()
  update({ pane_id: 'old', agent: 'shell' })
  expect(paneRef.current).toBeNull()
  update({ pane_id: 'agent', agent: 'letta' })
  expect(mode).toBe('chat')
  expect(paneRef.current).toBe('agent')
  mode = 'stream'
  update({ pane_id: 'agent', agent: 'letta', agent_status: 'blocked' }, true)
  expect(mode).toBe('stream')
  update({ pane_id: 'agent', agent: 'letta', agent_status: 'working' })
  expect(mode).toBe('stream')
})

test('a shell selection defaults to Terminal and a session-only agent defaults to Chat', () => {
  for (const [pane, wanted] of [
    [{ pane_id: 'next', agent: 'shell' }, 'stream'],
    [
      {
        pane_id: 'next',
        agent: 'shell',
        agent_session: { kind: 'id', value: 'fixture' }
      },
      'chat'
    ]
  ] as const) {
    let mode = 'chat'
    run(
      pane,
      'next',
      { agents: [] },
      false,
      mode,
      { current: 'previous' },
      { current: false },
      (next: string) => {
        mode = next
      },
      resolveSurfaceMode,
      isAgentPane
    )
    expect(mode).toBe(wanted)
  }
})
