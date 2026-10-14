// MIT License - Copyright (c) 2026 devswha; Copyright (c) 2026 T3 Tools Inc.
// Adapted dc2f11de DiffWorkerPool/idleLease/sourceTheme; local CSS-variable theme.
import { useEffect, type ReactNode } from 'react'
import { WorkerPoolContext } from '@pierre/diffs/react'
import { WorkerPoolManager } from '@pierre/diffs/worker'
import { createCSSVariablesTheme, registerCustomTheme } from '@pierre/diffs'
import { createIdleLease } from '@/utils/idle-lease.ts'
export const REPO_SOURCE_THEME = 'herdr-repo-source'
registerCustomTheme(REPO_SOURCE_THEME, async () =>
  createCSSVariablesTheme({
    name: REPO_SOURCE_THEME,
    variablePrefix: '--herdr-code-',
    fontStyle: false
  })
)
const pool = createIdleLease(
  () =>
    new WorkerPoolManager(
      {
        workerFactory: () =>
          new Worker(
            new URL('@pierre/diffs/worker/worker.js', import.meta.url),
            { type: 'module' }
          ),
        poolSize: 2,
        totalASTLRUCacheSize: 12
      },
      { theme: REPO_SOURCE_THEME, preferredHighlighter: 'shiki-js' }
    ),
  (manager) => manager.terminate(),
  30_000
)
export const DiffWorkerPool = ({ children }: { children: ReactNode }) => {
  const manager = pool.get()
  useEffect(() => pool.hold(), [manager])
  return <WorkerPoolContext value={manager}>{children}</WorkerPoolContext>
}
