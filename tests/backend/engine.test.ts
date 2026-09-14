import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, symlink, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BackendEngine } from '../../src/backend/engine'
import type { AgentRuntime, RuntimeToolCall, RuntimeToolResult } from '../../src/backend/runtime'
import type { LifeHistoryTurn } from '../../src/core/life-harness'
import type { TerminalBridge } from '../../src/backend/terminals'
import type { RpcNotification } from '../../src/backend/rpc'
import type { AgentModelSettings, PreparationProgress, SessionBinding } from '../../src/core/contracts'
import { digest } from '../../src/main/workspace'
import { models, settings, round, answers, draft, population } from './fixtures'
import { FixturePersistencePort } from './persistence-fixture'
import { DevStore } from '../../src/backend/dev-store'

class Runtime implements AgentRuntime {
  toolHandler: (call: RuntimeToolCall) => Promise<RuntimeToolResult> = async () => { throw new Error('No tool handler') }
  historyTurns = new Map<string, LifeHistoryTurn[]>()
  setToolHandler(handler: (call: RuntimeToolCall) => Promise<RuntimeToolResult>) { this.toolHandler = handler }
  listeners = new Set<(event: RpcNotification) => void>()
  listener = (event: RpcNotification) => { for (const listener of this.listeners) listener(event) }
  created: string[] = []
  instructions: string[] = []
  resumed: { agentId: string; threadId: string | null; instructions?: string }[] = []
  inputs: string[] = []
  failCreation = false
  mode: 'chatgpt' | 'apiKey' = 'chatgpt'
  available = models
  onNotification(listener: (event: RpcNotification) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async connect(mode: 'chatgpt' | 'apiKey') { this.mode = mode }
  async account() { return { authenticated: true, mode: this.mode } }
  async models() { return this.available }
  async loginChatGpt() { return { id: 'login', url: 'https://auth.openai.com' } }
  async loginApiKey() {}
  async cancelLogin() {}
  async create(binding: SessionBinding, instructions: string) { this.created.push(binding.agentId); this.instructions.push(instructions); if (this.failCreation) throw new Error('thread/start response lost'); return `thread-${binding.agentId}` }
  failFork = false
  forks: { source: string; lastTurnId: string | null; id: string }[] = []
  async fork(binding: SessionBinding, lastTurnId: string | null) {
    if (this.failFork) throw new Error('thread/fork response lost')
    const id = `fork-${crypto.randomUUID()}`, source = binding.threadId!
    const turns = this.historyTurns.get(source) ?? []
    const index = lastTurnId === null ? turns.length - 1 : turns.findIndex(t => t.id === lastTurnId)
    if (lastTurnId && index < 0) throw new Error('unknown rewind turn')
    this.historyTurns.set(id, structuredClone(turns.slice(0, index + 1)))
    this.forks.push({ source, lastTurnId, id })
    return id
  }
  async seed(_binding: SessionBinding, text: string) { this.inputs.push(text) }
  async resume(binding: SessionBinding, instructions?: string) {
    this.resumed.push({ agentId: binding.agentId, threadId: binding.threadId, instructions })
    if (instructions !== undefined) this.instructions.push(instructions)
  }
  async startTurn(binding: SessionBinding, text: string, _images?: string[], clientId?: string) {
    this.inputs.push(text)
    const id = `turn-${crypto.randomUUID()}`
    if (binding.role === 'parent' && text.includes('Harnessの承認済み制作処理です')) {
      const relative = text.match(/入力資料: (production\/[a-f0-9-]+\/input.json)/)![1]
      const input = JSON.parse(await readFile(path.join(binding.cwd, relative), 'utf8'))
      await writeFile(path.join(binding.cwd, relative.replace('input.json', 'result.json')), JSON.stringify({ npcId: input.identity.id, lifeSummary: [], personality: [], speechTendency: [], appearance: [], goals: [], behavior: [], schedule: [], runtimeGuidance: '', systemPrompt: '住民として応答する', memoryIds: [], relationshipTargets: [] }))
      setTimeout(() => {
        this.listener({ method: 'turn/started', params: { threadId: binding.threadId, turn: { id } } })
        this.listener({ method: 'turn/completed', params: { threadId: binding.threadId, turn: { id, status: 'completed' } } })
      }, 0)
    }
    if (binding.role !== 'parent') {
      const history: LifeHistoryTurn = { id, status: 'inProgress', clientIds: clientId ? [clientId] : [], compact: false }
      const turns = this.historyTurns.get(binding.threadId!) ?? []
      this.historyTurns.set(binding.threadId!, [...turns, history])
      setTimeout(() => {
        this.listener({ method: 'turn/started', params: { threadId: binding.threadId, turn: { id } } })
        const tool = binding.role === 'facility' ? 'initializeFacility' : text.includes('setInitialPosition') ? 'setInitialPosition' : 'endTurn'
        const args = tool === 'initializeFacility' ? { regions: [], homes: binding.agentId === 'facility-residential' ? population.npcs.map((n, i) => ({ id: `home${i}`, householdId: n.householdId, name: n.name, description: '家', bounds: { min: { x: i * 3, y: 0, z: 0 }, max: { x: i * 3 + 1, y: 1, z: 1 } } })) : [], publicState: '利用できます' } : tool === 'setInitialPosition' ? { position: { x: 0, y: 0, z: 0 } } : {}
        void this.toolHandler({ threadId: binding.threadId!, turnId: id, callId: `call-${id}`, namespace: null, tool, arguments: args }).then(result => {
          history.status = result.success ? 'completed' : 'failed'
          this.listener({ method: 'turn/completed', params: { threadId: binding.threadId, turn: { id, status: history.status, error: result.success ? null : { message: result.contentItems[0].text } } } })
        })
      }, 0)
    }
    return id
  }
  async steer() {}
  async compact() {}
  async history(threadId: string) { return this.historyTurns.get(threadId) ?? [] }
  async conversation(_threadId: string): Promise<import('../../src/shared/conversation').ConversationTurn[]> { return [] }
  async interrupt() {}
  async inspect() { return 'idle' as const }
  async turn() { return null }
  async close() {}
}
class Terminals implements TerminalBridge {
  ids = new Set<string>()
  exited = new Set<string>()
  listener: (id: string) => void = () => undefined
  has(id: string) { return this.ids.has(id) }
  isRunning(id: string) { return this.ids.has(id) && !this.exited.has(id) }
  onExit(listener: (id: string) => void) { this.listener = listener; return () => { this.listener = () => undefined } }
  async attach(binding: SessionBinding) { this.ids.add(binding.sessionId); this.exited.delete(binding.sessionId) }
  async snapshot(id: string) { return { sessionId: id, sequence: 1, columns: 100, rows: 30, data: 'real bridge tested separately' } }
  async input() {}
  async resize() {}
  async dispose() { this.ids.clear(); this.exited.clear() }
}
const engines = new Set<BackendEngine>()
afterEach(async () => { for (const e of engines) await e.close(); engines.clear() })
async function setup(base?: string, memory = false, connect = true) {
  await mkdir('.local/tests', { recursive: true })
  const root = base ?? await mkdtemp(path.resolve('.local/tests/backend-'))
  const runtime = new Runtime()
  const engine = new BackendEngine(root, runtime, new Terminals(), () => undefined, undefined, memory ? () => new FixturePersistencePort() : undefined)
  engines.add(engine); await engine.initialize()
  if (connect) await engine.backendCommand({ type: 'connect', authMode: 'chatgpt' })
  return { engine, runtime, root }
}
async function complete(engine: BackendEngine, runtime: Runtime, artifact: unknown) {
  const devBefore = engine.backendStatus().dev?.checkpoints
  await engine.workspace.write('preparation/work/result.json', JSON.stringify(artifact))
  const op = engine.backendStatus().preparation.operation!
  const revision = engine.backendStatus().preparation.revision
  const kind = (artifact as { kind?: string }).kind
  const threadId = engine.backendStatus().preparation.sessions.find(s => s.role === 'parent')!.threadId!
  runtime.historyTurns.set(threadId, [...(runtime.historyTurns.get(threadId) ?? []), { id: op.turnId!, status: 'completed', clientIds: [], compact: false }])
  runtime.listener({ method: 'turn/completed', params: { threadId, turn: { id: op.turnId, status: 'completed' } } })
  await vi.waitFor(() => {
    const p = engine.backendStatus().preparation
    expect(p.busy).toBe(false)
    if (p.error) throw new Error(p.error)
    expect(p.operation).toBeNull()
    if (kind === 'questions') expect(p.round).not.toBeNull()
    else if (kind === 'draft') {
      expect(p.revision).toBe(revision + 1)
      expect(engine.snapshot().state.map).toEqual(p.draft!.map)
    } else {
      expect(p.phase).toBe('ready')
      expect(engine.snapshot().state.stage).toBe('ready')
    }
  }, { timeout: 10000 })
  if (devBefore !== undefined) await vi.waitFor(() => { expect(engine.backendStatus().dev?.checkpoints).toBeGreaterThan(devBefore); expect(engine.backendStatus().dev?.busy).toBe(false); expect(engine.backendStatus().dev?.operation).toBeNull() }, { timeout: 10000 })
}
async function review(engine: BackendEngine, runtime: Runtime, configuration = settings, specification = draft) {
  await engine.backendCommand({ type: 'settings', settings: configuration })
  await engine.prepare({ description: '5人の町を作る。学校と職場がある。', images: [] })
  await complete(engine, runtime, { kind: 'questions', round })
  await engine.backendCommand({ type: 'answers', value: answers })
  await complete(engine, runtime, { kind: 'draft', draft: specification })
}

describe('Preparation harness', () => {
  it('registers parent event tools and authorizes only the current parent turn, retaining schedules on reconnect', async () => {
    const { engine, runtime, root } = await setup()
    const creation = vi.spyOn(runtime, 'create')
    await review(engine, runtime); await engine.backendCommand({ type: 'approve', revision: 1 }); await complete(engine, runtime, population)
    const parent = engine.backendStatus().preparation.sessions.find(s => s.role === 'parent')!
    expect(parent.worldEventToolsVersion).toBe(1)
    expect(creation.mock.calls[0]).toEqual([expect.anything(), expect.stringContaining('scheduleWorldEvent'), { disableEnvironment: false, tools: expect.arrayContaining([expect.objectContaining({ name: 'triggerWorldEvent' }), expect.objectContaining({ name: 'scheduleWorldEvent' })]) }])
    const call: RuntimeToolCall = { threadId: parent.threadId!, turnId: 'event-turn', callId: 'event-call', namespace: null, tool: 'scheduleWorldEvent', arguments: { title: '星祭り', type: '祭事', description: '広場で祭りが始まる', target: { scope: 'world' }, at: { day: 1, time: 'morning' } } }
    expect((await runtime.toolHandler(call)).success).toBe(false)
    runtime.listener({ method: 'turn/started', params: { threadId: parent.threadId, turn: { id: call.turnId } } })
    expect((await runtime.toolHandler({ ...call, namespace: 'forged' })).success).toBe(false)
    expect((await runtime.toolHandler({ ...call, threadId: 'thread-npc0' })).success).toBe(false)
    expect((await runtime.toolHandler(call)).success).toBe(true)
    expect((await runtime.toolHandler(call)).success).toBe(true)
    expect((await runtime.toolHandler({ ...call, callId: 'other-tool', tool: 'buildFacility' })).success).toBe(false)
    runtime.listener({ method: 'turn/completed', params: { threadId: parent.threadId, turn: { id: call.turnId, status: 'completed' } } })
    expect((await runtime.toolHandler({ ...call, callId: 'stale' })).success).toBe(false)
    await engine.pause()
    runtime.listener({ method: 'turn/started', params: { threadId: parent.threadId, turn: { id: 'paused-parent' } } })
    expect((await runtime.toolHandler({ ...call, turnId: 'paused-parent', callId: 'list', tool: 'getWorldEvents', arguments: {} })).success).toBe(true)
    runtime.listener({ method: 'turn/completed', params: { threadId: parent.threadId, turn: { id: 'paused-parent', status: 'completed' } } })
    await vi.waitFor(() => expect(engine.backendStatus().simulation?.worldEvents).toHaveLength(1))
    await engine.close(); engines.delete(engine)
    const next = await setup(root)
    expect(next.engine.backendStatus().simulation?.worldEvents).toMatchObject([{ title: '星祭り', status: 'scheduled' }])
    expect(next.runtime.resumed.find(s => s.agentId === 'parent')?.instructions).toContain('scheduleWorldEvent')
    await next.engine.backendCommand({ type: 'startSimulation', step: true })
    await vi.waitFor(() => expect(next.engine.backendStatus().simulation?.stage).toBe('paused'), { timeout: 10000 })
    expect(next.engine.backendStatus().simulation?.worldEvents).toMatchObject([{ status: 'occurred' }])
    expect(next.engine.backendStatus().simulation?.events.filter(e => e.kind === 'world')).toHaveLength(1)
    expect(next.engine.backendStatus().preparation.error).toBeNull()
    const run = next.engine.workspace.root
    await next.engine.close(); engines.delete(next.engine)
    const saved = JSON.parse(await readFile(path.join(run, 'backend.json'), 'utf8'))
    delete saved.preparation.sessions.find((s: SessionBinding) => s.role === 'parent').worldEventToolsVersion
    await writeFile(path.join(run, 'backend.json'), JSON.stringify(saved))
    const legacy = await setup(root)
    expect(legacy.runtime.resumed.find(s => s.agentId === 'parent')?.instructions).not.toContain('scheduleWorldEvent')
    legacy.runtime.listener({ method: 'turn/started', params: { threadId: parent.threadId, turn: { id: 'old-parent' } } })
    expect((await legacy.runtime.toolHandler({ ...call, turnId: 'old-parent', callId: 'old-call' })).success).toBe(false)
    legacy.runtime.listener({ method: 'turn/completed', params: { threadId: parent.threadId, turn: { id: 'old-parent', status: 'completed' } } })
  })

  it('retains a facility created during pause without starting inference until resume', async () => {
    const { engine, runtime } = await setup()
    await review(engine, runtime); await engine.backendCommand({ type: 'approve', revision: 1 }); await complete(engine, runtime, population)
    const create = runtime.create.bind(runtime), handler = runtime.toolHandler
    let release!: () => void, constructing = false, built = false
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(runtime, 'create').mockImplementation(async (binding, instructions) => {
      if (binding.agentId.startsWith('facility-built-')) { constructing = true; await gate }
      return create(binding, instructions)
    })
    runtime.toolHandler = async call => {
      if (!built && call.threadId === 'thread-npc0' && call.tool === 'endTurn') {
        built = true
        const result = await handler({ ...call, callId: 'paused-build', tool: 'buildFacility', arguments: { name: '工房', type: 'workshop', description: '制作', dimensions: { x: 10, y: 10, z: 3 }, organizationId: null } })
        expect(result.success).toBe(true)
      }
      return handler(call)
    }
    try {
      await engine.backendCommand({ type: 'startSimulation', step: true })
      await vi.waitFor(() => expect(constructing, JSON.stringify({ error: engine.backendStatus().error, simulation: engine.backendStatus().simulation?.stage })).toBe(true), { timeout: 10000 })
      await engine.pause()
    } finally { release() }
    await vi.waitFor(() => expect(engine.backendStatus().preparation.sessions.find(s => s.agentId.startsWith('facility-built-'))?.creation).toBe('initialized'))
    const facility = engine.backendStatus().simulation!.facilities.find(f => f.construction)!
    expect(facility.layout).toBeNull()
    expect(runtime.historyTurns.has(`thread-facility-${facility.id}`)).toBe(false)
    await engine.backendCommand({ type: 'startSimulation', step: true })
    await vi.waitFor(() => expect(engine.backendStatus().simulation?.facilities.find(f => f.id === facility.id)?.layout).not.toBeNull(), { timeout: 10000 })
    expect(runtime.created.filter(id => id === `facility-${facility.id}`)).toHaveLength(1)
  })
  it.each([false, true])('creates a constructed facility conversation and restores its map and binding (memory=%s)', async memory => {
    const { engine, runtime, root } = await setup(undefined, memory)
    await review(engine, runtime)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await complete(engine, runtime, population)
    const lock = structuredClone(engine.backendStatus().preparation.lock)
    const originalMap = structuredClone(engine.backendStatus().preparation.draft!.map)
    const handler = runtime.toolHandler
    let built = false
    runtime.toolHandler = async call => {
      if (!built && call.threadId === 'thread-npc0' && call.tool === 'endTurn') {
        built = true
        const result = await handler({ ...call, callId: 'build-once', tool: 'buildFacility', arguments: { name: '共同工房', type: 'workshop', description: '道具を制作する', dimensions: { x: 10, y: 10, z: 3 }, organizationId: null } })
        expect(result.success).toBe(true)
      }
      return handler(call)
    }
    await engine.backendCommand({ type: 'startSimulation', step: true })
    await vi.waitFor(() => expect(engine.backendStatus().simulation?.stage).toBe('paused'), { timeout: 10000 })
    const facility = engine.backendStatus().simulation!.facilities.find(f => f.construction)!
    expect(facility.layout?.publicState).toBe('利用できます')
    const agentId = `facility-${facility.id}`
    expect(runtime.created.filter(id => id === agentId)).toHaveLength(1)
    expect(engine.backendStatus().preparation.sessions.find(s => s.agentId === agentId)).toMatchObject({ role: 'facility', modelId: settings.facility.modelId, effort: settings.facility.effort, creation: 'initialized' })
    expect(engine.snapshot().state.map?.locations).toContainEqual(expect.objectContaining({ id: facility.locationId, name: '共同工房' }))
    expect(engine.snapshot().state.map?.connections).toContainEqual(expect.objectContaining({ from: 'home', to: facility.locationId }))
    expect(engine.snapshot().state.agents.find(a => a.id === agentId)?.name).toBe('共同工房')
    expect(engine.backendStatus().preparation.draft!.map).toEqual(originalMap)
    expect(engine.backendStatus().preparation.lock).toEqual(lock)
    await engine.close(); engines.delete(engine)
    const restored = await setup(root, memory)
    expect(restored.runtime.created).toEqual([])
    expect(restored.engine.snapshot().state.map?.locations).toContainEqual(expect.objectContaining({ id: facility.locationId }))
    expect(restored.engine.backendStatus().simulation!.facilities.find(f => f.id === facility.id)).toEqual(facility)
  })
  async function pendingDesign(memory = false) {
    const fixture = await setup(undefined, memory)
    await review(fixture.engine, fixture.runtime)
    await fixture.engine.backendCommand({ type: 'approve', revision: 1 })
    const input = structuredClone(population); input.npcs[0].age = 25
    await fixture.engine.workspace.write('preparation/work/result.json', JSON.stringify(input))
    const preparation = fixture.engine.backendStatus().preparation
    fixture.runtime.listener({ method: 'turn/completed', params: { threadId: preparation.sessions[0].threadId, turn: { id: preparation.operation!.turnId, status: 'completed' } } })
    await vi.waitFor(() => expect(fixture.engine.backendStatus().preparation.designReview?.decision).toBe('pending'))
    return { ...fixture, input, reviewId: fixture.engine.backendStatus().preparation.designReview!.id }
  }

  it.each([false, true])('requires an explicit design choice and preserves acceptance across restoration (memory=%s)', async memory => {
    const { engine, runtime, root, input, reviewId } = await pendingDesign(memory)
    expect(engine.backendStatus().preparation.population).toBeNull()
    expect(engine.backendStatus().preparation.error).toBeNull()
    expect(engine.snapshot().error).toBeNull()
    expect(runtime.created).toHaveLength(1)
    const turns = runtime.inputs.length
    await engine.backendCommand({ type: 'retry' })
    expect(runtime.inputs).toHaveLength(turns)
    await engine.backendCommand({ type: 'resolveDesign', reviewId, action: 'continue', message: '' })
    await vi.waitFor(() => expect(engine.backendStatus().preparation.phase).toBe('ready'), { timeout: 10000 })
    expect(engine.backendStatus().preparation.population).toEqual(input)
    expect(engine.backendStatus().preparation.designReview?.decision).toBe('accepted')
    expect(runtime.created).toHaveLength(9)
    await engine.close(); engines.delete(engine)
    const restored = await setup(root, memory)
    expect(restored.engine.backendStatus().preparation.designReview?.decision).toBe('accepted')
    expect(restored.engine.backendStatus().preparation.population).toEqual(input)
    expect(restored.runtime.created).toEqual([])
  })

  it('sends the design differences and optional instruction to the parent, then accepts corrected output', async () => {
    const { engine, runtime, reviewId } = await pendingDesign()
    await engine.backendCommand({ type: 'resolveDesign', reviewId, action: 'correct', message: '年齢配分だけを訂正してください' })
    expect(runtime.inputs.at(-1)).toContain('年齢配分だけを訂正してください')
    expect(runtime.inputs.at(-1)).toContain('population.ageDistribution')
    expect(engine.backendStatus().preparation.population).toBeNull()
    expect(engine.backendStatus().preparation.designReview?.decision).toBe('correctionRequested')
    await complete(engine, runtime, population)
    expect(engine.backendStatus().preparation.designReview).toBeUndefined()
    expect(engine.backendStatus().preparation.population).toEqual(population)
  })

  it('requires a fresh choice if generated output changes before acceptance', async () => {
    const { engine, runtime, input, reviewId } = await pendingDesign()
    input.npcs[1].age = 26
    await engine.workspace.write('preparation/work/result.json', JSON.stringify(input))
    await engine.backendCommand({ type: 'resolveDesign', reviewId, action: 'continue', message: '' })
    const current = engine.backendStatus().preparation.designReview!
    expect(current.id).not.toBe(reviewId)
    expect(current.decision).toBe('pending')
    expect(engine.backendStatus().preparation.population).toBeNull()
    await expect(engine.backendCommand({ type: 'resolveDesign', reviewId, action: 'continue', message: '' })).rejects.toThrow('対象が変わっています')
    expect(runtime.created).toHaveLength(1)
    await engine.backendCommand({ type: 'resolveDesign', reviewId: current.id, action: 'continue', message: '' })
    expect(engine.backendStatus().preparation.error).toBeNull()
    expect(engine.snapshot().error).toBeNull()
  })

  it('turns a saved legacy age-distribution failure into a pending choice after reconnecting', async () => {
    const { engine, root } = await pendingDesign()
    const metadata = JSON.parse(await engine.workspace.read('backend.json'))
    delete metadata.preparation.designReview
    metadata.preparation.error = '[generating / Harness] 年齢分布が承認済みの人口配分と一致しません'
    await engine.close(); engines.delete(engine)
    await writeFile(path.join(engine.workspace.root, 'backend.json'), JSON.stringify(metadata))
    const restored = await setup(root)
    expect(restored.engine.backendStatus().preparation.designReview?.decision).toBe('pending')
    expect(restored.engine.backendStatus().preparation.error).toBeNull()
    expect(restored.runtime.created).toEqual([])
  })

  it('rechecks corrected files without silently accepting a changed result or getting stuck', async () => {
    const { engine, runtime, reviewId } = await pendingDesign()
    await engine.workspace.write('preparation/work/result.json', JSON.stringify(population))
    await engine.backendCommand({ type: 'resolveDesign', reviewId, action: 'continue', message: '' })
    const updated = engine.backendStatus().preparation.designReview!
    expect(updated.id).not.toBe(reviewId)
    expect(updated.issues).toEqual([])
    expect(updated.decision).toBe('pending')
    expect(runtime.created).toHaveLength(1)
    await engine.backendCommand({ type: 'resolveDesign', reviewId: updated.id, action: 'continue', message: '' })
    await vi.waitFor(() => expect(engine.backendStatus().preparation.phase).toBe('ready'), { timeout: 10000 })
  })

  it('creates and restores conversations without spawning terminals until opened', async () => {
    const { engine, runtime, root } = await setup()
    const attach = vi.spyOn(engine.sessions, 'attach')
    await review(engine, runtime)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await complete(engine, runtime, population)
    expect(attach).not.toHaveBeenCalled()
    expect(engine.snapshot().state.agents.every(agent => agent.status !== 'ended')).toBe(true)
    await Promise.all([engine.terminalSnapshot('npc0'), engine.terminalSnapshot('npc0')])
    expect(attach).toHaveBeenCalledTimes(1)
    await engine.terminalSnapshot('npc0')
    expect(attach).toHaveBeenCalledTimes(1)
    await expect(engine.terminalSnapshot('missing')).rejects.toThrow('Conversation')
    await engine.close(); engines.delete(engine)
    const restored = await setup(root)
    expect(restored.engine.sessions.has('npc0')).toBe(false)
    expect(restored.runtime.created).toEqual([])
    await restored.engine.terminalSnapshot('npc0')
    expect(restored.engine.sessions.has('npc0')).toBe(true)
  })
  it.each([false, true])('refreshes existing life NPC prompts without replacing their conversations (memory=%s)', async memory => {
    const { engine, runtime, root } = await setup(undefined, memory)
    await review(engine, runtime)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await complete(engine, runtime, population)
    const sessions = engine.backendStatus().preparation.sessions
    await engine.close(); engines.delete(engine)
    const restored = await setup(root, memory)
    expect(restored.engine.backendStatus().preparation.sessions).toEqual(sessions)
    expect(restored.runtime.created).toEqual([])
    for (const session of sessions) {
      const resumed = restored.runtime.resumed.find(item => item.agentId === session.agentId)!
      expect(resumed.threadId).toBe(session.threadId)
      if (session.role === 'npc') {
        expect(session.memoryVersion).toBe(memory ? 1 : undefined)
        expect(resumed.instructions?.includes('consolidateMemory')).toBe(memory)
        expect(resumed.instructions).toContain('【心の声】')
        expect(resumed.instructions).toContain('【独り言】')
        expect(resumed.instructions).toContain('ユーザーだけに表示され、他のNPCへは届きません')
      } else if (session.role === 'facility') expect(resumed.instructions).toBeUndefined()
    }
    expect(restored.engine.snapshot().state.simulation).toMatchObject({ turn: 0, stage: 'ready' })
  })
  it('flushes initialization completion and the turn limit without waiting for the autosave interval', async () => {
    const { engine, runtime } = await setup(undefined, true)
    await review(engine, runtime, settings, { ...draft, specification: { ...draft.specification, simulation: { ...draft.specification.simulation, maxTurns: 1 } } })
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await complete(engine, runtime, population)
    const saved = () => { const status = engine.backendStatus().persistence!; expect(status.savedRevision).toBe(status.revision) }
    await vi.waitFor(saved)
    await engine.backendCommand({ type: 'startSimulation', step: false })
    await vi.waitFor(() => expect(engine.snapshot().state.stage).toBe('ended'))
    await vi.waitFor(saved)
  })
  it('creates only version 2 storage, pauses and cleanly restores exact conversations and world positions', async () => {
    const { engine, runtime, root } = await setup(undefined, true)
    await review(engine, runtime)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await complete(engine, runtime, population)
    await engine.backendCommand({ type: 'startSimulation', step: true })
    await vi.waitFor(() => expect(engine.snapshot().state.stage).toBe('paused'))
    await engine.pause()
    const before = engine.snapshot().state
    const sessions = engine.backendStatus().preparation.sessions
    const run = engine.workspace.root
    await engine.close(); engines.delete(engine)
    for (const file of ['state.json', 'backend.json', 'simulation/checkpoint.json']) await expect(readFile(path.join(run, file))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(path.join(run, 'persistence/manifest.json'), 'utf8')).dirty).toBe(false)
    const restored = await setup(root, true)
    expect(restored.engine.backendStatus().preparation.sessions).toEqual(sessions)
    expect(restored.engine.snapshot().state.simulation?.actors).toEqual(before.simulation!.actors)
    expect(restored.engine.snapshot().state.frame.turn).toBe(1)
    expect(restored.runtime.created).toEqual([])
    await restored.engine.backendCommand({ type: 'startSimulation', step: true })
    await vi.waitFor(() => expect(restored.engine.snapshot().state.frame.turn).toBe(2))
    await vi.waitFor(() => expect(restored.engine.snapshot().state.stage).toBe('paused'))
  })
  it('opens a dirty run read-only and blocks runtime and terminal input without replaying anything', async () => {
    const { engine, runtime, root } = await setup(undefined, true)
    await review(engine, runtime)
    await engine.saveNow()
    await engine.discardClose(); engines.delete(engine)
    const restored = await setup(root, true, false)
    expect(restored.engine.backendStatus().persistence?.readOnlyReason).toContain('閲覧専用')
    expect(() => restored.engine.backendCommand({ type: 'connect', authMode: 'chatgpt' })).toThrow('閲覧専用')
    await expect(restored.engine.terminalInput('parent', 'continue\r')).rejects.toThrow('閲覧専用')
    expect(restored.runtime.inputs).toEqual([])
    expect(restored.runtime.created).toEqual([])
    await restored.engine.newRun()
    expect(restored.engine.backendStatus().persistence?.readOnlyReason).toBeNull()
  })
  it('keeps a legacy world readable without dimensions or retrofitting life conversations', async () => {
    const { engine, runtime, root } = await setup()
    await review(engine, runtime)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await complete(engine, runtime, population)
    const run = engine.workspace.root
    await engine.close(); engines.delete(engine)
    const saved = JSON.parse(await readFile(path.join(run, 'backend.json'), 'utf8')) as { lifeVersion?: number; preparation: PreparationProgress }
    delete saved.lifeVersion
    for (const b of saved.preparation.sessions) delete b.lifeToolsVersion
    for (const f of saved.preparation.draft!.specification.town.facilities) delete f.dimensions
    saved.preparation.lock!.hash = digest(JSON.stringify(saved.preparation.draft))
    await writeFile(path.join(run, 'backend.json'), JSON.stringify(saved))
    await writeFile(path.join(run, 'preparation/locked.json'), JSON.stringify(saved.preparation.draft))
    const oldState = JSON.parse(await readFile(path.join(run, 'state.json'), 'utf8'))
    delete oldState.simulation
    await writeFile(path.join(run, 'state.json'), JSON.stringify(oldState))
    const restored = await setup(root)
    expect(restored.engine.snapshot().state.stage).toBe('ready')
    expect(restored.engine.snapshot().state.simulation).toBeUndefined()
    expect(restored.engine.snapshot().state.agents).toHaveLength(9)
    expect(restored.runtime.created).toEqual([])
    await expect(restored.engine.backendCommand({ type: 'startSimulation', step: false })).rejects.toThrow('新しい実行')
  })
  it.each(['fixed', 'auto'] as const)('passes explicit %s NPC settings from the harness at startup, generation and retry', async mode => {
    const { engine, runtime } = await setup()
    const configuration: AgentModelSettings = { ...settings, npc: { model: mode === 'auto' ? { mode: 'auto' } : { mode: 'fixed', modelId: 'gpt-6-astra' }, effort: { mode: 'auto' } } }
    await review(engine, runtime, configuration)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    // Reproduce a completed parent response that kept the old draft instead of writing population.
    const operation = engine.backendStatus().preparation.operation!
    runtime.listener({ method: 'turn/completed', params: { threadId: 'thread-parent', turn: { id: operation.turnId, status: 'completed' } } })
    await vi.waitFor(() => expect(engine.backendStatus().preparation.error).toContain('result.jsonが更新されていません'))
    await engine.backendCommand({ type: 'retry' })
    expect(runtime.instructions[0]).toContain('世界管理・シミュレーション責任者')
    expect(runtime.inputs).toHaveLength(5)
    for (const input of runtime.inputs) {
      const payload = JSON.parse(input.split('<harness_model_settings>\n')[1].split('\n</harness_model_settings>')[0])
      expect(payload.settings).toEqual(configuration)
      expect(payload.npcModelCandidates.map((m: { modelId: string }) => m.modelId)).toEqual(mode === 'auto' ? ['gpt-5.6-luna', 'gpt-6-astra'] : ['gpt-6-astra'])
    }
    expect(runtime.inputs.at(-1)).toContain('初期人口だけをresult.jsonへ保存')
    expect(runtime.created).toEqual(['parent'])
  })
  it('reconnects only the ended terminal to its saved conversation even while a turn is active', async () => {
    const { engine, runtime } = await setup()
    await engine.prepare({ description: '再接続を確認する町', images: [] })
    const binding = engine.backendStatus().preparation.sessions[0]
    const operation = engine.backendStatus().preparation.operation
    const terminals = engine.sessions as Terminals
    await engine.terminalSnapshot('parent')
    const resume = vi.spyOn(runtime, 'resume')
    const start = vi.spyOn(runtime, 'startTurn')
    const attach = vi.spyOn(terminals, 'attach')
    runtime.listener({ method: 'turn/started', params: { threadId: binding.threadId, turn: { id: operation!.turnId } } })
    terminals.exited.add('parent'); terminals.listener('parent')
    await vi.waitFor(() => expect(engine.snapshot().state.agents[0].status).toBe('ended'))
    await engine.backendCommand({ type: 'terminalReconnect', sessionId: 'parent' })
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ threadId: binding.threadId }))
    expect(engine.backendStatus().preparation.operation).toEqual(operation)
    expect(engine.snapshot().state.agents[0].status).toBe('running')
    expect(start).not.toHaveBeenCalled()
    expect(runtime.created).toEqual(['parent'])
    await engine.backendCommand({ type: 'terminalReconnect', sessionId: 'parent' })
    expect(attach).toHaveBeenCalledTimes(1)
  })
  it('does not send the CLI exit shortcut when interrupting an idle parent', async () => {
    const { engine, runtime } = await setup()
    await engine.backendCommand({ type: 'settings', settings })
    const input = vi.spyOn(engine.sessions, 'input')
    const interrupt = vi.spyOn(runtime, 'interrupt')
    await engine.interrupt('parent')
    expect(input).not.toHaveBeenCalled()
    expect(interrupt).not.toHaveBeenCalled()
  })
  it('stores the physical working directory when the project uses a Windows junction', async () => {
    await mkdir('.local/tests', { recursive: true })
    const directory = await mkdtemp(path.resolve('.local/tests/redirect-'))
    const physical = path.join(directory, 'physical')
    const alias = path.join(directory, 'alias')
    await mkdir(physical)
    await symlink(physical, alias, 'junction')
    const { engine } = await setup(alias)
    await engine.backendCommand({ type: 'settings', settings })
    const binding = engine.backendStatus().preparation.sessions[0]
    expect(binding.cwd).toBe(await realpath(binding.cwd))
    expect(binding.cwd).toContain(`${path.sep}physical${path.sep}`)
  })
  it('applies independent model Auto and age effort to initial sessions', async () => {
    const { engine, runtime } = await setup()
    await review(engine, runtime, { ...settings, npc: { model: { mode: 'auto' }, effort: { mode: 'auto' } } })
    await engine.backendCommand({ type: 'approve', revision: 1 })
    const selected = structuredClone(population)
    selected.npcs[0].birthModelId = models[1].model
    selected.npcs[0].modelSelectionReason = '先天的特徴として親が選択'
    await complete(engine, runtime, selected)
    expect(engine.backendStatus().preparation.sessions.filter(s => s.role === 'npc').map(s => s.effort)).toEqual(['low', 'medium', 'high', 'high', 'high'])
    expect(engine.backendStatus().preparation.sessions.find(s => s.agentId === 'npc0')?.modelId).toBe(models[1].model)
  })
  it('rejects a draft before the required initial question round is answered', async () => {
    const { engine, runtime } = await setup()
    await engine.prepare({ description: '十分な資料がある町', images: [] })
    await engine.workspace.write('preparation/work/result.json', JSON.stringify({ kind: 'draft', draft }))
    runtime.listener({ method: 'turn/completed', params: { threadId: 'thread-parent', turn: { id: engine.backendStatus().preparation.operation!.turnId, status: 'completed' } } })
    await vi.waitFor(() => expect(engine.backendStatus().preparation.error).toContain('質問ラウンド'))
    expect(engine.backendStatus().preparation.lock).toBeNull()
    expect(runtime.created).toEqual(['parent'])
  })
  it('reviews, locks and initializes 5 NPCs and facilities at turn zero, then restores exact IDs', async () => {
    const { engine, runtime, root } = await setup()
    await review(engine, runtime)
    expect(runtime.created).toEqual(['parent'])
    expect(engine.snapshot().state.map?.locations).toHaveLength(3)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await complete(engine, runtime, population)
    expect(engine.snapshot().state).toMatchObject({ stage: 'ready', frame: { turn: 0, mapRevision: 1 } })
    expect(engine.snapshot().state.agents).toHaveLength(9)
    expect(Object.keys(engine.snapshot().state.frame.positions)).toHaveLength(5)
    const bindings = engine.backendStatus().preparation.sessions
    expect(bindings.every(s => s.threadId && s.creation === 'initialized')).toBe(true)
    await engine.workspace.write('state.json', JSON.stringify({ ...engine.snapshot().state, frame: { ...engine.snapshot().state.frame, turn: 999 } }))
    await engine.workspace.refresh()
    expect(engine.snapshot().state.frame.turn).toBe(0)
    await engine.close(); engines.delete(engine)
    const restored = await setup(root)
    expect(restored.runtime.created).toEqual([])
    expect(restored.engine.backendStatus().preparation.sessions).toEqual(bindings)
    expect(restored.engine.snapshot().state.stage).toBe('ready')
    expect(restored.engine.snapshot().state.frame.turn).toBe(0)
  })
  it('rejects stale approvals and requires the first question round', async () => {
    const { engine, runtime } = await setup()
    await review(engine, runtime)
    await engine.backendCommand({ type: 'revise', revision: 1, message: '学校を移動してください' })
    await complete(engine, runtime, { kind: 'draft', draft: { ...draft, map: { ...draft.map, revision: 2 } } })
    await expect(engine.backendCommand({ type: 'approve', revision: 1 })).rejects.toThrow('承認できません')
    expect(runtime.created).toEqual(['parent'])
  })
  it('detects external modification of the locked specification and never creates children', async () => {
    const { engine, runtime } = await setup()
    await review(engine, runtime)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await engine.workspace.write('preparation/locked.json', '{}')
    await engine.workspace.write('preparation/work/result.json', JSON.stringify(population))
    runtime.listener({ method: 'turn/completed', params: { threadId: 'thread-parent', turn: { id: engine.backendStatus().preparation.operation!.turnId, status: 'completed' } } })
    await vi.waitFor(() => expect(engine.backendStatus().preparation.error).toContain('承認済み仕様が変更'))
    expect(runtime.created).toEqual(['parent'])
  })
  it('does not repeat uncertain Conversation creation on retry or restart', async () => {
    const { engine, runtime, root } = await setup()
    runtime.failCreation = true
    await expect(engine.backendCommand({ type: 'settings', settings })).rejects.toThrow('response lost')
    await expect(engine.backendCommand({ type: 'retry' })).rejects.toThrow('自動再送しません')
    expect(runtime.created).toEqual(['parent'])
    await engine.close(); engines.delete(engine)
    await expect(setup(root)).rejects.toThrow('自動再送しません')
  })
})


