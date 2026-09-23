import { describe, expect, it } from 'bun:test'
import {
  formatWorkspaceAriaLabel,
  formatWorkspaceSourceLine
} from '../workspace-helpers.ts'
import type { IWorkspace } from '@/types/herdr.ts'

describe('Workspace source metadata pure UI formatting', () => {
  const createBaseWorkspace = (overrides: Partial<IWorkspace> = {}): IWorkspace => ({
    workspace_id: 'ws-1',
    label: 'Alpha Space',
    number: 1,
    agent_status: 'working',
    tab_count: 2,
    pane_count: 4,
    focused: true,
    ...overrides
  })

  describe('absent metadata', () => {
    it('returns null for source line when tokens and worktree are completely absent', () => {
      const ws = createBaseWorkspace()
      expect(formatWorkspaceSourceLine(ws)).toBeNull()
      expect(formatWorkspaceSourceLine(null)).toBeNull()
      expect(formatWorkspaceSourceLine(undefined)).toBeNull()
    })

    it('returns null when tokens object is empty or contains only non-allowlisted keys', () => {
      const wsEmpty = createBaseWorkspace({ tokens: {} })
      expect(formatWorkspaceSourceLine(wsEmpty)).toBeNull()

      const wsUnallowlisted = createBaseWorkspace({
        tokens: {
          arbitrary: 'token'
        } as any
      })
      expect(formatWorkspaceSourceLine(wsUnallowlisted)).toBeNull()
    })

    it('preserves existing counts-only anatomy in aria-label when metadata is absent', () => {
      const ws = createBaseWorkspace({ label: 'Main', agent_status: 'idle' })
      const metadata = '2 Tabs · 4 panes'
      const aria = formatWorkspaceAriaLabel(ws, 'Main', metadata)
      expect(aria).toBe('Main, idle, 2 Tabs · 4 panes')
    })
  })

  describe('clean metadata', () => {
    it('formats clean branch name without dirty marker', () => {
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_branch: 'main',
          mahiro_workspace_git_status: 'clean'
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBe('main')
    })

    it('trims whitespace around branch name', () => {
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_branch: '  release/v1.0  ',
          mahiro_workspace_git_status: 'clean'
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBe('release/v1.0')
    })

    it('includes branch in aria-label cleanly', () => {
      const ws = createBaseWorkspace({
        label: 'Prod',
        agent_status: 'done',
        tokens: {
          mahiro_workspace_branch: 'main',
          mahiro_workspace_git_status: 'clean'
        }
      })
      const aria = formatWorkspaceAriaLabel(ws, 'Prod', '1 Tab · 1 pane')
      expect(aria).toBe('Prod, done, main, 1 Tab · 1 pane')
    })
  })

  describe('dirty metadata', () => {
    it('formats dirty branch with an asterisk marker', () => {
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_branch: 'feature/dark-mode',
          mahiro_workspace_git_status: 'dirty'
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBe('feature/dark-mode *')
    })

    it('formats dirty status without branch safely', () => {
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_git_status: 'dirty'
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBe('dirty *')
    })

    it('reflects (dirty) in aria-label truthfully for assistive tech', () => {
      const ws = createBaseWorkspace({
        label: 'Dev Space',
        agent_status: 'working',
        tokens: {
          mahiro_workspace_branch: 'feat/audit',
          mahiro_workspace_git_status: 'dirty'
        }
      })
      const aria = formatWorkspaceAriaLabel(ws, 'Dev Space', '3 Tabs · 6 panes')
      expect(aria).toBe('Dev Space, working, feat/audit (dirty), 3 Tabs · 6 panes')
    })
  })

  describe('worktree metadata', () => {
    it('formats standalone linked worktree label from tokens', () => {
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_worktree: 'wt-experiments'
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBe('wt-experiments')
    })

    it('formats combined clean branch and linked worktree token with separator', () => {
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_branch: 'feat/redesign',
          mahiro_workspace_git_status: 'clean',
          mahiro_workspace_worktree: 'wt-redesign'
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBe('feat/redesign · wt-redesign')
    })

    it('formats combined dirty branch and linked worktree token with separator', () => {
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_branch: 'feat/redesign',
          mahiro_workspace_git_status: 'dirty',
          mahiro_workspace_worktree: 'wt-redesign'
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBe('feat/redesign * · wt-redesign')
    })

    it('returns null for source line when only workspace.worktree is present without canonical tokens', () => {
      const ws = createBaseWorkspace({
        worktree: {
          repo_name: 'herdr-web',
          is_linked_worktree: true
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBeNull()
      expect(formatWorkspaceAriaLabel(ws, 'Alpha Space', '2 Tabs · 4 panes')).toBe('Alpha Space, working, 2 Tabs · 4 panes')
    })

    it('does not format worktree provenance from worktree object when tokens.mahiro_workspace_worktree is absent', () => {
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_branch: 'main',
          mahiro_workspace_git_status: 'clean'
        },
        worktree: {
          repo_name: 'herdr-web',
          is_linked_worktree: true
        }
      })
      expect(formatWorkspaceSourceLine(ws)).toBe('main')
      expect(formatWorkspaceAriaLabel(ws, 'Alpha Space', '2 Tabs · 4 panes')).toBe('Alpha Space, working, main, 2 Tabs · 4 panes')
    })

    it('includes worktree label in aria-label', () => {
      const ws = createBaseWorkspace({
        label: 'Feature Workspace',
        agent_status: 'idle',
        tokens: {
          mahiro_workspace_branch: 'feat/api',
          mahiro_workspace_git_status: 'clean',
          mahiro_workspace_worktree: 'wt-api'
        }
      })
      const aria = formatWorkspaceAriaLabel(ws, 'Feature Workspace', '1 Tab · 2 panes')
      expect(aria).toBe('Feature Workspace, idle, feat/api, worktree wt-api, 1 Tab · 2 panes')
    })
  })

  describe('long values', () => {
    it('preserves full text of long branch and worktree names for pure formatting without truncation errors', () => {
      const longBranch = 'feature/extremely-long-subsystem-branch-name-with-many-segments-and-details'
      const longWorktree = 'worktree-isolated-environment-checkout-branch-alpha'
      const ws = createBaseWorkspace({
        tokens: {
          mahiro_workspace_branch: longBranch,
          mahiro_workspace_git_status: 'dirty',
          mahiro_workspace_worktree: longWorktree
        }
      })

      const line = formatWorkspaceSourceLine(ws)
      expect(line).toBe(`${longBranch} * · ${longWorktree}`)

      const aria = formatWorkspaceAriaLabel(ws, 'Long Space', '1 Tab · 1 pane')
      expect(aria).toBe(`Long Space, working, ${longBranch} (dirty), worktree ${longWorktree}, 1 Tab · 1 pane`)
    })
  })
})
