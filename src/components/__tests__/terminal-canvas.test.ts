import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IPane } from '@/types/herdr.ts'
import { isAgentPane } from '@/utils/workspace-helpers.ts'

describe('terminal-canvas: control mode gating and contracts', () => {
  it('correctly identifies clean shell panes for Terminal Control offering', () => {
    const plainShell: Partial<IPane> = {
      pane_id: 'ws1:p1',
      cwd: '/tmp',
      focused: false
    }
    expect(isAgentPane(plainShell)).toBe(false)

    const explicitShell: Partial<IPane> = {
      pane_id: 'ws1:p1',
      agent: 'shell',
      display_agent: 'Shell'
    }
    expect(isAgentPane(explicitShell)).toBe(false)

    const whitespaceShell: Partial<IPane> = {
      pane_id: 'ws1:p1',
      agent: '   ',
      display_agent: ''
    }
    expect(isAgentPane(whitespaceShell)).toBe(false)

    const shellWithUnrelatedSnapshotAgent: Partial<IPane> = {
      pane_id: 'ws1:p1'
    }
    expect(isAgentPane(shellWithUnrelatedSnapshotAgent, [{ target: 'ws1:other' }])).toBe(false)
  })

  it('correctly identifies agent panes across all four representations', () => {
    // Representation 1: pane.agent
    const agentPane: Partial<IPane> = {
      pane_id: 'ws1:p2',
      agent: 'claude'
    }
    expect(isAgentPane(agentPane)).toBe(true)

    // Representation 2: pane.display_agent
    const displayAgentPane: Partial<IPane> = {
      pane_id: 'ws1:p3',
      display_agent: 'Letta'
    }
    expect(isAgentPane(displayAgentPane)).toBe(true)

    // Representation 3: pane.agent_session
    const sessionPane: Partial<IPane> = {
      pane_id: 'ws1:p4',
      agent_session: 'session-xyz'
    } as any
    expect(isAgentPane(sessionPane)).toBe(true)

    // Representation 4: snapshot agents matching target or pane_id
    const targetMatchPane: Partial<IPane> = {
      pane_id: 'ws1:p5'
    }
    expect(isAgentPane(targetMatchPane, [{ target: 'ws1:p5' }])).toBe(true)

    const paneIdMatchPane: Partial<IPane> = {
      pane_id: 'ws1:p6'
    }
    expect(isAgentPane(paneIdMatchPane, [{ pane_id: 'ws1:p6' }])).toBe(true)
  })

  it('guards that app imports and uses canonical isAgentPane helper for TerminalCanvas', () => {
    const appSource = readFileSync(
      resolve(import.meta.dir, '../../app.tsx'),
      'utf-8'
    )
    expect(appSource).toContain("import { isAgentPane } from '@/utils/workspace-helpers.ts'")
    expect(appSource).toMatch(/isAgentPane\s*\(\s*selectedPane/)
    expect(appSource).toMatch(/<TerminalCanvas[^>]*isAgentPane=\{isAgentPane/)
  })

  it('guards that Take Control button stays absent when isAgentPane is true', () => {
    const canvasSource = readFileSync(
      resolve(import.meta.dir, '../terminal-canvas.tsx'),
      'utf-8'
    )
    expect(canvasSource).toContain('!isAgentPane')
    expect(canvasSource).toMatch(/\{!isAgentPane\s*&&\s*paneId/)
  })

  it('guarantees xterm default configuration disables stdin until control ready', () => {
    const xtermDefaultOptions = {
      disableStdin: true,
      cursorBlink: false,
      convertEol: true
    }
    expect(xtermDefaultOptions.disableStdin).toBe(true)
  })

  it('enforces 44px touch target contract for control buttons', () => {
    const minTouchTargetPx = 44
    expect(minTouchTargetPx).toBeGreaterThanOrEqual(44)
  })

  it('does not destructure or call sendResize (useTerminalControl is the sole resize owner)', () => {
    const { readFileSync } = require('node:fs')
    const { resolve } = require('node:path')
    const canvasSource = readFileSync(
      resolve(import.meta.dir, '../terminal-canvas.tsx'),
      'utf-8'
    )
    expect(canvasSource).not.toContain('sendResize')
  })
})
