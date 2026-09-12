import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { NpcMemoryStore, normalizeCue, recallable } from '../../src/core/memory-store'
import { LifeHarness, type LifeServices } from '../../src/core/life-harness'
import type { MemoryArchive } from '../../src/core/memory-contracts'
import type { LifeChange } from '../../src/core/persistence'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { PersistenceCoordinator } from '../../src/backend/persistence-coordinator'
import { FixturePersistencePort } from './persistence-fixture'
import { MemoryMatchUncertainError } from '../../src/core/memory-contracts'
import { emptyPreparation } from '../../src/core/contracts'
import { draft, population } from './fixtures'

const content = { text: '葵から本を借りた', meaning: '親切な人だと思った', cues: { people: ['npc1'], places: ['residential'], topics: ['借りた本'] }, importance: 0.95, sourceIds: ['initial:npc0'] }
function store() {
  const value = new NpcMemoryStore('memory-run', ['npc0', 'npc1'])
  value.commit(value.source('npc0', 'initial:npc0', 0, '初期情報と本人が得た体験', 'initial'))
  value.commit(value.source('npc1', 'initial:npc1', 0, 'もう一人の初期情報', 'initial'))
  return value
}
function retain(s: NpcMemoryStore, turn = 1) {
  const c = s.remember('npc0', turn, content); s.commit(c.mutation)
  s.commit(s.prepare('npc0', o => { o.consolidation = 'running' }))
  s.commit(s.consolidate('npc0', turn, { memories: [{ ...content, id: null, candidateIds: [c.candidate.id], mergeIds: [], kind: 'episodic' }], forgetIds: [], relations: [{ target: 'npc1', label: '親切な人', description: '本を貸してくれた', memoryIds: [c.candidate.id] }] }, ['npc0', 'npc1']))
  return s.owner('npc0').records[0]
}

it('validates ownership and keeps candidate admission separate from retention', () => {
  const s = store()
  expect(() => s.remember('npc1', 1, content)).toThrow('本人の経験ではない')
  const result = s.remember('npc0', 1, content)
  expect(s.owner('npc0').candidates).toHaveLength(0)
  s.commit(result.mutation)
  expect(s.owner('npc0').records).toHaveLength(0)
  expect(s.owner('npc0').candidates).toHaveLength(1)
  expect(() => s.remember('npc0', 1, { ...content, importance: 1.1 })).toThrow()
})
it('rejects overflow without dropping candidates and validates consolidation atomically', () => {
  const s = store()
  for (let i = 0; i < 100; i++) s.commit(s.remember('npc0', 1, content).mutation)
  expect(() => s.remember('npc0', 1, content)).toThrow('100件')
  s.commit(s.prepare('npc0', o => { o.consolidation = 'running' }))
  const before = s.snapshot()
  const memories = s.owner('npc0').candidates.slice(0, 6).map(c => ({ ...content, id: null, candidateIds: [c.id], mergeIds: [], kind: 'episodic' }))
  expect(() => s.consolidate('npc0', 1, { memories, forgetIds: [], relations: [] }, ['npc0', 'npc1'])).toThrow('5件')
  expect(() => s.consolidate('npc0', 1, { memories: memories.slice(0, 1), forgetIds: [], relations: [{ target: 'npc1', label: '知人', description: '知っている', memoryIds: ['other-memory'] }] }, ['npc0', 'npc1'])).toThrow('根拠')
  expect(s.snapshot()).toEqual(before)
})
it('keeps directed evidence revisions after updates and forgetting', () => {
  const s = store(), first = retain(s)
  const evidence = s.owner('npc0').relations[0].evidence[0]
  expect(s.owner('npc1').relations).toEqual([])
  s.commit(s.prepare('npc0', o => { o.consolidation = 'running' }))
  s.commit(s.consolidate('npc0', 5, { memories: [], forgetIds: [first.id], relations: [{ target: 'npc1', label: '親切な人', description: '今も親切な人だと思う', memoryIds: [first.id] }] }, ['npc0', 'npc1']))
  expect(s.owner('npc0').records).toEqual([])
  expect(s.detail('npc0', evidence.memoryId, evidence.revision).record.text).toBe(content.text)
  expect(s.detail('npc0', first.id, 2).record.status).toBe('forgotten')
  expect(s.owner('npc0').relations[0].evidence[0]).toEqual(evidence)
  expect(() => s.detail('npc1', first.id, 1)).toThrow('見つかりません')
})
it('normalizes cue keys and uses reproducible decaying recall selection', () => {
  const record = retain(store())
  expect(normalizeCue(' ＢＯＯＫ  返却 ')).toBe('book 返却')
  const samples = Array.from({ length: 1000 }, (_, i) => `run-${i}`)
  const recent = samples.map(run => recallable(run, 'npc0', 1, record))
  expect(samples.map(run => recallable(run, 'npc0', 1, record))).toEqual(recent)
  const old = samples.filter(run => recallable(run, 'npc0', 161, record)).length
  expect(recent.filter(Boolean).length).toBeGreaterThan(850)
  expect(old).toBeLessThan(120)
})
it('includes reminders in the retention budget and explicitly completes or cancels them', () => {
  const s = store()
  const input = { action: 'create', ...content, trigger: { afterTurn: 5, facilityId: 'school', personId: 'npc1' } }
  expect(() => s.remind('npc0', 1, input, ['npc1'], [])).toThrow('存在しません')
  const first = s.remind('npc0', 1, input, ['npc1'], ['school']); s.commit(first.mutation)
  s.commit(s.remind('npc0', 2, { action: 'complete', memoryId: first.id }, [], []).mutation)
  expect(s.detail('npc0', first.id, 2).record.reminder?.status).toBe('done')
  const next = s.remind('npc0', 1, input, ['npc1'], ['school']); s.commit(next.mutation)
  s.commit(s.remind('npc0', 2, { action: 'cancel', memoryId: next.id }, [], []).mutation)
  expect(s.detail('npc0', next.id, 2).record.reminder?.status).toBe('cancelled')
  for (let i = 0; i < 100; i++) s.commit(s.remind('npc0', 1, input, ['npc1'], ['school']).mutation)
  expect(() => s.remind('npc0', 1, input, ['npc1'], ['school'])).toThrow('100件')
})

