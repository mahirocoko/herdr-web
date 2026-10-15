// MIT License - Copyright (c) 2026 devswha
// Presentation adapted directly from dc2f11de RepoChanges and RepoDiffViewer.
// Local cancellation, repository fingerprints and shared ChatFiles remain authoritative.
import {
  lazy,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { Dialog } from '@base-ui/react/dialog'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy,
  CopySlash,
  FileText,
  FoldVertical,
  Folder,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  RefreshCw,
  Rows3,
  WrapText,
  X
} from 'lucide-react'
import Button from './ui/button.tsx'
import Input from './ui/input.tsx'
import Textarea from './ui/textarea.tsx'
import { ChatFiles } from './chat-file-viewer.tsx'
import { OpenChatToolFileContext } from './chat-tool-content.tsx'
import {
  fetchRepoDiffFile,
  fetchRepoDiffFiles
} from '@/services/repo-diff-api.ts'
import { changeTree, type ChangeTreeEntry } from '@/utils/change-tree.ts'
import type {
  IRepoComparison,
  IRepoDiffFile,
  IRepoDiffFileList,
  IRepoDiffFilePatch,
  IRepoDiffTarget,
  RepoDiffScope
} from '@/types/repo-diff.ts'
import { diffStyleFor, type RepoDiffStyle } from '@/utils/repo-diff-style.ts'
import { RepoDiffBoundary } from './repo-diff-boundary.tsx'
import {
  DiffSkeleton,
  FileGlyph,
  pathParts,
  Skeleton,
  skeletonRows,
  STATUS_MARK,
  STATUS_WORD
} from './repo-change-presentation.tsx'
import './repo-changes.css'
import { ReviewDraftContext } from './review-draft-context.ts'
import { formatReviewQuote } from '@/utils/terminal-quote.ts'
const RepoDiff = lazy(() => import('./repo-diff.tsx'))