describe('DEV experiments', () => {
  const ready = async (engine: BackendEngine) => {
    await vi.waitFor(() => { expect(engine.backendStatus().dev?.operation).toBeNull(); expect(engine.backendStatus().dev?.busy).toBe(false) }, { timeout: 10000 })
    if (engine.backendStatus().error) throw new Error(engine.backendStatus().error!)
  }
  it('rewinds all conversations, files and world turns into branches and keeps latest or historical prompts', async () => {
    const { engine, runtime, root } = await setup(undefined, true)
    await engine.backendCommand({ type: 'devEnable' })
    const originalId = engine.snapshot().state.runId
    await review(engine, runtime)
    await ready(engine)
    const preCity = (await engine.devPanel()).checkpoints.find(c => c.label === '都市・仕様生成前')!
    expect(preCity).toBeDefined()
    await engine.backendCommand({ type: 'approve', revision: 1 })
    expect(() => engine.backendCommand({ type: 'devPrompts', prompts: { npc: 'in flight' } })).toThrow('処理中')
    await complete(engine, runtime, population); await ready(engine)
    await engine.backendCommand({ type: 'startSimulation', step: true })
    await vi.waitFor(() => expect(engine.backendStatus().simulation?.stage).toBe('paused'))
    await ready(engine)
    const point = (await engine.devPanel()).checkpoints.find(c => c.label === 'Turn 1 終了')!
    expect(point).toBeDefined()
    const oldThreads = engine.backendStatus().preparation.sessions.map(s => s.threadId)
    const oldHistory = structuredClone(runtime.historyTurns)
    await engine.backendCommand({ type: 'devPrompts', prompts: { npc: 'LATEST {{townName}} {{birthModelId}}', parent: 'PARENT_LATEST' } })
    await engine.workspace.write('future-only.txt', 'after checkpoint')
    await engine.backendCommand({ type: 'startSimulation', step: true })
    await vi.waitFor(() => expect(engine.backendStatus().simulation?.turn).toBe(2))
    await vi.waitFor(() => expect(engine.backendStatus().simulation?.stage).toBe('paused'))
    await ready(engine)
    await expect(engine.backendCommand({ type: 'answers', value: answers })).rejects.toThrow('回答待ち')
    expect(engine.backendStatus().error).not.toBeNull()
    await engine.backendCommand({ type: 'devBranch', checkpointId: point.id, prompts: 'latest' })
    expect(engine.snapshot().state.runId).not.toBe(originalId)
    expect(engine.backendStatus().error).toBeNull()
    expect(engine.backendStatus().simulation).toMatchObject({ turn: 1, stage: 'paused', phase: 'between' })
    expect(engine.backendStatus().preparation.sessions.every(s => !oldThreads.includes(s.threadId))).toBe(true)
    expect((await engine.devPanel()).state?.prompts.parent).toBe('PARENT_LATEST')
    expect(runtime.resumed.filter(s => s.agentId === 'npc0').at(-1)?.instructions).toContain('LATEST 試験の町')
    await expect(engine.workspace.read('future-only.txt')).rejects.toThrow()
    expect(await readFile(path.join(root, originalId, 'future-only.txt'), 'utf8')).toBe('after checkpoint')
    for (const binding of engine.backendStatus().preparation.sessions) {
      const source = oldThreads.find(id => id === `thread-${binding.agentId}`)!
      expect(await runtime.history(binding.threadId!)).toEqual(oldHistory.get(source) ?? [])
    }
    const inherited = (await engine.devPanel()).checkpoints.find(c => c.id === preCity.id)!
    await engine.backendCommand({ type: 'devBranch', checkpointId: inherited.id, runId: inherited.runId, prompts: 'checkpoint' })
    expect(engine.backendStatus().preparation.draft).toBeNull()
    expect(engine.backendStatus().preparation.population).toBeNull()
    expect(engine.backendStatus().simulation).toBeUndefined()
    expect((await engine.devPanel()).state?.prompts.parent).not.toBe('PARENT_LATEST')
    expect((await engine.devPanel()).state?.prompts.npc).toContain('{{townName}}')
    const parent = engine.backendStatus().preparation.sessions[0]
    expect(await runtime.history(parent.threadId!)).toEqual([])
    await engine.resume()
    expect(runtime.inputs.at(-1)).toContain('5人の町を作る。学校と職場がある。')
    await complete(engine, runtime, { kind: 'questions', round })
  })
  it('records every turn during continuous DEV execution and refuses an in-flight prompt edit', async () => {
    const { engine, runtime } = await setup(undefined, true)
    await engine.backendCommand({ type: 'devEnable' })
    await review(engine, runtime); await ready(engine)
    await engine.backendCommand({ type: 'approve', revision: 1 })
    await complete(engine, runtime, population); await ready(engine)
    await engine.backendCommand({ type: 'startSimulation', step: false })
    await vi.waitFor(() => expect(engine.backendStatus().simulation?.turn).toBeGreaterThanOrEqual(3), { timeout: 10000 })
    await engine.pause()
    const labels = (await engine.devPanel()).checkpoints.map(c => c.label)
    expect(labels).toContain('Turn 1 終了')
    expect(labels).toContain('Turn 2 終了')
  })
  it('does not activate or resend a branch whose fork result is unknown', async () => {
    const { engine, runtime } = await setup(undefined, true)
    await engine.backendCommand({ type: 'devEnable' })
    await engine.backendCommand({ type: 'settings', settings })
    await engine.prepare({ description: 'fixture', images: [] })
    await complete(engine, runtime, { kind: 'questions', round }); await ready(engine)
    const point = (await engine.devPanel()).checkpoints.at(-1)!
    const originalId = engine.snapshot().state.runId, calls = runtime.inputs.length
    runtime.failFork = true
    await expect(engine.backendCommand({ type: 'devBranch', checkpointId: point.id, prompts: 'latest' })).rejects.toThrow('thread/fork response lost')
    expect(engine.snapshot().state.runId).toBe(originalId)
    expect(runtime.inputs).toHaveLength(calls)
    await expect(engine.backendCommand({ type: 'devBranch', checkpointId: point.id, runId: crypto.randomUUID(), prompts: 'latest' })).rejects.toThrow('系譜')
  })
})


