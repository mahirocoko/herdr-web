import { describe, expect, it } from 'bun:test'
import {
  formatManifestSource,
  formatRegionLabel,
  isAgentPane,
  isShellLaunchCandidate
} from '../pane-drawer.tsx'
import type { IPane } from '@/types/herdr.ts'

describe('shell launch candidate (not process readiness)', () => {
  // Native QA wAB:p1: blank shell at prompt had UNKNOWN, not IDLE.
  // The previous direct guard `agent_status === idle` rejected this shape.
  const nativeShell: IPane = {
    pane_id: 'wAB:p1',
    terminal_id: 'term_65e1b4c85f42128',
    workspace_id: 'wAB',
    tab_id: 'wAB:t1',
    agent_status: 'unknown',
    cwd: null,
    focused: false,
    revision: 0
  }
  it('offers a bounded unknown shell candidate without claiming readiness', () => {
    expect(nativeShell.agent_status === 'idle').toBe(false)
    expect(isShellLaunchCandidate(nativeShell)).toBe(true)
    expect(
      isShellLaunchCandidate({ ...nativeShell, agent_status: 'idle' })
    ).toBe(true)
  })
  it('blocks stale terminal, session and both pane/snapshot agent evidence', () => {
    expect(isShellLaunchCandidate(null)).toBe(false)
    expect(
      isShellLaunchCandidate({ ...nativeShell, terminal_id: undefined })
    ).toBe(false)
    expect(isShellLaunchCandidate({ ...nativeShell, agent: 'pi' })).toBe(false)
    expect(
      isShellLaunchCandidate({ ...nativeShell, display_agent: 'Letta' })
    ).toBe(false)
    expect(
      isShellLaunchCandidate({
        ...nativeShell,
        agent_session: {
          source: 'native',
          agent: 'pi',
          kind: 'id',
          value: 'new-session'
        }
      })
    ).toBe(false)
    for (const agent of [
      { pane_id: nativeShell.pane_id },
      { target: nativeShell.pane_id }
    ]) {
      expect(isShellLaunchCandidate(nativeShell, [agent])).toBe(false)
    }
    for (const agent_status of ['working', 'blocked', 'done', '', 'stale']) {
      expect(isShellLaunchCandidate({ ...nativeShell, agent_status })).toBe(
        false
      )
    }
  })
})