const harnesses: LifeHarness[] = []
afterEach(async () => { for (const h of harnesses.splice(0)) await h.close() })
async function world(match: NonNullable<LifeServices['cognition']>['match'] = async () => []) {
  const changes: LifeChange[] = [], starts: { id: string; text: string; turnId: string; clientId: string }[] = [], compacted: string[] = [], errors: Error[] = []
  const services: LifeServices = {
    start: async (id, text, clientId) => { const turnId = crypto.randomUUID(); starts.push({ id, text, turnId, clientId }); h.notify(id, 'turn/started', { turn: { id: turnId } }); return turnId },
    steer: async (id, _turn, text, clientId) => { h.notify(id, 'item/completed', { item: { type: 'userMessage', clientId } }); starts.push({ id, text, turnId: _turn, clientId }) },
    compact: async id => { compacted.push(id); const turnId = crypto.randomUUID(); h.notify(id, 'turn/started', { turn: { id: turnId } }); h.notify(id, 'item/completed', { item: { type: 'contextCompaction' } }); h.notify(id, 'turn/completed', { turn: { id: turnId, status: 'completed' } }) },
    interrupt: async (id, turnId) => { h.notify(id, 'turn/completed', { turn: { id: turnId, status: 'interrupted' } }) },
    history: async () => [], terminalInput: async () => undefined, save: async () => { throw new Error('Disk wait on hot path') },
    changed: () => undefined, failed: e => errors.push(e), memory: { initialize: () => undefined, changed: value => changes.push(value) },
    cognition: { runId: 'memory-run', match }
  }
  const state = new LifeHarness(draft.specification, population, { ...services, cognition: undefined }).checkpoint()
  state.world.stage = 'ready'; state.world.phase = 'between'
  for (const f of state.world.facilities) f.layout = { regions: [], homes: f.type === 'residential' ? population.npcs.map((n, i) => ({ id: `house-${i}`, householdId: n.householdId, name: n.householdId, description: '', bounds: { min: { x: i * 2, y: 0, z: 0 }, max: { x: i * 2, y: 0, z: 0 } } })) : [], publicState: '' }
  state.world.actors.forEach(a => { a.activity = 'ended'; a.position = { x: 15, y: 15, z: 0 } })
  const s = new NpcMemoryStore('memory-run', population.npcs.map(n => n.id)), archive: MemoryArchive[] = []
  for (const n of population.npcs) { const m = s.source(n.id, `initial:${n.id}`, 0, JSON.stringify(n), 'initial'); archive.push(...m.archive); s.commit(m) }
  const record = retain(s)
  archive.push({ kind: 'memoryRecord', value: record })
  state.cognition = s.snapshot(); state.memoryArchive = archive
  const h = new LifeHarness(draft.specification, population, services, state); harnesses.push(h)
  await h.start(true)
  await vi.waitFor(() => expect(Object.values(h.checkpoint().active).filter(a => a.turnId)).toHaveLength(5))
  const call = (id: string, tool: string, args: unknown = {}, callId: string = crypto.randomUUID()) => h.tool(id, { turnId: h.checkpoint().active[id].turnId!, callId, tool, arguments: args })
  const finish = (id: string) => { h.notify(id, 'turn/completed', { turn: { id: h.checkpoint().active[id].turnId!, status: 'completed' } }) }
  return { h, changes, starts, compacted, errors, call, finish, record, state, services }
}
it('does not hold world transactions during semantic matching and deduplicates cues and Tool IDs', async () => {
  let release!: (ids: string[]) => void
  const matcher = vi.fn(async () => new Promise<string[]>(resolve => { release = resolve }))
  const { h, call, record, changes } = await world(matcher)
  const recall = call('npc0', 'recall', { cue: '本の返却' }, 'same')
  await vi.waitFor(() => expect(matcher).toHaveBeenCalledTimes(1))
  expect((await call('npc1', 'moveWithinFacility', { position: { x: 16, y: 15, z: 0 } })).success).toBe(true)
  const duplicate = call('npc0', 'recall', { cue: '本の返却' }, 'same')
  release([record.id])
  const result = await recall
  expect(await duplicate).toEqual(result)
  expect(await call('npc0', 'recall', { cue: ' 本の返却 ' })).toEqual(result)
  expect(matcher).toHaveBeenCalledTimes(1)
  expect(changes.some(c => c.history.some(r => r.kind === 'memoryRecall' && r.value.status === 'completed'))).toBe(true)
  expect(JSON.stringify(h.snapshot())).not.toContain(content.text)
})
it('accepts only delivered evidence and never registers ordinary output as memory', async () => {
  const { h, call, starts } = await world()
  const speech = await call('npc0', 'sendMessage', { text: '本を返してください', volume: 'high' })
  expect(speech.success).toBe(true)
  await vi.waitFor(() => expect(starts.some(s => s.id === 'npc1' && s.text.includes('heardSpeech'))).toBe(true))
  const situation = JSON.parse((await call('npc1', 'getSituation')).contentItems[0].text)
  const source = situation.memorySources.find((s: { kind: string }) => s.kind === 'received')
  expect(source).toBeDefined()
  expect((await call('npc1', 'remember', { ...content, sourceIds: [source.id] })).success).toBe(true)
  expect((await call('npc2', 'remember', { ...content, sourceIds: [source.id] })).success).toBe(false)
  const before = h.memoryInspection('npc1')
  h.notify('npc1', 'item/completed', { item: { type: 'agentMessage', text: '【心の声】本が気になる' } })
  await h.drain()
  expect(h.memoryInspection('npc1')).toEqual(before)
})
it('consolidates in the same Conversation before Compact and rejects partial or missing results', async () => {
  const { h, call, starts, finish, compacted, changes } = await world()
  await call('npc0', 'sleep'); finish('npc0')
  await vi.waitFor(() => expect(starts.some(s => s.id === 'npc0' && s.text.includes('睡眠時の記憶整理'))).toBe(true))
  expect(compacted).toEqual([])
  expect(JSON.stringify(h.checkpoint().jobs)).not.toContain(content.text)
  expect(changes.some(c => c.history.some(r => r.kind === 'memoryInput' && r.value.text.includes(content.text)))).toBe(true)
  expect((await call('npc0', 'moveWithinFacility', { position: { x: 1, y: 1, z: 0 } })).success).toBe(false)
  expect((await call('npc0', 'consolidateMemory', { memories: [], forgetIds: ['unknown'], relations: [] })).success).toBe(false)
  expect(h.memoryInspection('npc0').records).toHaveLength(1)
  expect((await call('npc0', 'consolidateMemory', { memories: [], forgetIds: [], relations: [] })).success).toBe(true)
  expect(compacted).toEqual([])
  finish('npc0')
  await vi.waitFor(() => expect(compacted).toEqual(['npc0']))
  expect(h.memoryInspection('npc0').progress.consolidation).toBe('complete')
})
it('stops explicitly when consolidation was not called', async () => {
  const { h, call, finish, starts, compacted } = await world()
  await call('npc0', 'sleep'); finish('npc0')
  await vi.waitFor(() => expect(starts.some(s => s.text.includes('睡眠時の記憶整理'))).toBe(true))
  finish('npc0')
  await vi.waitFor(() => expect(h.snapshot().stage).toBe('error'))
  expect(h.snapshot().error).toContain('記憶整理Tool')
  expect(compacted).toEqual([])
})