export const RepoPatchViewer = ({
  target,
  onBack,
  backLabel = 'Back to files'
}: {
  target: IRepoDiffTarget
  onBack: () => void
  backLabel?: string
}) => {
  const dispatch = useContext(ReviewDraftContext)
  const capturedDispatch = useRef(dispatch)
  const [draftStatus, setDraftStatus] = useState('')
  const [answer, setAnswer] = useState<IRepoDiffFilePatch | null>(null),
    [error, setError] = useState(''),
    [copy, setCopy] = useState(''),
    [manual, setManual] = useState<string | null>(null)
  const [style, setStyle] = useState<RepoDiffStyle>('unified')
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 600px)').matches
  )
  const [folded, setFolded] = useState(false)
  const [wrap, setWrap] = useState(false)
  const drawnStyle = diffStyleFor(style, narrow)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const openFile = useContext(OpenChatToolFileContext)
  useEffect(() => {
    const controller = new AbortController()
    setAnswer(null)
    setError('')
    setManual(null)
    setCopy('')
    void fetchRepoDiffFile(target, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setAnswer(value)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      }
    )
    return () => controller.abort()
  }, [target])
  const copyText = async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error()
      await navigator.clipboard.writeText(text)
      setCopy('Copied')
    } catch {
      setManual(text)
      setCopy('Clipboard unavailable; select and copy below')
    }
  }
  const { stem, extension, folder } = pathParts(target.path)
  const file = answer?.file
  const patch = answer?.patch ?? null
  const comparison =
    target.scope === 'commit'
      ? `${target.base?.slice(0, 7)}..${target.head?.slice(0, 7)}`
      : target.scope === 'workspace'
        ? 'Working tree'
        : 'Staged'
  return (
    <section className="repo-diff-viewer" aria-label="File patch">
      <header className="repo-diff-header">
        <div className="repo-diff-title">
          <h3 className="repo-diff-heading" title={target.path}>
            <span className="repo-diff-stem">{stem}</span>
            {extension}
          </h3>
          <p
            className="repo-diff-meta"
            title={
              target.oldPath === null
                ? target.path
                : `Renamed from ${target.oldPath}`
            }
          >
            {!answer && !error && (
              <>
                <Skeleton className="repo-diff-skeleton-status" />
                <Skeleton className="repo-diff-skeleton-counts" />
              </>
            )}
            {file && (
              <span className="repo-diff-status" data-status={file.status}>
                {STATUS_WORD[file.status]}
              </span>
            )}
            {file && file.additions !== null && file.deletions !== null && (
              <span className="repo-diff-counts">
                <span className="repo-diff-added">
                  +{file.additions.toLocaleString()}
                </span>
                <span className="repo-diff-deleted">
                  −{file.deletions.toLocaleString()}
                </span>
              </span>
            )}
            {file?.binary && <span>Binary</span>}
            <span className="repo-diff-compare">{comparison}</span>
            {folder !== '' && (
              <span className="repo-diff-path">
                <span dir="ltr">{folder}</span>
              </span>
            )}
          </p>
        </div>
        <div className="repo-diff-actions">
          {dispatch && capturedDispatch.current && answer && (
            <Button
              variant="ghost"
              onClick={() => {
                const scope =
                  target.scope === 'commit'
                    ? `Recorded commit comparison ${target.base}..${target.head}`
                    : target.scope === 'workspace'
                      ? 'Current working tree comparison (unstaged / untracked)'
                      : 'Current staged comparison (index versus HEAD)'
                setDraftStatus(
                  capturedDispatch.current!(
                    formatReviewQuote(target.path, scope)
                  ) ?? 'Added path and comparison scope to draft — not sent'
                )
              }}
            >
              Add to draft
            </Button>
          )}
          <div
            className="repo-segmented repo-diff-styles"
            role="group"
            aria-label="Patch layout"
          >
            <Button
              variant="ghost"
              aria-pressed={drawnStyle === 'unified'}
              onClick={() => setStyle('unified')}
            >
              <Rows3 aria-hidden="true" />
              <span className="repo-diff-style-word">Unified</span>
            </Button>
            <Button
              variant="ghost"
              aria-pressed={drawnStyle === 'split'}
              disabled={narrow}
              title={narrow ? 'Split view needs a wider screen' : undefined}
              onClick={() => setStyle('split')}
            >
              <Columns2 aria-hidden="true" />
              <span className="repo-diff-style-word">Split</span>
            </Button>
          </div>
          <div className="repo-diff-group">
            <Button
              variant="ghost"
              size="icon"
              className="repo-source-icon"
              aria-pressed={folded}
              aria-label="Fold context"
              title={
                folded ? 'Showing one line around each change' : 'Fold context'
              }
              disabled={patch === null}
              onClick={() => setFolded((value) => !value)}
            >
              <FoldVertical aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="repo-source-icon"
              aria-pressed={wrap}
              aria-label="Wrap lines"
              title="Wrap lines"
              onClick={() => setWrap((value) => !value)}
            >
              <WrapText aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="repo-source-icon"
              aria-label="Open current file"
              title="Open current file"
              disabled={
                !answer ||
                file?.status === 'deleted' ||
                /[\x00-\x1f\x7f]/.test(target.path)
              }
              onClick={() => {
                if (answer)
                  openFile?.(`${answer.repository.root}/${target.path}`)
              }}
            >
              <FileText aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="repo-source-icon"
              aria-label="Copy path"
              title="Copy path"
              onClick={() => void copyText(target.path)}
            >
              <CopySlash aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="repo-source-icon"
              aria-label="Copy patch"
              title="Copy patch"
              disabled={!patch}
              onClick={() => void copyText(patch!)}
            >
              <Copy aria-hidden="true" />
            </Button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="repo-source-icon repo-diff-close"
          aria-label={backLabel}
          title={backLabel}
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
      </header>
      <div className="repo-diff-body">
        {draftStatus && <p role="status">{draftStatus}</p>}
        <p className="repo-changes-note repo-reading-boundary">
          Open file shows current disk content, not a historical blob. Custom
          Git attributes and diff/filter drivers are ignored for safe reading.
          {narrow &&
            style === 'split' &&
            ' Split view needs a wider screen; showing one column.'}
        </p>
        {/[\x00-\x1f\x7f]/.test(target.path) && (
          <p className="repo-changes-note">
            The current-file viewer cannot open control-bearing paths. Patch and
            path copy remain available.
          </p>
        )}
        {copy && (
          <p className="repo-diff-note" role="status">
            {copy}
          </p>
        )}
        {manual !== null ? (
          <Textarea
            className="repo-diff-select-source"
            aria-label="Text to copy"
            readOnly
            value={manual}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : error ? (
          <p className="repo-diff-note" role="alert">
            {error}
          </p>
        ) : !answer ? (
          <DiffSkeleton />
        ) : answer.unavailable ? (
          <p className="repo-diff-note" role="status">
            {
              {
                binary: 'This is a binary file; there are no lines to compare.',
                too_large:
                  'This change is larger than 1 MiB and is not shown here.',
                unmerged:
                  'This file has a merge conflict; resolve it in the terminal first.',
                unsupported:
                  'No readable regular-file patch (or only metadata changed).'
              }[answer.unavailable]
            }
          </p>
        ) : (
          <RepoDiffBoundary resetKey={answer.patch}>
            <Suspense fallback={<DiffSkeleton />}>
              <RepoDiff
                patch={answer.patch ?? ''}
                style={drawnStyle}
                folded={folded}
                wrap={wrap}
              />
            </Suspense>
          </RepoDiffBoundary>
        )}
      </div>
    </section>
  )
}

