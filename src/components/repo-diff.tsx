// MIT License - Copyright (c) 2026 devswha
// Adapted dc2f11de RepoDiff.tsx; exact Pierre parser/virtualizer, local dark tokens.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_VIRTUAL_FILE_METRICS, trimPatchContext } from '@pierre/diffs'
import {
  FileDiff,
  Virtualizer,
  type FileDiffOptions
} from '@pierre/diffs/react'
import { DiffWorkerPool, REPO_SOURCE_THEME } from './diff-worker-pool.tsx'
import { keepEmptyRows, parseRepoPatch } from '@/utils/repo-diff-view.ts'
import type { RepoDiffStyle } from '@/utils/repo-diff-style.ts'
import './repo-diff.css'
const SHADOW_CSS = `:host {
--herdr-code-foreground: var(--color-text-primary);
--herdr-code-background: var(--color-bg-base);
--herdr-code-token-comment: var(--color-text-secondary);
--herdr-code-token-keyword: var(--color-accent);
--herdr-code-token-constant: var(--color-status-working);
--herdr-code-token-string: var(--color-status-done);
--herdr-code-token-string-expression: var(--color-status-done);
--herdr-code-token-function: var(--color-accent);
--herdr-code-token-parameter: var(--color-text-primary);
--herdr-code-token-punctuation: var(--color-text-primary);
--herdr-code-token-link: var(--color-accent);
--herdr-code-token-inserted: var(--color-status-done);
--herdr-code-token-deleted: var(--color-status-blocked);
--herdr-code-token-changed: var(--color-accent);
--diffs-light-bg: var(--color-bg-base);
--diffs-dark-bg: var(--color-bg-base);
--diffs-light: var(--color-text-primary);
--diffs-dark: var(--color-text-primary);
--diffs-fg-number-override: var(--color-text-secondary);
--diffs-font-family: var(--font-mono);
--diffs-font-size: 13px;
--diffs-line-height: 20px;
--diffs-light-addition-color: var(--color-status-done);
--diffs-dark-addition-color: var(--color-status-done);
--diffs-light-deletion-color: var(--color-status-blocked);
--diffs-dark-deletion-color: var(--color-status-blocked);
--diffs-bg-separator-override: var(--color-bg-elevated);
--diffs-bg-context-override: var(--color-bg-base);
--diffs-bg-context-gutter-override: var(--color-bg-base);
--diffs-header-font-family: var(--font-sans);
}`
interface IRepoDiffProps {
  patch: string
  style: RepoDiffStyle
  folded: boolean
  wrap: boolean
}
const RepoDiff = ({ patch, style, folded, wrap }: IRepoDiffProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const [lineHeight, setLineHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measured = Number.parseFloat(getComputedStyle(host).lineHeight)
    setLineHeight(
      Number.isFinite(measured) && measured > 0
        ? measured
        : DEFAULT_VIRTUAL_FILE_METRICS.lineHeight
    )
  }, [])
  const text = useMemo(
    () => (folded ? trimPatchContext(patch, 1) : patch),
    [patch, folded]
  )
  const parsed = useMemo(() => {
    try {
      return { file: parseRepoPatch(text), error: false }
    } catch {
      return { file: null, error: true }
    }
  }, [text])
  const onPostRender = useCallback<
    NonNullable<FileDiffOptions<undefined, undefined>['onPostRender']>
  >((node, _instance, phase) => {
    if (phase !== 'unmount' && node.shadowRoot) keepEmptyRows(node.shadowRoot)
  }, [])
  const colored = patch.length <= 256 * 1024 && patch.split('\n').length <= 5000
  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      disableFileHeader: true,
      diffStyle: style,
      hunkSeparators: 'line-info',
      overflow: wrap ? 'wrap' : 'scroll',
      theme: REPO_SOURCE_THEME,
      themeType: 'dark',
      tokenizeMaxLength: colored ? 5000 : 0,
      lineHoverHighlight: 'disabled',
      enableLineSelection: false,
      unsafeCSS: SHADOW_CSS,
      onPostRender
    }),
    [style, wrap, colored, onPostRender]
  )
  const metrics = useMemo(
    () =>
      lineHeight === null
        ? null
        : { ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight },
    [lineHeight]
  )
  if (parsed.error)
    return (
      <p role="alert">
        This patch could not be parsed. Copy the complete patch to inspect it.
      </p>
    )
  if (!parsed.file || parsed.file.hunks.length === 0)
    return <p>No lines changed (file metadata may have changed).</p>
  return (
    <div
      ref={hostRef}
      className="repo-diff"
      data-style={style}
      data-colored={colored ? '' : undefined}
      data-folded={folded ? '' : undefined}
      aria-label={`${style === 'split' ? 'Split' : 'Unified'} file patch`}
    >
      <DiffWorkerPool>
        <Virtualizer
          className="repo-diff-scroll"
          contentClassName="repo-diff-column"
          config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
        >
          {metrics && (
            <FileDiff
              className="repo-diff-file"
              fileDiff={parsed.file}
              options={options}
              metrics={metrics}
            />
          )}
        </Virtualizer>
      </DiffWorkerPool>
    </div>
  )
}
export default RepoDiff
