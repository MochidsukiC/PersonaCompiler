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

class Runtime implements AgentRuntime {
  toolHandler: (call: RuntimeToolCall) => Promise<RuntimeToolResult> = async () => { throw new Error('No tool handler') }
  historyTurns = new Map<string, LifeHistoryTurn[]>()
  setToolHandler(handler: (call: RuntimeToolCall) => Promise<RuntimeToolResult>) { this.toolHandler = handler }
  listener: (event: RpcNotification) => void = () => undefined
  created: string[] = []
  instructions: string[] = []
  inputs: string[] = []
  failCreation = false
  mode: 'chatgpt' | 'apiKey' = 'chatgpt'
  available = models
  onNotification(listener: (event: RpcNotification) => void) { this.listener = listener; return () => { this.listener = () => undefined } }
  async connect(mode: 'chatgpt' | 'apiKey') { this.mode = mode }
  async account() { return { authenticated: true, mode: this.mode } }
  async models() { return this.available }
  async loginChatGpt() { return { id: 'login', url: 'https://auth.openai.com' } }
  async loginApiKey() {}
  async cancelLogin() {}
  async create(binding: SessionBinding, instructions: string) { this.created.push(binding.agentId); this.instructions.push(instructions); if (this.failCreation) throw new Error('thread/start response lost'); return `thread-${binding.agentId}` }
  async seed(_binding: SessionBinding, text: string) { this.inputs.push(text) }
  async resume(_binding: SessionBinding, instructions?: string) { if (instructions !== undefined) this.instructions.push(instructions) }
  async startTurn(binding: SessionBinding, text: string, _images?: string[], clientId?: string) {
    this.inputs.push(text)
    const id = `turn-${crypto.randomUUID()}`
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
  async interrupt() {}
  async inspect() { return 'idle' as const }
  async turn() { return null }
  async close() {}
}
class Terminals implements TerminalBridge {
  ids = new Set<string>()
  listener: (id: string) => void = () => undefined
  has(id: string) { return this.ids.has(id) }
  isRunning(id: string) { return this.ids.has(id) }
  onExit(listener: (id: string) => void) { this.listener = listener; return () => { this.listener = () => undefined } }
  async attach(binding: SessionBinding) { this.ids.add(binding.sessionId) }
  async snapshot(id: string) { return { sessionId: id, sequence: 1, columns: 100, rows: 30, data: 'real bridge tested separately' } }
  async input() {}
  async resize() {}
  async dispose() { this.ids.clear() }
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
  await engine.workspace.write('preparation/work/result.json', JSON.stringify(artifact))
  const op = engine.backendStatus().preparation.operation!
  const revision = engine.backendStatus().preparation.revision
  const kind = (artifact as { kind?: string }).kind
  runtime.listener({ method: 'turn/completed', params: { threadId: 'thread-parent', turn: { id: op.turnId, status: 'completed' } } })
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
}
async function review(engine: BackendEngine, runtime: Runtime, configuration = settings, specification = draft) {
  await engine.backendCommand({ type: 'settings', settings: configuration })
  await engine.prepare({ description: '5人の町を作る。学校と職場がある。', images: [] })
  await complete(engine, runtime, { kind: 'questions', round })
  await engine.backendCommand({ type: 'answers', value: answers })
  await complete(engine, runtime, { kind: 'draft', draft: specification })
}

describe('Preparation harness', () => {
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
    const resume = vi.spyOn(runtime, 'resume')
    const start = vi.spyOn(runtime, 'startTurn')
    const attach = vi.spyOn(terminals, 'attach')
    runtime.listener({ method: 'turn/started', params: { threadId: binding.threadId, turn: { id: operation!.turnId } } })
    terminals.ids.delete('parent'); terminals.listener('parent')
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