const folderPaths = (entries: readonly ChangeTreeEntry[]): string[] =>
  entries.flatMap((entry) =>
    entry.kind === 'folder' ? [entry.path, ...folderPaths(entry.entries)] : []
  )
export const RepoChangeRows = ({
  entries,
  files,
  folded,
  onToggle,
  onOpen
}: {
  entries: readonly ChangeTreeEntry[]
  files: readonly IRepoDiffFile[]
  folded: ReadonlySet<string>
  onToggle: (path: string) => void
  onOpen: (file: IRepoDiffFile) => void
}): ReactNode =>
  entries.map((entry) => {
    const indent = { '--depth': entry.depth } as CSSProperties
    if (entry.kind === 'folder') {
      const open = !folded.has(entry.path)
      return (
        <li key={`folder:${entry.path}`}>
          <Button
            variant="ghost"
            className="repo-change-folder"
            style={indent}
            aria-expanded={open}
            onClick={() => onToggle(entry.path)}
          >
            <span className="repo-change-caret" aria-hidden="true">
              {open ? <ChevronDown /> : <ChevronRight />}
            </span>
            {open ? (
              <FolderOpen className="repo-change-glyph" aria-hidden="true" />
            ) : (
              <Folder className="repo-change-glyph" aria-hidden="true" />
            )}
            <span className="repo-change-folder-name">{entry.name}</span>
            <span className="repo-change-folder-count" aria-hidden="true">
              {entry.files.toLocaleString()}
            </span>
          </Button>
          {open && (
            <ul className="repo-change-children" role="list">
              <RepoChangeRows
                entries={entry.entries}
                files={files}
                folded={folded}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            </ul>
          )}
        </li>
      )
    }
    const file = files[entry.index]!
    const folder = file.path.slice(0, file.path.length - entry.name.length)
    const sameFolder =
      file.old_path !== null &&
      file.old_path.slice(0, file.old_path.lastIndexOf('/') + 1) === folder
    return (
      <li key={file.path}>
        <Button
          variant="ghost"
          className="repo-change"
          style={indent}
          onClick={() => onOpen(file)}
        >
          <span
            className="repo-change-mark"
            data-status={file.status}
            aria-hidden="true"
          >
            {STATUS_MARK[file.status]}
          </span>
          <span className="repo-visually-hidden">
            {STATUS_WORD[file.status]}{' '}
          </span>
          <FileGlyph name={file.path} className="repo-change-glyph" />
          <span
            className="repo-change-path"
            title={
              file.old_path === null
                ? file.path
                : `Renamed from ${file.old_path}`
            }
          >
            {file.old_path !== null && (
              <span className="repo-change-old">
                {sameFolder && folder !== '' && (
                  <span className="repo-visually-hidden">{folder}</span>
                )}
                {sameFolder
                  ? file.old_path.slice(folder.length)
                  : file.old_path}{' '}
                →{' '}
              </span>
            )}
            {folder !== '' && (
              <span className="repo-visually-hidden">{folder}</span>
            )}
            {entry.name}
          </span>
          {file.binary === true ? (
            <span className="repo-change-counts">Binary</span>
          ) : (
            file.additions !== null &&
            file.deletions !== null && (
              <span className="repo-change-counts">
                <span className="repo-change-added">
                  +{file.additions.toLocaleString()}
                </span>
                <span className="repo-change-deleted">
                  −{file.deletions.toLocaleString()}
                </span>
              </span>
            )
          )}
        </Button>
      </li>
    )
  })
