import { expect, test, spyOn } from 'bun:test'
import { createServer } from '../index.ts'
import * as reader from '../conversation/conversation-reader.ts'
import type { ISnapshotResult } from '../types.ts'

test('conversation HTTP routes preserve production defaults and explicit fixture isolation', async () => {
  const injectedSnapshot = async () => ({}) as ISnapshotResult
  for (const fetchSnapshot of [undefined, injectedSnapshot]) {
    let handler: any
    const serve = spyOn(Bun, 'serve').mockImplementation((config: any) => {
      handler = config.fetch
      return {} as any
    })
    try {
      createServer(8787, '127.0.0.1', {
        startPushBridge: false,
        deps: fetchSnapshot ? { fetchSnapshot } : undefined
      })
    } finally {
      serve.mockRestore()
    }
    const conversation = spyOn(
      reader,
      'readPaneConversation'
    ).mockResolvedValue({} as any)
    const output = spyOn(reader, 'readPaneToolOutput').mockResolvedValue(
      {} as any
    )
    const image = spyOn(reader, 'readPaneNativeImage').mockResolvedValue({
      bytes: Buffer.alloc(0),
      mimeType: 'image/png'
    } as any)
    try {
      for (const route of [
        '/api/conversation?pane_id=p',
        '/api/conversation/output?pane_id=p&history_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&ref=r',
        '/api/conversation/image?pane_id=p&history_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&ref=r'
      ]) {
        await handler(
          new Request(`http://127.0.0.1:8787${route}`, {
            headers: { host: '127.0.0.1:8787' }
          }),
          {}
        )
      }
      expect(conversation).toHaveBeenCalledTimes(1)
      expect(output).toHaveBeenCalledTimes(1)
      expect(image).toHaveBeenCalledTimes(1)
      expect(conversation.mock.calls[0]![1]?.deps?.fetchSnapshot).toBe(
        fetchSnapshot
      )
      expect(output.mock.calls[0]![3]?.deps?.fetchSnapshot).toBe(fetchSnapshot)
      expect(image.mock.calls[0]![3]?.deps?.fetchSnapshot).toBe(fetchSnapshot)
    } finally {
      conversation.mockRestore()
      output.mockRestore()
      image.mockRestore()
    }
  }
})
