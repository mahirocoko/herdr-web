import { validateOwnerAuth } from '../security.ts'
import {
  ConversationError,
  readPaneNativeImage,
  type IReadConversationOptions
} from './conversation-reader.ts'
interface IImageRouteOptions {
  ownerLogin?: string
  deps?: IReadConversationOptions['deps']
  readImage?: typeof readPaneNativeImage
}
const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
}
const error = (message: string, status: number, code?: string) =>
  new Response(JSON.stringify({ ok: false, error: message, code }), {
    status,
    headers: { ...headers, 'content-type': 'application/json' }
  })
/** No request can select a PID, root, filename, MIME or provider URL. */
export const handleConversationImageRequest = async (
  req: Request,
  options: IImageRouteOptions = {}
): Promise<Response> => {
  const auth = validateOwnerAuth(
    req,
    req.headers.get('host'),
    req.headers.get('origin'),
    options.ownerLogin,
    { requireOrigin: false }
  )
  if (!auth.allowed) return error(auth.error ?? 'Unauthorized', auth.status)
  if (req.method !== 'GET') return error('Method not allowed', 405)
  const params = new URL(req.url).searchParams
  if (
    [...params.keys()].some(
      (key) =>
        !['pane_id', 'history_id', 'ref'].includes(key) ||
        params.getAll(key).length !== 1
    )
  )
    return error('Invalid native-image request', 400)
  const pane = params.get('pane_id'),
    history = params.get('history_id'),
    ref = params.get('ref')
  if (
    !pane ||
    !history ||
    !ref ||
    !/^[a-zA-Z0-9_:-]{1,128}$/.test(pane) ||
    !/^[a-f0-9]{64}$/.test(history) ||
    ref.length > 2048
  )
    return error('Invalid native-image request', 400)
  try {
    const image = await (options.readImage ?? readPaneNativeImage)(
      pane,
      history,
      ref,
      { deps: options.deps }
    )
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        ...headers,
        'content-type': image.mediaType,
        'content-length': String(image.bytes.length),
        'x-image-width': String(image.width),
        'x-image-height': String(image.height)
      }
    })
  } catch (failure) {
    return failure instanceof ConversationError
      ? error(failure.message, failure.status, failure.code)
      : error('Native image unavailable', 422)
  }
}
