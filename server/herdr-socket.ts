import * as net from 'node:net'
import * as os from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { HERDR_TRACKED_PROTOCOL } from './generated/protocol.ts'

export class HerdrSocketError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'HerdrSocketError'
    this.code = code
  }
}

export interface ISocketRequestOptions {
  socketPath?: string
  timeoutMs?: number
  maxBytes?: number
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024 // 16 MB
const MAX_ERROR_MESSAGE_LENGTH = 1024

export const boundHerdrErrorMessage = (message: unknown): string => {
  const normalized = typeof message === 'string' && message.length > 0 ? message : 'Unknown error'
  return normalized.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

export const resolveHerdrSocketPath = (explicitPath?: string): string => {
  if (explicitPath && explicitPath.trim().length > 0) {
    return explicitPath.trim()
  }

  const envSocketPath = process.env.HERDR_SOCKET_PATH
  if (envSocketPath && envSocketPath.trim().length > 0) {
    return envSocketPath.trim()
  }

  const home = process.env.HOME || os.homedir()
  const sessionName = process.env.HERDR_SESSION
  if (sessionName && sessionName.trim().length > 0) {
    return `${home}/.config/herdr/sessions/${sessionName.trim()}/herdr.sock`
  }

  return `${home}/.config/herdr/herdr.sock`
}

let requestIdCounter = 0

export const generateRequestId = (prefix = 'req'): string => {
  requestIdCounter = (requestIdCounter + 1) % 1_000_000
  const now = Date.now()
  const randomPart = Math.random().toString(36).slice(2, 6)
  return `${prefix}_${now}_${requestIdCounter}_${randomPart}`
}

export interface IRawSocketEnvelope<T = any> {
  id: string
  result?: T
  error?: {
    code: string
    message: string
  }
}

export const sendRawSocketRequest = async <T = any>(
  method: string,
  params: Record<string, unknown> = {},
  options: ISocketRequestOptions = {}
): Promise<T> => {
  const socketPath = resolveHerdrSocketPath(options.socketPath)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const reqId = generateRequestId()

  return new Promise<T>((resolve, reject) => {
    let client: net.Socket | null = null
    let timer: NodeJS.Timeout | null = null
    let settled = false
    let receivedBytes = 0
    let buffer = ''
    const decoder = new StringDecoder('utf8')

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (client) {
        client.removeAllListeners()
        if (!client.destroyed) {
          client.destroy()
        }
        client = null
      }
    }

    const finishError = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const finishSuccess = (result: T) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    timer = setTimeout(() => {
      finishError(new Error(`Herdr socket request timed out after ${timeoutMs}ms (method: ${method})`))
    }, timeoutMs)

    try {
      client = net.createConnection({ path: socketPath })
    } catch (err) {
      finishError(err instanceof Error ? err : new Error(String(err)))
      return
    }

    client.on('connect', () => {
      try {
        // Send exactly one JSON line. Do not log prompt or payload contents.
        const payload = JSON.stringify({
          id: reqId,
          method,
          params
        }) + '\n'
        client?.write(payload)
      } catch (err) {
        finishError(err instanceof Error ? err : new Error(String(err)))
      }
    })

    client.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length
      if (receivedBytes > maxBytes) {
        finishError(new Error(`Herdr socket response exceeded maximum allowed size of ${maxBytes} bytes`))
        return
      }

      buffer += decoder.write(chunk)
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        try {
          const parsed = JSON.parse(line) as IRawSocketEnvelope<T>
          const isUncorrelatedDecodeError = parsed.id === '' && parsed.error?.code === 'invalid_request'
          if (parsed.id !== reqId && !isUncorrelatedDecodeError) {
            finishError(new Error(`Mismatched request id: expected "${reqId}", received "${parsed.id}"`))
            return
          }

          if (parsed.error) {
            finishError(new HerdrSocketError(parsed.error.code || 'unknown_error', boundHerdrErrorMessage(parsed.error.message)))
            return
          }

          if (parsed.result !== undefined) {
            finishSuccess(parsed.result)
            return
          }

          finishError(new Error('Invalid socket response: envelope contains neither result nor error'))
        } catch (parseErr) {
          finishError(new Error(`Malformed JSON response from Herdr socket: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`))
        }
      }
    })

    client.on('error', (err: Error) => {
      finishError(err)
    })

    client.on('end', () => {
      if (!settled) {
        finishError(new Error(`Premature EOF received from Herdr socket for method: ${method}`))
      }
    })

    client.on('close', () => {
      if (!settled) {
        finishError(new Error(`Herdr socket connection closed unexpectedly for method: ${method}`))
      }
    })
  })
}

export interface IPingResult {
  type: string
  version: string
  protocol: number
  capabilities?: Record<string, boolean | number | string>
}

export const executePing = async (options: ISocketRequestOptions = {}): Promise<IPingResult> => {
  const res = await sendRawSocketRequest<IPingResult>('ping', {}, options)

  if (res.protocol !== HERDR_TRACKED_PROTOCOL) {
    throw new Error(
      `Protocol mismatch: installed Herdr reports protocol=${res.protocol}, but tracked protocol=${HERDR_TRACKED_PROTOCOL}. Transport failing closed.`
    )
  }

  return res
}
