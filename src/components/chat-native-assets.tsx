import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  fetchConversationImage,
  fetchConversationToolOutput
} from '@/services/conversation-api.ts'
import type { ConversationPart } from '@/types/conversation.ts'
import { ChatToolContent } from './chat-tool-content.tsx'
import TerminalImagePreview from './terminal-image-preview.tsx'
import Button from './ui/button.tsx'

interface IChatAssetScope {
  paneId: string
  history: string
}
const ChatAssetContext = createContext<IChatAssetScope | null>(null)
type ImagePart = Extract<ConversationPart, { kind: 'image' }>
type ToolPart = Extract<ConversationPart, { kind: 'tool' }>

// Opaque tokens may rotate on polls. Only a real native revision resets results.
const useAssetOwner = (revision: string) => {
  const owner = useMemo(
    () => ({ active: true, controller: null as AbortController | null }),
    [revision]
  )
  useLayoutEffect(() => {
    owner.active = true
    return () => {
      owner.active = false
      owner.controller?.abort()
    }
  }, [owner])
  return owner
}

const WholeToolContent = ({ part }: { part: ToolPart }) => {
  const scope = useContext(ChatAssetContext)
  const revision = `${scope?.paneId}:${scope?.history}:${part.id}:${part.outputRevision ?? part.outputRef}`
  const owner = useAssetOwner(revision)
  const latest = useRef(part.outputRef)
  useLayoutEffect(() => {
    latest.current = part.outputRef
  })
  const [result, setResult] = useState<{
    owner: typeof owner
    output?: string
    error?: string
    loading?: boolean
  } | null>(null)
  const current = result?.owner === owner ? result : null
  const load = async () => {
    const ref = latest.current
    if (!scope || !ref || owner.controller || !owner.active) return
    const controller = new AbortController()
    owner.controller = controller
    setResult({ owner, loading: true })
    try {
      const data = await fetchConversationToolOutput(
        scope.paneId,
        scope.history,
        ref,
        { signal: controller.signal }
      )
      if (part.outputRevision && data.outputRevision !== part.outputRevision)
        throw new Error('Recorded output changed; refresh and retry.')
      if (owner.active && !controller.signal.aborted)
        setResult({ owner, output: data.output })
    } catch (error) {
      if (owner.active && !controller.signal.aborted)
        setResult({
          owner,
          error:
            error instanceof Error
              ? error.message
              : 'Recorded output unavailable'
        })
    } finally {
      if (owner.controller === controller) owner.controller = null
    }
  }
  return (
    <>
      <ChatToolContent
        part={
          current?.output !== undefined
            ? { ...part, output: current.output, truncated: false }
            : part
        }
      />
      {scope && part.outputRef && current?.output === undefined && (
        <Button
          variant="ghost"
          disabled={current?.loading}
          onClick={() => void load()}
        >
          {current?.loading ? 'Loading output…' : 'Load full output'}
          {part.outputLength !== undefined && !current?.loading
            ? ` (${part.outputLength.toLocaleString()} UTF-16 units)`
            : ''}
        </Button>
      )}
      {current?.error && (
        <p role="alert" className="chat-inline-error">
          {current.error}
        </p>
      )}
      {part.outputUnavailable && (
        <p className="chat-inline-state">
          Recorded output exceeds the whole-output envelope.
        </p>
      )}
    </>
  )
}

const NativeImage = ({ part }: { part: ImagePart }) => {
  const scope = useContext(ChatAssetContext)
  const revision = `${scope?.paneId}:${scope?.history}:${part.imageRevision ?? part.nativeKey ?? part.ref}`
  const owner = useAssetOwner(revision)
  const latest = useRef(part.ref)
  useLayoutEffect(() => {
    latest.current = part.ref
  })
  const [result, setResult] = useState<{
    owner: typeof owner
    url?: string
    blob?: Blob
    error?: string
  } | null>(null)
  const [open, setOpen] = useState(false)
  const current = result?.owner === owner ? result : null
  useLayoutEffect(() => {
    if (!scope) return
    const controller = new AbortController()
    owner.controller = controller
    let url: string | undefined
    setOpen(false)
    void fetchConversationImage(scope.paneId, scope.history, latest.current, {
      signal: controller.signal
    })
      .then((image) => {
        if (!owner.active || controller.signal.aborted) return
        url = URL.createObjectURL(image.blob)
        setResult({ owner, url, blob: image.blob })
      })
      .catch((error: unknown) => {
        if (owner.active && !controller.signal.aborted)
          setResult({
            owner,
            error: error instanceof Error ? error.message : 'Image unavailable'
          })
      })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [owner, scope?.paneId, scope?.history])
  if (!scope)
    return (
      <p className="chat-inline-state">
        Native image requires an active conversation.
      </p>
    )
  return (
    <div className="chat-native-image">
      {current?.url ? (
        <button
          type="button"
          className="chat-image-open"
          onClick={() => setOpen(true)}
          aria-label="Open native attachment"
        >
          <img
            src={current.url}
            alt="Native conversation attachment"
            width={part.width}
            height={part.height}
          />
        </button>
      ) : (
        <p
          className="chat-inline-state"
          role={current?.error ? 'alert' : 'status'}
        >
          {current?.error ?? 'Loading attachment…'}
        </p>
      )}
      {current?.blob && (
        <TerminalImagePreview
          imagePath="Native attachment"
          sourceBlob={current.blob}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

export { ChatAssetContext, NativeImage, WholeToolContent }
