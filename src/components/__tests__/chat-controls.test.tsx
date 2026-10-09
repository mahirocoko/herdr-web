import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatControls from '../chat-controls.tsx'

const render = (working: boolean, disabled = false) =>
  renderToStaticMarkup(
    <ChatControls
      working={working}
      nativeStatus={working ? 'working' : 'blocked'}
      observation={{}}
      disabled={disabled}
      requestStop={async () => 'acknowledged'}
      onMore={() => {}}
    />
  )
test('working Chat exposes an accessible native interrupt request, not a kill or completion claim', () => {
  const html = render(true)
  expect(html).toContain('Request agent stop using Ctrl+C')
  expect(html).toContain('More controls')
  expect(html).toContain('role="status"')
  expect(html).not.toContain('Stopped')
})
test('blocked/nonworking Chat retains More controls without replacing approvals with Stop', () => {
  expect(render(false)).not.toContain('Request agent stop using Ctrl+C')
  expect(render(false)).toContain('More controls')
})
test('invalid/busy working target disables Stop', () => {
  expect(render(true, true)).toContain('disabled=""')
})
