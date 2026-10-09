// MIT License - Copyright (c) 2026 devswha
// Content jobs from pinned5979118 FileViewer; existing local Dialog/lightbox recipe.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X, Download, Folder, ArrowUp } from 'lucide-react'
import { OpenChatToolFileContext } from './chat-tool-content.tsx'
import {
  fileContentUrl,
  fileTextPreview,
  openContextFile
} from '@/services/file-viewer-api.ts'
import type { FileViewResult } from '@/types/file-viewer.ts'
import Button from './ui/button.tsx'
import TerminalImagePreview from './terminal-image-preview.tsx'
import './chat-file-viewer.css'

interface IChatFilesProps {
  paneId: string
  children: ReactNode
}
const ChatFiles = ({ paneId, children }: IChatFilesProps) => {
  const [target, setTarget] = useState<{ path: string; offset: number } | null>(
    null
  )
  const [info, setInfo] = useState<FileViewResult | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState(false)
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null)
  const [zoom, setZoom] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setInfo(null)
    setText(null)
    setError(null)
    setImage(null)
    setZoom(false)
    setMediaError(false)
    if (!target) return
    const controller = new AbortController()
    let url: string | undefined
    const valid = () =>
      !controller.signal.aborted && generation.current === current
    void (async () => {
      try {
        const next = await openContextFile(
          target.path,
          paneId,
          controller.signal,
          target.offset
        )
        if (!valid()) return
        setInfo(next)
        if ('candidates' in next) return
        if (next.kind === 'text' && next.ref) {
          const preview = await fileTextPreview(next.ref, controller.signal)
          if (valid()) setText(preview)
        } else if (
          next.kind === 'image' &&
          next.ref &&
          next.inlineAllowed &&
          next.size <= 20 * 1024 * 1024
        ) {
          const response = await fetch(fileContentUrl(next.ref), {
            signal: controller.signal,
            cache: 'no-store'
          })
          if (!response.ok) throw new Error('Image changed or unavailable')
          const blob = await response.blob()
          if (blob.size !== next.size || !valid()) {
            if (!valid()) return
            throw new Error('Image payload changed')
          }
          url = URL.createObjectURL(blob)
          setImage({ url, blob })
        }
      } catch (reason) {
        if (valid())
          setError(
            reason instanceof Error ? reason.message : 'File unavailable'
          )
      }
    })()
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [target, paneId])
  const open = (path: string, offset = 0) => setTarget({ path, offset })
  const content = () => {
    if (error) return <p role="alert">{error}</p>
    if (!info) return <p role="status">Opening file…</p>
    if ('candidates' in info)
      return (
        <>
          <p>Choose the file you meant</p>
          {info.candidates.map((path) => (
            <Button key={path} variant="ghost" onClick={() => open(path)}>
              {path}
            </Button>
          ))}
        </>
      )
    if (info.kind === 'directory')
      return (
        <>
          {info.items?.map((item) => (
            <Button
              key={item.path}
              variant="ghost"
              className="file-entry"
              onClick={() => open(item.path)}
            >
              {item.directory && <Folder aria-hidden="true" />}
              {item.name}
            </Button>
          ))}
          {info.offset! > 0 && (
            <Button
              variant="ghost"
              onClick={() => open(info.path, Math.max(0, info.offset! - 200))}
            >
              Previous files
            </Button>
          )}
          {info.hasMore && (
            <Button
              variant="ghost"
              onClick={() => open(info.path, (info.offset ?? 0) + 200)}
            >
              More files
            </Button>
          )}
          {!info.items?.length && <p>Empty directory</p>}
        </>
      )
    if (info.kind === 'text')
      return (
        <>
          {text === null ? (
            <p role="status">Loading text…</p>
          ) : (
            <pre className="file-text">{text}</pre>
          )}
          {info.size > 64 * 1024 && (
            <p>Showing the first 64 KiB. Download for the complete file.</p>
          )}
        </>
      )
    if (info.kind === 'image')
      return image ? (
        <button
          type="button"
          className="file-image"
          onClick={() => setZoom(true)}
          aria-label="Zoom image"
        >
          <img
            src={image.url}
            alt={info.name}
            onError={() => setMediaError(true)}
          />
        </button>
      ) : (
        <p>
          {info.size > 20 * 1024 * 1024 || !info.inlineAllowed
            ? 'Image exceeds the inline byte/pixel envelope or lacks supported dimensions; download it below.'
            : 'Loading image…'}
        </p>
      )
    const src = info.ref ? fileContentUrl(info.ref) : undefined
    if (info.kind === 'video')
      return (
        <video
          controls
          preload="metadata"
          src={src}
          onError={() => setMediaError(true)}
        />
      )
    if (info.kind === 'audio')
      return (
        <audio
          controls
          preload="metadata"
          src={src}
          onError={() => setMediaError(true)}
        />
      )
    if (info.kind === 'pdf')
      return <iframe title={info.name} src={src} className="file-pdf" />
    return <p>Binary file — download to open it.</p>
  }
  const file = info && 'kind' in info ? info : null
  return (
    <OpenChatToolFileContext.Provider value={(path) => open(path)}>
      {children}
      <Dialog.Root
        open={target !== null}
        onOpenChange={(value) => {
          if (!value) setTarget(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="ui-image-lightbox__backdrop" />
          <Dialog.Popup className="ui-image-lightbox__popup file-viewer-popup">
            <header className="ui-image-lightbox__header">
              <Dialog.Title className="ui-image-lightbox__title">
                {file?.name || target?.path || 'File'}
              </Dialog.Title>
              <div className="ui-image-lightbox__controls">
                {file?.parent && (
                  <Button
                    variant="ghost"
                    onClick={() => open(file.parent!)}
                    aria-label="Open parent directory"
                  >
                    <ArrowUp />
                  </Button>
                )}
                {file?.ref && (
                  <a
                    className="file-download"
                    href={fileContentUrl(file.ref, 'download')}
                    aria-label="Download complete file"
                  >
                    <Download />
                  </a>
                )}
                <Dialog.Close
                  render={
                    <Button variant="ghost" aria-label="Close file viewer">
                      <X />
                    </Button>
                  }
                />
              </div>
            </header>
            <div className="file-viewer-body">
              {content()}
              {mediaError && (
                <p role="alert">
                  Media could not be decoded. Download the file or reopen it.
                </p>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {image && file && (
        <TerminalImagePreview
          imagePath={file.path}
          sourceBlob={image.blob}
          open={zoom}
          onClose={() => setZoom(false)}
        />
      )}
    </OpenChatToolFileContext.Provider>
  )
}
export { ChatFiles }
