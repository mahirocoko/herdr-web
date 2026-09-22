import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

const DOC_FILES = [
  'AGENTS.md',
  'README.md',
  'docs/project-overview.md',
  'docs/best-practices.md',
  'docs/onboarding.md',
  'docs/file-organization.md',
  'docs/patterns/services-pattern.md',
  'docs/patterns/hooks-pattern.md'
]

describe('drift-guards: retired absolute claims verification', () => {
  it('ensures retired "reaches Herdr only through ... CLI" claim is absent', () => {
    for (const relPath of DOC_FILES) {
      const fullPath = path.join(REPO_ROOT, relPath)
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8')
        expect(content).not.toContain('reaches Herdr only through bounded argv-based CLI calls')
        expect(content).not.toContain('reaches Herdr only through')
      }
    }
  })

  it('ensures retired "prefer Herdr public CLI contracts to internal socket" claim is absent', () => {
    for (const relPath of DOC_FILES) {
      const fullPath = path.join(REPO_ROOT, relPath)
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8')
        expect(content).not.toContain('Prefer Herdr public CLI contracts to internal socket')
        expect(content).not.toContain('prefer Herdr public CLI contracts to internal socket')
      }
    }
  })

  it('ensures retired "snapshot polling as primary" claims are absent in hook and docs', () => {
    const hookPath = path.join(REPO_ROOT, 'src/hooks/use-snapshot.ts')
    const hookContent = fs.readFileSync(hookPath, 'utf8')
    // Hook must check backend bridge health, not browser socket-open state, before polling.
    expect(hookContent).toContain('isEventStreamHealthyRef.current')
    expect(hookContent).toContain('bridgeStatusIsHealthy(message.status)')
    expect(hookContent).toContain('/api/events')
  })

  it('ensures socket-first protocol 22 and snapshot bridge contracts are documented', () => {
    const agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('protocol 22')
    expect(agentsMd).toContain('snapshot-bridge.ts')
    expect(agentsMd).toContain('HERDR_TRANSPORT=cli')
    expect(agentsMd).toContain('/api/events')

    const archMd = fs.readFileSync(path.join(REPO_ROOT, 'docs/transport-architecture.md'), 'utf8')
    expect(archMd).toContain('HERDR_TRACKED_PROTOCOL = 22')
    expect(archMd).toContain('events.subscribe')
    expect(archMd).toContain('SnapshotBridge')
  })

  it('keeps lifecycle safety and upstream status semantics in active docs', () => {
    const agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8')
    const archMd = fs.readFileSync(path.join(REPO_ROOT, 'docs/transport-architecture.md'), 'utf8')

    for (const actionType of ['workspace-create', 'workspace-close', 'tab-close']) {
      expect(agentsMd).toContain(actionType)
      expect(archMd).toContain(actionType)
    }
    expect(agentsMd).toContain('raw membership manifest')
    expect(archMd).toContain('changed membership returns a definitive 409 rejection and zero RPC')
    expect(agentsMd).toContain('attention aggregates')
    expect(readme).toContain('upstream attention aggregates')
    expect(archMd).toContain('a Space can truthfully aggregate to `done` while another Tab is `working`')
  })

  it('keeps Space and Tab navigation ownership separated across source and active docs', () => {
    const agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8')
    const spaceDrawer = fs.readFileSync(path.join(REPO_ROOT, 'src/components/space-drawer.tsx'), 'utf8')
    const paneDrawer = fs.readFileSync(path.join(REPO_ROOT, 'src/components/pane-drawer.tsx'), 'utf8')

    expect(agentsMd).toContain('Herdr-style Spaces side sheet')
    expect(readme).toContain('active-Space Tabs & Panes sheet')
    expect(spaceDrawer).toContain('aria-label="Herdr Spaces"')
    expect(spaceDrawer).not.toContain('New Shell Tab')
    expect(paneDrawer).toContain('Tabs & Panes')
    expect(paneDrawer).not.toContain('New Space')
    expect(paneDrawer).not.toContain('drawer-sheet__workspaces-scroll')
  })

  it('ensures retired "no external router library" and no-router claims are absent', () => {
    for (const relPath of DOC_FILES) {
      const fullPath = path.join(REPO_ROOT, relPath)
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8')
        expect(content).not.toContain('external router library')
        expect(content).not.toContain('avoid new state libraries, routers')
        expect(content).not.toContain('The Vite server proxies')
      }
    }
  })

  it('ensures server/index.ts has no active dist/ static or SW fallbacks', () => {
    const serverPath = path.join(REPO_ROOT, 'server/index.ts')
    const serverContent = fs.readFileSync(serverPath, 'utf8')
    expect(serverContent).not.toContain('dist/sw.js')
    expect(serverContent).not.toContain('dist${filePath}')
    expect(serverContent).not.toContain('dist/index.html')
  })

  it('ensures retired "only the first canonical tab ... can emit" claim is absent', () => {
    for (const relPath of DOC_FILES) {
      const fullPath = path.join(REPO_ROOT, relPath)
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8')
        expect(content).not.toContain('only the first canonical tab in each Space is enabled')
        expect(content).not.toContain('other tabs (e.g. Direct CLI) never emit')
      }
    }
  })

  it('ensures tab policy store, routes, and hooks are documented', () => {
    const agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('first canonical tab in each Space is enabled by default')
    expect(agentsMd).toContain('push-tab-policy.json')
    expect(agentsMd).toContain('/api/push/tab-policy')

    const fileOrgMd = fs.readFileSync(path.join(REPO_ROOT, 'docs/file-organization.md'), 'utf8')
    expect(fileOrgMd).toContain('tab-policy-store')
    expect(fileOrgMd).toContain('useTabNotificationPolicy')
  })

  it('ensures --takeover is absent from all argv builders and production code', () => {
    const serverFiles = [
      'server/terminal-control.ts',
      'server/herdr-cli.ts',
      'server/herdr-adapter.ts',
      'server/index.ts'
    ]
    for (const relPath of serverFiles) {
      const fullPath = path.join(REPO_ROOT, relPath)
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8')
        expect(content).not.toContain('--takeover')
      }
    }
  })

  it('ensures terminal control child and opt-in boundaries are documented', () => {
    const agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('/api/terminal/control')
    expect(agentsMd).toContain('verified idle shell panes')
    expect(agentsMd).toContain('Stream observer remains default')

    const archMd = fs.readFileSync(path.join(REPO_ROOT, 'docs/transport-architecture.md'), 'utf8')
    expect(archMd).toContain('Terminal Control Child')
    expect(archMd).toContain('herdr terminal session control')
    expect(archMd).toContain('Preflight validates')

    const fileOrgMd = fs.readFileSync(path.join(REPO_ROOT, 'docs/file-organization.md'), 'utf8')
    expect(fileOrgMd).toContain('terminal-control.ts')
    expect(fileOrgMd).toContain('useTerminalControl')
  })
})
