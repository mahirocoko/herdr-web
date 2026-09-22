import { useEffect, useState } from 'react'
import {
  calculateVisibleViewportGeometry,
  resolveLayoutViewportHeight,
  type IVisualViewportGeometry
} from '@/utils/visual-viewport.ts'

const getLayoutHeight = (visualViewport: VisualViewport): number => {
  if (typeof window === 'undefined') return 0
  return resolveLayoutViewportHeight({
    windowInnerHeight: window.innerHeight,
    documentClientHeight: document.documentElement?.clientHeight,
    visualHeight: visualViewport.height,
    visualOffsetTop: visualViewport.offsetTop
  })
}

const getHasEditableFocus = (): boolean => {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  if (!el || !(el instanceof HTMLElement)) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return true
  }
  return Boolean(el.isContentEditable)
}

/**
 * Bounded visual viewport hook for iOS keyboard / browser chrome ownership.
 * Uses window.visualViewport height and offsetTop bounded by current layout-viewport height.
 * Coalesces updates via requestAnimationFrame.
 * Listens to visualViewport resize/scroll, window resize, and document focusin/focusout.
 * Ignores pinch zoom (scale != 1) and falls back to null (letting CSS 100dvh take over).
 * Cleans up listeners on unmount.
 */
export const useVisualViewport = (): IVisualViewportGeometry | null => {
  const [viewportGeometry, setViewportGeometry] = useState<IVisualViewportGeometry | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const vv = window.visualViewport
    if (!vv) return

    let rafId: number | null = null

    const handleUpdate = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      rafId = requestAnimationFrame(() => {
        rafId = null
        const layoutHeight = getLayoutHeight(vv)
        const hasEditableFocus = getHasEditableFocus()
        const geometry = calculateVisibleViewportGeometry(
          {
            height: vv.height,
            offsetTop: vv.offsetTop,
            scale: vv.scale,
            hasEditableFocus
          },
          layoutHeight
        )
        setViewportGeometry(geometry)
      })
    }

    vv.addEventListener('resize', handleUpdate)
    vv.addEventListener('scroll', handleUpdate)
    window.addEventListener('resize', handleUpdate)
    document.addEventListener('focusin', handleUpdate)
    document.addEventListener('focusout', handleUpdate)

    handleUpdate()

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      vv.removeEventListener('resize', handleUpdate)
      vv.removeEventListener('scroll', handleUpdate)
      window.removeEventListener('resize', handleUpdate)
      document.removeEventListener('focusin', handleUpdate)
      document.removeEventListener('focusout', handleUpdate)
    }
  }, [])

  return viewportGeometry
}
