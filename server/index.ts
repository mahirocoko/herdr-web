import {
  CONSERVATIVE_TOKEN_REGEX,
  PANE_ID_REGEX,
  isHostAllowed,
  isOriginAllowed,
  validateActionRequest,
  validateAgentExplainParams,
  validateOwnerAuth,
  validatePaneReadParams,
  validateTerminalParams,
  verifyTargetAgainstSnapshot
} from './security.ts'
import {
  executeKeys,
  executePrompt,
  executeTabClose,
  executeTabCreate,
  executeTerminalInput,
  executeWorkspaceClose,
  executeWorkspaceCreate,
  getAgentExplain,
  getHerdrHealth,
  getHerdrSnapshot,
  getTransportMode,
  readPaneContent,
  spawnObserverProcess,
  validatePaneInSnapshot
} from './herdr-adapter.ts'
import { HerdrSocketError } from './herdr-socket.ts'
import { getSharedSnapshotBridge } from './snapshot-bridge.ts'
import { getSharedPushService } from './push/service.ts'
import { loadPushConfig } from './push/config.ts'
import {
  validatePushAuth,
  validatePushEndpointPayload,
  validatePushSubscriptionPayload
} from './push/security.ts'
import { resolveEffectiveTabPolicy } from './push/tab-policy-store.ts'
import { resolveWorkspaceOwnerTabs } from './push/transition-detector.ts'
import type { ITabPolicyOverrideRecord } from './push/types.ts'
import type { ISnapshotResult } from './types.ts'
import {
  getSharedOperationCoordinator,
  computePayloadFingerprint,
  type IBeginActionOptions,
  type OperationCoordinator
} from './operation-coordinator.ts'
import { resolveNearestRepoCatalog } from './catalog.ts'

import {
  MAX_LEASE_DURATION_MS,
  MAX_STDOUT_LINE_BYTES,
  getSharedTerminalControlLeaseManager,
  TerminalControlLeaseManager,
  preflightShellPane,
  spawnTerminalControlProcess,
  validateTerminalControlMessage,
  validateTerminalControlParams,
  validateTerminalControlStatusParams,
  parseAndValidateUpstreamTerminalMessage,
  getPublicPreflightErrorMessage,
  sanitizeStderrToCategory
} from './terminal-control.ts'

export type IWebSocketData =
  | {
      kind: 'terminal'
      pane: string
      cols: number
      rows: number
      proc?: ReturnType<typeof spawnObserverProcess>
      closed?: boolean
    }
  | {
      kind: 'terminal-control'
      pane: string
      cols: number
      rows: number
      leaseId: string
      shellPid: number
      pgid: number
      controlReady: boolean
      proc?: ReturnType<typeof spawnTerminalControlProcess>
      closed?: boolean
    }
  | {
      kind: 'events'
      unsubscribeSnapshot?: () => void
      unsubscribeStatus?: () => void
      closed?: boolean
    }

const PORT = parseInt(process.env.PORT || '8787', 10)
const HOST = '127.0.0.1'

export interface ICreateServerOptions {
  startPushBridge?: boolean
  deps?: {
    coordinator?: OperationCoordinator
    leaseManager?: TerminalControlLeaseManager
    fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
    verifyTarget?: typeof verifyTargetAgainstSnapshot
    executePrompt?: (paneId: string, text: string) => Promise<any>
    executeTerminalInput?: (paneId: string, text: string) => Promise<any>
    executeKeys?: (paneId: string, keys: string[]) => Promise<any>
    executeTabCreate?: typeof executeTabCreate
    executeWorkspaceCreate?: typeof executeWorkspaceCreate
    executeWorkspaceClose?: typeof executeWorkspaceClose
    executeTabClose?: typeof executeTabClose
  }
}

const PUSH_CLICK_DIAGNOSTIC_STAGES = new Set([
  'click_target_data',
  'click_target_tag',
  'click_target_none',
  'click_target_conflict',
  'ack_received',
  'ack_timeout',
  'ack_rejected',
  'ack_invalid',
  'ack_unsupported',
  'navigate_ok',
  'navigate_null',
  'navigate_error',
  'open_ok',
  'open_null',
  'open_error',
  'app_receive',
  'app_matched',
  'app_unknown',
  'app_ack'
])

const parseBoundedJsonBody = async (
  request: Request,
  maxBytes = 4096
): Promise<{ ok: boolean; status?: number; error?: string; data?: unknown }> => {
  const cType = (request.headers.get('content-type') || '').toLowerCase()
  if (!cType.includes('application/json')) {
    return { ok: false, status: 400, error: 'Content-Type must be application/json' }
  }

  const cLen = request.headers.get('content-length')
  if (cLen) {
    const num = parseInt(cLen, 10)
    if (!Number.isNaN(num) && num > maxBytes) {
      return { ok: false, status: 413, error: `Payload exceeds ${maxBytes} bytes limit` }
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, error: 'Request body required' }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          return { ok: false, status: 413, error: `Payload exceeds ${maxBytes} bytes limit` }
        }
        chunks.push(value)
      }
    }
  } catch {
    return { ok: false, status: 400, error: 'Failed to read request body' }
  }

  if (total === 0) {
    return { ok: false, status: 400, error: 'Request body is empty' }
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(combined)
  } catch {
    return { ok: false, status: 400, error: 'Invalid UTF-8 encoding in payload' }
  }

  try {
    return { ok: true, data: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, error: 'Malformed JSON payload' }
  }
}

