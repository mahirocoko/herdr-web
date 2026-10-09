// MIT License - Copyright (c) 2026 devswha
// Descriptor-backed adaptation of pi-tree.ts. Finite index; no path reopen/cache.
import {
  isFamilyClear,
  familyMessage,
  familyTaskTitles
} from './pi-family-parser.ts'
import type { IConversationMetadata } from '../../src/types/conversation.ts'

const foldMetadata = (
  row: any,
  metadata: IConversationMetadata,
  pi: boolean
) => {
  if (isFamilyClear(row)) {
    metadata.model = null
    metadata.reasoning_effort = null
    delete metadata.context
  }
  if (row.type === 'model_change' && typeof row.modelId === 'string')
    metadata.model = row.modelId
  if (
    row.type === 'thinking_level_change' &&
    typeof row.thinkingLevel === 'string'
  )
    metadata.reasoning_effort = row.thinkingLevel
  const message = familyMessage(row)
  if (message?.role !== 'assistant') return
  if (typeof message.model === 'string') metadata.model = message.model
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  const usage = message.usage ?? {}
  const used = pi
    ? message.stopReason === 'error' || message.stopReason === 'aborted'
      ? 0
      : count(usage.totalTokens) ||
        count(usage.input) +
          count(usage.output) +
          count(usage.cacheRead) +
          count(usage.cacheWrite)
    : count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite)
  if (used > 0) metadata.context = { used, window: null }
}
export const projectFamilyHistory = (
  size: number,
  read: (start: number, length: number) => Buffer,
  tree: boolean
) => {
  if (size > 512 * 1024 * 1024)
    throw new Error('Native family history exceeds finite verification limit')
  const nodes = new Map<
    string,
    {
      id: string
      parent: string | null
      start: number
      end: number
      settings: any
    }
  >()
  let pending = Buffer.alloc(0),
    position = 0,
    leaf: string | null = null,
    floor = 0
  const metadata: IConversationMetadata = {
    model: null,
    reasoning_effort: null
  }
  const taskTitles = new Map<string, string>()
  const apply = (bytes: Buffer, start: number, end: number) => {
    let row: any
    try {
      row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      return
    }
    if (!tree) {
      if (isFamilyClear(row)) floor = end
      foldMetadata(row, metadata, false)
      for (const [id, title] of familyTaskTitles(row)) taskTitles.set(id, title)
      if (taskTitles.size > 100000)
        throw new Error('Native task title index exceeds finite limit')
    }
    if (
      tree &&
      row.type !== 'session' &&
      typeof row.id === 'string' &&
      row.id
    ) {
      if (nodes.size >= 100000)
        throw new Error('Native branch index exceeds finite limit')
      nodes.delete(row.id)
      nodes.set(row.id, {
        id: row.id,
        parent: typeof row.parentId === 'string' ? row.parentId : null,
        start,
        end,
        settings: {
          type: row.type,
          taskTitles: familyTaskTitles(row),
          summary:
            row.type === 'branch_summary' && typeof row.summary === 'string'
              ? row.summary.slice(0, 16000)
              : null,
          customType: row.customType,
          modelId: row.modelId,
          thinkingLevel: row.thinkingLevel,
          message:
            row.type === 'message'
              ? {
                  role: row.message?.role,
                  model: row.message?.model,
                  stopReason: row.message?.stopReason,
                  usage: {
                    input: row.message?.usage?.input,
                    output: row.message?.usage?.output,
                    cacheRead: row.message?.usage?.cacheRead,
                    cacheWrite: row.message?.usage?.cacheWrite,
                    totalTokens: row.message?.usage?.totalTokens
                  }
                }
              : undefined
        }
      })
      leaf = row.id
    }
  }
  for (let offset = 0; offset < size; offset += 256 * 1024) {
    pending = Buffer.concat([
      pending,
      read(offset, Math.min(256 * 1024, size - offset))
    ])
    if (pending.length > 64 * 1024 * 1024 + 256 * 1024)
      throw new Error('Native history row exceeds finite limit')
    let first = 0
    for (
      let newline = pending.indexOf(10);
      newline >= 0;
      newline = pending.indexOf(10, first)
    ) {
      apply(
        pending.subarray(first, newline),
        position + first,
        position + newline + 1
      )
      first = newline + 1
    }
    pending = pending.subarray(first)
    position += first
  }
  if (!tree && pending.length) apply(pending, position, size)
  if (!tree)
    return { segments: null, floor, metadata, taskTitles, abandoned: undefined }
  const chain: { start: number; end: number; settings: any }[] = [],
    seen = new Set<string>()
  let id: string | null = leaf,
    total = 0
  while (id !== null) {
    if (seen.has(id)) throw new Error('Native branch cycle')
    seen.add(id)
    const node = nodes.get(id)
    if (!node) throw new Error('Native branch parent unavailable')
    chain.push({ start: node.start, end: node.end, settings: node.settings })
    total += node.end - node.start
    if (total > 64 * 1024 * 1024)
      throw new Error('Native branch exceeds finite limit')
    id = node.parent
  }
  const segments: { start: number; end: number }[] = []
  let virtual = 0
  for (const item of chain.reverse()) {
    virtual += item.end - item.start
    if (isFamilyClear(item.settings)) floor = virtual
    foldMetadata(item.settings, metadata, true)
    for (const [id, title] of item.settings.taskTitles)
      taskTitles.set(id, title)
    const previous = segments.at(-1)
    if (previous?.end === item.start) previous.end = item.end
    else segments.push({ start: item.start, end: item.end })
  }
  const heads = new Set<string>(),
    parents = new Set<string>()
  for (const node of nodes.values())
    if (node.parent !== null && !seen.has(node.id)) parents.add(node.parent)
  for (const node of nodes.values())
    if (
      !seen.has(node.id) &&
      ((node.parent !== null && seen.has(node.parent)) ||
        (node.parent === null && parents.has(node.id)))
    )
      heads.add(node.id)
  const owned = new Set<string>()
  let count = 0,
    summary: string | null = null
  for (const node of nodes.values()) {
    if (heads.has(node.id) || (node.parent !== null && owned.has(node.parent)))
      owned.add(node.id)
    if (
      owned.has(node.id) &&
      node.settings.type === 'message' &&
      ['user', 'assistant'].includes(node.settings.message?.role)
    )
      count++
    if (
      seen.has(node.id) &&
      node.settings.type === 'branch_summary' &&
      node.settings.summary
    )
      summary = node.settings.summary
  }
  return {
    segments,
    floor,
    metadata,
    taskTitles,
    abandoned: { count, branches: heads.size, summary }
  }
}
