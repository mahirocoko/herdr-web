import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ITab, IWorkspace } from '../types.ts'
import { getPushTabPolicyPath } from './config.ts'
import { resolveWorkspaceOwnerTabs, sanitizeWorkspaceLabel } from './transition-detector.ts'
import type {
  ILiveTabPolicy,
  ITabPolicyOverrideRecord,
  ITabPolicyStoreFile,
  ITabTopologyFingerprint
} from './types.ts'

const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/

export const sanitizeStoreLabel = (raw?: string | null, maxLength = 64): string => {
  return sanitizeWorkspaceLabel(raw, maxLength) || ''
}

export const computeTabFingerprint = (
  workspace: { number: number; label?: string | null },
  tab: { number: number; label?: string | null }
): ITabTopologyFingerprint => {
  return {
    workspaceNumber: workspace.number,
    workspaceLabel: sanitizeStoreLabel(workspace.label),
    tabNumber: tab.number,
    tabLabel: sanitizeStoreLabel(tab.label)
  }
}

export const matchesFingerprint = (
  stored: ITabTopologyFingerprint,
  current: ITabTopologyFingerprint
): boolean => {
  return (
    stored.workspaceNumber === current.workspaceNumber &&
    stored.workspaceLabel === current.workspaceLabel &&
    stored.tabNumber === current.tabNumber &&
    stored.tabLabel === current.tabLabel
  )
}

export const validateOverrideRecord = (record: unknown): record is ITabPolicyOverrideRecord => {
  if (!record || typeof record !== 'object') return false
  const r = record as Record<string, unknown>

  if (
    typeof r.workspaceId !== 'string' ||
    r.workspaceId.trim().length === 0 ||
    r.workspaceId.length > 128 ||
    CONTROL_CHAR_REGEX.test(r.workspaceId)
  ) {
    return false
  }

  if (
    typeof r.tabId !== 'string' ||
    r.tabId.trim().length === 0 ||
    r.tabId.length > 128 ||
    CONTROL_CHAR_REGEX.test(r.tabId)
  ) {
    return false
  }

  if (typeof r.enabled !== 'boolean') {
    return false
  }

  if (!r.fingerprint || typeof r.fingerprint !== 'object') {
    return false
  }

  const fp = r.fingerprint as Record<string, unknown>
  if (typeof fp.workspaceNumber !== 'number' || !Number.isFinite(fp.workspaceNumber)) {
    return false
  }
  if (
    typeof fp.workspaceLabel !== 'string' ||
    fp.workspaceLabel.length > 128 ||
    CONTROL_CHAR_REGEX.test(fp.workspaceLabel)
  ) {
    return false
  }
  if (typeof fp.tabNumber !== 'number' || !Number.isFinite(fp.tabNumber)) {
    return false
  }
  if (
    typeof fp.tabLabel !== 'string' ||
    fp.tabLabel.length > 128 ||
    CONTROL_CHAR_REGEX.test(fp.tabLabel)
  ) {
    return false
  }

  if (r.updatedAt !== undefined) {
    if (typeof r.updatedAt !== 'number' || !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0) {
      return false
    }
  }

  return true
}

export const resolveEffectiveTabPolicy = (
  workspaces: IWorkspace[] = [],
  tabs: ITab[] = [],
  overrides: ITabPolicyOverrideRecord[] = []
): ILiveTabPolicy[] => {
  const workspaceMap = new Map<string, IWorkspace>()
  for (const ws of workspaces) {
    if (ws && typeof ws.workspace_id === 'string') {
      const id = ws.workspace_id.trim()
      if (id) {
        workspaceMap.set(id, ws)
      }
    }
  }

  const ownerTabMap = resolveWorkspaceOwnerTabs(tabs)

  // Map overrides by workspaceId:tabId
  const overrideMap = new Map<string, ITabPolicyOverrideRecord>()
  for (const ov of overrides) {
    overrideMap.set(`${ov.workspaceId}:${ov.tabId}`, ov)
  }

  const tabIdCounts = new Map<string, number>()
  for (const tab of tabs) {
    if (!tab || typeof tab.tab_id !== 'string') continue
    const tabId = tab.tab_id.trim()
    if (tabId) tabIdCounts.set(tabId, (tabIdCounts.get(tabId) || 0) + 1)
  }

  const results: ILiveTabPolicy[] = []

  for (const tab of tabs) {
    if (!tab || typeof tab.tab_id !== 'string' || typeof tab.workspace_id !== 'string') continue
    const tabId = tab.tab_id.trim()
    const wsId = tab.workspace_id.trim()
    if (!tabId || !wsId) continue
    if (tabIdCounts.get(tabId) !== 1) continue
    if (typeof tab.number !== 'number' || !Number.isFinite(tab.number)) continue

    const ws = workspaceMap.get(wsId)
    if (!ws || typeof ws.number !== 'number' || !Number.isFinite(ws.number)) continue

    const isDefaultOwner = ownerTabMap.get(wsId) === tabId
    const defaultEnabled = isDefaultOwner
    const currentFingerprint = computeTabFingerprint(ws, tab)

    const key = `${wsId}:${tabId}`
    const storedOverride = overrideMap.get(key)

    let effectiveEnabled = defaultEnabled
    let source: 'default' | 'override' = 'default'

    if (storedOverride && matchesFingerprint(storedOverride.fingerprint, currentFingerprint)) {
      effectiveEnabled = storedOverride.enabled
      source = 'override'
    }

    results.push({
      workspaceId: wsId,
      tabId,
      workspaceLabel: sanitizeStoreLabel(ws.label || ws.workspace_id),
      workspaceNumber: ws.number,
      tabLabel: sanitizeStoreLabel(tab.label || `Tab ${tab.number}`),
      tabNumber: tab.number,
      enabled: effectiveEnabled,
      isDefaultOwner,
      source
    })
  }

  // Deterministic sort: by workspace number, then tab number, then tabId
  results.sort((a, b) => {
    if (a.workspaceNumber !== b.workspaceNumber) {
      return a.workspaceNumber - b.workspaceNumber
    }
    if (a.tabNumber !== b.tabNumber) {
      return a.tabNumber - b.tabNumber
    }
    return a.tabId < b.tabId ? -1 : a.tabId > b.tabId ? 1 : 0
  })

  return results
}

