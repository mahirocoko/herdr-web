import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatRenderBoundary } from '../chat-render-boundary.tsx'
test('per-turn fallback preserves native records and exposes recovery without input actions', () => {
  const boundary = new ChatRenderBoundary({
    children: createElement('p', null, 'record'),
    onSwitchToStream: () => {}
  })
  boundary.state = ChatRenderBoundary.getDerivedStateFromError()
  const html = renderToStaticMarkup(boundary.render())
  expect(html).toContain('role="alert"')
  expect(html).toContain('native transcript is unchanged')
  expect(html).toContain('Retry display')
  expect(html).toContain('View Terminal')
})
