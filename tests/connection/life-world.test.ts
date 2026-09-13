import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { CodexRuntime } from '../../src/backend/runtime'
import { PtyTerminals } from '../../src/backend/terminals'
import { LifeHarness, type LifeCheckpoint } from '../../src/core/life-harness'
import { lifeTools, type FacilityLayout } from '../../src/core/life-contracts'
import type { SessionBinding } from '../../src/core/contracts'
import { draft, population } from '../backend/fixtures'

it('runs five real NPC conversations and four facilities through a day with household homes and native sleep compaction', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/life-world-'))
  const specification = structuredClone(draft.specification)
  specification.simulation.maxTurns = 4
  specification.town.facilities.push({ id: 'shop', locationId: 'shop', type: 'shop', name: '店舗', description: '店', dimensions: { x: 15, y: 15, z: 2 } })
  const people = structuredClone(population)
  people.npcs.forEach((n, i) => { n.householdId = i < 2 ? 'family-a' : i < 4 ? 'family-b' : 'single' })
  const homes: FacilityLayout['homes'] = ['family-a', 'family-b', 'single'].map((householdId, i) => ({ id: `house-${i}`, householdId, name: `住宅${i + 1}`, description: '家', bounds: { min: { x: i * 4, y: 0, z: 0 }, max: { x: i * 4 + 2, y: 2, z: 1 } } }))
  const bindings: SessionBinding[] = []
  const errors: string[] = []
  const calls: { agentId: string; tool: string; success: boolean; turn: number }[] = []
  const clocks = new Map<number, string>()
  const plans = new Map<string, { name: string; arguments: unknown }[]>()
  let harness: LifeHarness
  let saved: LifeCheckpoint | null = null
  let compactCount = 0
  let responseId = 0
  const finish = (res: http.ServerResponse, item: Record<string, unknown>) => {
    const id = `r_${++responseId}`
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const event of [
      { type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } }
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    res.end()
  }
  const message = (res: http.ServerResponse) => finish(res, { id: `m_${responseId}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'LIFE_WORLD_RESPONSE', annotations: [] }] })
  const tool = (res: http.ServerResponse, name: string, args: unknown) => finish(res, { type: 'function_call', name, arguments: JSON.stringify(args), call_id: `call_${responseId}`, id: `fc_${responseId}` })
  const provider = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return }
    let raw = ''
    req.on('data', data => { raw += data })
    req.on('end', () => {
      if (req.url?.endsWith('/compact')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: `compact_${compactCount}`, object: 'response.compaction', created_at: 1, output: [{ type: 'compaction', encrypted_content: `fixture_${compactCount}` }], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } }))
        return
      }
      const body = JSON.parse(raw)
      const last = body.input.at(-1)
      if (JSON.stringify(last).includes('Generate a concise, single-line task title')) { message(res); return }
      const binding = bindings.find(b => b.threadId === body.client_metadata?.thread_id)
      if (!binding) { errors.push('Unknown fixture thread'); message(res); return }
      const world = harness.snapshot()
      if (world.phase === 'facilities') {
        const facility = world.facilities.find(f => `facility-${f.id}` === binding.agentId)!
        if (facility.layout) message(res)
        else tool(res, 'initializeFacility', { regions: [{ id: 'entrance', name: '入口', description: '出入り口', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } }], homes: facility.type === 'residential' ? homes : [], publicState: '営業中' })
        return
      }
      if (binding.role === 'facility') {
        const pending = harness.checkpoint().interactions.find(i => !i.done && `facility-${i.facilityId}` === binding.agentId)
        if (pending) tool(res, 'completeFacilityUse', { requestId: pending.id, text: '設備を利用しました', publicState: '利用履歴を保持しています' })
        else message(res)
        return
      }
      const actor = world.actors.find(a => a.id === binding.agentId)!
      if (!actor.position) { tool(res, 'setInitialPosition', { position: { x: actor.locationId === 'home' ? [0, 1, 4, 5, 3][Number(actor.id.slice(3))] : 0, y: 0, z: 0 } }); return }
      if (world.phase !== 'activity' || actor.activity !== 'active') { message(res); return }
      const key = `${actor.id}:${world.turn}`
      if (!plans.has(key)) {
        const actions: { name: string; arguments: unknown }[] = [{ name: 'getSituation', arguments: {} }]
        if (actor.id === 'npc0' && world.turn === 1) {
          actions.push({ name: 'sendMessage', arguments: { text: '家の中の会話', volume: 'high' } })
          for (let x = 0; x < 3; x++) actions.push({ name: 'moveWithinFacility', arguments: { position: { x, y: 0, z: 0 } } })
          actions.push({ name: 'moveToFacility', arguments: { facilityId: 'school' } })
        } else if (actor.id === 'npc4' && world.turn === 1) {
          actions.push({ name: 'sendMessage', arguments: { text: '屋外の会話', volume: 'high' } }, { name: 'moveToFacility', arguments: { facilityId: 'shop' } })
        } else if (actor.id === 'npc2' && world.turn === 1) actions.push({ name: 'moveToFacility', arguments: { facilityId: 'office' } })
        else {
          if (world.turn === 2) actions.push({ name: 'useFacility', arguments: { request: '現在の設備を使います' } })
          actions.push({ name: world.turn === 4 ? 'sleep' : 'endTurn', arguments: {} })
        }
        plans.set(key, actions)
      }
      const action = plans.get(key)!.shift()
      if (action) tool(res, action.name, action.arguments)
      else if (last?.type === 'function_call_output') message(res)
      else tool(res, world.turn === 4 ? 'sleep' : 'endTurn', {})
    })
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const config = path.join(root, 'fixture.toml')
  await writeFile(config, `model_provider = "fixture"\n[model_providers.fixture]\nname = "Life world fixture"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  const terminals = new PtyTerminals(runtime, () => undefined, error => errors.push(error))
  const binding = (id: string) => { const b = bindings.find(b => b.agentId === id); if (!b) throw new Error(`Missing binding: ${id}`); return b }
  const wait = async (predicate: () => boolean, label: string) => {
    for (let i = 0; i < 500; i++) {
      if (errors.length || harness.snapshot().stage === 'error') throw new Error(`${label}: ${JSON.stringify({ errors, checkpoint: harness.checkpoint() })}`)
      if (predicate()) return
      await delay(100)
    }
    throw new Error(`Timed out ${label}: ${JSON.stringify(harness.checkpoint())}`)
  }
  try {
    await runtime.connect('chatgpt')
    for (const agent of [...people.npcs.map(n => ({ id: n.id, role: 'npc' as const })), ...specification.town.facilities.map(f => ({ id: `facility-${f.id}`, role: 'facility' as const }))]) {
      const cwd = path.join(root, agent.id); await mkdir(cwd)
      const b: SessionBinding = { agentId: agent.id, sessionId: agent.id, role: agent.role, cwd, modelId: 'gpt-5.6-luna', effort: 'low', threadId: null, creation: 'requested', seedPersisted: false, lifeToolsVersion: 1 }
      bindings.push(b)
      b.threadId = await runtime.create(b, '生活Toolで初期化と生活を実行する。', { tools: lifeTools(agent.role), disableEnvironment: true })
      await runtime.seed(b, '初期化を待ってください。'); b.seedPersisted = true; b.creation = 'initialized'
      await terminals.attach(b)
    }
    harness = new LifeHarness(specification, people, {
      start: (id, text, clientId) => runtime.startTurn(binding(id), text, [], clientId),
      steer: (id, turnId, text, clientId) => runtime.steer(binding(id).threadId!, turnId, text, clientId),
      compact: id => runtime.compact(binding(id).threadId!), interrupt: (id, turnId) => runtime.interrupt(binding(id).threadId!, turnId),
      history: id => runtime.history(binding(id).threadId!), terminalInput: (id, text) => terminals.input(id, text),
      save: async checkpoint => { saved = structuredClone(checkpoint); await writeFile(path.join(root, 'checkpoint.json'), JSON.stringify(checkpoint)) },
      changed: world => { clocks.set(world.turn, `${world.day}/${world.time}`) }, failed: error => errors.push(error.message)
    })
    runtime.setToolHandler(async call => {
      const b = bindings.find(b => b.threadId === call.threadId)!
      const result = await harness.tool(b.agentId, call)
      calls.push({ agentId: b.agentId, tool: call.tool, success: result.success, turn: harness.snapshot().turn })
      return result
    })
    runtime.onNotification(event => {
      if (event.method === 'runtime/error') { errors.push(JSON.stringify(event.params)); return }
      const id = (event.params as { threadId?: string }).threadId
      const b = bindings.find(b => b.threadId === id)
      if (event.method === 'item/completed' && (event.params as { item: { type: string } }).item.type === 'contextCompaction') compactCount++
      if (b) harness.notify(b.agentId, event.method, event.params)
    })
    await harness.begin()
    await wait(() => harness.snapshot().stage === 'ready', 'initialization')
    expect(harness.snapshot().turn).toBe(0)
    expect(harness.snapshot().facilities.find(f => f.type === 'residential')!.layout!.homes).toHaveLength(3)
    await harness.start()
    await wait(() => harness.snapshot().stage === 'ended', 'one day')
    const world = harness.snapshot()
    expect(world.turn).toBe(4)
    expect([...clocks.entries()]).toEqual([[0, '1/morning'], [1, '1/morning'], [2, '1/noon'], [3, '1/evening'], [4, '1/night']])
    expect(compactCount).toBe(5)
    expect(world.actors.every(a => a.activity === 'sleeping' && a.compact === 'complete')).toBe(true)
    expect(world.actors.find(a => a.id === 'npc0')!.locationId).toBe('school')
    expect(world.actors.find(a => a.id === 'npc2')!.locationId).toBe('office')
    expect(world.actors.find(a => a.id === 'npc4')!.locationId).toBe('shop')
    expect(world.events.find(e => e.text === '家の中の会話')!.recipients).toEqual(['npc1'])
    expect(world.events.find(e => e.text === '屋外の会話')!.recipients).toEqual([])
    expect(world.events.filter(e => e.kind === 'facility')).toHaveLength(5)
    expect(calls.every(c => c.success)).toBe(true)
    expect(saved).not.toBeNull()
    for (const b of bindings) {
      const history = await runtime.history(b.threadId!)
      for (const job of harness.checkpoint().jobs.filter(j => j.agentId === b.agentId && j.status === 'done' && j.kind !== 'compact')) expect(history.find(t => t.id === job.turnId)?.clientIds).toContain(job.id)
    }
    for (const b of bindings) { expect(terminals.isRunning(b.sessionId)).toBe(true); expect((await terminals.snapshot(b.sessionId)).data).toContain('Codex') }
    await writeFile(path.join(root, 'acceptance.json'), JSON.stringify({ calls, clocks: [...clocks], compactCount, bindings, errors }, null, 2))
  } finally {
    if (harness!) await harness.close()
    await terminals.dispose(); await runtime.close()
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
  }
}, 120000)
