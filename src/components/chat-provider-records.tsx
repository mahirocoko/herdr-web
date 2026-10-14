// MIT License - Copyright (c) 2026 devswha
// Native completion/branch schema adapted from transcript-records.ts / pi-tree.ts.
import { useState } from 'react'
import {
  ChevronDown,
  CircleCheck,
  CircleSlash,
  CircleX,
  Layers
} from 'lucide-react'
import type {
  ConversationPart,
  IOmoTaskResult,
  IAbandonedBranches
} from '@/types/conversation.ts'
import { Markdown } from './markdown.tsx'

// Row anatomy from dc2f11de ChatView.TaskResultRow. Only native ended states
// are available locally; no live provider task status or actions are inferred.
const TaskResultRow = ({ task }: { task: IOmoTaskResult }) => {
  const [opened, setOpened] = useState(false)
  const Icon =
    task.status === 'completed'
      ? CircleCheck
      : task.status === 'failed'
        ? CircleX
        : CircleSlash
  const meta = [
    task.agent,
    task.model,
    task.duration_ms == null
      ? null
      : `${(task.duration_ms / 1000).toLocaleString()} s`,
    task.turns == null
      ? null
      : `${task.turns.toLocaleString()} ${task.turns === 1 ? 'turn' : 'turns'}`,
    task.tool_calls == null
      ? null
      : `${task.tool_calls.toLocaleString()} ${task.tool_calls === 1 ? 'tool call' : 'tool calls'}`,
    task.tokens == null ? null : `${task.tokens.toLocaleString()} tokens`
  ]
    .filter((value) => value != null)
    .join(' · ')
  return (
    <details
      className={`chat-task-result is-${task.status}`}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true)
      }}
    >
      <summary>
        <Icon className="chat-task-result-icon" aria-hidden="true" />
        <span className="chat-task-result-main">
          <span className="chat-task-result-title">{task.title}</span>
          {meta && <span className="chat-task-result-meta">{meta}</span>}
        </span>
        <span className="chat-task-result-status">
          {task.status === 'completed' ? 'done' : task.status}
        </span>
        <ChevronDown className="chat-skill-caret" aria-hidden="true" />
      </summary>
      {opened && (
        <div className="chat-task-result-body">
          <p className="chat-task-result-note">
            Task <code>{task.id}</code>
          </p>
          {task.result ? (
            <Markdown>{task.result}</Markdown>
          ) : (
            <p className="chat-task-result-note">The task reported no result</p>
          )}
          {task.result_cut && (
            <p className="chat-task-result-note">
              Recorded task result truncated in Chat.
            </p>
          )}
        </div>
      )}
    </details>
  )
}

export const ChatTaskResults = ({ tasks }: { tasks: IOmoTaskResult[] }) => {
  if (!tasks.length) return null
  const heading =
    tasks.length === 1
      ? 'Background task ended'
      : `${tasks.length} background tasks ended`
  return (
    <section aria-label={heading} className="chat-task-results">
      <p className="chat-task-results-head">
        <Layers aria-hidden="true" />
        <span>{heading}</span>
      </p>
      {tasks.map((task) => (
        <TaskResultRow key={task.id} task={task} />
      ))}
    </section>
  )
}

export const ChatRecordNotice = ({
  part
}: {
  part: Extract<ConversationPart, { kind: 'notice' | 'compact' }>
}) => {
  // Undefined source locally includes unpaired output, not necessarily an async
  // result. Never borrow upstream's async/peer labels without that provenance.
  const first = part.text
    .split('\n')
    .find((line) => line.trim())
    ?.trim()
  const label =
    part.kind === 'compact'
      ? 'Conversation compacted'
      : part.source === 'local-command'
        ? 'Local command'
        : first || 'Recorded notice'
  return (
    <details className="chat-compact chat-record-notice">
      <summary>
        <span className="chat-notice-label">{label}</span>
      </summary>
      <pre className="chat-compact-text chat-notice-text">{part.text}</pre>
      {part.truncated && (
        <p className="chat-task-result-note">
          Recorded detail truncated in Chat.
        </p>
      )}
    </details>
  )
}
export const ChatAbandonedBranches = ({
  abandoned
}: {
  abandoned?: IAbandonedBranches
}) => {
  if (!abandoned || abandoned.branches === 0) return null
  return (
    <details className="chat-compact">
      <summary>
        {abandoned.count} {abandoned.count === 1 ? 'turn' : 'turns'} left on{' '}
        {abandoned.branches}{' '}
        {abandoned.branches === 1 ? 'other branch' : 'other branches'}
      </summary>
      <div className="chat-compact-text">
        <p>
          Chat shows the branch ending at the latest complete native entry.
          Other branches remain in the native session file.
        </p>
        {abandoned.summary && <Markdown>{abandoned.summary}</Markdown>}
      </div>
    </details>
  )
}
