import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { LifeHarness, lifeCheckpointSchema, type LifeServices } from '../../src/core/life-harness'
import { applyEconomyTool, economyInventory, economySituation, inheritEconomy, tickEconomy, validateEconomy, validateEconomySeed } from '../../src/core/economy'
import { ItemDecisionUncertainError, itemDecisionSchema, type ItemDefinition } from '../../src/core/economy-contracts'
import { lifeTransaction } from '../../src/core/life-transaction'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { emptyPreparation } from '../../src/core/contracts'
import { worldEventTools } from '../../src/core/world-event-contracts'
import { draft, population } from './fixtures'
import { NpcMemoryStore } from '../../src/core/memory-store'
import { chicken, economyHarness, facilityStorage, personal, savedEconomy, seed, wheat } from './economy-fixture'

const running: LifeHarness[] = []
afterEach(async () => { for (const h of running) await h.close(); running.length = 0 })
const setup = async (...args: Parameters<typeof economyHarness>) => { const result = await economyHarness(...args); running.push(result.harness); return result }
async function companyFixture() {
  const context = await setup(), { call, harness } = context
  const created = await call('npc0', 'createOrganization', { name: '町の農場とお店', type: '会社', purpose: '生産と販売', locationId: 'office' })
  expect(created.success).toBe(true)
  const organizationId = created.value.organization.id, owner = { kind: 'organization' as const, id: organizationId }
  expect((await call('npc0', 'companyFunds', { organizationId, amount: 200, direction: 'deposit' })).success).toBe(true)
  for (const definition of [wheat, chicken]) {
    expect((await call('npc0', 'requestItem', { organizationId, name: definition.name, description: definition.description })).success).toBe(true)
    await vi.waitFor(() => expect(harness.snapshot().economy!.catalog.some(e => e.item.id === definition.id)).toBe(true))
  }
  return { ...context, organizationId, owner }
}
describe('会社と暮らしの経済', () => {
  it('validates initial references before accepting a parent seed and protects carried reservations', async () => {
    expect(() => validateEconomySeed({ ...seed, catalog: [{ item: chicken, licensees: [personal('missing')] }] }, population.npcs.map(n => n.id), ['office'])).toThrow('初期取得権')
    expect(() => validateEconomySeed({ ...seed, catalog: [{ item: wheat, licensees: [personal()] }] }, population.npcs.map(n => n.id), [])).toThrow('施設・道具')
    const { harness, call } = await setup(savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal()] }], holdings: [{ npcId: 'npc0', itemId: 'chicken', quantity: 1 }] }))
    const offered = await call('npc0', 'offerItem', { holdingId: harness.snapshot().economy!.holdings[0].id, quantity: 1, unitPrice: 100, targetId: null })
    expect((await call('npc0', 'moveWithinFacility', { position: { x: 1, y: 0, z: 0 } })).success).toBe(false)
    expect((await call('npc0', 'moveToFacility', { facilityId: 'school' })).success).toBe(false)
    await call('npc0', 'cancelItemOffer', { offerId: offered.value.offer.id })
    expect((await call('npc0', 'moveWithinFacility', { position: { x: 1, y: 0, z: 0 } })).success).toBe(true)
  })

  it('makes acquisition a private experience source without automatically choosing an attachment', async () => {
    const saved = savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal()] }] })
    saved.cognition = new NpcMemoryStore('economy-memory', saved.world.actors.map(a => a.id)).snapshot()
    const { harness, call } = await setup(saved, undefined, { cognition: { runId: 'economy-memory', match: async () => [] }, memory: { initialize() {}, changed() {} } })
    await call('npc0', 'acquireItem', { itemId: 'chicken', quantity: 1, owner: personal(), storage: { kind: 'carried', actorId: 'npc0' } })
    const own = (await call('npc0', 'getSituation', {})).value
    expect(own.memorySources.some((s: { text: string }) => s.text.includes('ファミチキ'))).toBe(true)
    expect((await call('npc1', 'getSituation', {})).value.memorySources).toEqual([])
    expect(harness.memoryInspection('npc0').candidates).toEqual([])
    expect(harness.memoryRecords('npc0')).toEqual([])
    await harness.parentTool({ turnId: 'parent', callId: 'effect', tool: 'triggerWorldEvent', arguments: { title: '疲労', type: 'injury', description: '負傷した', target: { scope: 'actors', actorIds: ['npc0'] }, effects: { hp: -10, san: 0 } } }, () => true)
    expect(harness.snapshot().events.find(e => e.kind === 'world')!.text).toContain('"hp":-10')
    expect(harness.snapshot().economy!.vitals.npc0.hp).toBe(90)
  })

  it('settles production, export, payroll, acquisition, sale and consumption with exact balances', async () => {
    const { harness, call, organizationId, owner } = await companyFixture()
    const offered = await call('npc0', 'offerEmployment', { organizationId, employeeId: 'npc1', facilityId: 'office', wage: 50, description: '小麦を生産する', primaryItemId: 'wheat' })
    expect(offered.success).toBe(true)
    const contractId = offered.value.contract.id
    expect((await call('npc1', 'acceptEmployment', { contractId })).success).toBe(true)
    const workId = crypto.randomUUID(), worked = await call('npc1', 'work', { contractId }, workId)
    expect(worked.success).toBe(true)
    expect(await call('npc1', 'work', { contractId }, workId)).toEqual(worked)
    expect((await call('npc1', 'work', { contractId })).success).toBe(false)
    const crop = harness.snapshot().economy!.holdings.find(h => h.itemId === 'wheat')!
    expect((await call('npc0', 'exportItem', { holdingId: crop.id, quantity: 5 })).value.received).toBe(250)
    const acquired = await call('npc0', 'acquireItem', { itemId: 'chicken', quantity: 2, owner, storage: facilityStorage })
    expect(acquired.success).toBe(true)
    const offeredItem = await call('npc0', 'offerItem', { holdingId: acquired.value.holdings[0].id, quantity: 1, unitPrice: 200, targetId: null })
    const purchase = await call('npc1', 'buyItem', { offerId: offeredItem.value.offer.id, quantity: 1, owner: personal('npc1'), storage: { kind: 'carried', actorId: 'npc1' } })
    expect(purchase.success).toBe(true)
    expect((await call('npc1', 'useItem', { holdingId: purchase.value.holdings[0].id })).success).toBe(true)
    const economy = harness.snapshot().economy!
    expect(economy.accounts[`organization:${organizationId}`]).toEqual({ balance: 400, sales: 200, exports: 250, purchases: 200, wages: 50 })
    expect(economy.accounts['npc:npc0'].balance).toBe(800)
    expect(economy.accounts['npc:npc1'].balance).toBe(850)
    expect(economy.vitals.npc1).toMatchObject({ hp: 90, hunger: 100, san: 100, lastWorkTurn: 1 })
    expect(economy.holdings.map(h => [h.itemId, h.quantity])).toEqual([['chicken', 1]])
    expect(harness.economyHistory('npc1').map(r => r.kind)).toEqual(expect.arrayContaining(['employment', 'work', 'purchase', 'use']))
    expect(lifeCheckpointSchema.safeParse(harness.checkpoint()).success).toBe(true)
  })
  it('rejects unauthorized funds and acquisition; membership does not grant treasury access', async () => {
    const { call, harness, organizationId, owner } = await companyFixture()
    await call('npc1', 'joinOrganization', { organizationId })
    const before = harness.snapshot().economy!
    expect((await call('npc1', 'companyFunds', { organizationId, amount: 1, direction: 'withdraw' })).success).toBe(false)
    expect((await call('npc1', 'acquireItem', { itemId: 'chicken', quantity: 1, owner, storage: facilityStorage })).success).toBe(false)
    expect((await call('npc1', 'acquireItem', { itemId: 'chicken', quantity: 1, owner: personal('npc1'), storage: { kind: 'carried', actorId: 'npc1' } })).success).toBe(false)
    expect(harness.snapshot().economy).toEqual(before)
    const visible = economySituation(harness.snapshot(), 'npc1')
    expect(Object.keys(visible.accounts)).toEqual(['npc:npc1'])
    expect(visible.holdings).toEqual([])
  })
  it('reserves listings, serializes competing purchases and releases cancellation reservations', async () => {
    const { call, harness, owner } = await companyFixture()
    const acquired = await call('npc0', 'acquireItem', { itemId: 'chicken', quantity: 2, owner, storage: facilityStorage })
    const holdingId = acquired.value.holdings[0].id
    const offer = await call('npc0', 'offerItem', { holdingId, quantity: 1, unitPrice: 200, targetId: null })
    expect((await call('npc0', 'moveItem', { holdingId, quantity: 2, storage: facilityStorage })).success).toBe(false)
    expect((await call('npc0', 'offerItem', { holdingId, quantity: 2, unitPrice: 200, targetId: null })).success).toBe(false)
    const results = await Promise.all(['npc1', 'npc2'].map(id => call(id, 'buyItem', { offerId: offer.value.offer.id, quantity: 1, owner: personal(id), storage: { kind: 'carried', actorId: id } })))
    expect(results.filter(r => r.success)).toHaveLength(1)
    const second = await call('npc0', 'offerItem', { holdingId, quantity: 1, unitPrice: 0, targetId: 'npc2' })
    expect((await call('npc1', 'buyItem', { offerId: second.value.offer.id, quantity: 1, owner: personal('npc1'), storage: { kind: 'carried', actorId: 'npc1' } })).success).toBe(false)
    expect((await call('npc0', 'cancelItemOffer', { offerId: second.value.offer.id })).success).toBe(true)
    expect(harness.snapshot().economy!.listings).toEqual([])
  })
  it('rolls back wages and vital costs when production fails; rejects remote storage', async () => {
    const tool: ItemDefinition = { ...chicken, id: 'shovel', name: 'シャベル', kind: 'durable', durability: 2, effects: { hp: 0, hunger: 0, san: 0 } }
    const saved = savedEconomy({ ...seed, catalog: [{ item: tool, licensees: [personal()] }, { item: { ...wheat, primary: { ...wheat.primary!, toolItemId: 'shovel' } }, licensees: [personal()] }] })
    const { harness, call } = await setup(saved)
    const before = harness.snapshot().economy
    expect((await call('npc0', 'produceItem', { itemId: 'wheat', owner: personal() })).success).toBe(false)
    expect(harness.snapshot().economy).toEqual(before)
    const acquired = await call('npc0', 'acquireItem', { itemId: 'shovel', quantity: 1, owner: personal(), storage: { kind: 'carried', actorId: 'npc0' } })
    expect((await call('npc0', 'moveItem', { holdingId: acquired.value.holdings[0].id, quantity: 1, storage: { kind: 'home', homeId: 'home-0' } })).success).toBe(false)
    expect((await call('npc0', 'produceItem', { itemId: 'wheat', owner: personal() })).success).toBe(true)
    expect(harness.snapshot().economy!.holdings.find(h => h.itemId === 'shovel')!.durability).toBe(1)
    const created = await call('npc0', 'createOrganization', { name: '無資金会社', type: '会社', purpose: '働く', locationId: 'office' })
    const contract = await call('npc0', 'offerEmployment', { organizationId: created.value.organization.id, employeeId: 'npc1', facilityId: 'office', wage: 50, description: '販売', primaryItemId: null })
    await call('npc1', 'acceptEmployment', { contractId: contract.value.contract.id })
    const unpaid = harness.snapshot().economy!
    expect((await call('npc1', 'work', { contractId: contract.value.contract.id })).success).toBe(false)
    expect(harness.snapshot().economy).toEqual(unpaid)
  })
})
describe('生存・来歴・相続', () => {
  it('uses family priority and stable age ordering and keeps ownerless companies and estates', () => {
    for (const family of [[], [{ npcId: 'npc1', relation: 'spouse' as const }, { npcId: 'npc4', relation: 'child' as const }], [{ npcId: 'npc2', relation: 'child' as const }, { npcId: 'npc1', relation: 'child' as const }]]) {
      const world = savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal()] }], holdings: [{ npcId: 'npc0', itemId: 'chicken', quantity: 2 }] }).world
      world.lifecycle!.residents[0].family = family
      world.lifecycle!.residents[1].age = 30
      world.organizations = [{ id: 'farm', name: '農場', type: '会社', purpose: '生産', founderId: 'npc0', foundedTurn: 1, members: ['npc0'], locationId: 'office' }]
      world.economy!.companies.farm = { managerId: 'npc0' }
      world.economy!.accounts['organization:farm'] = { balance: 200, sales: 0, purchases: 0, exports: 0, wages: 0 }
      applyEconomyTool(world, 'npc0', 'designateHeir', { npcId: 'npc3' })
      for (const id of ['npc0', 'npc3']) { world.actors.find(a => a.id === id)!.activity = 'dead'; world.lifecycle!.residents.find(r => r.id === id)!.diedTurn = 1 }
      inheritEconomy(world, ['npc0', 'npc3'])
      expect(world.economy!.companies.farm.managerId).toBe(family.length ? 'npc1' : null)
      expect(world.economy!.accounts['organization:farm'].balance).toBe(200)
      expect(world.economy!.holdings.every(h => h.owner.id === (family.length ? 'npc1' : 'npc0') && h.individual && h.storage.kind === 'home')).toBe(true)
      expect(() => applyEconomyTool(world, 'npc4', 'companyFunds', { organizationId: 'farm', amount: 1, direction: 'withdraw' })).toThrow('権限')
      validateEconomy(world)
    }
  })

  it('completes a birth with full vital states and no inherited money at the same boundary', async () => {
    const saved = savedEconomy(), errors: Error[] = []
    saved.world.turn = 4; saved.world.phase = 'between'; saved.world.time = 'night'; saved.world.economy!.processedTurn = 4; saved.world.lifecycle!.processedDay = 1
    saved.world.actors.forEach(a => { a.activity = 'ended' })
    saved.world.lifecycle!.births = [{ id: 'birth-1', parents: ['npc2', 'npc3'], homeParentId: 'npc2', dueDay: 1, status: 'scheduled', reason: null, childId: null }]
    const services: LifeServices = {
      economy: { seed, request: async () => { throw Error('unexpected request') } },
      lifecycle: { seed: 'economy-test', birth: async () => ({ ...population.npcs[2], id: 'child', age: 0, occupation: null, family: [{ npcId: 'npc2', relation: 'parent' }, { npcId: 'npc3', relation: 'parent' }] }) },
      async start(agentId, text) {
        const id = crypto.randomUUID()
        queueMicrotask(() => { void (async () => {
          harness.notify(agentId, 'turn/started', { turn: { id } })
          if (text.includes('setInitialPosition')) expect((await harness.tool(agentId, { turnId: id, callId: 'position', tool: 'setInitialPosition', arguments: { position: { x: 8, y: 0, z: 0 } } })).success).toBe(true)
          harness.notify(agentId, 'turn/completed', { turn: { id, status: 'completed' } })
        })().catch(error => errors.push(error)) })
        return id
      },
      async steer() {}, async compact() {}, async interrupt() {}, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed(error) { errors.push(error) }
    }
    const harness = new LifeHarness(draft.specification, population, services, saved); running.push(harness)
    await harness.resume(true); await harness.drain()
    expect(errors).toEqual([])
    expect(harness.snapshot().stage).toBe('paused')
    expect(harness.snapshot().economy!.vitals.child).toMatchObject({ hp: 100, hunger: 100, san: 100, lastWorkTurn: null, heirId: null })
    expect(harness.snapshot().economy!.accounts['npc:child'].balance).toBe(0)
  })

  it('applies hunger, sleep and SAN rules exactly once per boundary and keeps broken tools', () => {
    const world = savedEconomy({ ...seed, catalog: [{ item: { ...chicken, id: 'toy', name: '玩具', kind: 'durable', durability: 1, effects: { hp: 0, hunger: 0, san: 20 } }, licensees: [personal()] }], holdings: [{ npcId: 'npc0', itemId: 'toy', quantity: 1 }] }).world
    const v = world.economy!.vitals.npc0
    v.hp = 50; v.hunger = 30; v.san = 0
    const id = world.economy!.holdings[0].id
    applyEconomyTool(world, 'npc0', 'useItem', { holdingId: id })
    expect(v.san).toBe(20); expect(world.economy!.holdings[0].durability).toBe(0)
    expect(() => applyEconomyTool(world, 'npc0', 'useItem', { holdingId: id })).toThrow('破損')
    world.actors[0].activity = 'sleeping'; tickEconomy(world)
    expect(v).toMatchObject({ hp: 80, hunger: 20, san: 33 })
    const snapshot = structuredClone(world); tickEconomy(world); expect(world).toEqual(snapshot)
    world.turn++; v.hunger = 0; v.san = 0; tickEconomy(world)
    expect(v).toMatchObject({ hp: 60, hunger: 0, san: 15 })
    world.actors[0].activity = 'active'; v.san = 0
    expect(() => applyEconomyTool(world, 'npc0', 'produceItem', { itemId: 'toy', owner: personal() })).toThrow('SAN')
  })
  it('retains gift provenance through transfer and inheritance, excludes simultaneous deaths', () => {
    const saved = savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal()] }], holdings: [{ npcId: 'npc0', itemId: 'chicken', quantity: 2 }] }), world = saved.world, records = saved.economyArchive!
    const h = world.economy!.holdings[0]
    const offer = applyEconomyTool(world, 'npc0', 'offerItem', { holdingId: h.id, quantity: 1, unitPrice: 0, targetId: 'npc1' }).result as { offer: { id: string } }
    const gift = applyEconomyTool(world, 'npc1', 'buyItem', { offerId: offer.offer.id, quantity: 1, owner: personal('npc1'), storage: { kind: 'carried', actorId: 'npc1' } }); records.push(...gift.records)
    expect(world.economy!.holdings.find(h => h.owner.id === 'npc1')!.individual).toBe(true)
    world.economy!.vitals.npc0.heirId = 'npc1'
    world.lifecycle!.residents[0].family = [{ npcId: 'npc2', relation: 'child' }, { npcId: 'npc3', relation: 'child' }]
    for (const id of ['npc0', 'npc1']) { world.actors.find(a => a.id === id)!.activity = 'dead'; world.lifecycle!.residents.find(r => r.id === id)!.diedTurn = 1 }
    records.push(...inheritEconomy(world, ['npc0', 'npc1']))
    expect(world.economy!.accounts['npc:npc3'].balance).toBe(2000)
    expect(world.economy!.holdings.filter(h => h.owner.id === 'npc3').every(h => h.storage.kind === 'home' && h.individual)).toBe(true)
    expect(world.economy!.catalog[0].licensees).toContainEqual(personal('npc3'))
    const inventory = economyInventory(world, 'npc1', records)
    expect(inventory.provenance.map(r => r.kind)).toEqual(expect.arrayContaining(['initial', 'gift', 'inheritance']))
    validateEconomy(world)
  })
  it('transfers management at HP death while preserving living employees and cancelling listings', async () => {
    const { call, harness, organizationId, owner } = await companyFixture()
    const contract = await call('npc0', 'offerEmployment', { organizationId, employeeId: 'npc1', facilityId: 'office', wage: 50, description: '販売', primaryItemId: null })
    await call('npc1', 'acceptEmployment', { contractId: contract.value.contract.id })
    const acquired = await call('npc0', 'acquireItem', { itemId: 'chicken', quantity: 1, owner, storage: facilityStorage })
    await call('npc0', 'offerItem', { holdingId: acquired.value.holdings[0].id, quantity: 1, unitPrice: 200, targetId: null })
    await call('npc0', 'designateHeir', { npcId: 'npc2' })
    const result = await harness.parentTool({ turnId: 'parent-event', callId: 'injury', tool: 'triggerWorldEvent', arguments: { title: '事故', type: 'injury', description: '致命的な負傷', target: { scope: 'actors', actorIds: ['npc0'] }, effects: { hp: -100, san: -10 } } }, () => true)
    expect(result.success).toBe(true)
    await vi.waitFor(() => expect(harness.snapshot().actors[0].activity).toBe('dead'))
    expect(harness.snapshot().economy!.companies[organizationId].managerId).toBe('npc2')
    expect(harness.snapshot().economy!.listings).toEqual([])
    expect(harness.snapshot().lifecycle!.residents[0].deathCause).toBe('health')
    expect(harness.snapshot().stage).toBe('running')
    expect((await call('npc1', 'work', { contractId: contract.value.contract.id })).success).toBe(true)
  })
  it('kills a starving resident at the turn boundary and applies the decay only once', async () => {
    const saved = savedEconomy(); saved.world.economy!.vitals.npc0.hp = 20; saved.world.economy!.vitals.npc0.hunger = 10
    const { harness, call } = await setup(saved)
    for (const actor of harness.snapshot().actors) {
      const turnId = harness.checkpoint().active[actor.id].turnId!
      expect((await call(actor.id, 'endTurn', {})).success).toBe(true)
      harness.notify(actor.id, 'turn/completed', { turn: { id: turnId, status: 'completed' } })
    }
    await harness.drain()
    expect(harness.snapshot().stage).toBe('paused')
    expect(harness.snapshot().actors[0].activity).toBe('dead')
    expect(harness.snapshot().economy!.vitals.npc1).toMatchObject({ hp: 100, hunger: 90, san: 98 })
    expect(harness.economyHistory('npc0').map(r => r.kind)).toEqual(['starvation', 'inheritance'])
  })
  it('does not revive delivery jobs when a resident dies before the steer response arrives', async () => {
    const { harness, call, services } = await setup(savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal('npc1')] }], holdings: [{ npcId: 'npc1', itemId: 'chicken', quantity: 1 }] }))
    let release: (() => void) | undefined
    services.steer = async actorId => { if (actorId === 'npc0') await new Promise<void>(resolve => { release = resolve }) }
    try {
      await call('npc1', 'offerItem', { holdingId: harness.snapshot().economy!.holdings[0].id, quantity: 1, unitPrice: 0, targetId: 'npc0' })
      await vi.waitFor(() => expect(release).toBeDefined())
      await harness.parentTool({ turnId: 'parent', callId: 'injury', tool: 'triggerWorldEvent', arguments: { title: '事故', type: 'injury', description: '負傷', target: { scope: 'actors', actorIds: ['npc0'] }, effects: { hp: -100, san: 0 } } }, () => true)
      await vi.waitFor(() => expect(harness.checkpoint().active.npc0).toBeUndefined())
    } finally { services.steer = async () => {}; release?.() }
    await harness.drain()
    expect(harness.checkpoint().jobs.filter(j => j.agentId === 'npc0' && ['requested', 'running', 'queued'].includes(j.status))).toEqual([])
  })
  it('preserves receipts, current assets and provenance through persistence without archiving history in snapshots', async () => {
    const { harness, call } = await setup(savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal()] }] }))
    await call('npc0', 'acquireItem', { itemId: 'chicken', quantity: 2, owner: personal(), storage: { kind: 'carried', actorId: 'npc0' } })
    const checkpoint = harness.checkpoint()
    await mkdir('.local/tests', { recursive: true }); const root = await mkdtemp(path.resolve('.local/tests/economy-save-')), store = new PersistenceStore(root)
    store.apply({ kind: 'metadata', revision: 1, value: { version: 1, economyVersion: 1, economySeed: seed, authMode: null, settings: null, preparation: emptyPreparation(), artifactHash: null } })
    store.apply({ kind: 'initializeLife', revision: 2, value: checkpoint }); await store.save(false)
    const loaded = (await new PersistenceStore(root).load())!
    expect(loaded.run.life!.world.economy).toEqual(checkpoint.world.economy)
    expect(loaded.run.life!.receipts).toEqual(checkpoint.receipts)
    expect(loaded.run.life!.economyArchive).toEqual(checkpoint.economyArchive)
    expect(loaded.manifest.dirty).toBe(false)
  })
})
describe('親への非同期登録', () => {
  it('never advertises economic tools or accepts scheduled numeric effects in old worlds', async () => {
    const saved = savedEconomy(); delete saved.world.economy; delete saved.economyArchive
    const services: LifeServices = { lifecycle: { seed: 'economy-test', birth: async () => { throw Error('unexpected birth') } }, async start() { return null }, async steer() {}, async compact() {}, async interrupt() {}, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed() {} }
    const harness = new LifeHarness(draft.specification, population, services, saved); running.push(harness)
    expect(worldEventTools().find(t => t.name === 'scheduleWorldEvent')!.inputSchema.properties).not.toHaveProperty('effects')
    expect(worldEventTools(true).find(t => t.name === 'scheduleWorldEvent')!.inputSchema.properties).toHaveProperty('effects')
    const result = await harness.parentTool({ turnId: 'parent', callId: 'numeric', tool: 'scheduleWorldEvent', arguments: { title: '負傷', type: 'injury', description: '事故', target: { scope: 'world' }, effects: { hp: -10, san: -10 }, at: { day: 1, time: 'noon' } } }, () => true)
    expect(result.success).toBe(false)
    expect(harness.snapshot().worldEvents).toBeUndefined()
    expect(harness.snapshot().economy).toBeUndefined()
  })

  it('lets other actors act during review, distinguishes rejection, and reuses tool receipts', async () => {
    let finish!: (value: unknown) => void
    const decision = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const { call, harness } = await setup(savedEconomy(), decision)
    const key = crypto.randomUUID(), args = { name: '架空の商品', description: '申請資料', organizationId: null }
    const submitted = await call('npc0', 'requestItem', args, key)
    await vi.waitFor(() => expect(decision).toHaveBeenCalledOnce())
    expect((await call('npc1', 'moveWithinFacility', { position: { x: 1, y: 1, z: 0 } })).success).toBe(true)
    expect(await call('npc0', 'requestItem', args, key)).toEqual(submitted)
    finish({ decision: 'rejected', reason: '世界設定に適合しません' })
    await vi.waitFor(() => expect(harness.snapshot().economy!.requests[0].status).toBe('rejected'))
    expect(harness.snapshot().economy!.catalog).toEqual([])
    expect(harness.snapshot().stage).toBe('running')
  })
  it('stops uncertain registration without retry and rejects malformed parent definitions', async () => {
    const request = vi.fn(async () => { throw new ItemDecisionUncertainError('result lost') })
    const { call, harness } = await setup(savedEconomy(), request)
    await call('npc0', 'requestItem', { name: '商品', description: '資料', organizationId: null })
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('error'))
    expect(harness.snapshot().economy!.requests[0].status).toBe('uncertain')
    await expect(harness.resume()).rejects.toThrow('自動再送しません')
    expect(request).toHaveBeenCalledOnce()
    expect(itemDecisionSchema.safeParse({ decision: 'approved', reason: 'ok', item: { ...chicken, cost: 1.5 } }).success).toBe(false)
    expect(itemDecisionSchema.safeParse({ decision: 'approved', reason: 'ok', item: { ...chicken, primary: wheat.primary } }).success).toBe(false)
  })
  it('rejects approval when the applicant dies during parent review', async () => {
    let finish!: (value: unknown) => void
    const { harness, call } = await setup(savedEconomy(), () => new Promise(resolve => { finish = resolve }))
    await call('npc0', 'requestItem', { name: chicken.name, description: chicken.description, organizationId: null })
    await vi.waitFor(() => expect(finish).toBeDefined())
    await harness.parentTool({ turnId: 'parent', callId: 'death', tool: 'triggerWorldEvent', arguments: { title: '事故', type: 'injury', description: '負傷', target: { scope: 'actors', actorIds: ['npc0'] }, effects: { hp: -100, san: 0 } } }, () => true)
    finish({ decision: 'approved', reason: '許可', item: chicken })
    await vi.waitFor(() => expect(harness.snapshot().economy!.requests[0].status).toBe('rejected'))
    expect(harness.snapshot().economy!.catalog).toEqual([])
    expect(harness.checkpoint().jobs.filter(j => j.agentId === 'npc0' && ['queued', 'running', 'deferred'].includes(j.status))).toEqual([])
  })
  it('does not retain changes from a failed transaction', () => {
    const world = savedEconomy().world, transaction = lifeTransaction(world)
    expect(() => applyEconomyTool(transaction.draft, 'npc0', 'acquireItem', { itemId: 'missing', quantity: 1, owner: personal(), storage: facilityStorage })).toThrow('登録品')
    expect(world).toEqual(savedEconomy().world)
  })
})
