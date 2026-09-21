import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import webpush from 'web-push'
import {
  loadPushConfig,
  validatePushConfig
} from '../config.ts'

describe('server/push/config: validation and loading', () => {
  const vapidKeys = webpush.generateVAPIDKeys()
  const publicKey = vapidKeys.publicKey
  const privateKey = vapidKeys.privateKey

  test('validates valid push config', () => {
    const validRaw = {
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'mailto:owner@example.com'
    }

    const result = validatePushConfig(validRaw)
    expect(result.valid).toBe(true)
    expect(result.config?.ownerLogin).toBe('owner@example.com')
    expect(result.config?.publicKey).toBe(publicKey)
    expect(result.config?.privateKey).toBe(privateKey)
    expect(result.config?.subject).toBe('mailto:owner@example.com')
  })

  test('rejects non-object payload', () => {
    expect(validatePushConfig(null).valid).toBe(false)
    expect(validatePushConfig('string').valid).toBe(false)
    expect(validatePushConfig([]).valid).toBe(false)
  })

  test('rejects missing or empty ownerLogin', () => {
    const raw = {
      ownerLogin: '  ',
      publicKey,
      privateKey,
      subject: 'mailto:owner@example.com'
    }
    const result = validatePushConfig(raw)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('ownerLogin')
  })

  test('validates valid mailto and https VAPID subjects', () => {
    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'mailto:owner@example.com'
    }).valid).toBe(true)

    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'https://example.com/vapid'
    }).valid).toBe(true)
  })

  test('rejects invalid subject protocol (not mailto: or https:)', () => {
    const raw = {
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'ftp://example.com'
    }
    const result = validatePushConfig(raw)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('subject')
  })

  test('rejects empty or invalid mailto subject', () => {
    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'mailto:'
    }).valid).toBe(false)

    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'mailto:not-an-email'
    }).valid).toBe(false)
  })

  test('rejects localhost, loopback, and invalid HTTPS subjects', () => {
    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'https://localhost/vapid'
    }).valid).toBe(false)

    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'https://127.0.0.1/vapid'
    }).valid).toBe(false)

    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'https://0.0.0.0/vapid'
    }).valid).toBe(false)

    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'https://[::1]/vapid'
    }).valid).toBe(false)
  })

  test('rejects control characters or oversize subject', () => {
    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'mailto:owner\u0000@example.com'
    }).valid).toBe(false)

    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey,
      subject: 'mailto:' + 'a'.repeat(250) + '@example.com'
    }).valid).toBe(false)
  })

  test('rejects too short keys', () => {
    const raw = {
      ownerLogin: 'owner@example.com',
      publicKey: 'tooshort',
      privateKey: 'tooshort',
      subject: 'https://example.com'
    }
    const result = validatePushConfig(raw)
    expect(result.valid).toBe(false)
  })

  test('rejects length-valid invalid or mismatched VAPID key material', () => {
    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey: 'A'.repeat(87),
      privateKey: 'A'.repeat(43),
      subject: 'mailto:owner@example.com'
    }).valid).toBe(false)

    const otherKeys = webpush.generateVAPIDKeys()
    expect(validatePushConfig({
      ownerLogin: 'owner@example.com',
      publicKey,
      privateKey: otherKeys.privateKey,
      subject: 'mailto:owner@example.com'
    }).valid).toBe(false)
  })

  test('loadPushConfig returns null for non-existent file', () => {
    const cfg = loadPushConfig('/tmp/herdr-test-non-existent-config-' + Date.now())
    expect(cfg).toBeNull()
  })

  test('loadPushConfig reads and parses valid file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-cfg-'))
    const filePath = path.join(tmpDir, 'push-config.json')

    try {
      const validConfig = {
        ownerLogin: 'test-user',
        publicKey,
        privateKey,
        subject: 'mailto:test@example.com'
      }
      fs.writeFileSync(filePath, JSON.stringify(validConfig), { mode: 0o600 })
      if (process.platform !== 'win32') {
        fs.chmodSync(filePath, 0o600)
      }

      const loaded = loadPushConfig(filePath)
      expect(loaded).not.toBeNull()
      expect(loaded?.ownerLogin).toBe('test-user')
      expect(loaded?.subject).toBe('mailto:test@example.com')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('loadPushConfig rejects non-regular files and group/world-readable files on Unix', () => {
    if (process.platform === 'win32') return

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-perms-'))
    const dirAsConfig = path.join(tmpDir, 'is-a-directory')
    const insecureConfig = path.join(tmpDir, 'insecure-config.json')
    const insecureDir = path.join(tmpDir, 'insecure-dir')
    const insecureDirConfig = path.join(insecureDir, 'push-config.json')

    try {
      // 1. Directory instead of regular file
      fs.mkdirSync(dirAsConfig)
      expect(loadPushConfig(dirAsConfig)).toBeNull()

      // 2. Insecure group/world-readable permissions (0644 / 0666)
      const validConfig = {
        ownerLogin: 'test-user',
        publicKey,
        privateKey,
        subject: 'mailto:test@example.com'
      }
      fs.writeFileSync(insecureConfig, JSON.stringify(validConfig), { mode: 0o644 })
      fs.chmodSync(insecureConfig, 0o644)
      expect(loadPushConfig(insecureConfig)).toBeNull()

      // 3. Secure 0600 mode accepted
      fs.chmodSync(insecureConfig, 0o600)
      expect(loadPushConfig(insecureConfig)).not.toBeNull()

      // 4. Secure file inside a group/world-readable parent directory is rejected
      fs.mkdirSync(insecureDir, { mode: 0o755 })
      fs.writeFileSync(insecureDirConfig, JSON.stringify(validConfig), { mode: 0o600 })
      fs.chmodSync(insecureDir, 0o755)
      fs.chmodSync(insecureDirConfig, 0o600)
      expect(loadPushConfig(insecureDirConfig)).toBeNull()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

})
