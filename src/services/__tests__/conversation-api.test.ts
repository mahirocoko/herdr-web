import { afterEach, describe, expect, it } from 'bun:test'
import {
  ConversationError,
  fetchPaneConversation,
  fetchConversationToolOutput,
  fetchConversationImage
} from '../conversation-api.ts'

describe('fetchPaneConversation', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('fetches opaque native image as exact bounded Blob with MIME/dimensions, signal and no-store', async () => {
    const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'))
    const controller=new AbortController()
    let url='',init:RequestInit|undefined
    globalThis.fetch=(async(input:RequestInfo|URL,options?:RequestInit)=>{url=String(input);init=options;return new Response(bytes,{headers:{'content-type':'image/png','x-image-width':'1','x-image-height':'1'}})}) as unknown as typeof fetch
    const image=await fetchConversationImage('p1','history','opaque',{signal:controller.signal})
    expect(url).toBe('/api/conversation/image?pane_id=p1&history_id=history&ref=opaque')
    expect(init?.signal).toBe(controller.signal);expect(init?.cache).toBe('no-store')
    expect(image).toMatchObject({mediaType:'image/png',width:1,height:1})
    expect(new Uint8Array(await image.blob.arrayBuffer())).toEqual(bytes)
  })
  it('refuses SVG/invalid dimensions and cancels oversized native image stream', async () => {
    for(const headers of [{'content-type':'image/svg+xml','x-image-width':'1','x-image-height':'1'},{'content-type':'image/png','x-image-width':'9000','x-image-height':'1'}]) {
      globalThis.fetch=(async()=>new Response('invalid',{headers})) as unknown as typeof fetch
      await expect(fetchConversationImage('p1','history','opaque')).rejects.toThrow('Invalid native-image payload')
    }
    let cancelled=false
    globalThis.fetch=(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1))},cancel(){cancelled=true}}),{headers:{'content-type':'image/png','x-image-width':'1','x-image-height':'1'}})) as unknown as typeof fetch
    await expect(fetchConversationImage('p1','history','opaque')).rejects.toThrow('exceeds limit')
    expect(cancelled).toBe(true)
  })
  it('fetches whole output with frozen identity, cancellation signal and no-store', async () => {
    const controller = new AbortController()
    let capturedUrl = ''
    let capturedOptions: RequestInit | undefined
    const output = 'ไทย🙂'
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      options?: RequestInit
    ) => {
      capturedUrl = String(input)
      capturedOptions = options
      return Response.json({
        ok: true,
        paneId: 'p1',
        sessionKey: 'history',
        ref: 'opaque',
        output,
        length: output.length,
        lengthUnit: 'utf16-code-units'
      })
    }) as unknown as typeof fetch
    const result = await fetchConversationToolOutput(
      'p1',
      'history',
      'opaque',
      { signal: controller.signal }
    )
    expect(capturedUrl).toBe(
      '/api/conversation/output?pane_id=p1&history_id=history&ref=opaque'
    )
    expect(capturedOptions?.signal).toBe(controller.signal)
    expect(capturedOptions?.cache).toBe('no-store')
    expect(result.output).toBe(output)
  })

  it('rejects mismatched output identity/length and retains history_changed status', async () => {
    const valid = {
      ok: true,
      paneId: 'p1',
      sessionKey: 'history',
      ref: 'opaque',
      output: 'real',
      length: 4,
      lengthUnit: 'utf16-code-units'
    }
    for (const patch of [
      { paneId: 'p2' },
      { sessionKey: 'other' },
      { ref: 'other' },
      { length: 3 },
      { lengthUnit: 'bytes' }
    ]) {
      globalThis.fetch = (async () =>
        Response.json({ ...valid, ...patch })) as unknown as typeof fetch
      await expect(
        fetchConversationToolOutput('p1', 'history', 'opaque')
      ).rejects.toThrow('Invalid recorded-output payload')
    }
    globalThis.fetch = (async () =>
      Response.json(
        { error: 'Changed', code: 'history_changed' },
        { status: 409 }
      )) as unknown as typeof fetch
    try {
      await fetchConversationToolOutput('p1', 'history', 'opaque')
      expect.unreachable('Should reject stale output')
    } catch (error) {
      expect(error).toBeInstanceOf(ConversationError)
      expect((error as ConversationError).code).toBe('history_changed')
      expect((error as ConversationError).status).toBe(409)
    }
  })

  it('fetches conversation with pane_id parameter', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return new Response(
        JSON.stringify({
          ok: true,
          paneId: 'p1',
          source: 'letta-transcript',
          sessionKey: 'sk1',
          turns: [],
          metadata: { model: 'gpt-4o', reasoning_effort: null },
          truncated: false,
          before: null
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const res = await fetchPaneConversation('p1')
    expect(capturedUrl).toContain('/api/conversation?pane_id=p1')
    expect(res.ok).toBe(true)
    expect(res.paneId).toBe('p1')
    expect(res.source).toBe('letta-transcript')
  })

  it('passes before cursor in query params', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return new Response(
        JSON.stringify({
          ok: true,
          paneId: 'p1',
          source: 'agy-transcript',
          sessionKey: 'sk2',
          turns: [],
          metadata: { model: 'claude', reasoning_effort: null },
          truncated: false,
          before: 'prevCursor'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const res = await fetchPaneConversation('p1', { before: 'cursor123' })
    expect(capturedUrl).toContain('pane_id=p1')
    expect(capturedUrl).toContain('before=cursor123')
    expect(res.before).toBe('prevCursor')
  })

  it('throws ConversationError on non-200 responses', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: 'Pane conversation changed',
          code: 'history_changed'
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    try {
      await fetchPaneConversation('p1')
      expect.unreachable('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConversationError)
      const convErr = err as ConversationError
      expect(convErr.status).toBe(409)
      expect(convErr.code).toBe('history_changed')
    }
  })
})