it('restores a known DEV point from a dirty run without replaying unknown inference', async () => {
  const { engine, runtime, root } = await setup(undefined, true)
  await engine.backendCommand({ type: 'devEnable' })
  await engine.backendCommand({ type: 'settings', settings })
  await engine.prepare({ description: 'fixture', images: [] })
  await complete(engine, runtime, { kind: 'questions', round })
  const point = (await engine.devPanel()).checkpoints.at(-1)!
  const histories = structuredClone(runtime.historyTurns)
  await engine.saveNow(); await engine.discardClose(); engines.delete(engine)
  const restored = await setup(root, true, false)
  restored.runtime.historyTurns = histories
  expect(restored.engine.backendStatus().persistence?.state).toBe('readOnly')
  await restored.engine.backendCommand({ type: 'devBranch', checkpointId: point.id, prompts: 'checkpoint' })
  expect(restored.engine.backendStatus().persistence?.readOnlyReason).toBeNull()
  expect(restored.engine.backendStatus().preparation.round).toEqual(round)
  expect(restored.runtime.inputs).toEqual([])
})

it('retains a failed DEV prompt operation and does not resume it after a dirty restart', async () => {
  const { engine, runtime, root } = await setup(undefined, true)
  await engine.backendCommand({ type: 'devEnable' })
  await engine.backendCommand({ type: 'settings', settings })
  vi.spyOn(runtime, 'resume').mockRejectedValueOnce(new Error('resume response lost'))
  await expect(engine.backendCommand({ type: 'devPrompts', prompts: { parent: 'NEW_PROMPT' } })).rejects.toThrow('response lost')
  expect(engine.backendStatus().dev?.operation).toMatchObject({ kind: 'prompts', status: 'uncertain' })
  expect(() => engine.backendCommand({ type: 'startSimulation', step: true })).toThrow('未確定')
  await engine.discardClose(); engines.delete(engine)
  const restored = await setup(root, true, false)
  expect(restored.engine.backendStatus().persistence?.state).toBe('readOnly')
  expect(restored.runtime.resumed).toEqual([])
  expect(restored.runtime.inputs).toEqual([])
})


