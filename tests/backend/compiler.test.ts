import { expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BackendEngine } from '../../src/backend/engine'
import { ParentProduction } from '../../src/backend/production'
import { inspectCharacterPackage } from '../../src/backend/package-inspection'
import { digest, Workspace } from '../../src/main/workspace'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { LifeHarness } from '../../src/core/life-harness'
import { emptyPreparation, type SessionBinding } from '../../src/core/contracts'
import { compilerInputSchema, validateCharacterPackage, StandardCompilerPrompts } from '../../src/core/compiler'
import type { ProductionOperation } from '../../src/core/compiler-contracts'
import type { AgentRuntime, RuntimeToolCall, RuntimeToolResult } from '../../src/backend/runtime'
import type { RpcNotification } from '../../src/backend/rpc'
import type { TerminalBridge } from '../../src/backend/terminals'
import { FixturePersistencePort } from './persistence-fixture'
import { draft, population, settings, models } from './fixtures'

const packageFor = (npcId: string) => ({ npcId, lifeSummary: [{ text: '生活した人物', evidence: ['identity'] }], personality: [], speechTendency: [], appearance: [], goals: [], behavior: [], schedule: [], runtimeGuidance: '資料に沿って応答する', systemPrompt: 'あなたはこの町で暮らした住民です。', memoryIds: [], relationshipTargets: [] })
class Runtime implements AgentRuntime {
  readonly listeners = new Set<(event: RpcNotification) => void>()
  generated: string[] = []
  failNpc: string | null = null
  holdPosition = false
  heldPosition: string | null = null
  active: { threadId: string; turnId: string } | null = null
  handler: (call: RuntimeToolCall) => Promise<RuntimeToolResult> = async () => { throw new Error('No handler') }
  onNotification(listener: (event: RpcNotification) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  emit(event: RpcNotification) { for (const listener of this.listeners) listener(event) }
  setToolHandler(handler: (call: RuntimeToolCall) => Promise<RuntimeToolResult>) { this.handler = handler }
  async connect() {}
  async account() { return { authenticated: true, mode: 'chatgpt' as const } }
  async models() { return models }
  async loginChatGpt() { return { id: 'login', url: 'https://auth.openai.com' } }
  async loginApiKey() {} async cancelLogin() {}
  async create(b: SessionBinding) { return `thread-${b.agentId}` }
  async seed() {} async resume() {}
  async startTurn(binding: SessionBinding, text: string) {
    if (binding.role !== 'parent') {
      const id = crypto.randomUUID()
      if (this.holdPosition && text.includes('setInitialPosition')) {
        this.heldPosition = binding.agentId
        queueMicrotask(() => this.emit({ method: 'turn/started', params: { threadId: binding.threadId, turn: { id } } }))
        return id
      }
      queueMicrotask(() => { void (async () => {
        this.emit({ method: 'turn/started', params: { threadId: binding.threadId, turn: { id } } })
        const position = text.includes('setInitialPosition')
        const info = position ? JSON.parse(text.slice(text.indexOf('\n') + 1)) : null
        const point = info?.facility?.layout.homes.find((h: { householdId: string }) => h.householdId === info.identity.householdId)?.bounds.min ?? { x: 0, y: 0, z: 0 }
        const result = text.includes('日次境界の通知です') ? { success: true, contentItems: [] } : await this.handler({ threadId: binding.threadId!, turnId: id, callId: crypto.randomUUID(), namespace: null, tool: position ? 'setInitialPosition' : 'endTurn', arguments: position ? { position: point } : {} })
        this.emit({ method: 'turn/completed', params: { threadId: binding.threadId, turn: { id, status: result.success ? 'completed' : 'failed', error: result.success ? null : { message: result.contentItems[0].text } } } })
      })() })
      return id
    }
    const relative = text.match(/入力資料: (production\/[a-f0-9-]+\/input.json)/)![1]
    const source = JSON.parse(await readFile(path.join(binding.cwd, relative), 'utf8'))
    let result: unknown
    if (source.birth) {
      result = { ...population.npcs[0], id: `npc-${source.birth.id}`, name: '新生児', age: 0, occupation: null, sex: '女性', householdId: source.parents.find((p: { id: string }) => p.id === source.birth.homeParentId).householdId, locationId: 'home', family: source.birth.parents.map((npcId: string) => ({ npcId, relation: 'parent' })) }
      this.generated.push(`npc-${source.birth.id}`)
    } else {
      const input = compilerInputSchema.parse(source)
      this.generated.push(input.identity.id)
      const artifact = packageFor(input.identity.id)
      if (input.identity.id === this.failNpc) artifact.lifeSummary[0].evidence = ['nonexistent']
      result = artifact
    }
    await writeFile(path.join(binding.cwd, relative.replace('input.json', 'result.json')), JSON.stringify(result))
    const id = crypto.randomUUID()
    this.emit({ method: 'turn/started', params: { threadId: binding.threadId, turn: { id } } })
    this.emit({ method: 'turn/completed', params: { threadId: binding.threadId, turn: { id, status: 'completed' } } })
    return id
  }
  async steer() {} async compact() {} async history() { return [] }
  async conversation() { return [] }
  async interrupt(threadId: string, id: string) { this.emit({ method: 'turn/completed', params: { threadId, turn: { id, status: 'interrupted' } } }) }
  async inspect() { return 'idle' as const } async turn() { return null } async close() {}
}
const terminals = (): TerminalBridge => ({ has: () => false, isRunning: () => false, onExit: () => () => undefined, async attach() {}, async snapshot(id) { return { sessionId: id, sequence: 0, data: '', columns: 80, rows: 24 } }, async input() {}, async resize() {}, async dispose() {} })
async function setup(stage: 'ended' | 'paused' | 'ready' = 'ended', empty = false) {
  await mkdir('.local/tests', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/tests/compiler-')), runId = crypto.randomUUID(), root = path.join(base, runId)
  await mkdir(root)
  const harness = new LifeHarness(draft.specification, population, {
    lifecycle: { seed: runId, birth: async () => { throw new Error('Unexpected birth') } }, cognition: { runId, match: async () => [] }, memory: { initialize() {}, changed() {} },
    async start() { return '' }, async steer() {}, async compact() {}, async interrupt() {}, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed() {}
  })
  const checkpoint = harness.checkpoint()
  checkpoint.world.stage = stage; checkpoint.world.phase = stage === 'ended' ? 'complete' : 'between'; checkpoint.world.turn = 4
  if (stage === 'ready') {
    checkpoint.world.turn = 0
    checkpoint.world.lifecycle!.births.push({ id: 'birth-1', parents: ['npc2', 'npc3'], homeParentId: 'npc2', dueDay: 1, status: 'scheduled', childId: null, reason: null })
  }
  checkpoint.world.facilities.forEach(f => { f.layout = { homes: f.type === 'residential' ? population.npcs.map((n, i) => ({ id: `home-${i}`, householdId: n.householdId, name: '家', description: '', bounds: { min: { x: i * 3, y: 0, z: 0 }, max: { x: i * 3 + 1, y: 1, z: 1 } } })) : [], regions: [], publicState: '' } })
  checkpoint.world.actors.forEach(a => { a.activity = empty ? 'dead' : 'ended'; a.position = empty ? null : { x: 0, y: 0, z: 0 } })
  if (empty) checkpoint.world.lifecycle!.residents.forEach(n => { n.diedTurn = 4 })
  const preparation = { ...emptyPreparation(), phase: 'ready' as const, population, draft }
  for (const [id, role] of [['parent', 'parent'], ...population.npcs.map(n => [n.id, 'npc']), ...draft.specification.town.facilities.map(f => [`facility-${f.id}`, 'facility'])] as [string, SessionBinding['role']][]) {
    const cwd = path.join(root, role === 'parent' ? 'preparation/work' : `agents/${id}`); await mkdir(cwd, { recursive: true })
    preparation.sessions.push({ agentId: id, sessionId: id, threadId: `thread-${id}`, role, cwd, modelId: models[0].model, effort: 'medium', creation: 'initialized', seedPersisted: true, persistenceVersion: 2, lifecycleVersion: 1, ...(role !== 'parent' ? { lifeToolsVersion: 1 as const } : {}), ...(role === 'npc' ? { memoryVersion: 1 as const } : {}) })
  }
  const store = new PersistenceStore(root)
  store.apply({ revision: 1, kind: 'metadata', value: { version: 1, lifecycleVersion: 1, lifeVersion: 1, memoryVersion: 1, authMode: 'chatgpt', settings, preparation, artifactHash: null } })
  store.apply({ revision: 2, kind: 'initializeLife', value: checkpoint }); await store.save(false)
  await writeFile(path.join(base, 'active-run.json'), JSON.stringify({ runId }))
  const runtime = new Runtime(), engine = new BackendEngine(base, runtime, terminals(), () => undefined, undefined, () => new FixturePersistencePort())
  await engine.initialize()
  return { base, root, runtime, engine, checkpoint }
}
async function completed(engine: BackendEngine) {
  const until = Date.now() + 15000
  while (!['completed', 'failed', 'empty'].includes(engine.backendStatus().compilation?.status ?? '')) {
    if (Date.now() > until) throw new Error(JSON.stringify(engine.backendStatus()))
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
it('automatically compiles all survivors, preserves successful packages and does not duplicate on reconnect', async () => {
  const { base, root, runtime, engine } = await setup()
  runtime.failNpc = 'npc1'
  try {
    await engine.backendCommand({ type: 'connect', authMode: 'chatgpt' }); await completed(engine)
    const compilation = engine.backendStatus().compilation!
    expect(compilation.status).toBe('failed')
    expect(runtime.generated).toHaveLength(5)
    expect(compilation.tasks.filter(t => t.status === 'completed')).toHaveLength(4)
    const task = compilation.tasks.find(t => t.npcId === 'npc0')!
    const manifest = JSON.parse(await readFile(path.join(root, task.output, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest.files)).toHaveLength(8)
    const inspection = await inspectCharacterPackage(engine.workspace, `${task.output}/manifest.json`)
    expect(inspection.files).toHaveLength(8)
    expect(inspection.files.every(file => file.status === 'match')).toBe(true)
    expect(task.review).toBe(`${task.output}/review.json`)
    const reviewText = await readFile(path.join(root, task.review!), 'utf8')
    expect(JSON.parse(reviewText)).toMatchObject({ npcId: 'npc0', name: '住民0', sourceRevision: compilation.sourceRevision })
    expect(manifest.files['review.json']).toBe(digest(reviewText))
    expect(await readFile(path.join(root, task.output, 'review.md'), 'utf8')).toContain('# NPC制作レビュー')
    expect(compilation.tasks.find(t => t.npcId === 'npc1')!.error).toContain('根拠')
    await engine.close()
    const nextRuntime = new Runtime(), next = new BackendEngine(base, nextRuntime, terminals(), () => undefined, undefined, () => new FixturePersistencePort())
    try {
      await next.initialize(); await next.backendCommand({ type: 'connect', authMode: 'chatgpt' })
      expect(nextRuntime.generated).toEqual([])
      await next.pause()
      await next.backendCommand({ type: 'recompile' }); await completed(next)
      expect(next.backendStatus().compilation!.id).not.toBe(compilation.id)
      expect(next.backendStatus().compilation!.status).toBe('completed')
    } finally { await next.close() }
  } finally { if (engine.backendStatus().connection !== 'disconnected') await engine.close() }
}, 30000)
it.each(['generation', 'export'] as const)('keeps compilation input provenance when input changes during %s', async phase => {
  const { root, runtime, engine } = await setup()
  let changed = false
  const changeInput = async () => {
    const task = engine.backendStatus().compilation!.tasks.find(task => task.npcId === 'npc0')!
    const inputPath = path.join(root, task.input)
    const input = JSON.parse(await readFile(inputPath, 'utf8'))
    input.identity.name = '外部変更した名前'
    await writeFile(inputPath, JSON.stringify(input, null, 2))
    changed = true
  }
  const startTurn = runtime.startTurn.bind(runtime)
  runtime.startTurn = async (binding, text) => {
    if (phase === 'generation' && !changed && binding.role === 'parent') await changeInput()
    return startTurn(binding, text)
  }
  const write = engine.workspace.write.bind(engine.workspace)
  engine.workspace.write = async (relative, content) => {
    if (phase === 'export' && !changed && relative.endsWith('/npcs/npc0/character.json')) await changeInput()
    return write(relative, content)
  }
  try {
    await engine.backendCommand({ type: 'connect', authMode: 'chatgpt' }); await completed(engine)
    const compilation = engine.backendStatus().compilation!
    const task = compilation.tasks.find(task => task.npcId === 'npc0')!
    expect(changed).toBe(true)
    expect(digest(await readFile(path.join(root, task.input)))).not.toBe(task.inputHash)
    if (phase === 'generation') {
      expect(task.status).toBe('failed')
      expect(task.error).toContain('Compilation入力が変更されています')
      await expect(readFile(path.join(root, task.output, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(compilation.tasks.filter(task => task.status === 'completed')).toHaveLength(4)
    } else {
      expect(task.status).toBe('completed')
      const manifest = JSON.parse(await readFile(path.join(root, task.output, 'manifest.json'), 'utf8'))
      expect(manifest.inputHash).toBe(task.inputHash)
      const character = JSON.parse(await readFile(path.join(root, task.output, 'character.json'), 'utf8'))
      expect(character.identity.name).toBe('住民0')
    }
  } finally { await engine.close() }
})
it.each([['paused', false], ['ended', true]] as const)('does not infer for stage=%s, empty=%s', async (stage, empty) => {
  const { runtime, engine } = await setup(stage, empty)
  try {
    await engine.backendCommand({ type: 'connect', authMode: 'chatgpt' })
    if (empty) { await completed(engine); expect(engine.backendStatus().compilation?.status).toBe('empty') }
    else expect(engine.backendStatus().compilation).toBeUndefined()
    expect(runtime.generated).toEqual([])
  } finally { await engine.close() }
})
it('loads the external compiler prompt and rejects invented references', () => {
  expect(new StandardCompilerPrompts().compiler()).toContain('忘却した記憶')
  const input = compilerInputSchema.parse({ identity: { ...population.npcs[0], sexCategory: 'female', generation: 0, bornTurn: 0, diedTurn: null }, memories: [], relations: [], conversation: [], events: [], evidenceIds: ['identity'] })
  expect(() => validateCharacterPackage(input, { ...packageFor('npc0'), memoryIds: ['other-memory'] })).toThrow('記憶参照')
  expect(() => validateCharacterPackage(input, { ...packageFor('npc0'), relationshipTargets: ['npc1'] })).toThrow('関係参照')
})
it('rejects terminal reconnection for ended-world NPCs while keeping parent production access', async () => {
  const { runtime, engine } = await setup()
  try {
    await engine.backendCommand({ type: 'connect', authMode: 'chatgpt' }); await completed(engine)
    const resumed: string[] = [], attached: string[] = []
    const connection: AgentRuntime = runtime
    connection.resume = async binding => { resumed.push(binding.agentId) }
    engine.sessions.attach = async binding => { attached.push(binding.agentId) }
    await expect(engine.backendCommand({ type: 'terminalReconnect', sessionId: 'npc0' })).rejects.toThrow('終了した世界のConversationは閲覧専用です')
    expect(resumed).toEqual([])
    expect(attached).toEqual([])
    await expect(engine.terminalSnapshot('npc0')).rejects.toThrow('終了した住民のConversationは閲覧専用です')
    await expect(engine.terminalInput('npc0', '追加の入力')).rejects.toThrow('終了した世界のConversationは閲覧専用です')
    await engine.backendCommand({ type: 'terminalReconnect', sessionId: 'parent' })
    expect(resumed).toEqual(['parent'])
    expect(attached).toEqual(['parent'])
  } finally { await engine.close() }
})
it('records a lost parent response without automatically sending it again', async () => {
  const { runtime, engine } = await setup()
  try {
    const workspace: Workspace = engine.workspace
    const binding = engine.backendStatus().preparation.sessions.find(s => s.role === 'parent')!
    let sends = 0
    runtime.startTurn = async () => { sends++; throw new Error('response lost') }
    const operations: ProductionOperation[] = []
    const producer = new ParentProduction(runtime, workspace, () => binding, async () => undefined, async op => { operations.push(structuredClone(op)) })
    await expect(producer.generate('birth', 'birth-1', 'test', {})).rejects.toThrow('response lost')
    expect(sends).toBe(1)
    expect(operations.at(-1)).toMatchObject({ status: 'uncertain', turnId: null })
  } finally { await engine.close() }
})
it('requires selected relationships to retain their exact supporting memory revisions in the exported package', () => {
  const input = compilerInputSchema.parse({
    identity: { ...population.npcs[0], sexCategory: 'female', generation: 0, bornTurn: 0, diedTurn: null },
    memories: [{ id: 'memory-1', ownerId: 'npc0', kind: 'episodic', text: '住民1に本を貸してもらった。', meaning: '住民1を信頼している。', cues: { people: ['npc1'], places: [], topics: ['本'] }, importance: 0.7, sourceIds: ['source-1'], revision: 2, createdTurn: 1, organizedTurn: 4, recalledTurn: null, strengthenedTurn: 4, status: 'retained', reminder: null }],
    relations: [{ source: 'npc0', target: 'npc1', label: '信頼', description: '本を貸してくれた相手', evidence: [{ memoryId: 'memory-1', revision: 2 }], observedTurn: 4 }],
    conversation: [], events: [], evidenceIds: ['identity', 'memory:memory-1:2', 'relation:npc1']
  })
  const artifact = { ...packageFor('npc0'), relationshipTargets: ['npc1'] }
  expect(() => validateCharacterPackage(input, artifact)).toThrow('関係の根拠記憶が出力対象にありません: npc1/memory-1/2')
  expect(validateCharacterPackage(input, { ...artifact, memoryIds: ['memory-1'] }).relationshipTargets).toEqual(['npc1'])
  expect(() => validateCharacterPackage({ ...input, memories: [{ ...input.memories[0], revision: 3 }] }, { ...artifact, memoryIds: ['memory-1'] })).toThrow('関係の根拠記憶')
  expect(validateCharacterPackage(input, packageFor('npc0')).relationshipTargets).toEqual([])
})
it('creates a newborn through the parent, adds its conversation and restores the expanded population', async () => {
  const { base, runtime, engine } = await setup('ready')
  try {
    await engine.backendCommand({ type: 'connect', authMode: 'chatgpt' })
    for (let turn = 1; turn <= 4; turn++) {
      await engine.backendCommand({ type: 'startSimulation', step: true })
      const until = Date.now() + 10000
      while (engine.backendStatus().simulation?.stage !== 'paused' || engine.backendStatus().simulation?.turn !== turn) {
        if (Date.now() > until) throw new Error(JSON.stringify(engine.backendStatus()))
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(engine.backendStatus().simulation?.turn).toBe(turn)
    }
    const state = engine.backendStatus()
    expect(runtime.generated).toEqual(['npc-birth-1'])
    expect(state.preparation.population!.npcs).toHaveLength(5)
    expect(state.simulation!.lifecycle!.residents).toHaveLength(6)
    expect(state.preparation.sessions.find(s => s.agentId === 'npc-birth-1')).toMatchObject({ creation: 'initialized', memoryVersion: 1, lifecycleVersion: 1 })
    expect(state.simulation!.actors.find(a => a.id === 'npc-birth-1')!.position).not.toBeNull()
    await engine.close()
    const next = new BackendEngine(base, new Runtime(), terminals(), () => undefined, undefined, () => new FixturePersistencePort())
    try { await next.initialize(); await next.backendCommand({ type: 'connect', authMode: 'chatgpt' }); expect(next.backendStatus().simulation!.lifecycle!.residents).toHaveLength(6) } finally { await next.close() }
  } finally { if (engine.backendStatus().connection !== 'disconnected') await engine.close() }
}, 30000)

it('resumes newborn placement after a clean pause without regenerating the child or its session', async () => {
  const { base, runtime, engine } = await setup('ready')
  runtime.holdPosition = true
  try {
    await engine.backendCommand({ type: 'connect', authMode: 'chatgpt' })
    await engine.backendCommand({ type: 'startSimulation', step: false })
    const until = Date.now() + 10000
    while (!runtime.heldPosition) {
      if (Date.now() > until) throw new Error(JSON.stringify(engine.backendStatus()))
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    await engine.pause()
    const child = engine.backendStatus().preparation.sessions.find(s => s.agentId === runtime.heldPosition)!
    expect(engine.backendStatus().simulation!.turn).toBe(4)
    expect(engine.backendStatus().simulation!.actors.find(a => a.id === child.agentId)!.position).toBeNull()
    await engine.close()
    const nextRuntime = new Runtime(), next = new BackendEngine(base, nextRuntime, terminals(), () => undefined, undefined, () => new FixturePersistencePort())
    try {
      await next.initialize(); await next.backendCommand({ type: 'connect', authMode: 'chatgpt' })
      await next.backendCommand({ type: 'startSimulation', step: true })
      const until = Date.now() + 10000
      while (next.backendStatus().simulation!.stage !== 'paused' || !next.backendStatus().simulation!.actors.find(a => a.id === child.agentId)!.position) {
        if (Date.now() > until) throw new Error(JSON.stringify(next.backendStatus()))
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(next.backendStatus().simulation!.turn).toBe(4)
      expect(next.backendStatus().simulation!.actors.find(a => a.id === child.agentId)!.position).not.toBeNull()
      expect(next.backendStatus().preparation.sessions.find(s => s.agentId === child.agentId)!.threadId).toBe(child.threadId)
      expect(nextRuntime.generated).toEqual([])
    } finally { await next.close() }
  } finally { if (engine.backendStatus().connection !== 'disconnected') await engine.close() }
}, 30000)