describe('pane-drawer: pure helpers', () => {
  describe('isAgentPane', () => {
    it('identifies agent panes with agent or display_agent', () => {
      const lettaPane: IPane = {
        pane_id: 'w1:p1',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        agent: 'letta',
        display_agent: 'Letta',
        cwd: '/tmp',
        focused: false,
        agent_status: 'working'
      }
      expect(isAgentPane(lettaPane)).toBe(true)

      const agyPane: IPane = {
        pane_id: 'w1:p2',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        agent: 'agy',
        cwd: '/tmp',
        focused: false,
        agent_status: 'blocked'
      }
      expect(isAgentPane(agyPane)).toBe(true)
    })

    it('returns false for pure shell panes', () => {
      const shellPane: IPane = {
        pane_id: 'w1:p3',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        display_agent: 'Shell',
        cwd: '/tmp',
        focused: false,
        agent_status: 'unknown'
      }
      expect(isAgentPane(shellPane)).toBe(false)

      const plainPane: IPane = {
        pane_id: 'w1:p4',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        cwd: '/tmp',
        focused: false,
        agent_status: 'unknown'
      }
      expect(isAgentPane(plainPane)).toBe(false)

      const lowerShellPane: IPane = {
        pane_id: 'w1:p5',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        agent: 'shell',
        cwd: '/tmp',
        focused: false,
        agent_status: 'unknown'
      }
      expect(isAgentPane(lowerShellPane)).toBe(false)
    })
  })

  describe('formatRegionLabel', () => {
    it('translates known regions to readable human labels without inventing unknown meaning', () => {
      expect(formatRegionLabel('osc_title')).toBe('OSC Title')
      expect(formatRegionLabel('osc_progress')).toBe('OSC Progress')
      expect(formatRegionLabel('bottom_non_empty_lines(8)')).toBe(
        'Recent output (bottom)'
      )
      expect(formatRegionLabel('screen')).toBe('Full screen')
      expect(formatRegionLabel('cursor')).toBe('Cursor area')
      expect(formatRegionLabel('whole_recent')).toBe('Recent output')
      expect(formatRegionLabel('custom_unknown_region')).toBe(
        'custom_unknown_region'
      )
      expect(formatRegionLabel(undefined)).toBe('')
    })
  })

  describe('lifecycle source and accessibility guards', () => {
    it('offers exactly the five approved canonical native launch kinds in the existing Select', async () => {
      const source = await Bun.file(
        new URL('../pane-drawer.tsx', import.meta.url)
      ).text()
      const launchSelect = source.slice(
        source.indexOf('id="launch-kind"'),
        source.indexOf('<p>', source.indexOf('id="launch-kind"'))
      )
      expect(
        [...launchSelect.matchAll(/value: '([^']+)'/g)].map((match) => match[1])
      ).toEqual(['letta', 'pi', 'codex', 'agy', 'cursor'])
      expect(launchSelect).toContain('setLaunchKind(value)')
      expect(source).toContain('nativeLaunchKindLabel(launchKind)')
    })
    it('uses bounded source choices without arbitrary cwd, env, or focus inputs', async () => {
      const spaceSource = await Bun.file(
        new URL('../space-drawer.tsx', import.meta.url)
      ).text()
      const tabSource = await Bun.file(
        new URL('../pane-drawer.tsx', import.meta.url)
      ).text()
      expect(spaceSource).toContain('id="new-space-source"')
      expect(spaceSource).toContain('workspaceSourceChoices.map')
      expect(spaceSource).toContain('maxLength={100}')
      expect(spaceSource).not.toContain('name="cwd"')
      expect(spaceSource).not.toContain('name="env"')
      expect(spaceSource).not.toContain('name="focus"')
      expect(spaceSource).toContain('ref={cancelButtonRef}')
      expect(spaceSource).toContain('Dismiss — operation continues')
      expect(tabSource).toContain('Use Close Space for the last Tab')
    })

    it('delegates overlay containment and focus traps to Base UI Sheet without manual dialog impersonation', async () => {
      const tabSource = await Bun.file(
        new URL('../pane-drawer.tsx', import.meta.url)
      ).text()
      expect(tabSource).toContain('<Sheet')
      expect(tabSource).toContain('<SheetContent')
      expect(tabSource).toContain('id="tab-pane-drawer"')
      expect(tabSource).not.toContain('role="dialog"')
      expect(tabSource).not.toContain("addEventListener('keydown'")
      expect(tabSource).toContain('<Switch')
    })

    it('supports initialView new-tab to enter create form directly', async () => {
      const tabSource = await Bun.file(
        new URL('../pane-drawer.tsx', import.meta.url)
      ).text()
      expect(tabSource).toContain("initialView?: 'list' | 'new-tab'")
      expect(tabSource).toContain("initialView === 'new-tab'")
      expect(tabSource).toContain("dispatchNewTab({ type: 'OPEN_NEW_TAB' })")
    })
  })

  describe('formatManifestSource', () => {
    it('formats manifest sources cleanly with optional version', () => {
      expect(formatManifestSource('builtin', '0.9.1')).toBe(
        'Herdr built-in (0.9.1)'
      )
      expect(formatManifestSource('builtin')).toBe('Herdr built-in')
      expect(formatManifestSource('remote', '2026.08.24.1')).toBe(
        'Remote manifest (2026.08.24.1)'
      )
      expect(formatManifestSource('local')).toBe('Local manifest')
      expect(formatManifestSource('unknown')).toBe('Unknown source')
    })
  })
})
