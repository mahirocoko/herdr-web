import { validateOwnerAuth } from '../security.ts'
import {
  ConversationError,
  readPaneToolOutput,
  type IReadConversationOptions
} from './conversation-reader.ts'

interface IOutputRouteOptions {
  ownerLogin?: string
  deps?: IReadConversationOptions['deps']
  readOutput?: typeof readPaneToolOutput
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  })

/** Auth runs before parameter decoding, snapshots or native transcript access. */
export const handleConversationOutputRequest = async (
  req: Request,
  options: IOutputRouteOptions = {}
): Promise<Response> => {
  const auth = validateOwnerAuth(
    req,
    req.headers.get('host'),
    req.headers.get('origin'),
    options.ownerLogin,
    { requireOrigin: false }
  )
  if (!auth.allowed)
    return json({ ok: false, error: auth.error ?? 'Unauthorized' }, auth.status)
  if (req.method !== 'GET')
    return json({ ok: false, error: 'Method not allowed' }, 405)
  const params = new URL(req.url).searchParams
  if (
    [...params.keys()].some(
      (key) => !['pane_id', 'history_id', 'ref'].includes(key)
    ) ||
    [...params.keys()].some((key) => params.getAll(key).length !== 1)
  )
    return json({ ok: false, error: 'Invalid output request' }, 400)
  const pane = params.get('pane_id')
  const history = params.get('history_id')
  const ref = params.get('ref')
  if (
    !pane ||
    !history ||
    !ref ||
    !/^[a-zA-Z0-9_:-]{1,128}$/.test(pane) ||
    !/^[a-f0-9]{64}$/.test(history) ||
    ref.length > 2048
  )
    return json({ ok: false, error: 'Invalid output request' }, 400)
  try {
    const result = await (options.readOutput ?? readPaneToolOutput)(
      pane,
      history,
      ref,
      { deps: options.deps }
    )
    return json(result, 200)
  } catch (error) {
    if (error instanceof ConversationError)
      return json(
        { ok: false, error: error.message, code: error.code },
        error.status
      )
    return json({ ok: false, error: 'Recorded output unavailable' }, 422)
  }
}
