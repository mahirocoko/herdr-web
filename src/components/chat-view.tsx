// MIT License - Copyright (c) 2026 devswha
// Reading-position adaptation: Copyright (c) 2026 T3 Tools Inc. (see THIRD_PARTY_NOTICES)
// Adapted from devswha/herdr-web-ui
import {
  type FC,
  type ReactNode,
  useCallback,
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  ArrowDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  RotateCw,
  Search
} from 'lucide-react'
import { useConversation } from '@/hooks/use-conversation.ts'
import { ChatFind, ChatMatchSource } from './chat-find.tsx'
import {
  chatSearchText,
  isChatFindShortcut,
  type IChatSearchMatch
} from '@/utils/chat-search.ts'
import {
  captureChatPosition,
  restoreChatPosition,
  chatPositionStorageError,
  chatPositionScope,
  chatRestoreIndex,
  readChatPosition,
  rememberChatPosition,
  type IChatPosition
} from '@/utils/chat-scroll-memory.ts'
import { Markdown } from './markdown.tsx'
import {
  ChatTaskResults,
  ChatRecordNotice,
  ChatAbandonedBranches
} from './chat-provider-records.tsx'
import {
  ChatAssetContext,
  NativeImage,
  WholeToolContent
} from './chat-native-assets.tsx'
import {
  formatWorkDuration,
  isLiveWorkTurn,
  isWaitingWorkTurn,
  splitTurn,
  type ToolPart,
  workFailed,
  workStartsOpen,
  workSummary
} from './work-blocks.ts'
import Button from '@/components/ui/button.tsx'
import type {
  ConversationPart,
  IConversationMetadata,
  IConversationTurn
} from '@/types/conversation.ts'
import './chat-view.css'
import { ChatFiles } from './chat-file-viewer.tsx'
import { TurnChangedFiles } from './turn-changed-files.tsx'
import { shouldFoldUserMessage } from '@/utils/user-message-fold.ts'
import {
  DEFAULT_CHAT_PREFERENCES,
  type IChatPreferences
} from '@/utils/chat-preferences.ts'
import { chatPreferenceStyle } from './chat-preferences.tsx'
import { ChatRenderBoundary } from './chat-render-boundary.tsx'
import { dismissKeyboardOn } from '@/utils/chat-keyboard.ts'
import type { IActionTargetIdentity } from '@/types/herdr.ts'
import type { useChatSubmissions } from '@/hooks/use-chat-submissions.ts'
import type { useHeldMessages } from '@/hooks/use-held-messages.ts'
import { isLiveHeldMessage } from './held-queue-stack.tsx'
import {
  corroboratedSubmission,
  isCurrentSubmissionIssue,
  type IChatSubmission,
  sameSubmissionTarget,
  submissionBaseline,
  submissionLabel
} from '@/utils/chat-submissions.ts'

export interface IRecordedConversationMetadata {
  target: IActionTargetIdentity
  sessionKey: string
  metadata: IConversationMetadata
}

export interface IChatViewProps {
  paneId: string | null
  cwd?: string | null
  preferences?: IChatPreferences
  sendRevision?: number
  actionTarget?: IActionTargetIdentity | null
  submissions?: ReturnType<typeof useChatSubmissions>
  held?: ReturnType<typeof useHeldMessages>
  agentName?: string | null
  agentStatus?: string
  connected?: boolean
  isAgent?: boolean
  onSwitchToStream: () => void
  onRecordedMetadata?: (record: IRecordedConversationMetadata | null) => void
}

const formatTime = (ts: string | null): string | null => {
  if (ts === null) return null
  const date = new Date(ts)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const plainText = (markdown: string): string => {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/gi, '$1')
    .replace(/(?:\*\*|__|~~|`)(.*?)(?:\*\*|__|~~|`)/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^>\s?/gm, '')
}

interface ICopyButtonProps {
  text: string
  label: string
  className?: string
  children?: ReactNode
}

const CopyButton: FC<ICopyButtonProps> = ({
  text,
  label,
  className = 'chat-copy',
  children
}) => {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className={copied ? `${className} is-copied` : className}
      onClick={() => void copy()}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {children}
    </button>
  )
}

const ToolRow: FC<{ part: ToolPart }> = ({ part }) => {
  const [open, setOpen] = useState(false)
  const hasDetails = Boolean(part.input || part.output || part.images?.length)

  return (
    <div
      className={`work-row${part.error ? ' is-error' : ''}`}
      data-tool-name={part.name}
    >
      <button
        type="button"
        className="work-row-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="work-row-caret" aria-hidden="true">
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
        <span className="work-row-name">{part.name}</span>
        {part.error && <span className="work-block-failed">failed</span>}
        {part.pending && (
          <span className="work-row-summary">awaiting output</span>
        )}
        {part.truncated && (
          <span className="work-row-summary">output truncated</span>
        )}
        {part.inputTruncated && (
          <span className="work-row-summary">input truncated</span>
        )}
        {part.summary.length > 0 && part.summary !== part.name && (
          <span className="work-row-summary">{part.summary}</span>
        )}
      </button>
      {open && hasDetails && (
        <div className="work-row-detail">
          <WholeToolContent part={part} />
          {part.images?.map((image, index) => (
            <NativeImage key={image.nativeKey ?? index} part={image} />
          ))}
        </div>
      )}
    </div>
  )
}