export const createServer = (
  port = PORT,
  host = HOST,
  options: ICreateServerOptions = {}
) => {
  const coordinator = options.deps?.coordinator ?? getSharedOperationCoordinator()
  const leaseManager = options.deps?.leaseManager ?? (
    options.deps?.coordinator
      ? new TerminalControlLeaseManager({
          arbiter: {
            claimPane: (paneId, leaseId) => coordinator.claimPaneForControl(paneId, leaseId),
            releasePane: (token) => { coordinator.releaseControlPane(token) },
            isPaneClaimed: (paneId) => coordinator.isPaneClaimed(paneId)
          }
        })
      : getSharedTerminalControlLeaseManager()
  )

  // Any explicitly injected manager is coherently rebound to the selected coordinator
  // before it can reserve a lease. This prevents tests or alternate server constructors
  // from accidentally creating separate action and Control claim maps.
  if (options.deps?.leaseManager) {
    leaseManager.bindArbiter({
      claimPane: (paneId, leaseId) => coordinator.claimPaneForControl(paneId, leaseId),
      releasePane: (token) => { coordinator.releaseControlPane(token) },
      isPaneClaimed: (paneId) => coordinator.isPaneClaimed(paneId)
    })
  }

  if (options.startPushBridge !== false && getTransportMode() !== 'cli') {
    const pushService = getSharedPushService()
    if (pushService.isEnabled()) {
      const bridge = getSharedSnapshotBridge()
      pushService.attachToBridge(bridge)
      bridge.start()
    }
  }

  return Bun.serve<IWebSocketData>({
    port,
    hostname: host,
    async fetch(req, server) {
      const url = new URL(req.url)
      const pathname = url.pathname
      const hostHeader = req.headers.get('host')
      const originHeader = req.headers.get('origin')

      // GET /api/health
      if (req.method === 'GET' && pathname === '/api/health') {
        const health = await getHerdrHealth(3000)
        return new Response(JSON.stringify(health), {
          status: health.ok ? 200 : 503,
          headers: { 'content-type': 'application/json' }
        })
      }

      // GET /api/snapshot
      if (req.method === 'GET' && pathname === '/api/snapshot') {
        try {
          const snapshot = await getHerdrSnapshot(5000)
          return new Response(JSON.stringify({ ok: true, snapshot }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        } catch (err) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err)
            }),
            {
              status: 502,
              headers: { 'content-type': 'application/json' }
            }
          )
        }
      }

      const getConfiguredOwnerLogin = (): string | undefined => {
        const pushService = getSharedPushService()
        return pushService.getConfig()?.ownerLogin ?? loadPushConfig()?.ownerLogin
      }

      // POST /api/action
      if (req.method === 'POST' && pathname === '/api/action') {
        const auth = validateOwnerAuth(
          req,
          hostHeader,
          originHeader,
          getConfiguredOwnerLogin(),
          { requireOrigin: true }
        )
        if (!auth.allowed) {
          return new Response(
            JSON.stringify({ ok: false, error: auth.error || 'Forbidden: unauthorized' }),
            {
              status: auth.status,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        const bodyParsed = await parseBoundedJsonBody(req)
        if (!bodyParsed.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: bodyParsed.error || 'Invalid action payload' }),
            {
              status: bodyParsed.status || 400,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        const validation = validateActionRequest(bodyParsed.data)
        if (!validation.valid || !validation.data) {
          return new Response(
            JSON.stringify({ ok: false, error: validation.error || 'Invalid action payload' }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        const action = validation.data
        const fingerprint = computePayloadFingerprint(action)

        // 1. Synchronous token-fenced admission arbiter BEFORE ANY await
        let beginOptions: IBeginActionOptions
        if (action.type === 'workspace-create') {
          beginOptions = { topology: 'exclusive', targetKey: 'workspace-create' }
        } else if (action.type === 'workspace-close') {
          beginOptions = { topology: 'exclusive', targetKey: `workspace:${action.target.workspaceId}` }
        } else if (action.type === 'tab-create') {
          beginOptions = { topology: 'exclusive', targetKey: `workspace:${action.workspaceId}`, paneId: action.target.paneId }
        } else if (action.type === 'tab-close') {
          beginOptions = { topology: 'exclusive', targetKey: `tab:${action.target.tabId}` }
        } else {
          beginOptions = { topology: 'shared', targetKey: action.target.paneId, paneId: action.target.paneId }
        }

        const admission = coordinator.beginAction(action.operationId, beginOptions, fingerprint)

        if (admission.kind === 'replay') {
          return new Response(
            JSON.stringify(admission.body),
            { status: admission.status, headers: { 'content-type': 'application/json' } }
          )
        }

        if (admission.kind === 'conflict') {
          return new Response(
            JSON.stringify({ ok: false, error: admission.error }),
            { status: admission.status, headers: { 'content-type': 'application/json' } }
          )
        }

        if (admission.kind === 'in_flight' || admission.kind === 'contention') {
          return new Response(
            JSON.stringify({ ok: false, error: admission.error }),
            { status: admission.status, headers: { 'content-type': 'application/json' } }
          )
        }

        const attemptToken = admission.token

        let finalized = false
        const safeComplete = (status: number, body: any) => {
          if (!finalized) {
            finalized = true
            coordinator.completeAction(attemptToken, status, body)
          }
        }
        const safeAbandon = () => {
          if (!finalized) {
            finalized = true
            coordinator.abandonAction(attemptToken)
          }
        }

        try {
          // 2. Authoritative snapshot preflight verification
          let snapshot: ISnapshotResult
          try {
            const fetchSnapshot = options.deps?.fetchSnapshot ?? getHerdrSnapshot
            snapshot = await fetchSnapshot(3000)
          } catch (snapErr) {
            // Snapshot fetch failure remains uncached and abandons claim so same operation ID may later succeed!
            safeAbandon()
            const errorBody = {
              ok: false,
              outcome: 'rejected' as const,
              error: `Snapshot preflight failed: ${snapErr instanceof Error ? snapErr.message : String(snapErr)}`
            }
            return new Response(
              JSON.stringify(errorBody),
              { status: 502, headers: { 'content-type': 'application/json' } }
            )
          }

          if (
            action.type === 'prompt' ||
            action.type === 'terminal-input' ||
            action.type === 'keys' ||
            action.type === 'tab-create'
          ) {
            const verifyFn = options.deps?.verifyTarget ?? verifyTargetAgainstSnapshot
            const preflight = verifyFn(snapshot, action.target, {
              isTabCreate: action.type === 'tab-create',
              actionType: action.type
            })
            if (!preflight.ok) {
              const status = preflight.status || 409
              const errorBody = { ok: false, outcome: 'rejected' as const, error: preflight.error }
              // Authoritative target/mode/session mismatch remains a definitive cached rejection!
              safeComplete(status, errorBody)
              return new Response(
                JSON.stringify(errorBody),
                { status, headers: { 'content-type': 'application/json' } }
              )
            }
          }

          try {
            let responseBody: any
            let responseStatus = 200

            if (action.type === 'prompt') {
              const promptFn = options.deps?.executePrompt ?? executePrompt
              const res = await promptFn(action.target.paneId, action.text)
              responseBody = { ok: true, outcome: 'acknowledged', result: res }
              responseStatus = 200
            } else if (action.type === 'terminal-input') {
              const inputFn = options.deps?.executeTerminalInput ?? executeTerminalInput
              const res = await inputFn(action.target.paneId, action.text)
              responseBody = { ok: true, outcome: 'acknowledged', result: res }
              responseStatus = 200
            } else if (action.type === 'keys') {
              const keysFn = options.deps?.executeKeys ?? executeKeys
              const res = await keysFn(action.target.paneId, action.keys)
              responseBody = { ok: true, outcome: 'acknowledged', result: res }
              responseStatus = 200
            } else if (action.type === 'tab-create') {
              const tabCreateFn = options.deps?.executeTabCreate ?? executeTabCreate
              const res = await tabCreateFn(action.workspaceId, action.target, action.label, {
                preSnapshot: snapshot
              })
              responseStatus = res.status ?? (res.ok ? 200 : 500)
              responseBody = res
            } else if (action.type === 'workspace-create') {
              const workspaceCreateFn = options.deps?.executeWorkspaceCreate ?? executeWorkspaceCreate
              const res = await workspaceCreateFn(action.label, action.source, {
                preSnapshot: snapshot
              })
              responseStatus = res.status ?? (res.ok ? 200 : 500)
              responseBody = res
            } else if (action.type === 'workspace-close') {
              const workspaceCloseFn = options.deps?.executeWorkspaceClose ?? executeWorkspaceClose
              // Close mutations perform their own immediately-before-RPC snapshot fetch so
              // the client-confirmed membership manifest cannot race this earlier route snapshot.
              const res = await workspaceCloseFn(action.target)
              responseStatus = res.status ?? (res.ok ? 200 : 500)
              responseBody = res
            } else if (action.type === 'tab-close') {
              const tabCloseFn = options.deps?.executeTabClose ?? executeTabClose
              const res = await tabCloseFn(action.target)
              responseStatus = res.status ?? (res.ok ? 200 : 500)
              responseBody = res
            }

            safeComplete(responseStatus, responseBody)
            return new Response(JSON.stringify(responseBody), {
              status: responseStatus,
              headers: { 'content-type': 'application/json' }
            })
          } catch (actionErr) {
            const isTimeout =
              actionErr instanceof Error &&
              (actionErr.name === 'TimeoutError' ||
                actionErr.message.toLowerCase().includes('timeout') ||
                actionErr.message.toLowerCase().includes('timed out'))

            const isDefinitiveNotFound =
              (actionErr instanceof HerdrSocketError && actionErr.code === 'pane_not_found') ||
              (actionErr instanceof Error && actionErr.message.includes('does not exist'))

            let status = 500
            let outcome: 'rejected' | 'unknown' = 'unknown'
            const errorMsg = actionErr instanceof Error ? actionErr.message : String(actionErr)

            if (isDefinitiveNotFound) {
              status = 404
              outcome = 'rejected'
            } else if (isTimeout) {
              status = 504
              outcome = 'unknown'
            } else {
              status = 502
              outcome = 'unknown'
            }

            const errorBody = {
              ok: false,
              outcome,
              error: errorMsg
            }

            safeComplete(status, errorBody)

            return new Response(
              JSON.stringify(errorBody),
              {
                status,
                headers: { 'content-type': 'application/json' }
              }
            )
          }
        } catch (unexpectedPreDispatchErr) {
          safeAbandon()
          const errorMsg =
            unexpectedPreDispatchErr instanceof Error
              ? unexpectedPreDispatchErr.message
              : String(unexpectedPreDispatchErr)
          return new Response(
            JSON.stringify({
              ok: false,
              outcome: 'rejected',
              error: `Pre-dispatch error: ${errorMsg}`
            }),
            { status: 502, headers: { 'content-type': 'application/json' } }
          )
        } finally {
          if (!finalized) {
            safeAbandon()
          }
        }
      }

      // GET /api/interactions/catalog
      if (req.method === 'GET' && pathname === '/api/interactions/catalog') {
        if (!isHostAllowed(hostHeader)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Forbidden: host not authorized' }),
            { status: 403, headers: { 'content-type': 'application/json' } }
          )
        }
        if (originHeader && !isOriginAllowed(originHeader, hostHeader)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Forbidden: origin not authorized' }),
            { status: 403, headers: { 'content-type': 'application/json' } }
          )
        }

        const paneParam = url.searchParams.get('pane')?.trim()
        if (!paneParam || !PANE_ID_REGEX.test(paneParam)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Invalid or missing "pane" query param' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        const terminalIdParam = url.searchParams.get('terminalId')?.trim()
        if (!terminalIdParam || !CONSERVATIVE_TOKEN_REGEX.test(terminalIdParam) || terminalIdParam.length > 128) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Invalid or missing "terminalId" query param' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        try {
          const snapshot = await getHerdrSnapshot(3000)
          const targetPane = (snapshot.panes || []).find((p) => p && p.pane_id === paneParam)
          if (!targetPane) {
            return new Response(
              JSON.stringify({ ok: false, error: `Pane "${paneParam}" not found in active session` }),
              { status: 404, headers: { 'content-type': 'application/json' } }
            )
          }

          if (targetPane.terminal_id !== terminalIdParam) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: `Terminal replacement detected: pane "${paneParam}" terminal is "${targetPane.terminal_id ?? ''}", expected "${terminalIdParam}"`
              }),
              { status: 409, headers: { 'content-type': 'application/json' } }
            )
          }

          const derivedCwd = targetPane.foreground_cwd || targetPane.cwd || ''
          const catalogResult = resolveNearestRepoCatalog(derivedCwd)

          if (catalogResult.kind === 'invalid') {
            return new Response(
              JSON.stringify({
                ok: false,
                error: catalogResult.error
              }),
              { status: 422, headers: { 'content-type': 'application/json' } }
            )
          }

          return new Response(
            JSON.stringify({
              ok: true,
              source: 'repo-config',
              catalog: catalogResult.catalog
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        } catch (snapErr) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: `Snapshot preflight failed: ${snapErr instanceof Error ? snapErr.message : String(snapErr)}`
            }),
            { status: 502, headers: { 'content-type': 'application/json' } }
          )
        }
      }

      // GET /api/pane/read
      if (req.method === 'GET' && pathname === '/api/pane/read') {
        if (!isHostAllowed(hostHeader)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Forbidden: host not authorized' }),
            {
              status: 403,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        const paramValidation = validatePaneReadParams(url)
        if (!paramValidation.valid || !paramValidation.data) {
          return new Response(
            JSON.stringify({ ok: false, error: paramValidation.error || 'Invalid pane read parameters' }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        try {
          const res = await readPaneContent(paramValidation.data.pane, {
            source: paramValidation.data.source,
            lines: paramValidation.data.lines
          })
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        } catch (readErr) {
          const msg = readErr instanceof Error ? readErr.message : String(readErr)
          const isNotFound =
            (readErr instanceof HerdrSocketError && readErr.code === 'pane_not_found') ||
            msg.includes('does not exist') ||
            msg.includes('not found')
          const status = isNotFound ? 404 : 502
          return new Response(
            JSON.stringify({ ok: false, error: msg }),
            {
              status,
              headers: { 'content-type': 'application/json' }
            }
          )
        }
      }

      // GET /api/agent/explain
      if (req.method === 'GET' && pathname === '/api/agent/explain') {
        if (!isHostAllowed(hostHeader)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Forbidden: host not authorized' }),
            {
              status: 403,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        const paramValidation = validateAgentExplainParams(url)
        if (!paramValidation.valid || !paramValidation.data) {
          return new Response(
            JSON.stringify({ ok: false, error: paramValidation.error || 'Invalid agent explain parameters' }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' }
            }
          )
        }

        try {
          const res = await getAgentExplain(paramValidation.data.pane)
          return new Response(JSON.stringify(res), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        } catch (explainErr) {
          const msg = explainErr instanceof Error ? explainErr.message : String(explainErr)
          const isNotFound =
            (explainErr instanceof HerdrSocketError && explainErr.code === 'pane_not_found') ||
            msg.includes('does not exist') ||
            (msg.includes('not found') && msg.toLowerCase().includes('pane'))
          const status = isNotFound ? 404 : 502
          return new Response(
            JSON.stringify({
              ok: false,
              error: isNotFound
                ? `Pane "${paramValidation.data.pane}" does not exist in the active Herdr session`
                : 'Failed to explain agent status'
            }),
            {
              status,
              headers: { 'content-type': 'application/json' }
            }
          )
        }
      }

      // GET /api/push/config
      if (req.method === 'GET' && pathname === '/api/push/config') {
        if (!isHostAllowed(hostHeader)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Forbidden: host not authorized' }),
            { status: 403, headers: { 'content-type': 'application/json' } }
          )
        }

        if (getTransportMode() === 'cli') {
          return new Response(
            JSON.stringify({
              ok: true,
              enabled: false,
              reason: 'Push notifications require socket transport mode'
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }

        const pushService = getSharedPushService()
        const config = pushService.getPublicConfig()
        return new Response(JSON.stringify(config), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      // POST /api/push/click-diagnostic (temporary fixed-enum physical-device receipts)
      if (req.method === 'POST' && pathname === '/api/push/click-diagnostic') {
        const pushService = getSharedPushService()
        const auth = validatePushAuth(req, hostHeader, originHeader, pushService.getConfig()?.ownerLogin)
        if (!auth.allowed) {
          return new Response(
            JSON.stringify({ ok: false, error: auth.error || 'Forbidden: unauthorized' }),
            { status: auth.status, headers: { 'content-type': 'application/json' } }
          )
        }

        const bodyParsed = await parseBoundedJsonBody(req, 256)
        const stage = bodyParsed.ok && bodyParsed.data && typeof bodyParsed.data === 'object'
          ? (bodyParsed.data as Record<string, unknown>).stage
          : null
        if (typeof stage !== 'string' || !PUSH_CLICK_DIAGNOSTIC_STAGES.has(stage)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Invalid push click diagnostic stage' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        console.info(`[herdr-push-click] ${stage}`)
        return new Response(null, { status: 204 })
      }

      // POST /api/push/subscriptions
      if (req.method === 'POST' && pathname === '/api/push/subscriptions') {
        if (getTransportMode() === 'cli') {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push notifications unavailable in CLI transport mode; socket transport is required.' }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          )
        }

        const pushService = getSharedPushService()
        if (!pushService.isEnabled()) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push service unavailable: not configured' }),
            { status: 503, headers: { 'content-type': 'application/json' } }
          )
        }

        const auth = validatePushAuth(req, hostHeader, originHeader, pushService.getConfig()?.ownerLogin)
        if (!auth.allowed) {
          return new Response(
            JSON.stringify({ ok: false, error: auth.error || 'Forbidden: unauthorized' }),
            { status: auth.status, headers: { 'content-type': 'application/json' } }
          )
        }

        const bodyParsed = await parseBoundedJsonBody(req, 4096)
        if (!bodyParsed.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: bodyParsed.error }),
            { status: bodyParsed.status || 400, headers: { 'content-type': 'application/json' } }
          )
        }

        const validation = validatePushSubscriptionPayload(bodyParsed.data)
        if (!validation.valid || !validation.data) {
          return new Response(
            JSON.stringify({ ok: false, error: validation.error || 'Invalid push subscription payload' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        try {
          await pushService.registerSubscription(validation.data)
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        } catch {
          return new Response(
            JSON.stringify({ ok: false, error: 'Failed to register subscription' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          )
        }
      }

      // DELETE /api/push/subscriptions
      if (req.method === 'DELETE' && pathname === '/api/push/subscriptions') {
        if (getTransportMode() === 'cli') {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push notifications unavailable in CLI transport mode; socket transport is required.' }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          )
        }

        const pushService = getSharedPushService()
        if (!pushService.isEnabled()) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push service unavailable: not configured' }),
            { status: 503, headers: { 'content-type': 'application/json' } }
          )
        }

        const auth = validatePushAuth(req, hostHeader, originHeader, pushService.getConfig()?.ownerLogin)
        if (!auth.allowed) {
          return new Response(
            JSON.stringify({ ok: false, error: auth.error || 'Forbidden: unauthorized' }),
            { status: auth.status, headers: { 'content-type': 'application/json' } }
          )
        }

        const bodyParsed = await parseBoundedJsonBody(req, 4096)
        if (!bodyParsed.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: bodyParsed.error }),
            { status: bodyParsed.status || 400, headers: { 'content-type': 'application/json' } }
          )
        }

        const validation = validatePushEndpointPayload(bodyParsed.data)
        if (!validation.valid || !validation.data) {
          return new Response(
            JSON.stringify({ ok: false, error: validation.error || 'Invalid push endpoint payload' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        try {
          await pushService.removeSubscription(validation.data.endpoint)
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        } catch {
          return new Response(
            JSON.stringify({ ok: false, error: 'Failed to delete subscription' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          )
        }
      }

      // POST /api/push/test
      if (req.method === 'POST' && pathname === '/api/push/test') {
        if (getTransportMode() === 'cli') {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push notifications unavailable in CLI transport mode; socket transport is required.' }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          )
        }

        const pushService = getSharedPushService()
        if (!pushService.isEnabled()) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push service unavailable: not configured' }),
            { status: 503, headers: { 'content-type': 'application/json' } }
          )
        }

        const auth = validatePushAuth(req, hostHeader, originHeader, pushService.getConfig()?.ownerLogin)
        if (!auth.allowed) {
          return new Response(
            JSON.stringify({ ok: false, error: auth.error || 'Forbidden: unauthorized' }),
            { status: auth.status, headers: { 'content-type': 'application/json' } }
          )
        }

        const bodyParsed = await parseBoundedJsonBody(req, 4096)
        if (!bodyParsed.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: bodyParsed.error }),
            { status: bodyParsed.status || 400, headers: { 'content-type': 'application/json' } }
          )
        }

        const validation = validatePushEndpointPayload(bodyParsed.data)
        if (!validation.valid || !validation.data) {
          return new Response(
            JSON.stringify({ ok: false, error: validation.error || 'Invalid push endpoint payload' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        try {
          const result = await pushService.sendTest(validation.data.endpoint)
          if (!result.ok) {
            const isNotFound = result.error === 'Subscription not found in store'
            return new Response(
              JSON.stringify({ ok: false, error: result.error || 'Test notification failed' }),
              { status: isNotFound ? 404 : 502, headers: { 'content-type': 'application/json' } }
            )
          }

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        } catch {
          return new Response(
            JSON.stringify({ ok: false, error: 'Test notification failed' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          )
        }
      }

      // GET /api/push/tab-policy
      if (req.method === 'GET' && pathname === '/api/push/tab-policy') {
        if (getTransportMode() === 'cli') {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push notifications unavailable in CLI transport mode; socket transport is required.' }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          )
        }

        const pushService = getSharedPushService()
        if (!pushService.isEnabled()) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push service unavailable: not configured' }),
            { status: 503, headers: { 'content-type': 'application/json' } }
          )
        }

        const auth = validatePushAuth(req, hostHeader, originHeader, pushService.getConfig()?.ownerLogin, { requireOrigin: false })
        if (!auth.allowed) {
          return new Response(
            JSON.stringify({ ok: false, error: auth.error || 'Forbidden: unauthorized' }),
            { status: auth.status, headers: { 'content-type': 'application/json' } }
          )
        }

        let snapshot: ISnapshotResult
        try {
          snapshot = await getHerdrSnapshot(5000)
        } catch (err) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Failed to fetch authoritative snapshot' }),
            { status: 502, headers: { 'content-type': 'application/json' } }
          )
        }

        let overrides: ITabPolicyOverrideRecord[]
        try {
          overrides = await pushService.getTabPolicyStore().getOverrides()
        } catch {
          return new Response(
            JSON.stringify({ ok: false, error: 'Failed to read tab policy store' }),
            { status: 500, headers: { 'content-type': 'application/json' } }
          )
        }

        const tabs = resolveEffectiveTabPolicy(snapshot.workspaces || [], snapshot.tabs || [], overrides)
        return new Response(JSON.stringify({ ok: true, tabs }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      // PUT or POST /api/push/tab-policy
      if ((req.method === 'PUT' || req.method === 'POST') && pathname === '/api/push/tab-policy') {
        if (getTransportMode() === 'cli') {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push notifications unavailable in CLI transport mode; socket transport is required.' }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          )
        }

        const pushService = getSharedPushService()
        if (!pushService.isEnabled()) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Push service unavailable: not configured' }),
            { status: 503, headers: { 'content-type': 'application/json' } }
          )
        }

        const auth = validatePushAuth(req, hostHeader, originHeader, pushService.getConfig()?.ownerLogin)
        if (!auth.allowed) {
          return new Response(
            JSON.stringify({ ok: false, error: auth.error || 'Forbidden: unauthorized' }),
            { status: auth.status, headers: { 'content-type': 'application/json' } }
          )
        }

        const bodyParsed = await parseBoundedJsonBody(req, 1024)
        if (!bodyParsed.ok || !bodyParsed.data || typeof bodyParsed.data !== 'object') {
          return new Response(
            JSON.stringify({ ok: false, error: bodyParsed.error || 'Malformed JSON payload' }),
            { status: bodyParsed.status || 400, headers: { 'content-type': 'application/json' } }
          )
        }

        const raw = bodyParsed.data as Record<string, unknown>
        if (typeof raw.tabId !== 'string' || raw.tabId.trim().length === 0 || raw.tabId.length > 128) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Missing or invalid "tabId"' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        if (typeof raw.enabled !== 'boolean') {
          return new Response(
            JSON.stringify({ ok: false, error: 'Missing or invalid boolean "enabled"' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        const targetTabId = raw.tabId.trim()
        const targetEnabled = raw.enabled

        const topoClaim = coordinator.claimSharedTopology('tab-policy')
        if (!topoClaim.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: topoClaim.error }),
            { status: topoClaim.status, headers: { 'content-type': 'application/json' } }
          )
        }

        try {
          let snapshot: ISnapshotResult
          try {
            snapshot = await getHerdrSnapshot(5000)
          } catch (err) {
            return new Response(
              JSON.stringify({ ok: false, error: 'Failed to fetch authoritative snapshot' }),
              { status: 502, headers: { 'content-type': 'application/json' } }
            )
          }

          if (!Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.tabs) || !Array.isArray(snapshot.panes)) {
            return new Response(
              JSON.stringify({ ok: false, error: 'Malformed authoritative snapshot topology' }),
              { status: 502, headers: { 'content-type': 'application/json' } }
            )
          }

          const currentTabs = snapshot.tabs
          const currentWorkspaces = snapshot.workspaces

          const matchingTabs = currentTabs.filter((t) => t && t.tab_id === targetTabId)
          if (matchingTabs.length === 0) {
            return new Response(
              JSON.stringify({ ok: false, error: 'Tab not found in active session' }),
              { status: 404, headers: { 'content-type': 'application/json' } }
            )
          }
          if (matchingTabs.length > 1) {
            return new Response(
              JSON.stringify({ ok: false, error: 'Ambiguous duplicate tab ID in active session' }),
              { status: 400, headers: { 'content-type': 'application/json' } }
            )
          }

          const liveTab = matchingTabs[0]
          const matchingWorkspaces = currentWorkspaces.filter((workspace) => workspace && workspace.workspace_id === liveTab.workspace_id)
          if (matchingWorkspaces.length !== 1) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: matchingWorkspaces.length > 1
                  ? 'Ambiguous duplicate workspace ID in active session'
                  : 'Workspace not found for tab'
              }),
              { status: 400, headers: { 'content-type': 'application/json' } }
            )
          }
          const liveWorkspace = matchingWorkspaces[0]

          if (!Number.isFinite(liveTab.number) || !Number.isFinite(liveWorkspace.number)) {
            return new Response(
              JSON.stringify({ ok: false, error: 'Invalid non-finite tab or workspace number' }),
              { status: 400, headers: { 'content-type': 'application/json' } }
            )
          }

          const ownerMap = resolveWorkspaceOwnerTabs(currentTabs)
          const isDefaultOwner = ownerMap.get(liveWorkspace.workspace_id) === liveTab.tab_id

          let updatedOverrides: ITabPolicyOverrideRecord[]
          try {
            updatedOverrides = await pushService
              .getTabPolicyStore()
              .setTabOverride(liveWorkspace, liveTab, targetEnabled, isDefaultOwner)
          } catch {
            return new Response(
              JSON.stringify({ ok: false, error: 'Failed to write tab policy store' }),
              { status: 500, headers: { 'content-type': 'application/json' } }
            )
          }

          const refreshedTabs = resolveEffectiveTabPolicy(currentWorkspaces, currentTabs, updatedOverrides)
          return new Response(
            JSON.stringify({ ok: true, tabs: refreshedTabs }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        } finally {
          coordinator.releaseSharedTopology(topoClaim.token)
        }
      }

      // WebSocket /api/events (strict-origin browser event transport)
      if (pathname === '/api/events') {
        if (!originHeader || !isOriginAllowed(originHeader, hostHeader)) {
          return new Response('Forbidden: origin not authorized', { status: 403 })
        }

        if (getTransportMode() === 'cli') {
          return new Response('Event bridge unavailable in CLI transport mode; use HTTP snapshot polling.', { status: 409 })
        }

        const upgraded = server.upgrade(req, {
          data: {
            kind: 'events'
          }
        })

        if (upgraded) {
          return undefined
        }

        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      // WebSocket /api/terminal (observer stream)
      if (pathname === '/api/terminal') {
        if (!originHeader || !isOriginAllowed(originHeader, hostHeader)) {
          return new Response('Forbidden: origin not authorized', { status: 403 })
        }

        const paramValidation = validateTerminalParams(url)
        if (!paramValidation.valid || !paramValidation.data) {
          return new Response(
            JSON.stringify({ error: paramValidation.error }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        // Validate pane against a fresh snapshot before upgrading
        try {
          const snapshot = await getHerdrSnapshot(3000)
          if (!validatePaneInSnapshot(snapshot, paramValidation.data.pane)) {
            return new Response(
              JSON.stringify({ error: `Pane "${paramValidation.data.pane}" not found in active session` }),
              { status: 404, headers: { 'content-type': 'application/json' } }
            )
          }
        } catch (snapErr) {
          return new Response(
            JSON.stringify({ error: `Snapshot verification failed: ${snapErr instanceof Error ? snapErr.message : String(snapErr)}` }),
            { status: 502, headers: { 'content-type': 'application/json' } }
          )
        }

        const upgraded = server.upgrade(req, {
          data: {
            kind: 'terminal',
            pane: paramValidation.data.pane,
            cols: paramValidation.data.cols,
            rows: paramValidation.data.rows
          }
        })

        if (upgraded) {
          return undefined
        }

        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      // GET /api/terminal/control/status - read-only terminal control lease status
      if (pathname === '/api/terminal/control/status') {
        if (req.method !== 'GET') {
          return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'content-type': 'application/json' }
          })
        }

        const auth = validateOwnerAuth(
          req,
          hostHeader,
          originHeader,
          getConfiguredOwnerLogin(),
          { requireOrigin: false }
        )
        if (!auth.allowed) {
          return new Response(JSON.stringify({ error: auth.error || 'Forbidden: unauthorized' }), {
            status: auth.status,
            headers: { 'content-type': 'application/json' }
          })
        }

        const paramValidation = validateTerminalControlStatusParams(url)
        if (!paramValidation.valid || !paramValidation.data) {
          return new Response(
            JSON.stringify({ error: paramValidation.error || 'Invalid terminal control status parameters' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        const { pane } = paramValidation.data

        if (getTransportMode() === 'cli') {
          // CLI mode does not support terminal control; no pane can be leased.
          // Return bounded unleased status consistently without leaking process info.
          return new Response(
            JSON.stringify({
              ok: true,
              pane,
              leased: false,
              status: null
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }

        const leaseStatus = leaseManager.getLeaseStatus(pane)
        return new Response(
          JSON.stringify({
            ok: true,
            pane,
            leased: leaseStatus.leased,
            status: leaseStatus.status
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }

      // WebSocket /api/terminal/control (shell-only opt-in control session)
      if (pathname === '/api/terminal/control') {
        const auth = validateOwnerAuth(
          req,
          hostHeader,
          originHeader,
          getConfiguredOwnerLogin(),
          { requireOrigin: true }
        )
        if (!auth.allowed) {
          return new Response(JSON.stringify({ error: auth.error || 'Forbidden: unauthorized' }), {
            status: auth.status,
            headers: { 'content-type': 'application/json' }
          })
        }

        if (getTransportMode() === 'cli') {
          return new Response(
            JSON.stringify({ error: 'Terminal control is unavailable in CLI transport mode; socket transport is required.' }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          )
        }

        const paramValidation = validateTerminalControlParams(url)
        if (!paramValidation.valid || !paramValidation.data) {
          return new Response(
            JSON.stringify({ error: paramValidation.error || 'Invalid terminal control parameters' }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }

        const { pane, cols, rows } = paramValidation.data

        // Atomically reserve lease before upgrading
        const reservation = leaseManager.reserveLease(pane)
        if (!reservation.ok) {
          return new Response(
            JSON.stringify({ error: reservation.error }),
            { status: reservation.status, headers: { 'content-type': 'application/json' } }
          )
        }

        const leaseId = reservation.lease.id

        try {
          // Preflight shell pane before upgrading
          const preflight = await preflightShellPane(pane)
          if (!preflight.ok || preflight.shellPid === undefined || preflight.pgid === undefined) {
            await leaseManager.releaseLease(leaseId, 'preflight_failed')
            const code = !preflight.ok ? preflight.code : 'invalid_process_info'
            const status = !preflight.ok ? preflight.status : 409
            return new Response(
              JSON.stringify({ error: getPublicPreflightErrorMessage(code), code }),
              { status, headers: { 'content-type': 'application/json' } }
            )
          }

          // Verify exact lease ID is still pending and unexpired before upgrading
          if (!leaseManager.isLeasePending(leaseId)) {
            await leaseManager.releaseLease(leaseId, 'lease_expired_or_invalidated')
            return new Response(
              JSON.stringify({ error: 'Terminal control lease expired or was invalidated during preflight' }),
              { status: 409, headers: { 'content-type': 'application/json' } }
            )
          }

          const upgraded = server.upgrade(req, {
            data: {
              kind: 'terminal-control',
              pane,
              cols,
              rows,
              leaseId,
              shellPid: preflight.shellPid,
              pgid: preflight.pgid,
              controlReady: false
            }
          })

          if (upgraded) {
            return undefined
          }

          await leaseManager.releaseLease(leaseId, 'upgrade_failed')
          return new Response(JSON.stringify({ error: 'WebSocket upgrade failed' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          })
        } catch (err) {
          await leaseManager.releaseLease(leaseId, 'preflight_failed')
          throw err
        }
      }

      // Service worker serving (from build/client/ or public/ development fallback)
      if (pathname === '/sw.js') {
        const swBuild = Bun.file('build/client/sw.js')
        if (await swBuild.exists()) {
          return new Response(swBuild, {
            headers: {
              'content-type': 'application/javascript; charset=utf-8',
              'cache-control': 'no-cache'
            }
          })
        }
        const swPublic = Bun.file('public/sw.js')
        if (await swPublic.exists()) {
          return new Response(swPublic, {
            headers: {
              'content-type': 'application/javascript; charset=utf-8',
              'cache-control': 'no-cache'
            }
          })
        }
      }

      // Static file serving from build/client/
      const filePath = pathname === '/' ? '/index.html' : pathname
      const buildFile = Bun.file(`build/client${filePath}`)
      if (await buildFile.exists()) {
        return new Response(buildFile)
      }

      const buildIndexFile = Bun.file('build/client/index.html')
      if (await buildIndexFile.exists()) {
        return new Response(buildIndexFile, {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      }

      return new Response('Herdr Web API server is running on 127.0.0.1:8787. Run "bun run build" or connect Vite dev server on 5173.', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === 'events') {
          const bridge = getSharedSnapshotBridge()
          bridge.start()
          ws.data.closed = false

          // Send current status immediately
          ws.send(JSON.stringify({ type: 'status', status: bridge.getStatus() }))

          // Send current snapshot if available
          const currentSnap = bridge.getLatestSnapshot()
          if (currentSnap) {
            ws.send(JSON.stringify({ type: 'snapshot', data: currentSnap }))
          }

          const unsubSnapshot = bridge.onSnapshot((snapshot) => {
            if (!ws.data.closed && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }))
            }
          })

          const unsubStatus = bridge.onStatus((status) => {
            if (!ws.data.closed && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'status', status }))
            }
          })

          ws.data.unsubscribeSnapshot = unsubSnapshot
          ws.data.unsubscribeStatus = unsubStatus
          return
        }

        // ws.data.kind === 'terminal-control'
        if (ws.data.kind === 'terminal-control') {
          const { pane, cols, rows, leaseId, shellPid, pgid } = ws.data
          ws.data.closed = false
          ws.data.controlReady = false

          let proc: ReturnType<typeof spawnTerminalControlProcess>
          try {
            proc = spawnTerminalControlProcess(pane, cols, rows)
            ws.data.proc = proc
          } catch {
            void leaseManager.releaseLease(leaseId, 'spawn_failed')
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'control.error', error: 'Failed to spawn terminal control process' }))
              ws.close()
            }
            return
          }

          const activated = leaseManager.activateLease(leaseId, proc, ws)
          if (!activated) {
            try { proc.kill() } catch {}
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'control.error', error: 'Failed to activate terminal control lease' }))
              ws.close()
            }
            return
          }

          // Post-spawn recheck before reporting ready (fail-closed if shell/topology changed)
          void preflightShellPane(pane).then(async (recheck) => {
            if (ws.data.closed || ws.data.kind !== 'terminal-control') return
            if (
              !recheck.ok ||
              recheck.paneId !== pane ||
              recheck.shellPid !== shellPid ||
              recheck.pgid !== pgid
            ) {
              const reason = !recheck.ok ? 'post_spawn_recheck_failed' : 'shell_process_changed'
              await leaseManager.releaseLease(leaseId, reason)
              if (ws.readyState === 1 && !ws.data.closed) {
                ws.send(JSON.stringify({
                  type: 'control.error',
                  error: 'Terminal control preflight mismatch after spawn'
                }))
                ws.close()
              }
              return
            }

            // Immediately before setting controlReady/sending control.ready, verify exact same lease ID is still active and WS is open
            if (!leaseManager.isLeaseActive(leaseId) || ws.readyState !== 1 || ws.data.closed) {
              await leaseManager.releaseLease(leaseId, 'lease_no_longer_active')
              if (ws.readyState === 1 && !ws.data.closed) {
                ws.send(JSON.stringify({
                  type: 'control.error',
                  error: 'Terminal control lease is no longer active'
                }))
                ws.close()
              }
              return
            }

            // Post-spawn identity verified: mark controlReady = true immediately before emitting control.ready
            ws.data.controlReady = true

            // Report control.ready to browser
            const activeLease = leaseManager.getActiveLease()
            const remainingMs = activeLease ? Math.max(0, activeLease.expiresAt - Date.now()) : MAX_LEASE_DURATION_MS
            if (ws.readyState === 1 && !ws.data.closed) {
              ws.send(JSON.stringify({
                type: 'control.ready',
                pane,
                leaseDurationMs: remainingMs
              }))
            }
          })

          // Read child stdout with bounded line length (<= 1 MiB)
          const reader = proc.stdout.getReader()
          const decoder = new TextDecoder('utf-8', { fatal: false })
          let buffer = ''

          const readControlStdout = async () => {
            try {
              while (!ws.data.closed) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                if (buffer.length > MAX_STDOUT_LINE_BYTES * 2) {
                  await leaseManager.releaseLease(leaseId, 'stdout_line_limit_exceeded')
                  if (ws.readyState === 1 && !ws.data.closed) {
                    ws.send(JSON.stringify({ type: 'control.error', error: 'Terminal stdout buffer limit exceeded' }))
                    ws.close()
                  }
                  return
                }

                const lines = buffer.split('\n')
                buffer = lines.pop() || ''
                for (const line of lines) {
                  const trimmed = line.trim()
                  if (!trimmed) continue

                  const validation = parseAndValidateUpstreamTerminalMessage(trimmed)
                  if (!validation.valid || !validation.data) {
                    await leaseManager.releaseLease(leaseId, 'malformed_upstream_envelope')
                    if (ws.readyState === 1 && !ws.data.closed) {
                      ws.send(JSON.stringify({ type: 'control.error', error: 'Malformed upstream terminal frame' }))
                      ws.close()
                    }
                    return
                  }

                  const parsed = validation.data
                  if (parsed.type === 'terminal.closed') {
                    await leaseManager.releaseLease(leaseId, parsed.reason || 'child_closed')
                    return
                  }

                  if (ws.readyState === 1 && !ws.data.closed) {
                    ws.send(JSON.stringify(parsed))
                  }
                }
              }
            } catch {
            } finally {
              if (!ws.data.closed) {
                await leaseManager.releaseLease(leaseId, 'stream_ended')
              }
            }
          }

          readControlStdout()

          // Bounded stderr reading with sanitization and immediate lease release
          const errReader = proc.stderr.getReader()
          const readControlStderr = async () => {
            try {
              const { value } = await errReader.read()
              if (value && !ws.data.closed) {
                const rawErr = decoder.decode(value)
                const category = sanitizeStderrToCategory(rawErr)
                if (category !== 'empty') {
                  console.warn(`[terminal-control] Child stderr: ${category}`)
                  await leaseManager.releaseLease(leaseId, `stderr_${category}`)
                  if (ws.readyState === 1 && !ws.data.closed) {
                    ws.send(JSON.stringify({ type: 'terminal.closed', reason: category }))
                    ws.close()
                  }
                  return
                }
              }
            } catch {}
          }
          readControlStderr()

          // Child exit monitoring
          proc.exited.then(async (exitCode) => {
            if (!ws.data.closed) {
              await leaseManager.releaseLease(leaseId, `process exited with code ${exitCode}`)
            }
          })

          return
        }

        // ws.data.kind === 'terminal'
        const { pane, cols, rows } = ws.data
        const proc = spawnObserverProcess(pane, cols, rows)
        ws.data.proc = proc
        ws.data.closed = false

        // Stream stdout line-by-line (NDJSON)
        const reader = proc.stdout.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        const readStream = async () => {
          try {
            while (!ws.data.closed) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''
              for (const line of lines) {
                const trimmed = line.trim()
                if (trimmed.length > 0 && ws.readyState === 1) {
                  ws.send(trimmed)
                }
              }
            }
          } catch {
            // Stream closed or broken
          } finally {
            if (!ws.data.closed && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'terminal.closed', reason: 'stream_ended' }))
              ws.close()
            }
          }
        }

        readStream()

        // Capture stderr for bounded failures
        const errReader = proc.stderr.getReader()
        const readErr = async () => {
          try {
            const { value } = await errReader.read()
            if (value && ws.readyState === 1 && !ws.data.closed) {
              const errText = decoder.decode(value).slice(0, 500)
              if (errText.trim()) {
                ws.send(JSON.stringify({ type: 'terminal.closed', reason: errText.trim() }))
              }
            }
          } catch {}
        }
        readErr()

        // Monitor process exit
        proc.exited.then((exitCode) => {
          if (!ws.data.closed && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'terminal.closed', reason: `process exited with code ${exitCode}` }))
            ws.close()
          }
        })
      },
      close(ws) {
        ws.data.closed = true
        if (ws.data.kind === 'events') {
          ws.data.unsubscribeSnapshot?.()
          ws.data.unsubscribeStatus?.()
          return
        }

        if (ws.data.kind === 'terminal-control') {
          void leaseManager.releaseLease(ws.data.leaseId, 'websocket_closed')
          return
        }

        if (ws.data.proc) {
          try {
            ws.data.proc.kill()
          } catch {}
        }
      },
      message(ws, message) {
        if (ws.data.kind === 'events') {
          return
        }

        if (ws.data.kind === 'terminal-control') {
          const { leaseId, proc } = ws.data
          const activeLease = leaseManager.getActiveLease()
          if (!activeLease || activeLease.id !== leaseId || activeLease.status !== 'active' || ws.data.closed) {
            return
          }

          // Fail closed on any client message received before post-spawn identity recheck succeeds and control.ready is emitted
          if (!ws.data.controlReady) {
            void leaseManager.releaseLease(leaseId, 'pre_ready_input_rejected')
            if (ws.readyState === 1 && !ws.data.closed) {
              ws.send(JSON.stringify({
                type: 'control.error',
                error: 'Terminal control received client message before ready'
              }))
              ws.close()
            }
            return
          }

          const validation = validateTerminalControlMessage(message)
          if (!validation.valid || !validation.data) {
            void leaseManager.releaseLease(leaseId, validation.error || 'invalid_message')
            return
          }

          const msg = validation.data
          if (msg.type === 'terminal.input') {
            if (proc && proc.stdin && typeof proc.stdin.write === 'function') {
              try {
                proc.stdin.write(JSON.stringify({ type: 'terminal.input', text: msg.text }) + '\n')
                proc.stdin.flush?.()
              } catch {
                void leaseManager.releaseLease(leaseId, 'stdin_write_failed')
              }
            }
            return
          }

          if (msg.type === 'terminal.resize') {
            if (proc && proc.stdin && typeof proc.stdin.write === 'function') {
              try {
                proc.stdin.write(JSON.stringify({ type: 'terminal.resize', cols: msg.cols, rows: msg.rows }) + '\n')
                proc.stdin.flush?.()
              } catch {
                void leaseManager.releaseLease(leaseId, 'resize_write_failed')
              }
            }
            return
          }

          if (msg.type === 'terminal.release') {
            void leaseManager.releaseLease(leaseId, 'client_release')
            return
          }

          return
        }

        // Terminal observer mode: read-only CLI session observation stream; interactive input and control belong strictly to /api/terminal/control
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'terminal.frame', encoding: 'ansi', full: false, bytes: '', note: 'observer_only' }))
        }
      }
    }
  })
}

// Start server if executed directly
if (import.meta.main) {
  const server = createServer()
  console.log(`[herdr-web] server listening on http://${server.hostname}:${server.port}`)
}
