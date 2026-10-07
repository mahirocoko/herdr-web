import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('TerminalImagePreview Lightbox and TerminalCanvas Integration Contract', () => {
  const terminalCanvasPath = path.resolve(
    import.meta.dir,
    '../components/terminal-canvas.tsx'
  )
  const terminalCanvasSource = fs.readFileSync(terminalCanvasPath, 'utf8')

  const previewComponentPath = path.resolve(
    import.meta.dir,
    '../components/terminal-image-preview.tsx'
  )
  const previewComponentSource = fs.readFileSync(previewComponentPath, 'utf8')

  const recipesCssPath = path.resolve(
    import.meta.dir,
    '../components/ui/recipes.css'
  )
  const recipesCss = fs.readFileSync(recipesCssPath, 'utf8')

  describe('1. TerminalCanvas LinkProvider Integration', () => {
    it('imports and registers createTerminalImageLinkProvider', () => {
      expect(terminalCanvasSource).toContain('createTerminalImageLinkProvider')
      expect(terminalCanvasSource).toContain(
        'term.registerLinkProvider(linkProvider)'
      )
    })

    it('disposes linkProvider registration on unmount', () => {
      expect(terminalCanvasSource).toContain('linkDisposable.dispose()')
    })

    it('renders TerminalImagePreview modal within TerminalCanvas', () => {
      expect(terminalCanvasSource).toContain('<TerminalImagePreview')
      expect(terminalCanvasSource).toContain(
        'imagePath={previewTarget?.path ?? null}'
      )
      expect(terminalCanvasSource).toContain(
        'paneId={previewTarget?.paneId ?? null}'
      )
      expect(terminalCanvasSource).toContain('open={isPreviewOpen}')
    })
  })

  describe('2. TerminalImagePreview State, Dialog Ownership & Security Contract', () => {
    it('replaces old Sheet with Base UI Dialog primitive using controlled open and modal={true}', () => {
      expect(previewComponentSource).not.toContain('@/components/ui/sheet.tsx')
      expect(previewComponentSource).toContain("from '@base-ui/react/dialog'")
      expect(previewComponentSource).toContain('<Dialog.Root')
      expect(previewComponentSource).toContain('modal={true}')
      expect(previewComponentSource).toContain('<Dialog.Portal>')
      expect(previewComponentSource).toContain('<Dialog.Backdrop')
      expect(previewComponentSource).toContain('<Dialog.Popup')
      expect(previewComponentSource).toContain('<Dialog.Title')
      expect(previewComponentSource).toContain('<Dialog.Close')
    })

    it('uses Dialog.Close with canonical Button render interop inside Dialog.Popup', () => {
      expect(previewComponentSource).toContain('<Dialog.Close')
      expect(previewComponentSource).toContain('render={')
      expect(previewComponentSource).toContain('<Button')
    })

    it('calls POST /api/media/image with JSON path and paneId payload', () => {
      expect(previewComponentSource).toContain("fetch('/api/media/image'")
      expect(previewComponentSource).toContain("method: 'POST'")
      expect(previewComponentSource).toContain('path: imagePath')
      expect(previewComponentSource).toContain('paneId')
    })

    it('implements AbortController to cancel stale in-flight requests and prevent race conditions', () => {
      expect(previewComponentSource).toContain('new AbortController()')
      expect(previewComponentSource).toContain('controller.signal')
      expect(previewComponentSource).toContain(
        'abortControllerRef.current.abort()'
      )
    })

    it('revokes object URLs on close or unmount to avoid memory leaks', () => {
      expect(previewComponentSource).toContain(
        'URL.revokeObjectURL(activeUrlRef.current)'
      )
    })

    it('includes zoom in, zoom out, and reset controls with dimension-owned zoom steps', () => {
      expect(previewComponentSource).toContain('handleZoomIn')
      expect(previewComponentSource).toContain('handleZoomOut')
      expect(previewComponentSource).toContain('handleZoomReset')
      expect(previewComponentSource).toContain('ZOOM_STEPS')
    })

    it('guards against accidental dismissal during pan, drag, and image interaction', () => {
      expect(previewComponentSource).toContain('handleViewportPointerDown')
      expect(previewComponentSource).toContain('handleViewportPointerUp')
      expect(previewComponentSource).toContain(
        'onPointerDown={(e) => e.stopPropagation()}'
      )
      expect(previewComponentSource).toContain(
        'onClick={(e) => e.stopPropagation()}'
      )
    })
  })

  describe('3. CSS Recipe Tokens Contract (Lightbox)', () => {
    it('does not contain leftover .ui-sheet--image-preview drawer rules', () => {
      expect(recipesCss).not.toContain('.ui-sheet--image-preview')
    })

    it('declares full-viewport lightbox overlay and backdrop', () => {
      expect(recipesCss).toContain('.ui-image-lightbox__backdrop')
      expect(recipesCss).toContain('z-index: var(--z-modal, 1000);')
      expect(recipesCss).toContain('.ui-image-lightbox__popup')
      expect(recipesCss).toContain('width: 100vw;')
      expect(recipesCss).toContain('height: 100dvh;')
    })

    it('declares compact safe-area-aware toolbar and title truncation', () => {
      expect(recipesCss).toContain('.ui-image-lightbox__header')
      expect(recipesCss).toContain('height: 44px;')
      expect(recipesCss).toContain('padding-top: env(safe-area-inset-top, 0);')
      expect(recipesCss).toContain('.ui-image-lightbox__title')
      expect(recipesCss).toContain('text-overflow: ellipsis;')
      expect(recipesCss).toContain('.ui-image-lightbox__controls')
      expect(recipesCss).toContain('max-width: 320px;')
    })

    it('declares viewport and scroll container for zoom and pan', () => {
      expect(recipesCss).toContain('.ui-image-lightbox__viewport')
      expect(recipesCss).toContain('overflow: auto;')
      expect(recipesCss).toContain('.ui-image-lightbox__canvas-wrap')
      expect(recipesCss).toContain('.ui-image-lightbox__img')
    })

    it('declares loading and error states', () => {
      expect(recipesCss).toContain('.ui-image-lightbox__loading')
      expect(recipesCss).toContain('.ui-image-lightbox__error')
    })
  })
})
