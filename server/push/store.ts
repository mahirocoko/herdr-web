import * as fs from 'node:fs'
import * as path from 'node:path'
import { getPushSubscriptionsPath } from './config.ts'
import { validatePushSubscriptionPayload } from './security.ts'
import type { IPushSubscription } from './types.ts'

export class PushSubscriptionStore {
  private filePath: string
  private dirPath: string

  constructor(customPath?: string) {
    this.filePath = customPath || getPushSubscriptionsPath()
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
      throw new Error('Push subscription store permissions are insecure')
    }
  }

  private isValidSubscription(item: unknown): item is IPushSubscription {
    return validatePushSubscriptionPayload(item).valid
  }

  private readAllSync(): IPushSubscription[] {
    if (!fs.existsSync(this.filePath)) {
      return []
    }
    this.assertSecureExistingPath()
    const raw = fs.readFileSync(this.filePath, 'utf8')
    if (!raw || raw.trim().length === 0) {
      throw new Error('Push subscription store is invalid or corrupt')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Push subscription store is invalid or corrupt')
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Push subscription store is invalid or corrupt')
    }
    for (const item of parsed) {
      if (!this.isValidSubscription(item)) {
        throw new Error('Push subscription store is invalid or corrupt')
      }
    }
    return parsed as IPushSubscription[]
  }

  private writeAllSync(subscriptions: IPushSubscription[]) {
    this.ensureDir()
    const tempFile = `${this.filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
    const data = JSON.stringify(subscriptions, null, 2)
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

  public async getSubscriptions(): Promise<IPushSubscription[]> {
    return this.readAllSync()
  }

  public async getSubscription(endpoint: string): Promise<IPushSubscription | null> {
    const list = this.readAllSync()
    const found = list.find((s) => s.endpoint === endpoint)
    return found || null
  }

  public async addSubscription(subscription: IPushSubscription): Promise<void> {
    const list = this.readAllSync()
    const now = Date.now()
    const existingIndex = list.findIndex((s) => s.endpoint === subscription.endpoint)

    if (existingIndex >= 0) {
      list[existingIndex] = {
        ...subscription,
        createdAt: list[existingIndex].createdAt || now,
        updatedAt: now
      }
    } else {
      list.push({
        ...subscription,
        createdAt: subscription.createdAt || now,
        updatedAt: now
      })
    }

    this.writeAllSync(list)
  }

  public async removeSubscription(endpoint: string): Promise<boolean> {
    const list = this.readAllSync()
    const filtered = list.filter((s) => s.endpoint !== endpoint)
    if (filtered.length === list.length) {
      return false
    }
    this.writeAllSync(filtered)
    return true
  }

  public async clear(): Promise<void> {
    this.writeAllSync([])
  }
}
