// Adapted upstream composerStrip.test.ts (MIT, copyright 2026 devswha).
import { expect, test } from 'bun:test'
import { composerStrip } from '../composer-strip.ts'
import type { IPane, IWorkspace } from '@/types/herdr.ts'
test('absent metadata and labels never infer branch', () => {
  expect(composerStrip(null, null)).toBeNull()
  const pane = {
    cwd: '/repo/main',
    foreground_cwd: '/different/project'
  } as IPane
  expect(composerStrip(pane, { label: 'feature/guess' } as IWorkspace)).toEqual(
    { path: '/different/project', folder: 'project', source: null }
  )
})
test('full folder path retained; published checkout facts explicitly Space scoped', () => {
  expect(
    composerStrip(
      { cwd: '/' } as IPane,
      {
        tokens: {
          mahiro_workspace_branch: ' main ',
          mahiro_workspace_git_status: 'dirty',
          mahiro_workspace_worktree: 'linked'
        }
      } as IWorkspace
    )
  ).toEqual({
    path: '/',
    folder: '/',
    source: 'Space checkout: main * · linked'
  })
})
