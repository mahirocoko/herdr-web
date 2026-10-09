import { useEffect, useRef, useState, useCallback } from 'react'
import type { FC, PointerEvent } from 'react'
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  X,
  AlertCircle,
  Loader2
} from 'lucide-react'
import { Dialog } from '@base-ui/react/dialog'
import Button from '@/components/ui/button.tsx'

export interface ITerminalImagePreviewProps {
  imagePath: string | null
  sourceBlob?: Blob | null
  paneId?: string | null
  open: boolean
  onClose: () => void
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const DEFAULT_ZOOM_INDEX = 2 // 1.0 (Fit baseline)

export const TerminalImagePreview: FC<ITerminalImagePreviewProps> = ({
  imagePath,
  sourceBlob = null,
  paneId = null,
  open,
  onClose
}) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [naturalSize, setNaturalSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [stageSize, setStageSize] = useState<{
    width: number
    height: number
  }>({
    width: 800,
    height: 600
  })

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pointerDownRef = useRef<{
    target: EventTarget
    x: number
    y: number
  } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeUrlRef = useRef<string | null>(null)

  const cleanupUrl = useCallback(() => {
    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current)
      activeUrlRef.current = null
    }
    setObjectUrl(null)
  }, [])

  // Observe stage geometry of viewport
  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setStageSize({ width, height })
        }
      }
    })

    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [open, objectUrl])

  // Fetch image bytes when open and imagePath changes
  useEffect(() => {
    if (!open || (!imagePath && !sourceBlob)) {
      cleanupUrl()
      setError(null)
      setLoading(false)
      setNaturalSize(null)
      return
    }

    // Abort previous in-flight fetch to prevent stale A -> B race
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    cleanupUrl()

    const controller = new AbortController()
    abortControllerRef.current = controller

    setLoading(true)
    setError(null)
    setZoomIndex(DEFAULT_ZOOM_INDEX) // Reset zoom to 1.0 (Fit baseline)
    setNaturalSize(null)

    if (sourceBlob) {
      const url = URL.createObjectURL(sourceBlob)
      activeUrlRef.current = url
      setObjectUrl(url)
      setLoading(false)
      return () => {
        controller.abort()
        cleanupUrl()
      }
    }

    const fetchImage = async () => {
      try {
        const bodyPayload: { path: string; paneId?: string } = {
          path: imagePath!
        }
        if (paneId) {
          bodyPayload.paneId = paneId
        }

        const response = await fetch('/api/media/image', {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(bodyPayload),
          signal: controller.signal
        })

        if (controller.signal.aborted) return

        if (!response.ok) {
          let errorMsg = 'Failed to load image preview'
          try {
            const errData = await response.json()
            // Stale-safe guard: check abort signal again after json await
            if (controller.signal.aborted) return
            if (errData && errData.error) {
              errorMsg = errData.error
            }
          } catch {
            if (controller.signal.aborted) return
            errorMsg = `Server returned status ${response.status}`
          }

          if (controller.signal.aborted) return
          setError(errorMsg)
          setLoading(false)
          return
        }

        const blob = await response.blob()
        if (controller.signal.aborted) return

        const url = URL.createObjectURL(blob)
        activeUrlRef.current = url
        setObjectUrl(url)
        setLoading(false)
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Network error')
        setLoading(false)
      }
    }

    void fetchImage()

    return () => {
      controller.abort()
      cleanupUrl()
    }
  }, [open, imagePath, sourceBlob, paneId, cleanupUrl])

  const handleZoomIn = () => {
    setZoomIndex((prev) => Math.min(prev + 1, ZOOM_STEPS.length - 1))
  }

  const handleZoomOut = () => {
    setZoomIndex((prev) => Math.max(prev - 1, 0))
  }

  const handleZoomReset = () => {
    setZoomIndex(DEFAULT_ZOOM_INDEX)
  }

  // Pointer down/up guards: dismiss on unambiguous background click, preserve zoom drag and panning
  const handleViewportPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pointerDownRef.current = {
      target: e.target,
      x: e.clientX,
      y: e.clientY
    }
  }

  const handleViewportPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const down = pointerDownRef.current
    pointerDownRef.current = null
    if (!down) return

    const isBackground =
      e.target === viewportRef.current ||
      (e.target as HTMLElement)?.classList?.contains(
        'ui-image-lightbox__canvas-wrap'
      )
    const wasBackgroundDown =
      down.target === viewportRef.current ||
      (down.target as HTMLElement)?.classList?.contains(
        'ui-image-lightbox__canvas-wrap'
      )

    if (isBackground && wasBackgroundDown) {
      const dx = Math.abs(e.clientX - down.x)
      const dy = Math.abs(e.clientY - down.y)
      // Only dismiss if pointer did not move meaningfully (threshold 6px protects panning/scroll)
      if (dx < 6 && dy < 6) {
        onClose()
      }
    }
  }

  const currentZoom = ZOOM_STEPS[zoomIndex] ?? 1
  const filename = imagePath ? imagePath.split('/').pop() || imagePath : 'Image'

  // Calculate dimension-owned layout sizing
  // Fit baseline contains both axes within the stage geometry
  let displayWidth: number | undefined
  let displayHeight: number | undefined

  if (naturalSize) {
    const availW = Math.max(100, stageSize.width - 32)
    const availH = Math.max(100, stageSize.height - 32)
    const fitScale = Math.min(
      availW / naturalSize.width,
      availH / naturalSize.height,
      1
    )
    const baseW = Math.round(naturalSize.width * fitScale)
    const baseH = Math.round(naturalSize.height * fitScale)

    displayWidth = Math.round(baseW * currentZoom)
    displayHeight = Math.round(baseH * currentZoom)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose()
        }
      }}
      modal={true}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-image-lightbox__backdrop" />
        <Dialog.Popup
          className="ui-image-lightbox__popup"
          aria-label={`Image Preview: ${filename}`}
        >
          <header className="ui-image-lightbox__header">
            <Dialog.Title
              className="ui-image-lightbox__title"
              title={imagePath || undefined}
            >
              {filename}
            </Dialog.Title>

            <div className="ui-image-lightbox__controls">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleZoomOut}
                disabled={zoomIndex === 0 || loading || !!error}
                aria-label="Zoom out"
              >
                <ZoomOut size={16} />
              </Button>
              <Button
                variant="ghost"
                size="compact"
                onClick={handleZoomReset}
                disabled={loading || !!error}
                aria-label="Reset zoom to fit"
              >
                <RotateCcw size={14} className="mr-1" />
                <span>{Math.round(currentZoom * 100)}%</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleZoomIn}
                disabled={
                  zoomIndex === ZOOM_STEPS.length - 1 || loading || !!error
                }
                aria-label="Zoom in"
              >
                <ZoomIn size={16} />
              </Button>
              <Dialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close preview"
                  />
                }
                onClick={onClose}
              >
                <X size={16} />
              </Dialog.Close>
            </div>
          </header>

          <div
            className="ui-image-lightbox__viewport"
            ref={viewportRef}
            onPointerDown={handleViewportPointerDown}
            onPointerUp={handleViewportPointerUp}
          >
            {loading && (
              <div className="ui-image-lightbox__loading" role="status">
                <Loader2 size={24} className="animate-spin text-accent" />
                <span>Loading preview...</span>
              </div>
            )}

            {error && (
              <div className="ui-image-lightbox__error" role="alert">
                <AlertCircle size={28} className="text-danger" />
                <p className="ui-image-lightbox__error-msg">{error}</p>
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            )}

            {!loading && !error && objectUrl && (
              <div
                className="ui-image-lightbox__canvas-wrap"
                style={{
                  width: displayWidth ? `${displayWidth}px` : undefined,
                  height: displayHeight ? `${displayHeight}px` : undefined
                }}
              >
                <img
                  src={objectUrl}
                  alt={filename}
                  className="ui-image-lightbox__img"
                  style={{
                    width: displayWidth ? `${displayWidth}px` : undefined,
                    height: displayHeight ? `${displayHeight}px` : undefined
                  }}
                  draggable={false}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onLoad={(e) => {
                    const target = e.currentTarget
                    if (target.naturalWidth > 0 && target.naturalHeight > 0) {
                      setNaturalSize({
                        width: target.naturalWidth,
                        height: target.naturalHeight
                      })
                    }
                  }}
                  onError={() => {
                    cleanupUrl()
                    setError('Failed to decode image data')
                    setLoading(false)
                  }}
                />
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default TerminalImagePreview
