import { describe, expect, it } from 'vitest'
import { initializeLifecycle, ageDay, endReason, marry, related } from '../../src/core/lifecycle'
import { LifeHarness, TurnAlreadyEndedError, type LifeCheckpoint, type LifeServices, type LifeHistoryTurn } from '../../src/core/life-harness'
import { identitySchema, type Birth } from '../../src/core/lifecycle-contracts'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { draft, population, settings } from './fixtures'
import { emptyPreparation } from '../../src/core/contracts'

const seedPeople = () => {
  const people = structuredClone(population)
  people.npcs = people.npcs.slice(0, 3)
  people.npcs.forEach((n, i) => { n.age = i === 2 ? 79 : 18; n.sex = i === 0 ? '男性' : '女性'; n.family = [] })
  return people
}
const proposal = { partnerId: 'npc1', children: 2, homeParentId: 'npc0', withdraw: false }
describe('Lifecycle rules', () => {
  it('requires matching consent and persists reproducible 1–3 year spacing', () => {
    const state = initializeLifecycle(seedPeople(), 'seed')
    expect(marry(state, 'npc0', proposal).status).toBe('proposed')
    expect(marry(state, 'npc1', { ...proposal, partnerId: 'npc0', children: 1 }).status).toBe('proposed')
    expect(state.births).toEqual([])
    expect(marry(state, 'npc1', { ...proposal, partnerId: 'npc0' }).status).toBe('married')
    expect(state.births).toHaveLength(2)
    expect(state.births[0].dueDay).toBeGreaterThanOrEqual(1)
    expect(state.births[0].dueDay).toBeLessThanOrEqual(3)
    expect(state.births[1].dueDay - state.births[0].dueDay).toBeGreaterThanOrEqual(1)
    expect(state.births[1].dueDay - state.births[0].dueDay).toBeLessThanOrEqual(3)
    expect(() => marry(state, 'npc0', proposal)).toThrow('既に')
    const copy = JSON.parse(JSON.stringify(state))
    ageDay(copy, 4)
    expect(copy.births.map((b: Birth) => b.dueDay)).toEqual(state.births.map(b => b.dueDay))
  })
  it('counts initial children and rejects unilateral, underage and ineligible births', () => {
    const state = initializeLifecycle(seedPeople(), 'seed')
    state.residents[0].age = 17
    expect(() => marry(state, 'npc0', proposal)).toThrow('年齢')
    state.residents[0].age = 18
    state.residents[0].family.push({ npcId: 'npc2', relation: 'child' })
    expect(() => marry(state, 'npc0', { ...proposal, children: 4 })).toThrow('上限')
    state.residents[1].sexCategory = 'male'
    expect(() => marry(state, 'npc0', proposal)).toThrow('男女')
    expect(marry(state, 'npc0', { ...proposal, children: 0 }).status).toBe('proposed')
    expect(marry(state, 'npc0', { ...proposal, withdraw: true }).status).toBe('withdrawn')
    expect(state.proposals).toEqual([])
  })
  it('detects siblings, ancestors and cousins from family references', () => {
    const state = initializeLifecycle(seedPeople(), 'seed')
    state.residents[0].family.push({ npcId: 'npc2', relation: 'parent' })
    state.residents[1].family.push({ npcId: 'npc2', relation: 'parent' })
    expect(related(state, state.residents[0], state.residents[1])).toBe(true)
    expect(() => marry(state, 'npc0', proposal)).toThrow('血縁')
    const ancestor = structuredClone(state.residents[2])
    ancestor.id = 'grandparent'
    const aunt = structuredClone(state.residents[2])
    aunt.id = 'aunt'; aunt.family = [{ npcId: ancestor.id, relation: 'parent' }]
    state.residents.push(ancestor, aunt)
    state.residents[2].family = [{ npcId: ancestor.id, relation: 'parent' }]
    state.residents[1].family = [{ npcId: aunt.id, relation: 'parent' }]
    expect(related(state, state.residents[0], state.residents[1])).toBe(true)
    expect(related(state, state.residents[0], ancestor)).toBe(true)
  })
  it('ages once per day, cancels impossible births and distinguishes all end conditions', () => {
    const state = initializeLifecycle(seedPeople(), 'seed')
    marry(state, 'npc0', proposal); marry(state, 'npc1', { ...proposal, partnerId: 'npc0' })
    state.residents[0].age = 49
    expect(ageDay(state, 3)).toEqual([])
    expect(ageDay(state, 4).map(n => n.id)).toEqual(['npc2'])
    expect(state.residents[0].age).toBe(50)
    ageDay(state, 4); expect(state.residents[0].age).toBe(50)
    expect(state.births.every(b => b.status === 'cancelled')).toBe(true)
    expect(endReason(state, 'turn_limit', 4, 4)).toBe('turn_limit')
    expect(endReason(state, 'generation_zero_extinction_with_turn_limit', 4, 4)).toBe('turn_limit')
    expect(endReason(state, 'generation_zero_extinction', 4, 4)).toBeNull()
    state.residents[0].generation = 1; state.residents[1].generation = 1
    expect(endReason(state, 'generation_zero_extinction_with_turn_limit', 4, 100)).toBe('generation_zero_extinction')
    state.residents.forEach(n => { n.diedTurn = 4 })
    expect(endReason(state, 'turn_limit', 4, 100)).toBe('population_extinction')
    const initialOld = initializeLifecycle(seedPeople(), 'old')
    initialOld.residents[2].age = 80
    expect(ageDay(initialOld, 4).map(n => n.id)).toEqual(['npc2'])
  })
})

