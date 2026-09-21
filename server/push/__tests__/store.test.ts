import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createECDH } from 'node:crypto'
import { PushSubscriptionStore } from '../store.ts'
import type { IPushSubscription } from '../types.ts'

describe('server/push/store: atomic private JSON subscription storage', () => {
  const curve = createECDH('prime256v1')
  const p256dh = curve.generateKeys().toString('base64url')
  const updatedCurve = createECDH('prime256v1')
  const updatedP256dh = updatedCurve.generateKeys().toString('base64url')
  const authKey = 'A'.repeat(22)

  test('adds, retrieves, and idempotently updates subscriptions', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-store-'))
    const storePath = path.join(tmpDir, 'push-subscriptions.json')

    try {
      const store = new PushSubscriptionStore(storePath)

      const sub1: IPushSubscription = {
        endpoint: 'https://push.example.com/sub/1',
        keys: {
          p256dh,
          auth: authKey
        }
      }

      await store.addSubscription(sub1)
      let list = await store.getSubscriptions()
      expect(list.length).toBe(1)
      expect(list[0].endpoint).toBe(sub1.endpoint)
      expect(list[0].keys.p256dh).toBe(p256dh)
      expect(list[0].createdAt).toBeGreaterThan(0)
      expect(list[0].updatedAt).toBeGreaterThan(0)

      // Idempotent update on same endpoint
      const sub1Updated: IPushSubscription = {
        endpoint: 'https://push.example.com/sub/1',
        keys: {
          p256dh: updatedP256dh,
          auth: authKey
        }
      }

      await store.addSubscription(sub1Updated)
      list = await store.getSubscriptions()
      expect(list.length).toBe(1)
      expect(list[0].keys.p256dh).toBe(updatedP256dh)

      // Add a second subscription
      const sub2: IPushSubscription = {
        endpoint: 'https://push.example.com/sub/2',
        keys: {
          p256dh,
          auth: authKey
        }
      }

      await store.addSubscription(sub2)
      list = await store.getSubscriptions()
      expect(list.length).toBe(2)

      // Get single subscription
      const fetchedSub1 = await store.getSubscription('https://push.example.com/sub/1')
      expect(fetchedSub1?.keys.p256dh).toBe(updatedP256dh)

      const nonExistent = await store.getSubscription('https://push.example.com/sub/999')
      expect(nonExistent).toBeNull()

      // Remove subscription
      const removed = await store.removeSubscription('https://push.example.com/sub/1')
      expect(removed).toBe(true)

      const listAfterRemove = await store.getSubscriptions()
      expect(listAfterRemove.length).toBe(1)
      expect(listAfterRemove[0].endpoint).toBe(sub2.endpoint)

      // Idempotent remove again returns false
      const removedAgain = await store.removeSubscription('https://push.example.com/sub/1')
      expect(removedAgain).toBe(false)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('throws store-invalid error and preserves file on corrupted JSON or invalid records', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-corrupt-'))
    const storePath = path.join(tmpDir, 'push-subscriptions.json')

    try {
      // 1. Corrupt JSON throws and does not overwrite
      const corruptContent = 'invalid json content {'
      fs.writeFileSync(storePath, corruptContent, { mode: 0o600 })
      const store = new PushSubscriptionStore(storePath)

      expect(store.getSubscriptions()).rejects.toThrow('Push subscription store is invalid or corrupt')
      // Ensure file content is preserved on disk
      expect(fs.readFileSync(storePath, 'utf8')).toBe(corruptContent)

      // 2. Non-array JSON throws and preserves file
      const nonArrayContent = '{"not": "an array"}'
      fs.writeFileSync(storePath, nonArrayContent, { mode: 0o600 })
      expect(store.getSubscriptions()).rejects.toThrow('Push subscription store is invalid or corrupt')
      expect(fs.readFileSync(storePath, 'utf8')).toBe(nonArrayContent)

      // 3. Array with invalid records throws and preserves file
      const invalidRecordContent = JSON.stringify([{ endpoint: 'http://not-https.com', keys: {} }])
      fs.writeFileSync(storePath, invalidRecordContent, { mode: 0o600 })
      expect(store.getSubscriptions()).rejects.toThrow('Push subscription store is invalid or corrupt')
      expect(fs.readFileSync(storePath, 'utf8')).toBe(invalidRecordContent)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('enforces Unix file mode 0600 on saved subscriptions and directory 0700', async () => {
    if (process.platform === 'win32') return

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-perms-'))
    const storeDir = path.join(tmpDir, 'nested-store-dir')
    const storePath = path.join(storeDir, 'push-subscriptions.json')

    try {
      const store = new PushSubscriptionStore(storePath)
      await store.addSubscription({
        endpoint: 'https://push.example.com/sub/perm-test',
        keys: { p256dh, auth: authKey }
      })

      const dirStat = fs.statSync(storeDir)
      const fileStat = fs.statSync(storePath)

      expect(dirStat.mode & 0o777).toBe(0o700)
      expect(fileStat.mode & 0o777).toBe(0o600)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('rejects existing subscription state with insecure Unix permissions', async () => {
    if (process.platform === 'win32') return

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-insecure-'))
    const storePath = path.join(tmpDir, 'push-subscriptions.json')
    const content = JSON.stringify([{
      endpoint: 'https://push.example.com/sub/insecure',
      keys: { p256dh, auth: authKey }
    }])

    try {
      fs.writeFileSync(storePath, content, { mode: 0o644 })
      fs.chmodSync(storePath, 0o644)
      const store = new PushSubscriptionStore(storePath)

      expect(store.getSubscriptions()).rejects.toThrow('permissions are insecure')
      expect(fs.readFileSync(storePath, 'utf8')).toBe(content)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
