import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseArgs, runInitPush } from '../init-push.ts'

describe('scripts/init-push: CLI argument parsing and VAPID key generation', () => {
  test('parses CLI arguments correctly', () => {
    const args = parseArgs([
      '--owner-login',
      'owner@tailnet.ts.net',
      '--subject',
      'mailto:owner@tailnet.ts.net',
      '--config-path',
      '/tmp/test-config.json',
      '--force'
    ])

    expect(args.ownerLogin).toBe('owner@tailnet.ts.net')
    expect(args.subject).toBe('mailto:owner@tailnet.ts.net')
    expect(args.configPath).toBe('/tmp/test-config.json')
    expect(args.force).toBe(true)
  })

  test('validates required ownerLogin and subject', () => {
    const noOwner = runInitPush({ ownerLogin: '', subject: 'mailto:a@b.com' })
    expect(noOwner.ok).toBe(false)
    expect(noOwner.message).toContain('--owner-login')

    const noSubject = runInitPush({ ownerLogin: 'owner', subject: '' })
    expect(noSubject.ok).toBe(false)
    expect(noSubject.message).toContain('--subject')

    const badSubject = runInitPush({ ownerLogin: 'owner', subject: 'invalid://sub' })
    expect(badSubject.ok).toBe(false)
    expect(badSubject.message).toContain('mailto: or https://')
  })

  test('generates VAPID keys and creates 0600 config file without leaking private key', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-init-push-'))
    const targetFile = path.join(tmpDir, 'subdir', 'push-config.json')

    try {
      const result = runInitPush({
        ownerLogin: 'test-admin',
        subject: 'mailto:admin@example.com',
        configPath: targetFile
      })

      expect(result.ok).toBe(true)
      expect(result.publicKey).toBeDefined()
      expect(result.publicKey?.length).toBeGreaterThan(30)
      expect(result.message).not.toContain('privateKey')
      expect((result as any).privateKey).toBeUndefined()

      expect(fs.existsSync(targetFile)).toBe(true)
      const content = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
      expect(content.ownerLogin).toBe('test-admin')
      expect(content.publicKey).toBe(result.publicKey)
      expect(content.privateKey).toBeDefined()

      // Second run without force should refuse overwrite
      const rerun = runInitPush({
        ownerLogin: 'test-admin',
        subject: 'mailto:admin@example.com',
        configPath: targetFile,
        force: false
      })
      expect(rerun.ok).toBe(false)
      expect(rerun.message).toContain('already exists')

      // Run with force succeeds
      const forceRun = runInitPush({
        ownerLogin: 'test-admin',
        subject: 'mailto:admin@example.com',
        configPath: targetFile,
        force: true
      })
      expect(forceRun.ok).toBe(true)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('repairs an existing config directory to 0700 on Unix', () => {
    if (process.platform === 'win32') return

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-init-push-dir-'))
    const targetDir = path.join(tmpDir, 'existing')
    const targetFile = path.join(targetDir, 'push-config.json')

    try {
      fs.mkdirSync(targetDir, { mode: 0o755 })
      fs.chmodSync(targetDir, 0o755)

      const result = runInitPush({
        ownerLogin: 'test-admin',
        subject: 'mailto:admin@example.com',
        configPath: targetFile
      })

      expect(result.ok).toBe(true)
      expect(fs.statSync(targetDir).mode & 0o777).toBe(0o700)
      expect(fs.statSync(targetFile).mode & 0o777).toBe(0o600)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