it.each([false, true])('preserves rejected source ID diagnostics and accepts an explicit correction: %s', async correct => {
  const { h, call, finish, starts, compacted } = await world()
  await call('npc0', 'remember', content)
  const candidate = h.memoryInspection('npc0').candidates[0]
  await call('npc0', 'sleep'); finish('npc0')
  await vi.waitFor(() => expect(h.memoryInspection('npc0').progress.consolidation).toBe('running'))
  const prompt = starts.find(s => s.text.includes('睡眠時の記憶整理'))!.text
  expect(prompt).toContain('候補ID・記憶IDをsourceIdsへ入れてはいけません')
  expect(prompt).toContain('text(result)')
  const input = { memories: [{ ...content, id: null, candidateIds: [candidate.id], sourceIds: [candidate.id], mergeIds: [], kind: 'episodic' }], forgetIds: [], relations: [] }
  const before = h.memoryInspection('npc0')
  const failed = await call('npc0', 'consolidateMemory', input, 'invalid-source')
  expect(failed.success).toBe(false)
  expect(failed.contentItems[0].text).toContain(candidate.id)
  expect(await call('npc0', 'consolidateMemory', input, 'invalid-source')).toEqual(failed)
  expect(h.memoryInspection('npc0')).toEqual(before)
  expect(h.checkpoint().jobs.find(j => j.kind === 'consolidation')!.consolidationError).toContain(candidate.id)
  if (correct) {
    input.memories[0].sourceIds = candidate.sourceIds
    expect((await call('npc0', 'consolidateMemory', input)).success).toBe(true)
  }
  finish('npc0')
  if (correct) {
    await vi.waitFor(() => expect(compacted).toEqual(['npc0']))
    expect(h.snapshot().error).toBeNull()
  } else {
    await vi.waitFor(() => expect(h.snapshot().stage).toBe('error'))
    expect(h.snapshot().error).toContain('検証に失敗したまま')
    expect(h.snapshot().error).toContain(`本人の経験ではない根拠です: npc0/${candidate.id}`)
    expect(h.snapshot().error).not.toContain('実行されていません')
    expect(compacted).toEqual([])
  }
})

