// MIT License - Copyright (c) 2026 devswha
// Adapted from herdr-web-ui 5979118 ChatView.tsx rich tool owners.
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleSlash
} from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import Button from './ui/button.tsx'
import type { ToolPart } from './work-blocks.ts'
import {
  isTodoTool,
  lineDiff,
  parseTodoAnswer,
  patchText,
  phaseRows,
  planRows,
  taskCallItems,
  taskRows,
  todoRows,
  type IChecklistRow,
  type ITodoItem,
  type TodoStatus
} from '@/utils/chat-tool-details.ts'

// The contextual file viewer supplies this callback; absent it, paths remain text.
const OpenChatToolFileContext = createContext<((path: string) => void) | null>(
  null
)
interface IToolFileProps {
  path: string
  suffix?: string
}
const ToolFile = ({ path, suffix }: IToolFileProps) => {
  const open = useContext(OpenChatToolFileContext)
  return (
    <p className="chat-tool-file">
      {open === null ? (
        path
      ) : (
        <Button
          variant="ghost"
          className="chat-tool-file-link"
          title={`Open ${path}`}
          onClick={() => open(path)}
        >
          {path}
        </Button>
      )}
      {suffix}
    </p>
  )
}
const ChecklistView = ({ rows }: { rows: IChecklistRow[] }) => (
  <ul className="chat-checklist">
    {rows.map((row, index) => (
      <li
        key={index}
        className={
          row.heading
            ? 'chat-checklist-phase'
            : row.done
              ? 'is-done'
              : row.active
                ? 'is-active'
                : undefined
        }
      >
        {!row.heading && (
          <span className="chat-checklist-box" aria-hidden="true">
            {row.done ? '✓' : '•'}
          </span>
        )}
        {row.label}
        {!row.heading && (
          <span className="sr-only">
            {' '}
            ({row.done ? 'done' : row.active ? 'in progress' : 'to do'})
          </span>
        )}
      </li>
    ))}
  </ul>
)
const TODO_ICONS = {
  completed: CircleCheck,
  in_progress: CircleDot,
  pending: Circle,
  blocked: CircleAlert,
  dropped: CircleSlash
}
const TODO_LABELS: Record<TodoStatus, string> = {
  completed: 'done',
  in_progress: 'in progress',
  pending: 'to do',
  blocked: 'blocked',
  dropped: 'dropped'
}
const TodoList = ({ items }: { items: ITodoItem[] }) => {
  const groups: { phase: string | null; items: ITodoItem[] }[] = []
  for (const item of items) {
    const group = groups[groups.length - 1]
    if (group && group.phase === item.phase) group.items.push(item)
    else groups.push({ phase: item.phase, items: [item] })
  }
  return (
    <div className="todo-list">
      {groups.map((group, index) => (
        <div key={index} className="todo-group">
          {group.phase !== null && <p className="todo-phase">{group.phase}</p>}
          <ul>
            {group.items.map((item, row) => {
              const Icon = TODO_ICONS[item.status]
              return (
                <li key={row} className={`todo-item is-${item.status}`}>
                  <Icon className="todo-icon" aria-hidden="true" />
                  <span className="todo-label">
                    {item.label}
                    <span className="sr-only">
                      {' '}
                      ({TODO_LABELS[item.status]})
                    </span>
                    {item.note && (
                      <span className="todo-note">{item.note}</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
const EditDiff = ({ before, after }: { before: string; after: string }) => (
  <pre className="chat-diff">
    {lineDiff(before, after).map((line, index) => (
      <span
        key={index}
        className={
          line.kind === 'add'
            ? 'chat-diff-add'
            : line.kind === 'del'
              ? 'chat-diff-del'
              : undefined
        }
      >
        {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
        {line.text}
        {'\n'}
      </span>
    ))}
  </pre>
)
const PatchView = ({ patch }: { patch: string }) => {
  const sections: { file: string | null; action: string; lines: string[] }[] =
    []
  for (const line of patch.split('\n')) {
    const file = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line)
    if (file !== null) {
      sections.push({ file: file[2]!.trim(), action: file[1]!, lines: [] })
      continue
    }
    if (/^\*\*\* (Begin|End) Patch/.test(line)) continue
    if (sections.length === 0)
      sections.push({ file: null, action: '', lines: [] })
    sections.at(-1)!.lines.push(line)
  }
  return (
    <div className="chat-tool-io">
      {sections.map((section, index) => (
        <div key={index}>
          {section.file !== null && (
            <ToolFile
              path={section.file}
              suffix={
                section.action === 'Update'
                  ? undefined
                  : ` (${section.action.toLowerCase()})`
              }
            />
          )}
          <pre className="chat-diff">
            {section.lines.map((line, at) => (
              <span
                key={at}
                className={
                  line.startsWith('@@') || line.startsWith('*** Move to:')
                    ? 'chat-diff-head'
                    : line.startsWith('+')
                      ? 'chat-diff-add'
                      : line.startsWith('-')
                        ? 'chat-diff-del'
                        : undefined
                }
              >
                {line}
                {'\n'}
              </span>
            ))}
          </pre>
        </div>
      ))}
    </div>
  )
}
const richInput = (part: ToolPart): ReactNode => {
  // Native clipping/error flags take precedence over an apparent complete todo answer.
  const after =
    isTodoTool(part.name) && !part.truncated && !part.pending && !part.error
      ? parseTodoAnswer(part.output)
      : null
  if (after !== null && after.length > 0) return <TodoList items={after} />
  const patch = patchText(part.input)
  if (patch !== null) return <PatchView patch={patch} />
  let parsed: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(part.input)
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return null
    parsed = value as Record<string, unknown>
  } catch {
    return null
  }
  const spawned = part.name === 'task' ? taskCallItems(parsed) : null
  if (spawned !== null)
    return (
      <ol className="chat-task-calls">
        {spawned.map((item, index) => (
          <li key={index} className="chat-task-call">
            <p className="chat-task-call-head">
              <span className="chat-task-call-title">{item.title}</span>
              {item.agent !== null && (
                <span className="chat-task-call-agent">{item.agent}</span>
              )}
            </p>
            {item.prompt.length > 0 && (
              <pre className="chat-tool-io chat-task-call-prompt">
                {item.prompt}
              </pre>
            )}
          </li>
        ))}
      </ol>
    )
  const str = (key: string): string | undefined =>
    typeof parsed[key] === 'string' ? parsed[key] : undefined
  const command = str('command') ?? str('cmd')
  if (command !== undefined)
    return (
      <div className="chat-tool-io">
        <pre>{command}</pre>
        {str('cwd') !== undefined && (
          <p className="chat-tool-io-meta">cwd: {str('cwd')}</p>
        )}
        {str('description') !== undefined && (
          <p className="chat-tool-io-meta">{str('description')}</p>
        )}
      </div>
    )
  const oldString = str('old_string')
  const newString = str('new_string')
  if (oldString !== undefined || newString !== undefined)
    return (
      <div className="chat-tool-io">
        {str('file_path') !== undefined && (
          <ToolFile path={str('file_path')!} />
        )}
        <EditDiff before={oldString ?? ''} after={newString ?? ''} />
      </div>
    )
  if (
    Array.isArray(parsed['edits']) &&
    parsed['edits'].length > 0 &&
    parsed['edits'].every(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (typeof item.old_string === 'string' ||
          typeof item.new_string === 'string')
    )
  ) {
    const edits = parsed['edits'] as Record<string, unknown>[]
    return (
      <div className="chat-tool-io">
        {str('file_path') !== undefined && (
          <ToolFile path={str('file_path')!} />
        )}
        {edits.map((item, index) => (
          <EditDiff
            key={index}
            before={
              typeof item['old_string'] === 'string' ? item['old_string'] : ''
            }
            after={
              typeof item['new_string'] === 'string' ? item['new_string'] : ''
            }
          />
        ))}
      </div>
    )
  }
  const script = str('input')
  if (script !== undefined)
    return (
      <pre className="chat-tool-io chat-diff">
        {script.split('\n').map((line, index) => (
          <span
            key={index}
            className={
              line.startsWith('+-') ||
              line.startsWith('-') ||
              /^(CUT|REM)\b/.test(line)
                ? 'chat-diff-del'
                : line.startsWith('+')
                  ? 'chat-diff-add'
                  : /^(PUT|MV)/.test(line) || line.startsWith('[')
                    ? 'chat-diff-head'
                    : undefined
            }
          >
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
    )
  const content = str('content')
  const path = str('file_path') ?? str('path')
  if (content !== undefined)
    return (
      <div className="chat-tool-io">
        {path !== undefined && <ToolFile path={path} />}
        <pre>{content}</pre>
      </div>
    )
  if (path !== undefined)
    return (
      <div className="chat-tool-io">
        <ToolFile
          path={path}
          suffix={
            str('pattern') !== undefined ? ` — /${str('pattern')}/` : undefined
          }
        />
      </div>
    )
  for (const [key, toRows] of [
    ['list', phaseRows],
    ['todos', todoRows],
    ['plan', planRows],
    ['tasks', taskRows]
  ] as const) {
    const value = parsed[key]
    if (Array.isArray(value)) {
      const rows = toRows(value)
      if (rows.length > 0) return <ChecklistView rows={rows} />
    }
  }
  return null
}
interface IChatToolContentProps {
  part: ToolPart
}
const ChatToolContent = ({ part }: IChatToolContentProps) => {
  const rich = richInput(part)
  return (
    <>
      {rich}
      {part.input &&
        (rich === null ? (
          <pre className="chat-tool-io">{part.input}</pre>
        ) : (
          <details className="chat-tool-raw">
            <summary>Raw input</summary>
            <pre className="chat-tool-io">{part.input}</pre>
          </details>
        ))}
      {part.output && (
        <section className="chat-tool-output">
          <h4>{part.error ? 'Error' : 'Output'}</h4>
          <pre className="chat-tool-io">{part.output}</pre>
        </section>
      )}
    </>
  )
}
export { ChatToolContent, OpenChatToolFileContext }