it('rejects forged consent, underage builders and overlapping homes without partial updates', async () => {
  const people = seedPeople()
  people.npcs[2].age = 10
  const services: LifeServices = { lifecycle: { seed: 'rules', birth: async () => { throw new Error('Unexpected birth') } }, async start(id) { return `turn-${id}` }, async steer() {}, async compact() {}, async interrupt() {}, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed(error) { throw error } }
  const initial = new LifeHarness(draft.specification, people, services).checkpoint()
  initial.world.stage = 'ready'; initial.world.phase = 'between'
  initial.world.facilities.forEach(f => { f.layout = { regions: [], publicState: '', homes: f.type === 'residential' ? people.npcs.map((n, i) => ({ id: `h${i}`, householdId: n.householdId, name: '家', description: '', bounds: { min: { x: i * 3, y: 0, z: 0 }, max: { x: i * 3 + 1, y: 1, z: 1 } } })) : [] } })
  initial.world.actors.forEach(a => { a.activity = 'ended'; a.position = { x: 0, y: 0, z: 0 } })
  const harness = new LifeHarness(draft.specification, people, services, initial)
  const call = (agentId: string, tool: string, args: unknown) => harness.tool(agentId, { turnId: `turn-${agentId}`, callId: crypto.randomUUID(), tool, arguments: args })
  try {
    await harness.start(); await harness.drain()
    expect((await call('npc2', 'createHome', { members: ['npc2'], description: '子どもの申請' })).success).toBe(false)
    const request = await call('npc0', 'createHome', { members: ['npc1'], description: '同居' })
    const requestId = JSON.parse(request.contentItems[0].text).requestId
    expect((await call('npc0', 'consentHome', { requestId, accept: true })).success).toBe(false)
    expect((await call('npc1', 'consentHome', { requestId, accept: true })).success).toBe(true)
    await harness.drain()
    const before = harness.snapshot()
    const invalid = { requestId, name: '新居', description: '', dimensions: { x: 35, y: 30, z: 3 }, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } }
    expect((await call('npc0', 'completeHome', invalid)).success).toBe(false)
    expect((await call('facility-residential', 'completeHome', invalid)).success).toBe(false)
    expect(harness.snapshot().facilities).toEqual(before.facilities)
    expect(harness.snapshot().lifecycle).toEqual(before.lifecycle)
    expect((await call('facility-residential', 'completeHome', { ...invalid, bounds: { min: { x: 31, y: 0, z: 0 }, max: { x: 32, y: 1, z: 1 } } })).success).toBe(true)
    expect(harness.snapshot().lifecycle!.residents.find(n => n.id === 'npc1')!.householdId).not.toBe('house1')
  } finally { await harness.close(false) }
})

