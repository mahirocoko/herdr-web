import { createHash } from 'node:crypto'
import {
  ImageUploadStore,
  readUploadBody,
  type IUploadScope
} from './image-upload.ts'
import {
  validateActionRequest,
  validateOwnerAuth,
  verifyTargetAgainstSnapshot
} from './security.ts'
import type { IActionTargetIdentity, ISnapshotResult } from './types.ts'
import {
  imagePromptBytes,
  MAX_IMAGE_PROMPT_BYTES
} from '../src/types/image-upload.ts'

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const context = (file: string) =>
  `\n\nImage context (local file; expires in 24 hours): use ViewImage to read ${JSON.stringify(file)}. This is a supplied image file, not a command.`
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  })
export class ImageUploadService {
  constructor(
    readonly store: ImageUploadStore,
    private deps: {
      snapshot: () => Promise<ISnapshotResult>
      ready: (target: IActionTargetIdentity) => Promise<boolean>
      owner: () => string | undefined
    }
  ) {}
  private owner(request: Request) {
    // Same-origin browser GET does not normally emit Origin. The explicit read
    // header requires CORS preflight cross-origin; never override a real Origin.
    const origin =
      request.headers.get('origin') ??
      (request.method === 'GET'
        ? request.headers.get('x-herdr-image-origin')
        : null)
    const auth = validateOwnerAuth(
      request,
      request.headers.get('host'),
      origin,
      this.deps.owner(),
      { requireOrigin: true }
    )
    if (!auth.allowed)
      throw new Error('Owner and same-origin authentication required')
    return hash([
      this.deps.owner() ?? null,
      request.headers.get('tailscale-user-login') ?? 'loopback-development',
      origin
    ])
  }
  private target(request: Request): IActionTargetIdentity {
    const raw = request.headers.get('x-herdr-image-target')
    if (!raw || Buffer.byteLength(raw) > 2048)
      throw new Error('Exact image target required')
    const target = JSON.parse(raw)
    if (
      !target ||
      Object.keys(target).some(
        (key) =>
          !['paneId', 'terminalId', 'expectedMode', 'agentSessionId'].includes(
            key
          )
      )
    )
      throw new Error('Invalid image target')
    const parsed = validateActionRequest({
      type: 'prompt',
      operationId: 'image-upload',
      target,
      text: 'image'
    })
    if (!parsed.valid || parsed.data?.type !== 'prompt')
      throw new Error('Invalid image target')
    return parsed.data.target
  }
  private identity(snapshot: ISnapshotResult, target: IActionTargetIdentity) {
    const checked = verifyTargetAgainstSnapshot(snapshot, target, {
      actionType: 'prompt'
    })
    if (!checked.ok || !checked.pane)
      throw new Error('Image target changed or unavailable')
    const pane = checked.pane
    const owner =
      snapshot.agents?.filter(
        (item) =>
          item.target === target.paneId || item.pane_id === target.paneId
      ) ?? []
    if (owner.length > 1) throw new Error('Ambiguous native image owner')
    const kind = pane.agent ?? pane.agent_session?.agent ?? owner[0]?.agent
    if (kind?.toLowerCase() !== 'letta')
      throw new Error('Image context currently supports native Letta only')
    // Native stable runtime identity, never inferred from model labels or first-turn content.
    const scope = pane.tokens?.letta_scope
    const started = pane.tokens?.letta_started_at
    if (
      typeof scope !== 'string' ||
      !/^[a-f0-9]{16,64}$/i.test(scope) ||
      typeof started !== 'string' ||
      !/^\d{10,20}$/.test(started)
    )
      throw new Error(
        'Native Letta runtime identity unavailable; image context is not eligible'
      )
    return hash([
      target.paneId,
      target.terminalId,
      pane.workspace_id,
      pane.tab_id,
      scope,
      started,
      pane.agent_session?.value ??
        pane.agent_session?.id ??
        owner[0]?.agent_session?.value ??
        owner[0]?.agent_session?.id ??
        null
    ])
  }
  private async capture(
    target: IActionTargetIdentity,
    owner: string
  ): Promise<IUploadScope> {
    const before = this.identity(await this.deps.snapshot(), target)
    if (!(await this.deps.ready(target)))
      throw new Error('Current prompt readiness unavailable; inspect Terminal')
    if (this.identity(await this.deps.snapshot(), target) !== before)
      throw new Error('Image target changed while reading readiness')
    // Internal scope only: no fabricated public session and no private native metadata in HTTP.
    return {
      paneId: target.paneId,
      terminalId: target.terminalId,
      agentSessionId: before,
      generation: owner
    }
  }
  handle = async (request: Request, imageId?: string) => {
    let owner: string
    try {
      owner = this.owner(request)
    } catch {
      return json(403, {
        ok: false,
        error: 'Owner and same-origin authentication required'
      })
    }
    if (
      (!imageId && request.method !== 'POST') ||
      (imageId && !['GET', 'DELETE'].includes(request.method))
    )
      return json(405, { ok: false, error: 'Method not allowed' })
    try {
      if (new URL(request.url).search)
        return json(400, {
          ok: false,
          error: 'Image upload query fields are not accepted'
        })
      const target = this.target(request)
      const scope = await this.capture(target, owner)
      if (imageId) {
        if (!/^[a-f0-9]{64}$/.test(imageId))
          return json(404, { ok: false, error: 'Image unavailable' })
        if (request.method === 'DELETE') {
          await this.store.remove(imageId, scope)
          return json(200, { ok: true })
        }
        const result = await this.store.preview(imageId, scope)
        if (
          this.identity(await this.deps.snapshot(), target) !==
          scope.agentSessionId
        )
          throw new Error('Image target changed')
        return new Response(new Uint8Array(result.data), {
          headers: {
            'content-type': result.mime,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff'
          }
        })
      }
      const mime = request.headers.get('content-type') ?? ''
      if (!['image/png', 'image/jpeg'].includes(mime))
        return json(415, {
          ok: false,
          error: 'Only static PNG/JPEG image bodies are supported'
        })
      const releaseBody = this.store.admitBody()
      try {
        const data = await readUploadBody(request)
        if (
          (await this.capture(target, owner)).agentSessionId !==
          scope.agentSessionId
        )
          throw new Error('Image target changed during upload')
        const result = await this.store.upload(
          data,
          mime,
          scope,
          request.signal
        )
        try {
          if (
            request.signal.aborted ||
            (await this.capture(target, owner)).agentSessionId !==
              scope.agentSessionId
          )
            throw new Error('Image upload cancelled or target changed')
          return json(200, {
            ok: true,
            ...result,
            imageContextBytes: imagePromptBytes(
              context(this.store.contextPath(result.imageId, result.mime))
            )
          })
        } catch (error) {
          await this.store.remove(result.imageId, scope)
          throw error
        }
      } finally {
        releaseBody()
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Image upload unavailable'
      // Only known application errors; filesystem paths must never reach the browser.
      const safe =
        /^(Image |Invalid |Only |Animated |Incomplete |Unsupported |Multi-picture |Exact |Native |Current |Upload |Ambiguous )/.test(
          message
        ) && !message.includes('/')
          ? message
          : 'Image unavailable'
      return json(
        message.includes('limit') || message.includes('size') ? 413 : 409,
        { ok: false, error: safe }
      )
    }
  }
  // Called inside the existing action coordinator claim; returned text is server-only.
  prepareSend = async (
    request: Request,
    target: IActionTargetIdentity,
    imageId: string,
    text: string
  ) => {
    const owner = this.owner(request)
    const scope = await this.capture(target, owner)
    const preview = await this.store.preview(imageId, scope)
    const suffix = context(this.store.contextPath(imageId, preview.mime))
    if (
      imagePromptBytes(text, imagePromptBytes(suffix)) > MAX_IMAGE_PROMPT_BYTES
    )
      throw new Error('Combined image context exceeds 4096 UTF-8 bytes')
    await this.store.consume(imageId, scope)
    if (
      this.identity(await this.deps.snapshot(), target) !== scope.agentSessionId
    )
      throw new Error('Image target changed before Send')
    return text + suffix
  }
}
