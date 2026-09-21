import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isValidVapidKeyPair } from './crypto.ts'
import type { IPushConfig } from './types.ts'

export const getDefaultConfigDir = (): string => {
  return path.join(os.homedir(), '.config', 'herdr-web')
}

export const getPushConfigPath = (): string => {
  if (process.env.HERDR_PUSH_CONFIG_PATH && process.env.HERDR_PUSH_CONFIG_PATH.trim().length > 0) {
    return process.env.HERDR_PUSH_CONFIG_PATH.trim()
  }
  return path.join(getDefaultConfigDir(), 'push-config.json')
}

export const getPushSubscriptionsPath = (): string => {
  if (process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH && process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH.trim().length > 0) {
    return process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH.trim()
  }
  return path.join(getDefaultConfigDir(), 'push-subscriptions.json')
}

export const getPushTabPolicyPath = (): string => {
  if (process.env.HERDR_PUSH_TAB_POLICY_PATH && process.env.HERDR_PUSH_TAB_POLICY_PATH.trim().length > 0) {
    return process.env.HERDR_PUSH_TAB_POLICY_PATH.trim()
  }
  return path.join(getDefaultConfigDir(), 'push-tab-policy.json')
}

export interface IConfigValidationResult {
  valid: boolean
  config?: IPushConfig
  error?: string
}

export const validateVapidSubject = (subject: unknown): { valid: boolean; error?: string } => {
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    return { valid: false, error: 'Push config "subject" must be a non-empty string' }
  }

  const s = subject.trim()

  if (s.length > 254) {
    return { valid: false, error: 'Push config "subject" exceeds maximum length of 254 characters' }
  }

  if (/[\u0000-\u0020\u007f]/.test(s)) {
    return { valid: false, error: 'Push config "subject" contains invalid control characters or whitespace' }
  }

  if (s.startsWith('mailto:')) {
    const address = s.slice('mailto:'.length)
    if (address.length === 0) {
      return { valid: false, error: 'Push config "subject" mailto target is empty' }
    }
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
    if (!emailRegex.test(address)) {
      return { valid: false, error: 'Push config "subject" mailto address is invalid' }
    }
    return { valid: true }
  }

  if (s.startsWith('https://')) {
    let url: URL
    try {
      url = new URL(s)
    } catch {
      return { valid: false, error: 'Push config "subject" is not a valid HTTPS URL' }
    }

    if (url.protocol !== 'https:') {
      return { valid: false, error: 'Push config "subject" must use HTTPS protocol' }
    }

    const hostname = url.hostname.toLowerCase()
    if (!hostname || hostname.length === 0) {
      return { valid: false, error: 'Push config "subject" URL host is empty' }
    }

    if (url.username || url.password) {
      return { valid: false, error: 'Push config "subject" URL must not contain credentials' }
    }

    // Reject localhost / loopback addresses (Apple APNs rejects them)
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      return { valid: false, error: 'Push config "subject" cannot use localhost or loopback host' }
    }

    if (!hostname.includes('.')) {
      return { valid: false, error: 'Push config "subject" host must be a valid domain' }
    }

    return { valid: true }
  }

  return { valid: false, error: 'Push config "subject" must begin with mailto: or https://' }
}

export const validatePushConfig = (raw: unknown): IConfigValidationResult => {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Push config must be a JSON object' }
  }

  const obj = raw as Record<string, unknown>

  if (typeof obj.ownerLogin !== 'string' || obj.ownerLogin.trim().length === 0) {
    return { valid: false, error: 'Push config missing or empty "ownerLogin"' }
  }

  if (typeof obj.publicKey !== 'string' || obj.publicKey.trim().length === 0) {
    return { valid: false, error: 'Push config missing or empty "publicKey"' }
  }

  if (typeof obj.privateKey !== 'string' || obj.privateKey.trim().length === 0) {
    return { valid: false, error: 'Push config missing or empty "privateKey"' }
  }

  if (typeof obj.subject !== 'string' || obj.subject.trim().length === 0) {
    return { valid: false, error: 'Push config missing or empty "subject"' }
  }

  const ownerLogin = obj.ownerLogin.trim()
  const publicKey = obj.publicKey.trim()
  const privateKey = obj.privateKey.trim()
  const subject = obj.subject.trim()

  if (ownerLogin.length > 254 || /[\u0000-\u001f\u007f]/.test(ownerLogin)) {
    return { valid: false, error: 'Push config "ownerLogin" is invalid' }
  }

  const subjectValidation = validateVapidSubject(subject)
  if (!subjectValidation.valid) {
    return { valid: false, error: subjectValidation.error }
  }

  if (!isValidVapidKeyPair(publicKey, privateKey)) {
    return { valid: false, error: 'Push config VAPID keypair is invalid or mismatched' }
  }

  return {
    valid: true,
    config: {
      ownerLogin,
      publicKey,
      privateKey,
      subject
    }
  }
}

export const loadPushConfig = (customPath?: string): IPushConfig | null => {
  const targetPath = customPath || getPushConfigPath()
  try {
    if (!fs.existsSync(targetPath)) {
      return null
    }

    if (process.platform !== 'win32') {
      const parentStat = fs.statSync(path.dirname(targetPath))
      const parentMode = parentStat.mode & 0o777
      if (!parentStat.isDirectory() || (parentMode & 0o077) !== 0) {
        console.warn(`[herdr-push] Insecure permissions for push config directory ${path.dirname(targetPath)}; must be 0700 or stricter. Rejecting config.`)
        return null
      }

      const stat = fs.lstatSync(targetPath)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        console.warn(`[herdr-push] Config target ${targetPath} is not a regular file`)
        return null
      }
      const mode = stat.mode & 0o777
      // Reject if group or world have any permissions (read, write, execute)
      if ((mode & 0o077) !== 0) {
        console.warn(`[herdr-push] Insecure permissions for push config file ${targetPath}: mode is 0${mode.toString(8)}, must be 0600 or stricter. Rejecting config.`)
        return null
      }
    }

    const content = fs.readFileSync(targetPath, 'utf8')
    const parsed = JSON.parse(content)
    const result = validatePushConfig(parsed)
    if (!result.valid || !result.config) {
      console.warn(`[herdr-push] Invalid config at ${targetPath}: ${result.error}`)
      return null
    }

    return result.config
  } catch (err) {
    console.warn(`[herdr-push] Failed to read config from ${targetPath}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