it('resumes a confirmed interrupted consolidation only after the user resumes and never repeats a committed one', async () => {
  const { h, call, finish, starts, compacted } = await world()
  await call('npc0', 'sleep'); finish('npc0')
  await vi.waitFor(() => expect(h.memoryInspection('npc0').progress.consolidation).toBe('running'))
  await h.pause(); await h.drain()
  expect(h.memoryInspection('npc0').progress.consolidation).toBe('interrupted')
  const before = starts.length
  expect(compacted).toEqual([])
  await h.resume(true)
  await vi.waitFor(() => expect(starts.slice(before).filter(s => s.id === 'npc0' && s.text.includes('睡眠時の記憶整理'))).toHaveLength(1))
  expect((await call('npc0', 'consolidateMemory', { memories: [], forgetIds: [], relations: [] })).success).toBe(true)
  await h.pause(); await h.drain()
  expect(h.memoryInspection('npc0').progress.consolidation).toBe('complete')
  await h.resume(true)
  await vi.waitFor(() => expect(compacted).toEqual(['npc0']))
  expect(starts.slice(before).filter(s => s.id === 'npc0' && s.text.includes('睡眠時の記憶整理'))).toHaveLength(1)
})
it('restores current memory and forgotten evidence from separate checkpoint/history segments', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/memory-store-'))
  const { h, changes, state, record, call } = await world()
  const recalled = await call('npc0', 'recall', { cue: '保存する手掛かり' })
  expect(h.checkpoint().cognition!.owners.npc0.recalls).toHaveLength(0)
  const persistence = new PersistenceStore(root)
  persistence.apply({ revision: 1, kind: 'metadata', value: { version: 1, memoryVersion: 1, preparation: emptyPreparation(), settings: null, authMode: null, artifactHash: null } })
  persistence.apply({ revision: 2, kind: 'initializeLife', value: { ...state, memoryArchive: undefined } })
  persistence.apply({ revision: 3, kind: 'life', value: { patches: [], history: state.memoryArchive! } })
  let revision = 3
  for (const change of changes) persistence.apply({ revision: ++revision, kind: 'life', value: change })
  await persistence.save(false)
  const restored = await new PersistenceStore(root).load()
  const checkpoint = restored!.run.life!
  const s = new NpcMemoryStore('memory-run', population.npcs.map(n => n.id), checkpoint.cognition, checkpoint.memoryArchive)
  expect(s.recalled('npc0', 1, '保存する手掛かり')?.selected).toEqual(JSON.parse(recalled.contentItems[0].text).memories.map((r: { id: string; revision: number }) => ({ memoryId: r.id, revision: r.revision })))
  expect(s.detail('npc0', record.id, 1).record).toEqual(record)
  expect(s.owner('npc0').records).toEqual(h.memoryInspection('npc0').records.map(r => s.detail('npc0', r.id, r.revision).record))
})