const ThinkingRow: FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="work-row work-row-thinking">
      <button
        type="button"
        className="work-row-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="work-row-caret" aria-hidden="true">
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
        <span className="work-row-name">thinking</span>
      </button>
      {open && <div className="work-row-detail work-thinking-text">{text}</div>}
    </div>
  )
}

interface IWorkBlockProps {
  parts: ConversationPart[]
  duration: string | null
  live: boolean
  waiting: boolean
  defaultOpen: boolean
  showThinking?: boolean
}

const WorkBlockView: FC<IWorkBlockProps> = ({
  parts,
  duration,
  live,
  waiting,
  defaultOpen,
  showThinking = false
}) => {
  const [chosenOpen, setOpen] = useState<boolean | null>(null)
  const open = chosenOpen ?? defaultOpen

  const visible = parts.filter(
    (part) => showThinking || part.kind !== 'thinking'
  )
  const summary = workSummary(visible)
  const failed = workFailed(visible)
  if (!visible.length) return null

  const title = waiting
    ? 'Needs you'
    : live
      ? 'Working…'
      : duration !== null
        ? `Worked for ${duration}`
        : 'Worked'

  return (
    <section
      className={`work-block${live ? ' is-live' : ''}${waiting ? ' is-waiting' : ''}${open ? '' : ' is-folded'}`}
    >
      <button
        type="button"
        className="work-block-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="work-row-caret" aria-hidden="true">
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
        <span className="work-block-title">{title}</span>
        {summary.length > 0 && (
          <span className="work-block-summary">· {summary}</span>
        )}
        {failed > 0 && (
          <span className="work-block-failed">· {failed} failed</span>
        )}
      </button>
      {open && (
        <div className="work-block-rows">
          {visible.map((part, index) => {
            if (part.kind === 'thinking') {
              return (
                <ThinkingRow key={part.nativeKey ?? index} text={part.text} />
              )
            }
            if (part.kind === 'text') {
              return (
                <div key={part.nativeKey ?? index} className="work-narration">
                  <Markdown>{part.text}</Markdown>
                </div>
              )
            }
            if (part.kind === 'tool') {
              return <ToolRow key={part.nativeKey ?? part.id} part={part} />
            }
            if (part.kind === 'image')
              return <NativeImage key={part.nativeKey ?? index} part={part} />
            return null
          })}
        </div>
      )}
    </section>
  )
}

// Source-owned fold anatomy from dc2f11de ChatView.UserMessage. Keyed Turn keeps
// disclosure identity across polling; P1's full source reveal remains outside the cap.
const UserMessage = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false)
  const canFold = useMemo(() => shouldFoldUserMessage(text), [text])
  const capped = canFold && !open
  const body = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const folding = useRef(false)
  const disclosureChanged = useRef(false)
  const id = useId()
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const node = body.current
    if (!canFold || !node) {
      setClipped(false)
      return
    }
    // Keep the measured disclosure mounted while expanded. Clearing this flag
    // removes its focused button for one render when keyboard users collapse.
    if (!capped) return
    const measure = () => setClipped(node.scrollHeight > node.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [canFold, capped, text])
  useLayoutEffect(() => {
    if (!disclosureChanged.current) return
    disclosureChanged.current = false
    const wasFolding = folding.current
    folding.current = false
    const node = card.current
    const view = node?.closest<HTMLElement>('.chat-view')
    const selectedRow = node?.closest<HTMLElement>('[data-chat-match]')
    const mark =
      selectedRow?.querySelector<HTMLElement>('.chat-match-source mark') ??
      (selectedRow
        ? view?.querySelector<HTMLElement>('.chat-find .chat-match-source mark')
        : null)
    // Only an explicit disclosure change of the selected Find row re-reveals
    // its passage. Ordinary resizing and away-reader scrolling stay untouched.
    if (mark && view) {
      view.scrollTop +=
        (selectedRow?.querySelector('.chat-match-source')
          ? mark
          : (selectedRow ?? mark)
        ).getBoundingClientRect().top -
        view.getBoundingClientRect().top -
        view.clientHeight / 2
      return
    }
    if (
      wasFolding &&
      node &&
      view &&
      node.getBoundingClientRect().top < view.getBoundingClientRect().top
    )
      node.scrollIntoView({ block: 'start' })
  }, [open])
  return (
    <div
      ref={card}
      className={`chat-bubble${capped ? ' is-capped' : ''}${clipped ? ' is-folded' : ''}`}
    >
      <div ref={body} id={id} className="chat-bubble-body">
        <Markdown>{text}</Markdown>
      </div>
      {(open || clipped) && (
        <div className="chat-bubble-foot">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => {
              disclosureChanged.current = true
              folding.current = open
              setOpen(!open)
            }}
          >
            {open ? 'Show less' : 'Show full message'}
          </Button>
        </div>
      )}
    </div>
  )
}

