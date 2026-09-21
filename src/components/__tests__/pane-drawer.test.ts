import { describe, expect, it } from 'bun:test'
import {
  formatManifestSource,
  formatRegionLabel,
  getNextFocusIndex,
  isAgentPane
} from '../pane-drawer.tsx'
import type { IPane } from '@/types/herdr.ts'

describe('pane-drawer: pure helpers', () => {
  describe('getNextFocusIndex', () => {
    it('handles empty list safely', () => {
      expect(getNextFocusIndex(0, 0, false)).toBe(-1)
      expect(getNextFocusIndex(-1, 0, false)).toBe(-1)
      expect(getNextFocusIndex(0, 0, true)).toBe(-1)
    })

    it('handles single item list safely', () => {
      expect(getNextFocusIndex(0, 1, false)).toBe(0)
      expect(getNextFocusIndex(-1, 1, false)).toBe(0)
      expect(getNextFocusIndex(0, 1, true)).toBe(0)
    })

    it('cycles forward with Tab and wraps around', () => {
      expect(getNextFocusIndex(0, 3, false)).toBe(1)
      expect(getNextFocusIndex(1, 3, false)).toBe(2)
      expect(getNextFocusIndex(2, 3, false)).toBe(0)
    })

    it('cycles backward with Shift+Tab and wraps around', () => {
      expect(getNextFocusIndex(2, 3, true)).toBe(1)
      expect(getNextFocusIndex(1, 3, true)).toBe(0)
      expect(getNextFocusIndex(0, 3, true)).toBe(2)
    })

    it('handles uncontained initial focus (-1)', () => {
      expect(getNextFocusIndex(-1, 4, false)).toBe(0)
      expect(getNextFocusIndex(-1, 4, true)).toBe(3)
    })
  })
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
      expect(formatRegionLabel('bottom_non_empty_lines(8)')).toBe('Recent output (bottom)')
      expect(formatRegionLabel('screen')).toBe('Full screen')
      expect(formatRegionLabel('cursor')).toBe('Cursor area')
      expect(formatRegionLabel('whole_recent')).toBe('Recent output')
      expect(formatRegionLabel('custom_unknown_region')).toBe('custom_unknown_region')
      expect(formatRegionLabel(undefined)).toBe('')
    })
  })

  describe('formatManifestSource', () => {
    it('formats manifest sources cleanly with optional version', () => {
      expect(formatManifestSource('builtin', '0.9.1')).toBe('Herdr built-in (0.9.1)')
      expect(formatManifestSource('builtin')).toBe('Herdr built-in')
      expect(formatManifestSource('remote', '2026.08.24.1')).toBe('Remote manifest (2026.08.24.1)')
      expect(formatManifestSource('local')).toBe('Local manifest')
      expect(formatManifestSource('unknown')).toBe('Unknown source')
    })
  })
})
