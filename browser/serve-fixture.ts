import { resolve, sep } from 'node:path'

// CI-owned static build only. Never import server/index or native/credential owners.
if (process.env.CI !== 'true')
  throw new Error(
    'Fixture server is CI-only; local QA uses the Main-owned server on 8787'
  )
const root = resolve('build/client')
Bun.serve({
  hostname: '127.0.0.1',
  port: 8791,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.pathname.startsWith('/api/'))
      return new Response('Forbidden', { status: 403 })
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (path !== root && !path.startsWith(root + sep))
      return new Response('Forbidden', { status: 403 })
    if (
      url.pathname === '/' ||
      url.pathname === '/settings' ||
      url.pathname === '/spaces/smoke-space'
    )
      return new Response(Bun.file(resolve(root, 'index.html')))
    const file = Bun.file(path)
    if (await file.exists()) return new Response(file)
    return new Response('Not found', { status: 404 })
  }
})
