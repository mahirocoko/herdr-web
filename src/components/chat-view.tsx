// MIT License - Copyright (c) 2026 devswha
// Adapted from devswha/herdr-web-ui
import {
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  RotateCw
} from 'lucide-react'
import { useConversation } from '@/hooks/use-conversation.ts'
import { Markdown } from './markdown.tsx'
import {
  ChatTaskResults,
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
  IConversationTurn
} from '@/types/conversation.ts'
import './chat-view.css'
import { ChatFiles } from './chat-file-viewer.tsx'
import { useChatPreferences } from '@/hooks/use-chat-preferences.ts'
import { ChatPreferences, chatPreferenceStyle } from './chat-preferences.tsx'
import { ChatRenderBoundary } from './chat-render-boundary.tsx'
import { dismissKeyboardOn } from '@/utils/chat-keyboard.ts'

export interface IChatViewProps {
  paneId: string | null
  sendRevision?: number
  agentName?: string | null
  agentStatus?: string
  connected?: boolean
  isAgent?: boolean
  onSwitchToStream: () => void
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
    <div className={`work-row${part.error ? ' is-error' : ''}`}>
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

interface ITurnProps {
  turn: IConversationTurn
  live: boolean
  waiting: boolean
  showThinking?: boolean
}

const Turn: FC<ITurnProps> = ({
  turn,
  live,
  waiting,
  showThinking = false
}) => {
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
    const text =
      part.kind === 'notice' || part.kind === 'compact'
        ? part.text
        : (part.kind === 'text' || part.kind === 'thinking') && part.truncated
          ? `${part.kind === 'thinking' ? 'Thinking' : 'Text'} truncated in Chat.`
          : null
    return text === null ? null : (
      <details key={index} className="chat-compact">
        <summary>
          {part.kind === 'compact' ? 'Context compacted' : 'Notice'}
        </summary>
        <div className="chat-compact-text">
          <pre>{text}</pre>
        </div>
      </details>
    )
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
      <article className="chat-turn chat-turn-user">
        {notices}
        <div className="chat-user-row">
          {turn.parts
            .filter((part) => part.kind === 'image')
            .map((part, index) => (
              <NativeImage key={part.nativeKey ?? index} part={part} />
            ))}
          {text.length > 0 && (
            <div className="chat-bubble">
              <Markdown>{text}</Markdown>
            </div>
          )}
          <div className="chat-turn-meta">
            {time !== null && (
              <time dateTime={turn.ts ?? undefined}>{time}</time>
            )}
            {text.length > 0 && <CopyButton text={text} label="Copy message" />}
          </div>
        </div>
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
    <article className="chat-turn chat-turn-agent">
      {notices}
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
      <SkillActivity parts={turn.parts} />
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
    <div className="chat-skills" aria-label="Recorded skill activity">
      {[...recorded.entries()].map(([key, skill]) => (
        <details key={key} className="chat-skill">
          <summary>
            {skill.name} ·{' '}
            {skill.status === 'loaded'
              ? 'instructions loaded'
              : skill.status === 'failed'
                ? 'failed'
                : 'invoked'}
          </summary>
          <p>
            {skill.evidence === 'instructions'
              ? 'Native record contains skill instructions.'
              : 'Native record contains a skill invocation.'}{' '}
            This is activity evidence, not proof the workflow completed.
          </p>
          {skill.path && <code>{skill.path}</code>}
        </details>
      ))}
    </div>
  )
}

const ChatView: FC<IChatViewProps> = ({
  paneId,
  sendRevision = 0,
  agentStatus,
  connected = true,
  isAgent = true,
  onSwitchToStream
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const prependRef = useRef<{
    height: number
    top: number
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
  const { preferences, update, storageError } = useChatPreferences()

  const {
    turns,
    sessionKey,
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

  // Maintain scroll stickiness
  if (sendRevision && sentOver.current?.revision !== sendRevision)
    sentOver.current = {
      revision: sendRevision,
      page: turns,
      turn: turns.at(-1)?.role === 'assistant' ? turns.at(-1)! : null
    }
  const finishedBeforeSend =
    sentOver.current?.page === turns ? sentOver.current.turn : null
  const fetchOlder = useCallback(() => {
    const node = scrollerRef.current
    if (!node || !hasOlder || isLoading || isLoadingOlder || prependRef.current)
      return
    prependRef.current = {
      height: node.scrollHeight,
      top: node.scrollTop,
      first: turns[0]?.id
    }
    void loadOlder()
  }, [hasOlder, isLoading, isLoadingOlder, loadOlder, turns])
  const onScroll = useCallback(() => {
    const node = scrollerRef.current
    if (node === null) return
    const isAtBottom =
      node.scrollTop + node.clientHeight >= node.scrollHeight - 48
    stickToBottomRef.current = isAtBottom
    setAway(!isAtBottom)
    if (isAtBottom) setNewMessages(false)
    if (node.scrollTop < 80) fetchOlder()
  }, [fetchOlder])

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
    setAway(false)
    setNewMessages(false)
  }, [])

  useLayoutEffect(() => {
    stickToBottomRef.current = true
    prependRef.current = null
    setAway(false)
    setNewMessages(false)
    latestRef.current = ''
  }, [paneId, sessionKey])

  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node) return
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
      node.scrollTop = anchor.top + node.scrollHeight - anchor.height
      prependRef.current = null
    } else if (stickToBottomRef.current) node.scrollTop = node.scrollHeight
    if (!isLoadingOlder) prependRef.current = null
  }, [turns, isLoadingOlder])

  useLayoutEffect(() => {
    const node = scrollerRef.current
    const content = node?.querySelector('.chat-transcript')
    if (!node || !content || typeof ResizeObserver === 'undefined') return
    let lane = ''
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
        const style = getComputedStyle(content)
        const next = `${entry.contentRect.width}:${style.fontSize}:${style.fontFamily}:${style.getPropertyValue('--chat-fs-body')}`
        if (next !== lane) {
          lane = next
          follow()
        }
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
    return node ? dismissKeyboardOn(node) : undefined
  }, [paneId, sessionKey])

  useEffect(() => {
    const node = scrollerRef.current
    if (
      node &&
      node.scrollHeight <= node.clientHeight &&
      hasOlder &&
      !isLoading &&
      !isLoadingOlder
    )
      fetchOlder()
  }, [fetchOlder, hasOlder, isLoading, isLoadingOlder, turns])

  if (!isAgent || !paneId) {
    return (
      <div className="chat-view" role="region" aria-label="Agent Conversation">
        <div className="chat-empty">
          <p>
            Chat is available for supported agent panes. This shell pane does
            not have an agent conversation.
          </p>
          <Button variant="secondary" onClick={onSwitchToStream}>
            Switch to Terminal
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ChatFiles key={`${paneId}:${sessionKey}`} paneId={paneId}>
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
            <ChatPreferences
              preferences={preferences}
              onChange={update}
              storageError={storageError}
            />
            {(metadata.model ||
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
                onClick={fetchOlder}
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
                  />
                </ChatRenderBoundary>
              )
            })}

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

            {!isLoading && turns.length === 0 && error === null && (
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

export { Turn, ToolRow }
export default ChatView
