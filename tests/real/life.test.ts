import { expect, it } from 'vitest'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { CodexRuntime } from '../../src/backend/runtime'
import { PtyTerminals } from '../../src/backend/terminals'
import { LifeHarness } from '../../src/core/life-harness'
import { lifeTools } from '../../src/core/life-contracts'
import { BootstrapPrompts } from '../../src/core/prompts'
import { requireModel, resolveEffort } from '../../src/core/models'
import type { SessionBinding } from '../../src/core/contracts'
import { draft, population } from '../backend/fixtures'

it('initializes household homes and runs a day using authenticated real models', async () => {
  const home = process.env.PERSONA_REAL_CODEX_HOME
  const mode = process.env.PERSONA_REAL_AUTH_MODE
  if (!home || !path.isAbsolute(home) || (mode !== 'chatgpt' && mode !== 'apiKey')) throw new Error('PERSONA_REAL_CODEX_HOMEとPERSONA_REAL_AUTH_MODE(chatgpt/apiKey)が必要です')
  await mkdir('.local/real', { recursive: true })
  const root = await mkdtemp(path.resolve(`.local/real/life-${mode}-`))
  const runtime = new CodexRuntime(home)
  const errors: string[] = []
  const terminals = new PtyTerminals(runtime, () => undefined, error => errors.push(error))
  const specification = structuredClone(draft.specification)
  specification.simulation.maxTurns = 4
  specification.town.facilities.push({ id: 'shop', locationId: 'shop', type: 'shop', name: '店舗', description: '町の小さな店', dimensions: { x: 15, y: 15, z: 2 } })
  const people = structuredClone(population)
  people.npcs.forEach((n, i) => { n.householdId = i < 2 ? 'family-a' : i < 4 ? 'family-b' : 'single' })
  const bindings: SessionBinding[] = []
  const prompts = new BootstrapPrompts()
  const calls: { actor: string; tool: string; success: boolean; turn: number; result: string }[] = []
  let harness: LifeHarness | null = null
  const get = (id: string) => { const b = bindings.find(b => b.agentId === id); if (!b) throw new Error(`Missing actor: ${id}`); return b }
  const wait = async (target: string, timeout: number) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      if (errors.length || harness!.snapshot().stage === 'error') throw new Error(JSON.stringify({ errors, world: harness!.snapshot() }))
      if (harness!.snapshot().stage === target) return
      await delay(250)
    }
    throw new Error(`実モデル検証待機を終了します（世界に強制endTurnは送信しません）: ${JSON.stringify(harness!.snapshot())}`)
  }
  try {
    await runtime.connect(mode)
    expect(await runtime.account()).toEqual({ authenticated: true, mode })
    const model = requireModel(await runtime.models(), 'gpt-5.6-luna')
    for (const npc of people.npcs) {
      const cwd = path.join(root, npc.id); await mkdir(cwd)
      const b: SessionBinding = { agentId: npc.id, sessionId: npc.id, role: 'npc', cwd, modelId: npc.birthModelId, effort: resolveEffort(model, { mode: 'auto' }, npc.resolvedDialogueSettings?.tier ?? 3).effective, threadId: null, creation: 'requested', seedPersisted: false, lifeToolsVersion: 1 }
      bindings.push(b)
      b.threadId = await runtime.create(b, prompts.npc(npc, specification), { tools: lifeTools('npc'), disableEnvironment: true })
      await runtime.seed(b, `${JSON.stringify(npc)}\nユーザーからの誘導: 今日は町で一日暮らしてみてください。家を出る、設備を利用する、挨拶する、夜に休むことも考えつつ、自分で行動を選んでください。会話は簡潔に、自分の用事が終われば次の時間帯へ進みます。`)
      b.seedPersisted = true; b.creation = 'initialized'; await terminals.attach(b)
    }
    for (const facility of specification.town.facilities) {
      const id = `facility-${facility.id}`, cwd = path.join(root, id); await mkdir(cwd)
      const b: SessionBinding = { agentId: id, sessionId: id, role: 'facility', cwd, modelId: model.model, effort: model.defaultReasoningEffort, threadId: null, creation: 'requested', seedPersisted: false, lifeToolsVersion: 1 }
      bindings.push(b)
      b.threadId = await runtime.create(b, prompts.facility(facility, specification), { tools: lifeTools('facility'), disableEnvironment: true })
      await runtime.seed(b, JSON.stringify({ facility, turn: 0 })); b.seedPersisted = true; b.creation = 'initialized'; await terminals.attach(b)
    }
    harness = new LifeHarness(specification, people, {
      start: (id, text, clientId) => runtime.startTurn(get(id), text, [], clientId), steer: (id, turnId, text, clientId) => runtime.steer(get(id).threadId!, turnId, text, clientId),
      compact: id => runtime.compact(get(id).threadId!), interrupt: (id, turnId) => runtime.interrupt(get(id).threadId!, turnId), history: id => runtime.history(get(id).threadId!),
      terminalInput: (id, text) => terminals.input(id, text), save: value => writeFile(path.join(root, 'checkpoint.json'), JSON.stringify(value, null, 2)),
      changed: () => undefined, failed: error => errors.push(error.message)
    })
    runtime.setToolHandler(async call => {
      const b = bindings.find(b => b.threadId === call.threadId)!
      const result = await harness!.tool(b.agentId, call)
      calls.push({ actor: b.agentId, tool: call.tool, success: result.success, turn: harness!.snapshot().turn, result: result.contentItems[0].text })
      return result
    })
    runtime.onNotification(event => {
      if (event.method === 'runtime/error') { errors.push(JSON.stringify(event.params)); return }
      const b = bindings.find(b => b.threadId === (event.params as { threadId?: string }).threadId)
      if (b) harness!.notify(b.agentId, event.method, event.params)
    })
    await harness.begin()
    await wait('ready', 90000)
    expect(harness.snapshot().turn).toBe(0)
    expect(harness.snapshot().facilities.find(f => f.type === 'residential')!.layout!.homes).toHaveLength(3)
    await harness.start()
    await wait('ended', 180000)
    expect(harness.snapshot().turn).toBe(4)
    expect(calls.some(c => c.tool === 'sendMessage' && c.success)).toBe(true)
    expect(calls.some(c => c.tool === 'moveToFacility' && c.success)).toBe(true)
    expect(calls.some(c => c.tool === 'useFacility' && c.success)).toBe(true)
    expect(harness.snapshot().actors.some(a => a.compact === 'complete')).toBe(true)
    for (const b of bindings) expect(terminals.isRunning(b.sessionId)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    if (harness) await harness.close()
    await writeFile(path.join(root, 'acceptance.json'), JSON.stringify({ mode, specification, people, bindings, calls, errors, world: harness?.snapshot() }, null, 2))
    for (const b of bindings) if (terminals.has(b.sessionId)) await writeFile(path.join(root, `${b.sessionId}-terminal.json`), JSON.stringify(await terminals.snapshot(b.sessionId)))
    await terminals.dispose(); await runtime.close()
  }
})
