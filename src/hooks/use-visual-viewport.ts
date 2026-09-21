import { useEffect, useState } from 'react'
import {
  calculateVisibleViewportGeometry,
  type IVisualViewportGeometry
} from '@/utils/visual-viewport.ts'

const getLayoutHeight = (): number => {
  if (typeof window === 'undefined') return 0
  return window.innerHeight || document.documentElement?.clientHeight || 0
}

/**
 * Bounded visual viewport hook for iOS keyboard / browser chrome ownership.
 * Uses window.visualViewport height and offsetTop bounded by current layout-viewport height.
 * Coalesces updates via requestAnimationFrame.
 * Listens to visualViewport resize/scroll and window resize.
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
        const layoutHeight = getLayoutHeight()
        const geometry = calculateVisibleViewportGeometry(
          {
            height: vv.height,
            offsetTop: vv.offsetTop,
            scale: vv.scale
          },
          layoutHeight
        )
        setViewportGeometry(geometry)
      })
    }

    vv.addEventListener('resize', handleUpdate)
    vv.addEventListener('scroll', handleUpdate)
    window.addEventListener('resize', handleUpdate)

    handleUpdate()

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      vv.removeEventListener('resize', handleUpdate)
      vv.removeEventListener('scroll', handleUpdate)
      window.removeEventListener('resize', handleUpdate)
    }
  }, [])

  return viewportGeometry
}