const ChangesBody = ({ paneId }: { paneId: string }) => {
  const [scope, setScope] = useState<RepoDiffScope>('workspace'),
    [base, setBase] = useState(''),
    [head, setHead] = useState('')
  const [asked, setAsked] = useState<IRepoComparison | null>({
      scope: 'workspace',
      base: null,
      head: null
    }),
    [list, setList] = useState<IRepoDiffFileList | null>(null),
    [error, setError] = useState(''),
    [target, setTarget] = useState<IRepoDiffTarget | null>(null)
  const [last, setLast] = useState<IRepoDiffFileList | null>(null)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const shown = list ?? last
  const tree = useMemo(
    () => changeTree(shown?.files.map((file) => file.path) ?? []),
    [shown]
  )
  const folders = useMemo(() => folderPaths(tree), [tree])
  const allOpen = folders.every((path) => !folded.has(path))
  useEffect(() => {
    const controller = new AbortController()
    setList(null)
    setTarget(null)
    setError('')
    if (asked)
      void fetchRepoDiffFiles(paneId, asked, controller.signal).then(
        (value) => {
          if (!controller.signal.aborted) {
            setList(value)
            setLast(value)
          }
        },
        (reason) => {
          if (!controller.signal.aborted) setError(reason.message)
        }
      )
    return () => controller.abort()
  }, [asked, paneId])
  if (target)
    return <RepoPatchViewer target={target} onBack={() => setTarget(null)} />
  const repository = shown?.repository
  const pending = asked !== null && !list && !error
  return (
    <div
      className="repo-changes"
      role="group"
      aria-label="Changes"
      aria-busy={pending}
    >
      <div className="repo-changes-bar">
        <div
          className="repo-segmented repo-changes-scopes"
          role="group"
          aria-label="Comparison scope"
        >
          {(['workspace', 'staged', 'commit'] as const).map((next) => (
            <Button
              key={next}
              variant="ghost"
              aria-pressed={scope === next}
              onClick={() => {
                setScope(next)
                setAsked(
                  next === 'commit'
                    ? null
                    : { scope: next, base: null, head: null }
                )
              }}
            >
              {next === 'workspace'
                ? 'Working tree'
                : next === 'staged'
                  ? 'Staged'
                  : 'Commits'}
            </Button>
          ))}
        </div>
        <div className="repo-changes-tools">
          <Button
            variant="ghost"
            size="icon"
            className="repo-source-icon"
            aria-label={allOpen ? 'Collapse all folders' : 'Expand all folders'}
            title={allOpen ? 'Collapse all folders' : 'Expand all folders'}
            disabled={folders.length === 0}
            onClick={() => setFolded(allOpen ? new Set(folders) : new Set())}
          >
            {allOpen ? (
              <ChevronsDownUp aria-hidden="true" />
            ) : (
              <ChevronsUpDown aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="repo-source-icon"
            aria-label="Refresh changes"
            title="Refresh changes"
            disabled={!asked || pending}
            onClick={() => setAsked(asked ? { ...asked } : null)}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
      </div>
      {scope === 'commit' && (
        <form
          className="repo-changes-commits"
          onSubmit={(event) => {
            event.preventDefault()
            setAsked({ scope: 'commit', base: base.trim(), head: head.trim() })
          }}
        >
          <label>
            <span>From commit</span>
            <Input
              value={base}
              maxLength={200}
              onChange={(event) => setBase(event.target.value)}
              placeholder="HEAD~1"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label>
            <span>To commit</span>
            <Input
              value={head}
              maxLength={200}
              onChange={(event) => setHead(event.target.value)}
              placeholder="HEAD"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <Button type="submit" disabled={!base.trim() || !head.trim()}>
            Compare
          </Button>
        </form>
      )}
      {repository && (
        <p className="repo-changes-repo" title={repository.root}>
          <span className="repo-changes-branch">
            <GitBranch aria-hidden="true" />
            {repository.branch ??
              (repository.unborn ? 'No commits yet' : 'Detached HEAD')}
          </span>
          <span className="repo-changes-root">
            <span dir="ltr">{repository.root}</span>
          </span>
        </p>
      )}
      {error ? (
        <p className="repo-changes-note repo-changes-error" role="alert">
          {error}
        </p>
      ) : (
        <ul
          className="repo-changes-list"
          role="list"
          aria-label="Changed files"
          data-scope={list?.scope}
        >
          {pending && (
            <li className="repo-changes-loading" role="status">
              <span className="repo-visually-hidden">Loading changes…</span>
              {skeletonRows(last === null ? null : last.files.length).map(
                (width, index) => (
                  <span
                    key={index}
                    className="repo-change-skeleton"
                    aria-hidden="true"
                  >
                    <Skeleton className="repo-change-skeleton-mark" />
                    <Skeleton className="repo-change-skeleton-glyph" />
                    <Skeleton width={width} />
                    <Skeleton className="repo-change-skeleton-counts" />
                  </span>
                )
              )}
            </li>
          )}
          {list && (
            <RepoChangeRows
              entries={tree}
              files={list.files}
              folded={folded}
              onToggle={(path) =>
                setFolded((current) => {
                  const next = new Set(current)
                  if (!next.delete(path)) next.add(path)
                  return next
                })
              }
              onOpen={(file) =>
                setTarget({
                  paneId,
                  repositoryIdentity: list.repository_identity,
                  scope: list.scope,
                  base: list.base,
                  head: list.head,
                  path: file.path,
                  oldPath: file.old_path
                })
              }
            />
          )}
          {list && list.files.length === 0 && (
            <li className="repo-changes-note">
              {scope === 'workspace'
                ? 'No unstaged or untracked changes.'
                : scope === 'staged'
                  ? 'Nothing staged'
                  : 'These commits are the same'}
            </li>
          )}
          {list?.truncated && (
            <li className="repo-changes-note" role="status">
              {list.total === null
                ? `The list was cut short; only the first ${list.files.length.toLocaleString()} files are shown.`
                : `Showing the first ${list.files.length.toLocaleString()} of ${list.total.toLocaleString()} changed files.`}
            </li>
          )}
        </ul>
      )}
      <p className="repo-changes-note repo-reading-boundary">
        {scope === 'workspace'
          ? 'Working tree: unstaged tracked changes + untracked files; excludes staged-only changes.'
          : scope === 'staged'
            ? 'Index versus HEAD.'
            : 'Compare two explicit commits; excludes working tree and staged changes.'}
      </p>
    </div>
  )
}
export const RepoChangesTrigger = ({ paneId }: { paneId: string }) => {
  const [open, setOpen] = useState(false)
  const dispatch = useContext(ReviewDraftContext)
  const capturedDispatch = useRef(dispatch)
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (value && !open) capturedDispatch.current = dispatch
        setOpen(value)
      }}
    >
      <Dialog.Trigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Repository Changes"
            title="Repository Changes"
          >
            <GitCompareArrows size={18} aria-hidden="true" />
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-image-lightbox__backdrop" />
        <Dialog.Popup className="ui-image-lightbox__popup file-viewer-popup repo-changes-popup">
          <header className="ui-image-lightbox__header">
            <Dialog.Title className="ui-image-lightbox__title">
              Repository Changes
            </Dialog.Title>
            <Dialog.Close
              render={
                <Button variant="ghost" size="icon" aria-label="Close Changes">
                  <X />
                </Button>
              }
            />
          </header>
          <div className="file-viewer-body">
            <ReviewDraftContext.Provider value={capturedDispatch.current}>
              <ChatFiles paneId={paneId}>
                <ChangesBody key={paneId} paneId={paneId} />
              </ChatFiles>
            </ReviewDraftContext.Provider>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