interface ITurnProps {
  turn: IConversationTurn
  live: boolean
  waiting: boolean
  showThinking?: boolean
  sourcePreview?: boolean
  match?: IChatSearchMatch | null
}

const Turn: FC<ITurnProps> = ({
  turn,
  live,
  waiting,
  showThinking = false,
  sourcePreview = true,
  match = null
}) => {
  const matchingSource =
    sourcePreview && match?.rowKey === turn.id ? (
      <ChatMatchSource text={chatSearchText(turn)} match={match} />
    ) : null
  const time = formatTime(turn.ts)

  const notices = turn.parts.map((part, index) => {
    if (part.kind === 'task_result')
      return (
        <ChatTaskResults key={part.nativeKey ?? index} tasks={part.tasks} />
      )
    if (part.kind === 'notice' && part.source === 'letta-runtime')
      return (
        <div
          key={part.nativeKey ?? index}
          className={`chat-runtime-warning${part.severity === 'error' ? ' is-error' : ''}`}
          role="alert"
        >
          <strong>
            {part.severity === 'error'
              ? 'Letta runtime error'
              : 'Letta warning'}
          </strong>
          <pre>{part.text}</pre>
          {part.truncated && <p>Recorded error detail truncated in Chat.</p>}
        </div>
      )
    if (part.kind === 'notice' || part.kind === 'compact')
      return <ChatRecordNotice key={part.nativeKey ?? index} part={part} />
    if ((part.kind === 'text' || part.kind === 'thinking') && part.truncated)
      return (
        <ChatRecordNotice
          key={part.nativeKey ?? index}
          part={{
            kind: 'notice',
            text: `${part.kind === 'thinking' ? 'Thinking' : 'Text'} truncated in Chat.`
          }}
        />
      )
    return null
  })

  if (turn.role === 'user') {
    const text = turn.parts
      .filter(
        (part): part is Extract<ConversationPart, { kind: 'text' }> =>
          part.kind === 'text'
      )
      .map((part) => part.text)
      .join('\n\n')

    return (
      <article
        className="chat-turn chat-turn-user"
        data-chat-row={turn.id}
        data-chat-match={match?.rowKey === turn.id ? '' : undefined}
      >
        {notices}
        <div className="chat-user-row">
          {turn.parts
            .filter((part) => part.kind === 'image')
            .map((part, index) => (
              <NativeImage key={part.nativeKey ?? index} part={part} />
            ))}
          {text.length > 0 && <UserMessage text={text} />}
          <div className="chat-turn-meta">
            {time !== null && (
              <time dateTime={turn.ts ?? undefined}>{time}</time>
            )}
            {text.length > 0 && <CopyButton text={text} label="Copy message" />}
          </div>
        </div>
        <SkillActivity parts={turn.parts} />
        {matchingSource}
      </article>
    )
  }

  const { work, answer } = splitTurn(
    turn.parts.filter(
      (part) =>
        part.kind !== 'notice' &&
        part.kind !== 'compact' &&
        part.kind !== 'skill' &&
        part.kind !== 'task_result'
    )
  )
  const answerText = answer.map((part) => part.text).join('\n\n')

  return (
    <article
      className="chat-turn chat-turn-agent"
      data-chat-row={turn.id}
      data-chat-match={match?.rowKey === turn.id ? '' : undefined}
    >
      {notices}
      <SkillActivity parts={turn.parts} />
      {work.length > 0 && (
        <WorkBlockView
          parts={work}
          duration={formatWorkDuration(turn.ts, turn.end_ts ?? null)}
          live={live}
          waiting={waiting}
          defaultOpen={workStartsOpen(live, turn.parts)}
          showThinking={showThinking}
        />
      )}
      <TurnChangedFiles parts={turn.parts} />
      {answer.map((part, index) => (
        <Markdown key={part.nativeKey ?? index}>{part.text}</Markdown>
      ))}
      {answerText.length > 0 && (
        <div className="chat-turn-meta chat-agent-meta">
          <CopyButton
            className="chat-meta-btn"
            text={answerText}
            label="Copy as markdown"
          >
            <span className="chat-meta-fmt">MD</span>
          </CopyButton>
          <CopyButton
            className="chat-meta-btn chat-meta-plain"
            text={plainText(answerText)}
            label="Copy as plain text"
          >
            <span className="chat-meta-fmt">TXT</span>
            <span className="chat-meta-word">Plain text</span>
          </CopyButton>
          {time !== null && <time dateTime={turn.ts ?? undefined}>{time}</time>}
        </div>
      )}
      {matchingSource}
    </article>
  )
}

