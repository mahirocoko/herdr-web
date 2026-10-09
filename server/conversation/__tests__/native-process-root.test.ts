import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureNativeProcessRootReady, selectedProcessRoots, selectedCodexRolloutFiles } from '../native-process-root.ts'
import { readPaneConversation } from '../conversation-reader.ts'
import type { ISnapshotResult } from '../../types.ts'

const native = process.platform === 'darwin' ? describe : describe.skip
native('private selected-process root authority (owned synthetic child only)', () => {
  let root: string, fixture: string
  const children: ReturnType<typeof Bun.spawn>[] = []
  beforeEach(async () => {
    root = fs.mkdtempSync(path.resolve('.agent-state/tmp/native-root-fixture-'))
    fixture = path.join(root, 'owned-child')
    const compiler = Bun.spawn(['/usr/bin/xcrun', 'clang', '-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', fileURLToPath(new URL('../native/process-root-fixture.c', import.meta.url)), '-o', fixture], { env: { PATH: '/usr/bin:/bin', TMPDIR: root }, stdout: 'ignore', stderr: 'ignore' })
    expect(await compiler.exited).toBe(0)
  })
  afterEach(async () => {
    for (const child of children.splice(0)) { if (child.exitCode === null) child.kill(); await child.exited }
    fs.rmSync(root, { recursive: true, force: true })
  })
  const child = async (mode?: string | string[], overrides: Record<string, string> = {}) => {
    const process = Bun.spawn([fixture, ...(Array.isArray(mode) ? mode : mode ? [mode] : [])], { env: { HOME: root, CODEX_HOME: root, CLAUDE_CONFIG_DIR: root, OPAQUE_UNKNOWN_KEY: 'SYNTHETIC_PRIVATE_SENTINEL_NEVER_RETURN', ...overrides }, stdout: 'pipe', stderr: 'ignore' })
    children.push(process)
    const stream = process.stdout as ReadableStream<Uint8Array>
    const reader = stream.getReader()
    const receipt = await reader.read()
    reader.releaseLock()
    expect(new TextDecoder().decode(receipt.value)).toContain('codexPresent')
    return process
  }
  test('actual built helper readiness, fixed-key extraction and no unknown environment fields/values', async () => {
    const readiness = ensureNativeProcessRootReady()
    expect(ensureNativeProcessRootReady()).toBe(readiness)
    const binary = await readiness
    const owned = await child()
    const roots = await selectedProcessRoots(owned.pid)
    expect(roots.pid).toBe(owned.pid)
    expect(roots.source).toBe('kern-procargs2')
    expect(roots.start).toMatch(/^\d+:\d+$/)
    expect(roots.keys).toEqual({ CODEX_HOME: root, CLAUDE_CONFIG_DIR: root, HOME: root })
    expect(Object.keys(roots).sort()).toEqual(['keys','pid','source','start'])
    expect(JSON.stringify(roots)).not.toContain('SYNTHETIC_PRIVATE_SENTINEL_NEVER_RETURN')
    expect(JSON.stringify(roots)).not.toContain('OPAQUE_UNKNOWN_KEY')
    const capture = Bun.spawn([binary, String(owned.pid)], { env: {}, stdout: 'pipe', stderr: 'pipe' })
    const stdout = await new Response(capture.stdout).text(), stderr = await new Response(capture.stderr).text()
    expect(await capture.exited).toBe(0)
    expect(stdout + stderr).not.toContain('SYNTHETIC_PRIVATE_SENTINEL_NEVER_RETURN')
    expect(stderr).toBe('')
    owned.kill(); await owned.exited
    await expect(selectedProcessRoots(owned.pid)).rejects.toThrow('unavailable')
  })
  test('unknown invalid UTF8 values remain opaque; duplicate/invalid/oversized selected roots fail closed without disclosure', async () => {
    const opaque = await child('opaque')
    expect((await selectedProcessRoots(opaque.pid)).keys).toEqual({ CODEX_HOME: '/fixture', CLAUDE_CONFIG_DIR: '/fixture', HOME: '/fixture' })
    for (const mode of ['duplicate','invalid','oversized']) {
      const owned = await child(mode)
      await expect(selectedProcessRoots(owned.pid)).rejects.toThrow('unavailable')
      const capture = Bun.spawn([await ensureNativeProcessRootReady(), String(owned.pid)], { env: {}, stdout: 'pipe', stderr: 'pipe' })
      const stdout = await new Response(capture.stdout).text(), stderr = await new Response(capture.stderr).text()
      expect(await capture.exited).not.toBe(0)
      expect(stdout).toBe('')
      expect(stderr).toBe('process_root_unavailable\n')
      expect(stdout + stderr).not.toContain('PRIVATE')
    }
  })
  test('native rollout descriptor authority selects only owned-root rollout and rejects stale process start', async () => {
    const id = 'a1111111-1111-4111-8111-111111111111'
    const directory = path.join(root, 'sessions', '2026', '10', '08')
    fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, `rollout-2026-10-08T07-00-00-${id}.jsonl`)
    fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id, cwd: root } }) + '\n')
    const owned = await child(['open-rollout', file])
    const roots = await selectedProcessRoots(owned.pid)
    expect(await selectedCodexRolloutFiles(owned.pid, root, roots.start)).toEqual([file])
    expect(await selectedCodexRolloutFiles(owned.pid, path.join(root, 'different-root'), roots.start)).toEqual([])
    await expect(selectedCodexRolloutFiles(owned.pid, root, '1:1')).rejects.toThrow('unavailable')
  })
  test('actual built-runtime resolver uses kernel custom roots for both provider-native fixture stores', async () => {
    const id='a1111111-1111-4111-8111-111111111111'
    const codex = path.join(root,'sessions','2026','10','08'), claude = path.join(root,'projects','-fixture')
    fs.mkdirSync(codex,{recursive:true});fs.mkdirSync(claude,{recursive:true})
    fs.writeFileSync(path.join(codex,`rollout-2026-10-08T07-00-00-${id}.jsonl`),JSON.stringify({type:'session_meta',payload:{id,cwd:root}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'kernel-root fixture'}]}})+'\n')
    fs.writeFileSync(path.join(claude,`${id}.jsonl`),JSON.stringify({type:'user',uuid:'u',sessionId:id,message:{role:'user',content:'kernel-root fixture'}})+'\n')
    const owned=await child(['open-rollout', path.join(codex,`rollout-2026-10-08T07-00-00-${id}.jsonl`)])
    for(const provider of ['codex','claude'] as const) {
      const session=provider==='claude'?{source:`herdr:${provider}`,agent:provider,kind:'id',value:id}:undefined
      const snapshot:ISnapshotResult={protocol:22,version:'0.9.3',workspaces:[{workspace_id:'w',label:'fixture',number:1,agent_status:'idle',tab_count:1,pane_count:1,focused:true}],tabs:[{tab_id:'t',workspace_id:'w',label:'fixture',number:1,pane_count:1,focused:true,agent_status:'idle'}],panes:[{pane_id:'owned-fixture-pane',workspace_id:'w',tab_id:'t',terminal_id:'owned-terminal',agent:provider,agent_session:session,agent_status:'idle',cwd:null,focused:true}]}
      const page=await readPaneConversation('owned-fixture-pane',{deps:{fetchSnapshot:async()=>snapshot,nativeRpc:async(method,params)=>method==='agent.get'?{agent:{pane_id:params.target,agent:provider,agent_session:session}}:{process_info:{pane_id:params.pane_id,foreground_processes:[{pid:owned.pid,name:provider,argv0:provider,argv:[provider]}]}}}})
      expect(page.source).toBe(`${provider}-transcript`)
      expect(page.turns.flatMap(turn=>turn.parts)).toContainEqual(expect.objectContaining({kind:'text',text:'kernel-root fixture'}))
    }
    // Canonical RPC/provider labels above are synthetic injected evidence, NOT
    // live Codex/Claude proof. Native helper, root resolution and file reads run.
  })
})