it('runs five NPCs for two days with differing recollections, reminders, directed relations and forgetting', async () => {
  const { h, call, finish, starts, compacted, errors, record } = await world(async (_id, _cue, records) => records.slice(0, 3).map(r => r.id))
  const reminders = await call('npc0', 'remindMe', { action: 'create', ...content, trigger: { afterTurn: 2, facilityId: 'residential', personId: 'npc1' } })
  const reminderId = JSON.parse(reminders.contentItems[0].text).memoryId
  const firstEvidence = h.memoryRelations()![0].evidence[0]
  let completedRevision = 0
  for (let turn = 1; turn <= 8; turn++) {
    if (turn > 1) {
      await h.resume(true)
      await vi.waitFor(() => expect(Object.values(h.checkpoint().active).filter(a => a.turnId)).toHaveLength(5))
    }
    expect(h.snapshot().turn).toBe(turn)
    await call('npc0', 'sendMessage', { text: '本を大切に読んでくれてうれしい', volume: 'high' })
    await vi.waitFor(() => expect(starts.filter(s => s.id === 'npc1' && s.text.includes('heardSpeech')).length).toBeGreaterThanOrEqual(turn))
    for (const npc of population.npcs) {
      const info = JSON.parse((await call(npc.id, 'getSituation')).contentItems[0].text)
      const source = info.memorySources.at(-1)
      expect((await call(npc.id, 'remember', { ...content, text: `同じ本の会話・turn ${turn}`, meaning: npc.id === 'npc0' ? '喜びを伝えられた' : '期待に応えたいと感じた', sourceIds: [source.id] })).success).toBe(true)
      expect((await call(npc.id, 'recall', { cue: '本にまつわること' })).success).toBe(true)
    }
    if (turn === 2) {
      completedRevision = h.memoryInspection('npc0').records.find(r => r.id === reminderId)!.revision + 1
      expect((await call('npc0', 'remindMe', { action: 'complete', memoryId: reminderId })).success).toBe(true)
    }
    for (const npc of population.npcs) { await call(npc.id, 'sleep'); finish(npc.id) }
    await vi.waitFor(() => expect(population.npcs.every(n => h.memoryInspection(n.id).progress.consolidation === 'running')).toBe(true))
    for (const npc of population.npcs) {
      const state = h.memoryInspection(npc.id), candidate = state.candidates[0]
      const source = { text: candidate.text, meaning: candidate.meaning, cues: candidate.cues, importance: candidate.importance, sourceIds: candidate.sourceIds }
      expect((await call(npc.id, 'consolidateMemory', { memories: [{ ...source, id: null, candidateIds: [candidate.id], mergeIds: [], kind: turn < 5 ? 'episodic' : 'semantic' }], forgetIds: state.records.filter(r => r.kind !== 'prospective').map(r => r.id), relations: [{ target: npc.id === 'npc0' ? 'npc1' : 'npc0', label: npc.id === 'npc0' ? '読書仲間' : '期待してくれる人', description: candidate.meaning, memoryIds: [candidate.id] }] })).success).toBe(true)
      finish(npc.id)
    }
    await vi.waitFor(() => expect(h.snapshot().stage).toBe('paused'))
    expect(h.snapshot()).toMatchObject({ turn, phase: 'between', day: Math.floor((turn - 1) / 4) + 1 })
    expect(h.memoryRelations()).toHaveLength(5)
  }
  expect(compacted).toHaveLength(40)
  expect(h.memoryDetail('npc0', firstEvidence.memoryId, firstEvidence.revision).record.id).toBe(record.id)
  expect(h.memoryDetail('npc0', reminderId, completedRevision).record.reminder?.status).toBe('done')
  const relations = h.memoryRelations()!
  expect(relations.find(r => r.source === 'npc0')!.description).not.toBe(relations.find(r => r.source === 'npc1')!.description)
  expect(errors).toEqual([])
})