it('runs marriage, adult-sponsored homes, births, independence and generation extinction with persisted memory owners', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/lifecycle-'))
  const store = new PersistenceStore(root), people = seedPeople(), spec = structuredClone(draft.specification)
  spec.simulation.endCondition = 'generation_zero_extinction'; spec.simulation.maxTurns = 4
  let revision = 0
  store.apply({ revision: ++revision, kind: 'metadata', value: { version: 1, lifecycleVersion: 1, memoryVersion: 1, lifeVersion: 1, settings, authMode: 'chatgpt', preparation: { ...emptyPreparation(), population: people }, artifactHash: null } })
  const histories = new Map<string, LifeHistoryTurn[]>(), actions = new Set<string>(), errors: Error[] = [], births: string[] = [], notices: { turn: number; text: string }[] = []
  const services: LifeServices = {
    lifecycle: { seed: 'seed', birth: async (b, parents) => {
      births.push(b.id)
      return identitySchema.parse({ ...people.npcs[0], id: `npc-${b.id}`, name: b.id, age: 0, sex: '女性', householdId: parents.find(n => n.id === b.homeParentId)!.householdId, locationId: 'home', family: b.parents.map(npcId => ({ npcId, relation: 'parent' })) })
    } },
    cognition: { runId: path.basename(root), match: async () => [] },
    memory: { initialize: value => store.apply({ revision: ++revision, kind: 'initializeLife', value }), changed: value => store.apply({ revision: ++revision, kind: 'life', value }) },
    async start(agentId, text, clientId) {
      const id = crypto.randomUUID(), record: LifeHistoryTurn = { id, status: 'inProgress', clientIds: [clientId], compact: false }
      histories.set(agentId, [...(histories.get(agentId) ?? []), record])
      queueMicrotask(() => { void (async () => {
        harness.notify(agentId, 'turn/started', { turn: { id } })
        const call = async (tool: string, args: unknown) => {
          const result = await harness.tool(agentId, { turnId: id, callId: crypto.randomUUID(), tool, arguments: args })
          if (!result.success) throw new Error(result.contentItems[0].text)
          return JSON.parse(result.contentItems[0].text)
        }
        const world = harness.snapshot()
        if (agentId.startsWith('facility-')) {
          if (world.phase === 'facilities') await call('initializeFacility', { regions: [], homes: agentId === 'facility-residential' ? people.npcs.map((n, i) => ({ id: `initial-${i}`, householdId: n.householdId, name: n.name, description: '家', bounds: { min: { x: i * 3, y: 0, z: 0 }, max: { x: i * 3 + 1, y: 1, z: 1 } } })) : [], publicState: '' })
          else for (const request of world.lifecycle!.homes.filter(h => h.status === 'building')) {
            const facility = harness.snapshot().facilities.find(f => f.type === 'residential')!, x = facility.dimensions.x
            await call('completeHome', { requestId: request.id, name: '新居', description: request.description, dimensions: { ...facility.dimensions, x: x + 3 }, bounds: { min: { x, y: 0, z: 0 }, max: { x: x + 1, y: 1, z: 1 } } })
          }
        } else if (text.includes('setInitialPosition')) {
          const actor = world.actors.find(a => a.id === agentId)!
          const home = world.facilities.find(f => f.type === 'residential')!.layout!.homes.find(h => h.householdId === actor.householdId)!
          if (world.phase === 'between') expect((await harness.tool(agentId, { turnId: id, callId: crypto.randomUUID(), tool: 'setInitialPosition', arguments: { position: { x: 0, y: 0, z: 0 } } })).success).toBe(false)
          await call('setInitialPosition', { position: home.bounds.min })
        } else if (text.includes('日次境界の通知です')) {
          notices.push({ turn: world.turn, text })
          expect(world.stage).toBe('running')
        }
        else {
          const person = world.lifecycle!.residents.find(n => n.id === agentId)!
          if (['npc0', 'npc1'].includes(agentId) && !actions.has(`marry-${agentId}`)) {
            actions.add(`marry-${agentId}`)
            await call('marry', { partnerId: agentId === 'npc0' ? 'npc1' : 'npc0', children: 2, homeParentId: 'npc0', withdraw: false })
          }
          if (agentId === 'npc0' && !actions.has('home')) { actions.add('home'); await call('createHome', { members: ['npc0', 'npc1'], description: '夫婦の新居' }) }
          if (agentId === 'npc0' && !actions.has('proxy')) {
            const child = world.lifecycle!.residents.find(n => n.generation > 0)
            if (child) { actions.add('proxy'); await call('createHome', { members: [child.id], description: '未成年の子への代理申請' }) }
          }
          if (person.generation > 0 && person.age >= 18 && !actions.has(`independent-${agentId}`)) { actions.add(`independent-${agentId}`); await call('createHome', { members: [agentId], description: '独立' }) }
          for (const request of harness.snapshot().lifecycle!.homes.filter(h => h.status === 'consent' && h.members.includes(agentId) && !h.accepted.includes(agentId))) await call('consentHome', { requestId: request.id, accept: true })
          await call('endTurn', {})
        }
        record.status = 'completed'; harness.notify(agentId, 'turn/completed', { turn: { id, status: 'completed' } })
      })().catch(error => { errors.push(error); record.status = 'failed'; harness.notify(agentId, 'turn/completed', { turn: { id, status: 'failed', error: { message: String(error) } } }) }) })
      return id
    },
    async steer(agentId, turnId, _text, clientId) { const record = histories.get(agentId)!.find(t => t.id === turnId)!; if (record.status !== 'inProgress') throw new TurnAlreadyEndedError(); record.clientIds.push(clientId) }, async compact() {},
    async interrupt(agentId, id) { const record = histories.get(agentId)?.find(t => t.id === id); if (record) record.status = 'interrupted'; harness.notify(agentId, 'turn/completed', { turn: { id, status: 'interrupted' } }) },
    async history(id) { return histories.get(id) ?? [] }, async terminalInput() {}, async save() {}, changed() {}, failed(error) { errors.push(error) }
  }
  const harness = new LifeHarness(spec, people, services)
  try {
    await harness.begin(); await harness.drain()
    expect(harness.snapshot().stage).toBe('ready')
    await harness.start(); await harness.drain()
    expect(errors).toEqual([])
    const world = harness.snapshot()
    expect(world.stage).toBe('ended')
    expect(world.lifecycle!.endReason).toBe('generation_zero_extinction')
    expect(world.lifecycle!.residents.filter(n => n.diedTurn === null)).toHaveLength(2)
    expect(births).toHaveLength(2)
    expect(world.lifecycle!.homes.filter(h => h.status === 'complete')).toHaveLength(4)
    expect(world.facilities.find(f => f.type === 'residential')!.dimensions.x).toBe(42)
    expect(world.actors.filter(a => a.activity === 'dead')).toHaveLength(3)
    expect(notices.some(n => n.turn === world.turn && n.text.includes('deathNotice'))).toBe(true)
    await expect(harness.bufferTerminal('npc0', 'hello')).rejects.toThrow('死亡')
    await store.save(false)
    const loaded = await new PersistenceStore(root).load()
    const restored = new LifeHarness(spec, people, services, loaded!.run.life as LifeCheckpoint)
    expect(restored.snapshot().lifecycle).toEqual(world.lifecycle)
    expect(restored.checkpoint().cognition!.owners).toHaveProperty(`npc-${births[0]}`)
    await restored.close(false)
  } finally { await harness.close(false) }
}, 60000)
