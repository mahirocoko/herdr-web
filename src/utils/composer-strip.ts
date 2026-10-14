// Adapted from devswha/herdr-web-ui composerStrip.ts/paneBranch.ts (MIT, copyright 2026 devswha).
import type { IPane, IWorkspace } from '@/types/herdr.ts'
import { formatWorkspaceSourceLine } from './workspace-helpers.ts'
export const composerStrip = (
  pane: IPane | null,
  workspace: IWorkspace | null
) => {
  const cwd = pane?.foreground_cwd || pane?.cwd
  const path = cwd?.trim() ? cwd : null
  const source = formatWorkspaceSourceLine(workspace)
  if (!path && !source) return null
  // Published workspace facts do not prove this pane's checkout ownership.
  // Name their Space scope explicitly, never infer a pane branch from cwd/label.
  return {
    path,
    folder: path ? path.replace(/\/+$/, '').split('/').pop() || '/' : null,
    source: source ? `Space checkout: ${source}` : null
  }
}
