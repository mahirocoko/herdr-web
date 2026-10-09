import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import schema from '../../generated/herdr-schema.json'

/**
 * Architectural counterexample, NOT a provider-adapter acceptance test.
 * The allowed socket evidence cannot distinguish a per-process store override
 * when agent.get supplies an ID rather than a path. No real process is queried.
 */
test('process root override is not identifiable from protocol22 ID/process evidence', () => {
  const defs = schema.schemas.success_response.$defs
  expect(Object.keys(defs.PaneProcessInfoProcess.properties).sort()).toEqual([
    'argv',
    'argv0',
    'cmdline',
    'cwd',
    'name',
    'pid'
  ])
  expect(Object.keys(defs.AgentSessionInfo.properties).sort()).toEqual([
    'agent',
    'kind',
    'source',
    'value'
  ])
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-root-evidence-'))
  try {
    const id = 'a1111111-1111-4111-8111-111111111111'
    const stores = ['profile-a', 'profile-b'].map((profile) =>
      path.join(root, profile)
    )
    for (const [index, store] of stores.entries()) {
      const project = path.join(store, 'projects', '-fixture-project')
      const sessions = path.join(store, 'sessions', '2026', '10', '08')
      fs.mkdirSync(project, { recursive: true })
      fs.mkdirSync(sessions, { recursive: true })
      // Both profiles legitimately contain the exact session, for example a
      // copied/resumed store. ID uniqueness inside each root is not uniqueness
      // across roots. Content cannot establish which process owns a profile.
      fs.writeFileSync(
        path.join(project, `${id}.jsonl`),
        JSON.stringify({
          type: 'user',
          uuid: 'message-1',
          sessionId: id,
          timestamp: '2026-10-08T07:00:00.000Z',
          message: { role: 'user', content: `profile ${index}` }
        }) + '\n'
      )
      fs.writeFileSync(
        path.join(sessions, `rollout-2026-10-08T07-00-00-${id}.jsonl`),
        JSON.stringify({
          type: 'session_meta',
          payload: { id, cwd: '/fixture-project' }
        }) + '\n'
      )
    }
    for (const agent of ['claude', 'codex']) {
      const evidence = {
        agent: {
          pane_id: 'pane-fixture',
          agent,
          agent_session: {
            source: `herdr:${agent}`,
            agent,
            kind: 'id',
            value: id
          }
        },
        process: {
          pane_id: 'pane-fixture',
          shell_pid: 40,
          foreground_processes: [
            {
              pid: 41,
              name: agent,
              argv0: agent,
              argv: [agent],
              cwd: '/fixture-project'
            }
          ]
        }
      }
      // A and B represent alternate native realities; the environment is
      // intentionally not in their allowed evidence (not a secret read).
      const worldA = { evidence, nativeRoot: stores[0] }
      const worldB = {
        evidence: structuredClone(evidence),
        nativeRoot: stores[1]
      }
      expect(worldA.evidence).toEqual(worldB.evidence)
      expect(worldA.nativeRoot).not.toBe(worldB.nativeRoot)
      const relative =
        agent === 'claude'
          ? path.join('projects', '-fixture-project', `${id}.jsonl`)
          : path.join(
              'sessions',
              '2026',
              '10',
              '08',
              `rollout-2026-10-08T07-00-00-${id}.jsonl`
            )
      const hits = stores.filter((store) =>
        fs.existsSync(path.join(store, relative))
      )
      expect(hits).toHaveLength(2)
      // Explicit trusted root injection removes the ambiguity, but requires
      // that extra fact from a server owner; it cannot derive it from evidence.
      expect(hits.filter((store) => store === worldA.nativeRoot)).toHaveLength(
        1
      )
      expect(hits.filter((store) => store === worldB.nativeRoot)).toHaveLength(
        1
      )
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
