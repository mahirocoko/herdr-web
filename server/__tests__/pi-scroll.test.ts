import { describe, it, expect } from 'bun:test'
import { executePiScroll, verifyPiPageRecipe } from '../pi-scroll.ts'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const recipeFixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-page-recipe-'))
  const pkg = path.join(dir, '@earendil-works/pi-coding-agent')
  const agentDir = path.join(dir, 'agent')
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true })
  fs.mkdirSync(agentDir)
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ version: '1.3.0' })
  )
  const cli = path.join(pkg, 'dist/cli.js')
  fs.writeFileSync(cli, '')
  const runtime = {
    provider: 'pi' as const,
    pid: 16684,
    start: '123:456',
    argv: [] as string[],
    agentDir
  }
  return {
    dir,
    pkg,
    cli,
    runtime,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  }
}
describe('official Pi application page recipe', () => {
  it('accepts missing native argv explicitly as unknown, using known installed recipe', () => {
    const f = recipeFixture()
    try {
      const recipe = verifyPiPageRecipe(f.runtime, f.dir, () => f.cli)
      expect(recipe.argvEvidence).toBe('unavailable')
      expect(recipe.modeEvidence).toBe('settings-default-argv-unavailable')
    } finally {
      f.cleanup()
    }
  })
  it.each([
    'regular-args',
    'regular-settings',
    'wrong-package',
    'wrong-version',
    'conflicting-page',
    'removed-page',
    'bad-pid',
    'conflicting-latest',
    'removed-latest'
  ])('rejects known incompatible %s', (kind) => {
    const f = recipeFixture()
    if (kind === 'regular-args')
      f.runtime.argv = [f.cli, '--tui-mode', 'regular']
    if (kind === 'regular-settings')
      fs.writeFileSync(
        path.join(f.runtime.agentDir, 'settings.json'),
        JSON.stringify({ tuiMode: 'regular' })
      )
    if (kind === 'wrong-version')
      fs.writeFileSync(
        path.join(f.pkg, 'package.json'),
        JSON.stringify({ version: '2.0.0' })
      )
    if (kind === 'conflicting-page')
      fs.writeFileSync(
        path.join(f.runtime.agentDir, 'keybindings.json'),
        JSON.stringify({ 'app.quit': 'pageUp' })
      )
    if (kind === 'removed-page')
      fs.writeFileSync(
        path.join(f.runtime.agentDir, 'keybindings.json'),
        JSON.stringify({ 'tui.editor.pageUp': 'ctrl+u' })
      )
    if (kind === 'bad-pid') f.runtime.pid = 0
    if (kind === 'conflicting-latest')
      fs.writeFileSync(
        path.join(f.runtime.agentDir, 'keybindings.json'),
        JSON.stringify({ 'app.quit': 'ctrl+end' })
      )
    if (kind === 'removed-latest')
      fs.writeFileSync(
        path.join(f.runtime.agentDir, 'keybindings.json'),
        JSON.stringify({ 'tui.altScreen.bottom': [] })
      )
    try {
      expect(() =>
        verifyPiPageRecipe(f.runtime, f.dir, () =>
          kind === 'wrong-package' ? path.join(f.dir, 'other.js') : f.cli
        )
      ).toThrow()
    } finally {
      f.cleanup()
    }
  })
})
import { TerminalFitManager } from '../terminal-fit.ts'
import { validateActionRequest } from '../security.ts'
import {
  OperationCoordinator,
  computePayloadFingerprint
} from '../operation-coordinator.ts'
import type { IPiScrollAction, ISnapshotResult } from '../types.ts'
const action: IPiScrollAction = {
  type: 'pi-scroll',
  operationId: 'pi-page-fixture',
  target: {
    paneId: 'w1:p1',
    terminalId: 'term1',
    expectedMode: 'agent',
    agentSessionId: '/native/session.jsonl'
  },
  fitGeneration: 1,
  direction: 'up'
}
const fixture = () => {
  const manager = new TerminalFitManager()
  const fit = manager.reserveFit('term1', 'w1:p1')
  if (!fit.ok) throw new Error('fixture')
  const packets: string[] = []
  const proc = {
    stdin: {
      write: (text: string) => {
        packets.push(text)
        return Buffer.byteLength(text)
      }
    }
  }
  const ws = { readyState: 1 }
  manager.activateSession('term1', 1, proc, ws, 80, 24)
  manager.markValidatedFirstFrame('term1', 1, proc, ws)
  const snapshot: ISnapshotResult = {
    protocol: 22,
    version: '0.9.4',
    workspaces: [],
    tabs: [],
    panes: [
      {
        pane_id: 'w1:p1',
        terminal_id: 'term1',
        workspace_id: 'w1',
        tab_id: 't1',
        agent: 'pi',
        agent_status: 'working',
        cwd: '/native',
        focused: false,
        agent_session: {
          kind: 'path',
          source: 'herdr:pi',
          agent: 'pi',
          value: '/native/session.jsonl'
        }
      }
    ]
  }
  const deps = {
    manager,
    snapshot: async () => snapshot,
    ready: async () => true,
    resolve: async () => ({
      root: '/native',
      file: '/native/session.jsonl',
      session: 'id',
      source: 'pi-transcript' as const,
      signature: 'pid-start-fixture',
      validate: async () => {}
    })
  }
  return { manager, fit, packets, snapshot, deps }
}
describe('typed Pi page scroll', () => {
  it('accepts only the fixed latest direction, not caller-selected end keys', () => {
    expect(
      validateActionRequest({ ...action, direction: 'latest' }).valid
    ).toBe(true)
    expect(
      validateActionRequest({ ...action, direction: 'ctrl+end' }).valid
    ).toBe(false)
    expect(
      validateActionRequest({
        ...action,
        direction: 'latest',
        keys: ['ctrl+end']
      }).valid
    ).toBe(false)
  })
  it.each(['text', 'bytes', 'keys', 'count', 'coords', 'mode', 'claim'])(
    'rejects extra %s',
    (key) => {
      expect(
        validateActionRequest({ ...action, [key]: 'untrusted' }).valid
      ).toBe(false)
    }
  )
  it('admits working and writes a single fixed packet', async () => {
    const f = fixture()
    expect((await executePiScroll(action, f.deps)).ok).toBe(true)
    expect(f.packets).toEqual([
      JSON.stringify({ type: 'terminal.input', text: '\u001b[5~' }) + '\n'
    ])
  })
  it.each(['generation', 'session', 'modal', 'pid', 'retiring', 'no-frame'])(
    'rejects %s without packet',
    async (kind) => {
      const f = fixture()
      if (kind === 'generation') f.fit.session.generation++
      if (kind === 'session')
        f.snapshot.panes[0].agent_session!.value += 'changed'
      if (kind === 'modal') f.deps.ready = async () => false
      if (kind === 'pid')
        f.deps.resolve = async () => {
          throw new Error('native PID/start changed')
        }
      if (kind === 'retiring')
        f.deps.ready = async () => {
          f.fit.session.status = 'retiring'
          return true
        }
      if (kind === 'no-frame') f.fit.session.validatedFirstFrame = false
      expect((await executePiScroll(action, f.deps)).ok).toBe(false)
      expect(f.packets).toEqual([])
    }
  )
  it('existing coordinator fingerprints direction and deduplicates exact operation', () => {
    const c = new OperationCoordinator()
    const fp = computePayloadFingerprint(action)
    expect(fp).not.toBe(
      computePayloadFingerprint({ ...action, direction: 'down' })
    )
    const admission = c.beginAction(
      action.operationId,
      action.target.paneId,
      fp
    )
    expect(admission.kind).toBe('admitted')
    expect(
      c.beginAction(action.operationId, action.target.paneId, fp).kind
    ).toBe('in_flight')
    expect(c.beginAction('other', action.target.paneId, fp).kind).toBe(
      'contention'
    )
    if (admission.kind === 'admitted')
      c.completeAction(admission.token, 502, { outcome: 'unknown' })
    expect(
      c.beginAction(action.operationId, action.target.paneId, fp).kind
    ).toBe('replay')
  })
})
