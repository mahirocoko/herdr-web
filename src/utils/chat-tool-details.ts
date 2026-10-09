// MIT License - Copyright (c) 2026 devswha
// Adapted from herdr-web-ui 5979118: lib/diff, checklist, todos, omoTasks and shared/patch.
export interface IDiffLine {
  kind: 'same' | 'del' | 'add'
  text: string
}
export const lineDiff = (before: string, after: string): IDiffLine[] => {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  if (a.length * b.length > 250_000)
    return [
      ...a.map((text) => ({ kind: 'del' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text }))
    ]
  const width = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!)
  const lines: IDiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)
      lines.push({ kind: 'del', text: a[i++]! })
    else lines.push({ kind: 'add', text: b[j++]! })
  }
  while (i < a.length) lines.push({ kind: 'del', text: a[i++]! })
  while (j < b.length) lines.push({ kind: 'add', text: b[j++]! })
  return lines
}
export const patchText = (input: string): string | null => {
  const trimmed = input.trimStart()
  if (trimmed.startsWith('*** Begin Patch')) return trimmed
  const call =
    /tools\.apply_patch\(\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/s.exec(input)
  if (call === null) return null
  const literal = call[1]!
  let text: string
  if (literal.startsWith('`')) text = literal.slice(1, -1).replace(/\\`/g, '`')
  else {
    try {
      text = JSON.parse(literal) as string
    } catch {
      return null
    }
  }
  return text.trimStart().startsWith('*** Begin Patch')
    ? text.trimStart()
    : null
}
export interface IChecklistRow {
  label: string
  done: boolean
  active?: boolean
  heading?: boolean
}
export const phaseRows = (list: unknown[]): IChecklistRow[] => {
  const rows: IChecklistRow[] = []
  for (const phase of list) {
    if (typeof phase !== 'object' || phase === null) continue
    if ('phase' in phase && typeof phase.phase === 'string')
      rows.push({ label: phase.phase, done: false, heading: true })
    if ('items' in phase && Array.isArray(phase.items))
      for (const item of phase.items)
        if (typeof item === 'string') rows.push({ label: item, done: false })
  }
  return rows
}
export const todoRows = (todos: unknown[]): IChecklistRow[] => {
  const rows: IChecklistRow[] = []
  for (const todo of todos) {
    if (
      typeof todo !== 'object' ||
      todo === null ||
      !('content' in todo) ||
      typeof todo.content !== 'string'
    )
      continue
    const status = 'status' in todo ? todo.status : undefined
    rows.push({
      label: todo.content,
      done: status === 'completed',
      active: status === 'in_progress'
    })
  }
  return rows
}
export const planRows = (plan: unknown[]): IChecklistRow[] => {
  const rows: IChecklistRow[] = []
  for (const entry of plan) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('step' in entry) ||
      typeof entry.step !== 'string'
    )
      continue
    const status = 'status' in entry ? entry.status : undefined
    rows.push({
      label: entry.step,
      done: status === 'completed',
      active: status === 'in_progress'
    })
  }
  return rows
}
export const taskRows = (tasks: unknown[]): IChecklistRow[] => {
  const rows: IChecklistRow[] = []
  for (const [index, task] of tasks.entries()) {
    if (typeof task === 'string') {
      rows.push({ label: task, done: false })
      continue
    }
    if (typeof task !== 'object' || task === null) continue
    const name =
      'name' in task && typeof task.name === 'string' ? task.name : ''
    rows.push({
      label: name.length > 0 ? name : `task ${index + 1}`,
      done: false
    })
  }
  return rows
}
export interface ITaskCallItem {
  title: string
  agent: string | null
  prompt: string
}
export const taskCallItems = (
  input: Record<string, unknown>
): ITaskCallItem[] | null => {
  const str = (
    row: Record<string, unknown>,
    ...keys: string[]
  ): string | null => {
    for (const key of keys) {
      const value = row[key]
      if (typeof value === 'string' && value.trim().length > 0)
        return value.trim()
    }
    return null
  }
  const agentOf = (row: Record<string, unknown>): string | null =>
    str(row, 'subagent_type', 'agent', 'category')
  const shared = agentOf(input)
  const rows = Array.isArray(input['tasks']) ? input['tasks'] : [input]
  const items = rows.flatMap((value, index): ITaskCallItem[] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return []
    const row = value as Record<string, unknown>
    const prompt = str(row, 'prompt', 'assignment') ?? ''
    const title = str(row, 'task_summary', 'description', 'name', 'id')
    if (title === null && prompt.length === 0) return []
    return [
      { title: title ?? `#${index + 1}`, agent: agentOf(row) ?? shared, prompt }
    ]
  })
  return items.length > 0 ? items : null
}
export type TodoStatus =
  'pending' | 'in_progress' | 'completed' | 'blocked' | 'dropped'
export interface ITodoItem {
  label: string
  phase: string | null
  status: TodoStatus
  note?: string
}
export const isTodoTool = (name: string): boolean =>
  name === 'TodoWrite' ||
  name === 'update_plan' ||
  name === 'todo' ||
  name === 'todo_write' ||
  /^mcp__.+__todo$/.test(name)
export const parseTodoAnswer = (output: string): ITodoItem[] | null => {
  if (output.endsWith('… trimmed')) return null
  if (
    /^(?:Todo list is empty\.|Todo list cleared\.)/m.test(output) &&
    !/^ {4}\S/m.test(output)
  )
    return []
  const items: ITodoItem[] = []
  let phase: string | null = null
  for (const line of output.split('\n')) {
    const heading = /^ {2}(\S.*):$/.exec(line)
    if (heading) {
      phase = heading[1]!
      continue
    }
    const box = /^ {4}- \[(X| )\] (.+)$/.exec(line)
    if (box) {
      let label = box[2]!
      let status: TodoStatus = box[1] === 'X' ? 'completed' : 'pending'
      let note: string | undefined
      const suffix = / \((in progress|dropped|blocked)(?:: (.*))?\)$/.exec(
        label
      )
      if (suffix) {
        label = label.slice(0, suffix.index)
        status =
          suffix[1] === 'in progress'
            ? 'in_progress'
            : suffix[1] === 'dropped'
              ? 'dropped'
              : 'blocked'
        note = suffix[2]
      }
      items.push(
        note === undefined
          ? { label, phase, status }
          : { label, phase, status, note }
      )
      continue
    }
    const glyph = /^ {4}([✓→○✗⊘!]) (.+)$/.exec(line)
    if (glyph) {
      const mark = glyph[1]
      items.push({
        label: glyph[2]!,
        phase,
        status:
          mark === '✓'
            ? 'completed'
            : mark === '→'
              ? 'in_progress'
              : mark === '○'
                ? 'pending'
                : mark === '!'
                  ? 'blocked'
                  : 'dropped'
      })
    }
  }
  if (items.length === 0) return null
  const overall = /^Overall: \d+\/(\d+) done/m.exec(output)
  if (overall && Number(overall[1]) > items.length) return null
  return items
}