it('cancels pending matching on pause and resumes life without resending the stopped operation', async () => {
  const matcher = vi.fn(async (_id, _cue, _records, signal: AbortSignal) => new Promise<string[]>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
  const { h, call } = await world(matcher)
  const request = call('npc0', 'recall', { cue: '待機する照合' })
  await vi.waitFor(() => expect(matcher).toHaveBeenCalledOnce())
  await h.pause()
  expect((await request).success).toBe(false)
  await h.drain()
  expect(h.memoryInspection('npc0').recalls[0].status).toBe('cancelled')
  h.assertStopped()
  await h.resume(true)
  await vi.waitFor(() => expect(Object.values(h.checkpoint().active).filter(a => a.turnId)).toHaveLength(5))
  expect((await call('npc0', 'recall', { cue: '待機する照合' })).success).toBe(false)
  expect(matcher).toHaveBeenCalledOnce()
})

it('keeps an unknown external lookup unresolved instead of treating it as a clean shutdown', async () => {
  const { h, call } = await world(async () => { throw new MemoryMatchUncertainError('turn/start result unknown') })
  expect((await call('npc0', 'recall', { cue: '本' })).success).toBe(false)
  await h.drain()
  expect(h.memoryInspection('npc0').recalls[0]).toMatchObject({ status: 'uncertain', error: 'turn/start result unknown' })
  await expect(h.settle()).rejects.toThrow('記憶操作が未確定')
})

it('continues memory and life operations during a ten-second worker stall and replays unsaved deltas after worker exit', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/memory-worker-')), ports: FixturePersistencePort[] = []
  const coordinator = new PersistenceCoordinator(root, () => { const p = new FixturePersistencePort(); ports.push(p); return p }, () => undefined)
  const { h, call, state, changes, services } = await world()
  let release!: () => void
  try {
    await coordinator.initialize()
    coordinator.setMetadata({ version: 1, memoryVersion: 1, authMode: null, settings: null, preparation: emptyPreparation(), artifactHash: null })
    coordinator.initializeLife({ ...state, memoryArchive: undefined })
    coordinator.life({ patches: [], history: state.memoryArchive! })
    for (const change of changes) coordinator.life(change)
    services.memory!.changed = change => coordinator.life(change)
    await coordinator.markDirty()
    const baseline = coordinator.status.savedRevision
    ports[0].saveGate = new Promise(resolve => { release = resolve })
    expect((await call('npc0', 'remember', content)).success).toBe(true)
    const saving = coordinator.flush()
    const began = performance.now()
    const results = await Promise.all([
      call('npc0', 'remember', { ...content, text: '保存中でも記憶を選べる' }),
      call('npc1', 'moveWithinFacility', { position: { x: 16, y: 15, z: 0 } }),
      call('npc2', 'sendMessage', { text: '保存中の会話', volume: 'high' })
    ])
    expect(results.every(r => r.success)).toBe(true)
    expect(performance.now() - began).toBeLessThan(1000)
    await new Promise(resolve => setTimeout(resolve, 10000))
    expect(coordinator.status.savedRevision).toBe(baseline)
    release(); await saving
    await coordinator.flush()
    await ports[0].terminate()
    expect((await call('npc0', 'remember', { ...content, text: 'Worker停止後の記憶' })).success).toBe(true)
    await coordinator.flush()
    const loaded = (await new PersistenceStore(root).load())!
    expect(loaded.manifest.dirty).toBe(true)
    const restored = new NpcMemoryStore('memory-run', population.npcs.map(n => n.id), loaded.run.life!.cognition, loaded.run.life!.memoryArchive)
    expect(restored.owner('npc0').candidates).toHaveLength(3)
    expect(restored.owner('npc0').candidates.map(c => c.text)).toEqual(h.memoryInspection('npc0').candidates.map(c => c.text))
    expect(coordinator.status.savedRevision).toBe(coordinator.status.revision)
    expect(ports).toHaveLength(2)
  } finally { release?.(); await h.close(); await coordinator.close() }
})
