// MIT License - Copyright (c) 2026 devswha
// Native completion/branch schema adapted from transcript-records.ts / pi-tree.ts.
import type {
  IOmoTaskResult,
  IAbandonedBranches
} from '@/types/conversation.ts'
import { Markdown } from './markdown.tsx'

export const ChatTaskResults = ({ tasks }: { tasks: IOmoTaskResult[] }) => (
  <section
    aria-label="Recorded background task results"
    className="chat-task-results"
  >
    {tasks.map((task) => (
      <details key={task.id} className="chat-compact">
        <summary>
          {task.title} · {task.status}
        </summary>
        <div className="chat-compact-text">
          <dl>
            <dt>Task</dt>
            <dd>
              <code>{task.id}</code>
            </dd>
            {task.agent && (
              <>
                <dt>Agent</dt>
                <dd>{task.agent}</dd>
              </>
            )}
            {task.model && (
              <>
                <dt>Model</dt>
                <dd>{task.model}</dd>
              </>
            )}
            {task.duration_ms !== null && (
              <>
                <dt>Duration</dt>
                <dd>{(task.duration_ms / 1000).toLocaleString()} s</dd>
              </>
            )}
            {task.turns !== null && (
              <>
                <dt>Turns</dt>
                <dd>{task.turns.toLocaleString()}</dd>
              </>
            )}
            {task.tool_calls !== null && (
              <>
                <dt>Tool calls</dt>
                <dd>{task.tool_calls.toLocaleString()}</dd>
              </>
            )}
            {task.tokens !== null && (
              <>
                <dt>Tokens</dt>
                <dd>{task.tokens.toLocaleString()}</dd>
              </>
            )}
          </dl>
          {task.result && <Markdown>{task.result}</Markdown>}
          {task.result_cut && <p>Recorded task result truncated in Chat.</p>}
        </div>
      </details>
    ))}
  </section>
)
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
