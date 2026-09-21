import * as fs from 'node:fs'
import * as path from 'node:path'
import webpush from 'web-push'
import { getPushConfigPath, validateVapidSubject } from '../server/push/config.ts'

export interface IInitPushArgs {
  ownerLogin: string
  subject: string
  configPath?: string
  force?: boolean
}

export const parseArgs = (argv: string[]): IInitPushArgs => {
  let ownerLogin = ''
  let subject = ''
  let configPath: string | undefined
  let force = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--owner-login' && i + 1 < argv.length) {
      ownerLogin = argv[++i]
    } else if (arg.startsWith('--owner-login=')) {
      ownerLogin = arg.slice('--owner-login='.length)
    } else if (arg === '--subject' && i + 1 < argv.length) {
      subject = argv[++i]
    } else if (arg.startsWith('--subject=')) {
      subject = arg.slice('--subject='.length)
    } else if (arg === '--config-path' && i + 1 < argv.length) {
      configPath = argv[++i]
    } else if (arg.startsWith('--config-path=')) {
      configPath = arg.slice('--config-path='.length)
    } else if (arg === '--force') {
      force = true
    }
  }

  return { ownerLogin, subject, configPath, force }
}

export const runInitPush = (args: IInitPushArgs): { ok: boolean; message: string; publicKey?: string; configPath?: string } => {
  const ownerLogin = args.ownerLogin?.trim()
  const subject = args.subject?.trim()
  const targetPath = args.configPath?.trim() || getPushConfigPath()
  const targetDir = path.dirname(targetPath)

  if (!ownerLogin) {
    return { ok: false, message: 'Missing required argument: --owner-login <login>' }
  }

  if (!subject) {
    return { ok: false, message: 'Missing required argument: --subject <mailto:...|https://...>' }
  }

  const subjectValidation = validateVapidSubject(subject)
  if (!subjectValidation.valid) {
    return { ok: false, message: `Invalid --subject: ${subjectValidation.error}` }
  }

  if (fs.existsSync(targetPath) && !args.force) {
    return {
      ok: false,
      message: `Config file already exists at ${targetPath}. Use --force to overwrite.`
    }
  }

  const vapidKeys = webpush.generateVAPIDKeys()
  const config = {
    ownerLogin,
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
    subject
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 })
  }
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(targetDir, 0o700)
    } catch {}
  }

  const tempPath = `${targetPath}.tmp.${Date.now()}`
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(tempPath, 0o600)
  } catch {}
  fs.renameSync(tempPath, targetPath)
  try {
    fs.chmodSync(targetPath, 0o600)
  } catch {}

  return {
    ok: true,
    message: `Push configuration successfully created at ${targetPath}`,
    publicKey: vapidKeys.publicKey,
    configPath: targetPath
  }
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2))
  const result = runInitPush(args)
  if (!result.ok) {
    console.error(`Error: ${result.message}`)
    process.exit(1)
  }

  console.log(result.message)
  console.log(`Public Key: ${result.publicKey}`)
  console.log('Private key securely written to config file (0600 permissions). Never disclose private keys.')
  console.log('Note: Generated configuration requires server restart or reload before Push notifications become enabled.')
}
