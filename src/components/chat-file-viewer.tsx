// MIT License - Copyright (c) 2026 devswha
// Content jobs from pinned5979118 FileViewer; existing local Dialog/lightbox recipe.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
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
import { Markdown } from './markdown.tsx'
import ToggleGroup from './ui/toggle-group.tsx'
import Toggle from './ui/toggle.tsx'
import Textarea from './ui/textarea.tsx'
import {
  canReadMarkdownPreview,
  resolveViewedFileLink,
  sourcePreviewPage
} from '@/utils/file-viewer-text.ts'
import './chat-file-viewer.css'
import { ChatPatchContext } from './turn-changed-files.tsx'
import { RepoPatchViewer } from './repo-changes.tsx'
import { fetchRepoDiffFiles } from '@/services/repo-diff-api.ts'
import {
  turnPatchTarget,
  repositoryTurnPath
} from '@/utils/turn-changed-files.ts'
import type { IRepoDiffTarget } from '@/types/repo-diff.ts'

interface IFileTextPreviewProps {
  path: string
  size: number
  text: string
  onOpen: (path: string) => void
}
export const FileTextPreview = ({
  path,
  size,
  text,
  onOpen
}: IFileTextPreviewProps) => {
  const markdown = /\.(md|markdown)$/i.test(path)
  const readable = useMemo(() => canReadMarkdownPreview(text), [text])
  const [mode, setMode] = useState<'reader' | 'source'>(
    markdown && readable ? 'reader' : 'source'
  )
  const [page, setPage] = useState(0)
  const [copyState, setCopyState] = useState<
    'idle' | 'pending' | 'copied' | 'manual'
  >('idle')
  const source = useMemo(() => sourcePreviewPage(text, page), [text, page])
  const truncated = size > 64 * 1024
  const copy = async () => {
    setCopyState('pending')
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      setCopyState('manual')
    }
  }
  return (
    <>
      <div className="file-text-controls">
        {markdown && (
          <ToggleGroup
            aria-label="File view"
            value={[mode]}
            onValueChange={(values) => {
              if (values[0] === 'reader' || values[0] === 'source')
                setMode(values[0])
            }}
          >
            <Toggle value="reader" variant="tab" disabled={!readable}>
              Markdown
            </Toggle>
            <Toggle value="source" variant="tab">
              Source
            </Toggle>
          </ToggleGroup>
        )}
        <Button
          variant="secondary"
          disabled={copyState === 'pending'}
          onClick={() => void copy()}
        >
          {truncated ? 'Copy preview' : 'Copy file'}
        </Button>
        {copyState === 'copied' && (
          <span role="status">
            {truncated ? 'Preview copied' : 'File copied'}
          </span>
        )}
      </div>
      {truncated && (
        <p className="file-text-notice" role="status">
          Showing the first 64 KiB. Copy includes only this preview; download
          for the complete file.
        </p>
      )}
      {markdown && !readable && (
        <p className="file-text-notice">
          This document is too complex for Markdown preview. Read the paged
          source or download the complete file.
        </p>
      )}
      {copyState === 'manual' && (
        <div className="file-copy-fallback">
          <p role="status">
            Clipboard unavailable. Select the text below and copy manually.
          </p>
          <Textarea
            aria-label={truncated ? 'Preview to copy' : 'File to copy'}
            readOnly
            value={text}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
      {text === '' ? (
        <p>Empty file</p>
      ) : mode === 'reader' && readable ? (
        <OpenChatToolFileContext.Provider
          value={(target) => {
            const resolved = resolveViewedFileLink(path, target)
            if (resolved) onOpen(resolved)
          }}
        >
          <Markdown className="file-markdown">{text}</Markdown>
        </OpenChatToolFileContext.Provider>
      ) : (
        <>
          <div className="file-source-navigation">
            <Button
              variant="ghost"
              disabled={source.current === 0}
              onClick={() => setPage(source.current - 1)}
            >
              Previous lines
            </Button>
            <span role="status">
              Lines {source.start + 1}–{source.start + source.lines.length} of{' '}
              {source.total}
            </span>
            <Button
              variant="ghost"
              disabled={source.current + 1 === source.pages}
              onClick={() => setPage(source.current + 1)}
            >
              Next lines
            </Button>
          </div>
          <pre
            className="file-text"
            aria-label="File source"
            style={{ '--file-line-start': source.start } as CSSProperties}
          >
            <code>
              {source.lines.map((line, index) => (
                <span className="file-source-line" key={source.start + index}>
                  {line}
                </span>
              ))}
            </code>
          </pre>
        </>
      )}
    </>
  )
}

interface IChatFilesProps {
  paneId: string
  cwd?: string | null
  children: ReactNode
}
const ChatFiles = ({ paneId, cwd = null, children }: IChatFilesProps) => {
  const [patchPath, setPatchPath] = useState<string | null>(null)
  const [patchTarget, setPatchTarget] = useState<IRepoDiffTarget | null>(null)
  const [patchError, setPatchError] = useState('')
  const patchRead = useRef<AbortController | null>(null)
  useEffect(() => {
    setPatchTarget(null)
    setPatchError('')
    if (!patchPath) return
    const controller = new AbortController()
    patchRead.current = controller
    void fetchRepoDiffFiles(
      paneId,
      { scope: 'workspace', base: null, head: null },
      AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
    ).then(
      (list) => {
        if (controller.signal.aborted) return
        const next = turnPatchTarget(paneId, patchPath, cwd, list)
        if (next) setPatchTarget(next)
        else
          setPatchError(
            repositoryTurnPath({
              path: patchPath,
              cwd,
              root: list.repository.root
            }) === null
              ? 'Path is outside the current repository or its relative base is unavailable.'
              : list.truncated
                ? 'This path is not in the bounded current changes list. Its current patch is unavailable.'
                : 'This file is no longer in current unstaged / untracked changes (it may be staged or committed). Historical edits are not reconstructed.'
          )
      },
      (reason) => {
        if (!controller.signal.aborted)
          setPatchError(
            reason instanceof Error
              ? reason.message
              : 'Current changes unavailable'
          )
      }
    )
    return () => {
      controller.abort()
      patchRead.current = null
    }
  }, [patchPath, paneId, cwd])
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
          const preview = await fileTextPreview(
            next.ref,
            controller.signal,
            next.size > 64 * 1024
          )
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
    if (error)
      return (
        <>
          <p role="alert">{error}</p>
          <Button
            variant="secondary"
            onClick={() => {
              if (target) open(target.path, target.offset)
            }}
          >
            Reopen file
          </Button>
        </>
      )
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
      return text === null ? (
        <p role="status">Loading text…</p>
      ) : (
        <FileTextPreview
          key={info.ref}
          path={info.path}
          size={info.size}
          text={text}
          onOpen={open}
        />
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
  const file = !patchPath && info && 'kind' in info ? info : null
  return (
    <OpenChatToolFileContext.Provider
      value={(path) => {
        patchRead.current?.abort()
        setPatchPath(null)
        setPatchTarget(null)
        open(path)
      }}
    >
      <ChatPatchContext.Provider
        value={(path) => {
          patchRead.current?.abort()
          setTarget(null)
          setPatchTarget(null)
          setPatchError('')
          setPatchPath(path)
        }}
      >
        {children}
      </ChatPatchContext.Provider>
      <Dialog.Root
        open={target !== null || patchPath !== null}
        onOpenChange={(value) => {
          if (!value) {
            patchRead.current?.abort()
            setTarget(null)
            setPatchPath(null)
            setPatchTarget(null)
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="ui-image-lightbox__backdrop" />
          <Dialog.Popup className="ui-image-lightbox__popup file-viewer-popup">
            <header className="ui-image-lightbox__header">
              <Dialog.Title className="ui-image-lightbox__title">
                {patchPath
                  ? 'Current repository changes'
                  : file?.name || target?.path || 'File'}
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
              {patchPath ? (
                <>
                  <p>
                    Tool metadata names a historical edit. This viewer reads
                    current unstaged / untracked changes only.
                  </p>
                  {patchError ? (
                    <p role="status">{patchError}</p>
                  ) : patchTarget ? (
                    <RepoPatchViewer
                      target={patchTarget}
                      backLabel="Close current changes"
                      onBack={() => {
                        setPatchPath(null)
                        setPatchTarget(null)
                      }}
                    />
                  ) : (
                    <p role="status">Reading current authorized changes…</p>
                  )}
                </>
              ) : (
                content()
              )}
              {!patchPath && mediaError && (
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