it('stops before inference when a DEV checkpoint cannot be saved', async () => {
  const { engine, runtime } = await setup(undefined, true)
  await engine.backendCommand({ type: 'devEnable' })
  await engine.backendCommand({ type: 'settings', settings })
  const before = runtime.inputs.length
  const capture = vi.spyOn(DevStore.prototype, 'capture').mockRejectedValueOnce(new Error('ENOSPC DEV checkpoint'))
  await expect(engine.prepare({ description: 'must not dispatch', images: [] })).rejects.toThrow('ENOSPC')
  capture.mockRestore()
  expect(runtime.inputs).toHaveLength(before)
  expect(engine.backendStatus().dev?.operation).toMatchObject({ status: 'uncertain' })
  expect((await engine.devPanel()).checkpoints).toHaveLength(1)
  await engine.discardClose(); engines.delete(engine)
})


it('checkpoints the final DEV world before automatic Compilation and does not compile merely by branching', async () => {
  const { engine, runtime, root } = await setup(undefined, true)
  await engine.backendCommand({ type: 'devEnable' })
  const specification = structuredClone(draft); specification.specification.simulation.maxTurns = 1
  await review(engine, runtime, settings, specification)
  await engine.backendCommand({ type: 'approve', revision: 1 })
  await complete(engine, runtime, population)
  await engine.backendCommand({ type: 'startSimulation', step: false })
  await vi.waitFor(() => expect(engine.backendStatus().compilation?.status).toBe('completed'), { timeout: 10000 })
  const point = (await engine.devPanel()).checkpoints.find(c => c.label === 'Turn 1 終了')!
  expect(point).toBeDefined()
  const inputs = runtime.inputs.length
  await engine.backendCommand({ type: 'devBranch', checkpointId: point.id, prompts: 'latest' })
  expect(engine.backendStatus().simulation?.stage).toBe('ended')
  expect(engine.backendStatus().compilation).toBeUndefined()
  expect(runtime.inputs).toHaveLength(inputs)
  const history = structuredClone(runtime.historyTurns)
  await engine.close(); engines.delete(engine)
  const restored = await setup(root, true, false)
  restored.runtime.historyTurns = history
  await restored.engine.backendCommand({ type: 'connect', authMode: 'chatgpt' })
  expect(restored.runtime.inputs).toEqual([])
  expect((await restored.engine.devPanel()).state?.hold).toBe(true)
  await restored.engine.backendCommand({ type: 'recompile' })
  await vi.waitFor(() => expect(restored.engine.backendStatus().compilation?.status).toBe('completed'), { timeout: 10000 })
})