const SkillActivity = ({ parts }: { parts: ConversationPart[] }) => {
  const recorded = new Map<
    string,
    NonNullable<Extract<ConversationPart, { kind: 'tool' | 'skill' }>['skill']>
  >()
  for (const part of parts) {
    if ((part.kind === 'tool' || part.kind === 'skill') && part.skill)
      recorded.set(
        `${part.skill.evidence}:${part.skill.path ?? part.skill.name}`,
        part.skill
      )
  }
  if (!recorded.size) return null
  return (
    <div
      className="chat-skills"
      role="group"
      aria-label="Recorded skill activity"
    >
      {[...recorded.entries()].map(([key, skill]) => (
        <details
          key={key}
          className={`chat-skill${skill.status === 'failed' ? ' is-error' : ''}`}
          data-status={skill.status}
        >
          <summary>
            <BookOpen aria-hidden="true" />
            <span className="chat-skill-name">{skill.name}</span>
            <span className="chat-skill-status">
              {skill.evidence === 'invocation'
                ? skill.status === 'failed'
                  ? 'Skill invocation failed'
                  : skill.status === 'requested'
                    ? 'Skill requested'
                    : 'Skill invoked'
                : skill.status === 'failed'
                  ? 'Skill read failed'
                  : skill.status === 'requested'
                    ? 'Reading skill requested'
                    : 'Skill instructions loaded'}
            </span>
            <ChevronDown className="chat-skill-caret" aria-hidden="true" />
          </summary>
          <div className="chat-skill-detail">
            <p>
              {skill.evidence === 'instructions'
                ? 'The transcript records loading this skill’s instructions. This does not confirm every step was followed.'
                : 'Recorded by the agent’s Skill tool. This does not mean the skill’s work is complete.'}
            </p>
            {skill.path && <code>{skill.path}</code>}
          </div>
        </details>
      ))}
    </div>
  )
}

interface ISubmissionReceiptsProps {
  records: IChatSubmission[]
  actionTarget: IActionTargetIdentity | null
  sessionKey: string | null
  corroborations: Map<string, string | null>
  onClear: () => void
}

const SubmissionReceipt = ({
  record,
  nativeId,
  historical
}: {
  record: IChatSubmission
  nativeId: string | null | undefined
  historical: boolean
}) => (
  <article className={historical ? undefined : 'chat-turn chat-turn-user'}>
    <div className={historical ? undefined : 'chat-user-row'}>
      {historical ? (
        <pre>{record.text}</pre>
      ) : (
        <div className="chat-bubble">
          <Markdown>{record.text}</Markdown>
        </div>
      )}
      <p className="chat-inline-state" role={historical ? undefined : 'status'}>
        {nativeId
          ? 'Corroborated in native transcript — execution not confirmed.'
          : submissionLabel(record)}
      </p>
      {historical && (
        <>
          <p>Operation: {record.operationId}</p>
          <p>
            Target: {record.target.paneId} / {record.target.terminalId} /{' '}
            {record.target.agentSessionId ?? 'session unavailable'} /{' '}
            {record.target.expectedMode}
          </p>
          <p>
            Captured history: {record.baseline?.sessionKey ?? 'unavailable'}
          </p>
          <p>Browser generation: {record.generation}</p>
          <time dateTime={record.submittedAt}>{record.submittedAt}</time>
        </>
      )}
    </div>
  </article>
)

/** Ordinary Send evidence is separate from the capability-owned held records. */
const SubmissionReceipts = ({
  records,
  actionTarget,
  sessionKey,
  corroborations,
  onClear
}: ISubmissionReceiptsProps) => {
  if (!records.length) return null
  const current = records.filter((record) =>
    isCurrentSubmissionIssue(record, actionTarget, sessionKey)
  )
  const history = records.filter((record) => !current.includes(record))
  return (
    <>
      {current.map((record) => (
        <SubmissionReceipt
          key={record.operationId}
          record={record}
          historical={false}
          nativeId={corroborations.get(record.operationId)}
        />
      ))}
      <details className="chat-compact submission-history">
        <summary>Submission history (not queued)</summary>
        <div className="chat-compact-text">
          <p>
            Read-only ordinary Send evidence, not held messages or proof of
            native delivery. Captured target/history may differ or be
            unavailable; these records do not authorize input.
          </p>
          {history.map((record) => (
            <SubmissionReceipt
              key={record.operationId}
              record={record}
              historical
              nativeId={corroborations.get(record.operationId)}
            />
          ))}
          {current.length > 0 && (
            <p>Current sending or problem receipts are shown above.</p>
          )}
          <Button variant="ghost" onClick={onClear}>
            Clear saved receipts (all panes)
          </Button>
          <p className="chat-inline-state">
            Removes Web evidence only; does not cancel native input.
          </p>
        </div>
      </details>
    </>
  )
}