export class PushTabPolicyStore {
  private filePath: string
  private dirPath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(customPath?: string) {
    this.filePath = customPath || getPushTabPolicyPath()
    this.dirPath = path.dirname(this.filePath)
  }

  private ensureDir() {
    if (!fs.existsSync(this.dirPath)) {
      fs.mkdirSync(this.dirPath, { recursive: true, mode: 0o700 })
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(this.dirPath, 0o700)
      } catch {}
    }
  }

  private assertSecureExistingPath() {
    if (process.platform === 'win32') return

    const dirStat = fs.statSync(this.dirPath)
    const fileStat = fs.lstatSync(this.filePath)
    const dirMode = dirStat.mode & 0o777
    const fileMode = fileStat.mode & 0o777

    if (
      !dirStat.isDirectory() ||
      (dirMode & 0o077) !== 0 ||
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      (fileMode & 0o077) !== 0
    ) {
      throw new Error('Tab policy store permissions are insecure')
    }
  }

  private readAllSync(): ITabPolicyOverrideRecord[] {
    if (!fs.existsSync(this.filePath)) {
      return []
    }
    this.assertSecureExistingPath()
    const raw = fs.readFileSync(this.filePath, 'utf8')
    if (!raw || raw.trim().length === 0) {
      throw new Error('Tab policy store is invalid or corrupt')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Tab policy store is invalid or corrupt')
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tab policy store is invalid or corrupt')
    }

    const doc = parsed as Record<string, unknown>
    if (doc.version !== 1 || !Array.isArray(doc.overrides)) {
      throw new Error('Tab policy store is invalid or corrupt')
    }

    const seenKeys = new Set<string>()
    const result: ITabPolicyOverrideRecord[] = []

    for (const item of doc.overrides) {
      if (!validateOverrideRecord(item)) {
        throw new Error('Tab policy store is invalid or corrupt')
      }
      const key = `${item.workspaceId}:${item.tabId}`
      if (seenKeys.has(key)) {
        // Reject duplicate entry fail closed
        throw new Error('Tab policy store is invalid or corrupt')
      }
      seenKeys.add(key)
      result.push(item)
    }

    return result
  }

  private writeAllSync(overrides: ITabPolicyOverrideRecord[]) {
    this.ensureDir()
    const tempFile = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
    const doc: ITabPolicyStoreFile = {
      version: 1,
      overrides
    }
    const data = JSON.stringify(doc, null, 2)
    fs.writeFileSync(tempFile, data, { mode: 0o600 })
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(tempFile, 0o600)
      } catch {}
    }
    fs.renameSync(tempFile, this.filePath)
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(this.filePath, 0o600)
      } catch {}
    }
  }

  public async getOverrides(): Promise<ITabPolicyOverrideRecord[]> {
    return this.readAllSync()
  }

  public async setTabOverride(
    workspace: { workspace_id: string; number: number; label?: string | null },
    tab: { tab_id: string; number: number; label?: string | null },
    enabled: boolean,
    isDefaultOwner: boolean
  ): Promise<ITabPolicyOverrideRecord[]> {
    return this.mutateOverrides((current) => {
      const wsId = workspace.workspace_id.trim()
      const tabId = tab.tab_id.trim()

      if (enabled === isDefaultOwner) {
        // Setting a Tab to its current default removes the override rather than storing redundant state
        return current.filter((rec) => !(rec.workspaceId === wsId && rec.tabId === tabId))
      }

      // Non-default setting: upsert override with current topology fingerprint
      const fingerprint = computeTabFingerprint(workspace, tab)
      const existingIdx = current.findIndex((rec) => rec.workspaceId === wsId && rec.tabId === tabId)
      const newRecord: ITabPolicyOverrideRecord = {
        workspaceId: wsId,
        tabId,
        enabled,
        fingerprint,
        updatedAt: Date.now()
      }

      if (existingIdx >= 0) {
        const next = [...current]
        next[existingIdx] = newRecord
        return next
      }

      return [...current, newRecord]
    })
  }

  public async mutateOverrides(
    mutator: (current: ITabPolicyOverrideRecord[]) => ITabPolicyOverrideRecord[]
  ): Promise<ITabPolicyOverrideRecord[]> {
    const operation = async (): Promise<ITabPolicyOverrideRecord[]> => {
      const current = this.readAllSync()
      const next = mutator(current)
      this.writeAllSync(next)
      return next
    }

    const nextPromise = this.writeQueue.then(operation, operation)
    this.writeQueue = nextPromise.then(
      () => {},
      () => {}
    )
    return nextPromise
  }

  public async clear(): Promise<void> {
    await this.mutateOverrides(() => [])
  }
}