const ChatView: FC<IChatViewProps> = ({
  paneId,
  cwd = null,
  preferences = DEFAULT_CHAT_PREFERENCES,
  sendRevision = 0,
  actionTarget = null,
  submissions,
  held,
  agentStatus,
  connected = true,
  isAgent = true,
  onSwitchToStream,
  onRecordedMetadata
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const strictReadingRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const prependRef = useRef<{
    position: IChatPosition
    first: string | undefined
  } | null>(null)
  const [away, setAway] = useState(false)
  const [newMessages, setNewMessages] = useState(false)
  const latestRef = useRef<string>('')
  const sentOver = useRef<{
    revision: number
    page: IConversationTurn[]
    turn: IConversationTurn | null
  } | null>(null)

  const {
    turns,
    contributions,
    sessionKey,
    source,
    metadata,
    abandoned,
    retentionLimited,
    isLoading,
    isLoadingOlder,
    error,
    hasOlder,
    loadOlder,
    refetch
  } = useConversation({
    paneId: isAgent ? paneId : null,
    isEnabled: isAgent && Boolean(paneId),
    pollIntervalMs: 2000
  })

  // Share the existing reader's recorded facts only; keyed target remounts retire them.
  useEffect(() => {
    if (!onRecordedMetadata) return
    onRecordedMetadata(
      isAgent && sessionKey && actionTarget?.paneId === paneId
        ? { target: { ...actionTarget }, sessionKey, metadata }
        : null
    )
    return () => onRecordedMetadata(null)
  }, [
    onRecordedMetadata,
    isAgent,
    paneId,
    actionTarget?.paneId,
    actionTarget?.terminalId,
    actionTarget?.agentSessionId,
    actionTarget?.expectedMode,
    sessionKey,
    metadata
  ])

  const scope =
    paneId &&
    sessionKey &&
    source &&
    actionTarget?.paneId === paneId &&
    actionTarget.terminalId
      ? chatPositionScope(
          paneId,
          actionTarget?.terminalId,
          actionTarget?.agentSessionId,
          source,
          sessionKey
        )
      : null
  const [findOpen, setFindOpen] = useState(false)
  const [match, setMatch] = useState<IChatSearchMatch | null>(null)
  const findButton = useRef<HTMLButtonElement>(null)
  const rows = useMemo(
    () =>
      findOpen
        ? turns.map((turn) => ({ key: turn.id, text: chatSearchText(turn) }))
        : [],
    [findOpen, turns]
  )
  const savedPlace = useRef<IChatPosition | null>(null)
  const restoring = useRef<IChatPosition | null>(null)
  const restorePages = useRef(0)
  const [restoreNotice, setRestoreNotice] = useState('')
  const rememberPlace = useCallback(() => {
    const node = scrollerRef.current
    if (scope && node && !restoring.current && turns.length) {
      savedPlace.current = captureChatPosition(node, stickToBottomRef.current)
      rememberChatPosition(scope, savedPlace.current)
    }
  }, [scope, turns.length])
  const closeFind = useCallback(() => {
    setFindOpen(false)
    setMatch(null)
  }, [])
  const wasFinding = useRef(false)
  useLayoutEffect(() => {
    // Explicit Find owns reading while an older saved anchor is still pending.
    if (findOpen && restoring.current) {
      restoring.current = null
      stickToBottomRef.current = false
      strictReadingRef.current = true
      setAway(true)
    }
    // Find's toolbar changes height independently of the incoming history page.
    const node = scrollerRef.current
    if (node && prependRef.current)
      prependRef.current.position = captureChatPosition(node, false)
    if (wasFinding.current && !findOpen)
      findButton.current?.focus({ preventScroll: true })
    wasFinding.current = findOpen
  }, [findOpen])
  useEffect(() => {
    if (!scope || !isAgent) return
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !scrollerRef.current?.getClientRects().length
      )
        return
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]')
      )
        return
      if (event.key === 'Escape' && findOpen) {
        event.preventDefault()
        closeFind()
        return
      }
      if (
        !isChatFindShortcut(event, /Mac|iPhone|iPad/.test(navigator.platform))
      )
        return
      event.preventDefault()
      setFindOpen(true)
      scrollerRef.current
        .querySelector<HTMLInputElement>('.chat-find input')
        ?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scope, isAgent, findOpen, closeFind])
  const showMatch = useCallback((next: IChatSearchMatch | null) => {
    setMatch(next)
    if (next) {
      restoring.current = null
      stickToBottomRef.current = false
      strictReadingRef.current = true
      setAway(true)
    }
  }, [])
  useLayoutEffect(() => {
    if (!match) return
    const node = scrollerRef.current
    const row = [
      ...(node?.querySelectorAll<HTMLElement>('[data-chat-row]') ?? [])
    ].find((row) => row.dataset.chatRow === match.rowKey)
    if (node && row) {
      node.scrollTop +=
        row.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        node.clientHeight * 0.25
      lastScrollTopRef.current = node.scrollTop
      // Keep input focus for repeated Enter; the source passage is focusable for readers.
      rememberPlace()
    }
  }, [match?.rowKey, match?.start, match?.end, rememberPlace])

  const observeSubmissionBaseline = submissions?.observe
  useEffect(() => {
    if (actionTarget && actionTarget.paneId === paneId)
      observeSubmissionBaseline?.(
        actionTarget,
        error ? null : submissionBaseline(sessionKey, contributions)
      )
  }, [
    actionTarget?.paneId,
    actionTarget?.terminalId,
    actionTarget?.agentSessionId,
    actionTarget?.expectedMode,
    paneId,
    sessionKey,
    contributions,
    error,
    observeSubmissionBaseline
  ])
  const paneSubmissions =
    submissions?.records.filter((record) => record.target.paneId === paneId) ??
    []
  const corroborations = new Map(
    paneSubmissions.map((record) => [
      record.operationId,
      corroboratedSubmission(
        record,
        paneSubmissions,
        actionTarget,
        sessionKey,
        contributions
      )
    ])
  )

  // Maintain scroll stickiness
  if (sendRevision && sentOver.current?.revision !== sendRevision)
    sentOver.current = {
      revision: sendRevision,
      page: turns,
      turn: turns.at(-1)?.role === 'assistant' ? turns.at(-1)! : null
    }
  const finishedBeforeSend =
    sentOver.current?.page === turns ? sentOver.current.turn : null
  const fetchOlder = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      const node = scrollerRef.current
      if (
        !node ||
        !hasOlder ||
        isLoading ||
        isLoadingOlder ||
        prependRef.current
      )
        return false
      prependRef.current = {
        position: captureChatPosition(node, false),
        first: turns[0]?.id
      }
      const loaded = await loadOlder(signal)
      if (!loaded) prependRef.current = null
      return loaded
    },
    [hasOlder, isLoading, isLoadingOlder, loadOlder, turns]
  )
  const onScroll = useCallback(() => {
    const node = scrollerRef.current
    if (node === null) return
    const isAtBottom = strictReadingRef.current
      ? node.scrollTop > lastScrollTopRef.current &&
        node.scrollHeight - node.clientHeight - node.scrollTop <= 1
      : node.scrollTop + node.clientHeight >= node.scrollHeight - 48
    lastScrollTopRef.current = node.scrollTop
    if (isAtBottom) strictReadingRef.current = false
    stickToBottomRef.current = isAtBottom
    setAway(!isAtBottom)
    if (isAtBottom) setNewMessages(false)
    if (prependRef.current)
      prependRef.current.position = captureChatPosition(node, false)
    rememberPlace()
    if (node.scrollTop < 80 && !findOpen && !restoring.current)
      void fetchOlder()
  }, [fetchOlder, rememberPlace, findOpen])

  const scrollToBottom = useCallback(() => {
    const node = scrollerRef.current
    if (node === null) return
    node.scrollTo({
      top: node.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
    })
    stickToBottomRef.current = true
    strictReadingRef.current = false
    setAway(false)
    setNewMessages(false)
  }, [])

  useLayoutEffect(() => {
    const saved = scope ? readChatPosition(scope) : undefined
    restoring.current = saved && !saved.atEnd ? saved : null
    savedPlace.current = saved ?? null
    restorePages.current = 0
    stickToBottomRef.current = !restoring.current
    strictReadingRef.current = Boolean(restoring.current)
    lastScrollTopRef.current = 0
    prependRef.current = null
    setAway(Boolean(restoring.current))
    setNewMessages(false)
    setRestoreNotice('')
    setFindOpen(false)
    setMatch(null)
    latestRef.current = ''
    return () => {
      if (scope && savedPlace.current)
        rememberChatPosition(scope, savedPlace.current)
    }
  }, [scope])

  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    const saved = restoring.current
    if (saved && turns.length && !isLoading && !isLoadingOlder) {
      const index = chatRestoreIndex(
        saved,
        turns.map((turn) => turn.id)
      )
      const row =
        index === null
          ? null
          : [...node.querySelectorAll<HTMLElement>('[data-chat-row]')].find(
              (row) => row.dataset.chatRow === turns[index].id
            )
      if (row) {
        node.scrollTop +=
          row.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          saved.offset
        lastScrollTopRef.current = node.scrollTop
        restoring.current = null
        prependRef.current = null
      } else if (hasOlder && !error && restorePages.current < 20) {
        restorePages.current++
        void fetchOlder()
        return
      } else {
        restoring.current = null
        stickToBottomRef.current = true
        strictReadingRef.current = false
        setAway(false)
        setRestoreNotice(
          'Saved reading position is outside available loaded history; showing latest.'
        )
      }
    }
    const anchor = prependRef.current
    const last = turns.at(-1)
    const revision = last
      ? `${last.id}:${last.end_ts}:${last.parts.length}:${last.parts.map((part) => ('text' in part ? part.text.length : part.kind === 'tool' ? (part.output?.length ?? 0) : 0)).join(',')}`
      : ''
    if (
      latestRef.current &&
      latestRef.current !== revision &&
      !anchor &&
      !stickToBottomRef.current
    )
      setNewMessages(true)
    latestRef.current = revision
    if (anchor && anchor.first !== turns[0]?.id) {
      // Preserve the reader's current row, not total height (Find, loading and
      // retention can independently alter that height during the pending read).
      restoreChatPosition(node, anchor.position)
      lastScrollTopRef.current = node.scrollTop
      prependRef.current = null
    } else if (stickToBottomRef.current) node.scrollTop = node.scrollHeight
    if (!isLoadingOlder) prependRef.current = null
    rememberPlace()
  }, [
    turns,
    isLoading,
    isLoadingOlder,
    submissions?.records,
    hasOlder,
    error,
    fetchOlder,
    rememberPlace
  ])

  useLayoutEffect(() => {
    const node = scrollerRef.current
    const content = node?.querySelector('.chat-transcript')
    if (!node || !content || typeof ResizeObserver === 'undefined') return
    const follow = () => {
      if (stickToBottomRef.current && !prependRef.current)
        node.scrollTop = node.scrollHeight
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === node) {
          follow()
          continue
        }
        // A user-message disclosure changes height without changing font/width.
        // Only following readers move; the existing away/prepend owners still win.
        follow()
      }
    })
    observer.observe(node)
    observer.observe(content)
    document.fonts?.addEventListener('loadingdone', follow)
    return () => {
      observer.disconnect()
      document.fonts?.removeEventListener('loadingdone', follow)
    }
  }, [paneId, sessionKey])

  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (node && stickToBottomRef.current && !prependRef.current)
      node.scrollTop = node.scrollHeight
  }, [preferences.fontSize, preferences.fontFamily, preferences.width])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    const cancelRestore = () => {
      if (!restoring.current) return
      restoring.current = null
      stickToBottomRef.current = false
      setAway(true)
      rememberPlace()
    }
    for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown'])
      node.addEventListener(type, cancelRestore, { passive: true })
    return () => {
      for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown'])
        node.removeEventListener(type, cancelRestore)
    }
  }, [scope, rememberPlace])

  useEffect(() => {
    const node = scrollerRef.current
    return node ? dismissKeyboardOn(node) : undefined
  }, [paneId, sessionKey])

  useEffect(() => {
    const node = scrollerRef.current
    if (
      node &&
      node.scrollHeight <= node.clientHeight &&
      hasOlder &&
      !isLoading &&
      !isLoadingOlder &&
      !findOpen &&
      !restoring.current
    )
      void fetchOlder()
  }, [fetchOlder, hasOlder, isLoading, isLoadingOlder, turns, findOpen])

  if (!isAgent || !paneId) {
    return (
      <div className="chat-view" role="region" aria-label="Agent Conversation">
        <div className="chat-empty">
          <p>
            No native agent conversation is available for this pane. Open an
            agent in Herdr, then select its pane here, or use Terminal for this
            pane.
          </p>
          <Button variant="secondary" onClick={onSwitchToStream}>
            Switch to Terminal
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ChatFiles key={`${paneId}:${sessionKey}`} paneId={paneId} cwd={cwd}>
      <ChatAssetContext.Provider
        value={sessionKey ? { paneId, history: sessionKey } : null}
      >
        <div
          className="chat-view"
          style={chatPreferenceStyle(preferences)}
          ref={scrollerRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-label={`Conversation for pane ${paneId}`}
        >
          <div className="chat-transcript">
            {findOpen && scope ? (
              <ChatFind
                key={scope}
                rows={rows}
                older={hasOlder}
                loading={isLoading || isLoadingOlder}
                limited={retentionLimited}
                error={error}
                onOlder={fetchOlder}
                onMatch={showMatch}
                onClose={closeFind}
              />
            ) : (
              <Button
                ref={findButton}
                variant="ghost"
                size="sm"
                className="chat-find-open"
                disabled={!scope}
                onClick={() => setFindOpen(true)}
              >
                <Search aria-hidden="true" /> Find in Chat
              </Button>
            )}
            {chatPositionStorageError() && (
              <p className="chat-inline-state" role="status">
                Reading positions are memory-only; browser storage is
                unavailable.
              </p>
            )}
            {restoreNotice && (
              <p className="chat-inline-state" role="status">
                {restoreNotice}
              </p>
            )}
            {!onRecordedMetadata &&
              (metadata.model ||
                metadata.reasoning_effort ||
                metadata.context) && (
                <p
                  className="chat-recorded-metadata"
                  aria-label="Recorded conversation metadata"
                >
                  {[
                    metadata.model,
                    metadata.reasoning_effort,
                    metadata.context
                      ? `${metadata.context.used.toLocaleString()}${metadata.context.window ? ` / ${metadata.context.window.toLocaleString()}` : ''} tokens`
                      : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            {hasOlder && (
              <button
                type="button"
                className="chat-older"
                disabled={isLoadingOlder}
                onClick={() => void fetchOlder()}
              >
                {isLoadingOlder
                  ? 'Loading earlier messages…'
                  : 'Earlier messages'}
              </button>
            )}

            <ChatAbandonedBranches abandoned={abandoned} />
            {retentionLimited && (
              <p className="chat-inline-state" role="status">
                This browser view retains a bounded history window. Earlier
                records remain in the native transcript.
              </p>
            )}
            {turns.map((turn, index) => {
              const last = index === turns.length - 1
              const live = isLiveWorkTurn(
                turn,
                last,
                agentStatus,
                finishedBeforeSend
              )
              const waiting = isWaitingWorkTurn(live, agentStatus)
              return (
                <ChatRenderBoundary
                  key={`${paneId}:${sessionKey}:${turn.id || index}`}
                  onSwitchToStream={onSwitchToStream}
                >
                  <Turn
                    key={`${paneId}:${sessionKey}:${turn.id || `${turn.role}:${turn.ts ?? index}`}`}
                    turn={turn}
                    live={live}
                    waiting={waiting}
                    showThinking={preferences.showThinking}
                    sourcePreview={false}
                    match={match?.rowKey === turn.id ? match : null}
                  />
                </ChatRenderBoundary>
              )
            })}

            <SubmissionReceipts
              records={paneSubmissions}
              actionTarget={actionTarget}
              sessionKey={sessionKey}
              corroborations={corroborations}
              onClear={() => submissions?.clear()}
            />
            {held?.records
              .filter(
                (record) =>
                  record.target.paneId === paneId && !isLiveHeldMessage(record)
              )
              .map((record) => (
                <article
                  className="chat-turn held-message-history"
                  key={record.operationId}
                >
                  <div className="chat-compact-text">
                    <p>{record.text}</p>
                  </div>
                  <p className="chat-inline-state" role="status">
                    {record.restored
                      ? 'Saved Web-held evidence (not live queue)'
                      : record.state === 'held'
                        ? 'Held in Web — send manually'
                        : record.state === 'consumed'
                          ? 'Submitted — native execution not confirmed'
                          : record.state === 'discarded'
                            ? 'Discarded unsent Web-held text — no native cancellation'
                            : record.state === 'uncertain'
                              ? 'Outcome uncertain — inspect Terminal; no retry'
                              : record.state === 'enqueue-unknown'
                                ? 'Enqueue outcome unknown — refresh held evidence; do not enqueue again.'
                                : record.state === 'rejected'
                                  ? 'Enqueue rejected — no retained Web intent.'
                                  : record.state}
                    {record.restored &&
                      ' Restored informational copy — no delivery or discard authority.'}
                  </p>
                  {!sameSubmissionTarget(record.target, actionTarget) && (
                    <p className="chat-inline-state">
                      Captured target/session differs or is unavailable. Send
                      controls are unavailable.
                    </p>
                  )}
                  {record.error && <p role="alert">{record.error}</p>}
                  {!record.restored && (
                    <Button
                      variant="ghost"
                      onClick={() => void held.refresh(record)}
                    >
                      Refresh held evidence (read only)
                    </Button>
                  )}
                  {(record.restored ||
                    [
                      'rejected',
                      'consumed',
                      'discarded',
                      'invalidated',
                      'uncertain'
                    ].includes(record.state)) && (
                    <Button
                      variant="ghost"
                      onClick={() => held.dismiss(record)}
                    >
                      Dismiss saved copy
                    </Button>
                  )}
                  <p className="chat-inline-state">
                    Enqueue operation: {record.operationId}
                  </p>
                  <Button variant="ghost" onClick={onSwitchToStream}>
                    Inspect Terminal
                  </Button>
                </article>
              ))}
            {held?.storageError && (
              <p className="chat-inline-state" role="status">
                {held.storageError}
              </p>
            )}
            {submissions?.storageError && (
              <p className="chat-inline-state" role="status">
                {submissions.storageError}
              </p>
            )}
            {!connected && <p className="chat-inline-state">reconnecting…</p>}

            {error !== null && (
              <div className="chat-empty">
                <p className="chat-inline-state chat-inline-error" role="alert">
                  {error}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button variant="secondary" onClick={() => void refetch()}>
                    <RotateCw aria-hidden="true" /> Retry
                  </Button>
                  <Button variant="ghost" onClick={onSwitchToStream}>
                    Switch to Terminal
                  </Button>
                </div>
              </div>
            )}

            {isLoading && turns.length === 0 && error === null && (
              <p className="chat-inline-state" role="status">
                Loading conversation…
              </p>
            )}

            {!isLoading &&
              turns.length === 0 &&
              paneSubmissions.length === 0 &&
              error === null && (
                <div className="chat-empty">
                  <p>No conversation yet — say something below</p>
                </div>
              )}
          </div>

          {away && (
            <button
              type="button"
              className="chat-new-messages"
              aria-label="Jump to latest"
              title="Jump to latest"
              onClick={scrollToBottom}
            >
              <ArrowDown aria-hidden="true" />
              <span>{newMessages ? 'New messages' : 'Latest'}</span>
            </button>
          )}
        </div>
      </ChatAssetContext.Provider>
    </ChatFiles>
  )
}

export { Turn, ToolRow, SubmissionReceipts }
export default ChatView
