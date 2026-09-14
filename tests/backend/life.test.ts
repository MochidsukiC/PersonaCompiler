import { afterEach, describe, expect, it, vi } from 'vitest'
import { LifeHarness, type LifeCheckpoint, type LifeHistoryTurn, type LifeServices } from '../../src/core/life-harness'
import { audible, speechRecipients, validateLayout, validateLifeSpecification } from '../../src/core/spatial'
import type { FacilityLayout, LifeFacility, SimulationSnapshot, Voxel } from '../../src/core/life-contracts'
import { draft, population } from './fixtures'
import type { LifeChange } from '../../src/core/persistence'
import { NpcMemoryStore } from '../../src/core/memory-store'

const people = structuredClone(population)
people.npcs.forEach((n, i) => { n.householdId = i < 2 ? 'family-a' : i < 4 ? 'family-b' : 'single' })
const homes: FacilityLayout['homes'] = ['family-a', 'family-b', 'single'].map((householdId, i) => ({
  id: `house-${i}`, householdId, name: householdId, description: '世帯の家', bounds: { min: { x: i * 4, y: 0, z: 0 }, max: { x: i * 4 + 2, y: 2, z: 1 } }
}))
const residential: LifeFacility = { id: 'residential', locationId: 'home', name: '住宅街', type: 'residential', dimensions: { x: 30, y: 30, z: 3 }, layout: { homes, regions: [], publicState: '生活の場' } }
const positions: Voxel[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }]
const running = new Set<LifeHarness>()
afterEach(async () => { for (const h of running) await h.close(); running.clear() })

class Services implements LifeServices {
  harness!: LifeHarness
  saved: LifeCheckpoint | null = null
  errors: Error[] = []
  starts: { agentId: string; turnId: string; text: string; clientId: string }[] = []
  steers: { agentId: string; text: string }[] = []
  compacts: string[] = []
  writes: string[] = []
  turns = new Map<string, LifeHistoryTurn[]>()
  uncertain = false
  omitInitializationFor: string | null = null
  async save(value: LifeCheckpoint) { this.saved = structuredClone(value) }
  changed(_world: SimulationSnapshot) {}
  failed(error: Error) { this.errors.push(error) }
  async start(agentId: string, text: string, clientId: string) {
    if (this.uncertain) throw new Error('turn/start response lost')
    const turnId = crypto.randomUUID()
    this.starts.push({ agentId, turnId, text, clientId })
    this.turns.set(agentId, [...(this.turns.get(agentId) ?? []), { id: turnId, status: 'inProgress', clientIds: [clientId], compact: false }])
    this.harness.notify(agentId, 'turn/started', { turn: { id: turnId } })
    const phase = this.harness.snapshot().phase
    if (['facilities', 'positions', 'entry'].includes(phase)) {
      queueMicrotask(() => {
        if (this.omitInitializationFor === agentId) { this.omitInitializationFor = null; this.finish(agentId, turnId); return }
        const tool = agentId.startsWith('facility-') ? 'initializeFacility' : 'setInitialPosition'
        const input = tool === 'initializeFacility' ? { regions: [], homes: agentId === 'facility-residential' ? homes : [], publicState: '営業中' } : { position: positions[Number(agentId.slice(3))] }
        void this.harness.tool(agentId, { turnId, callId: `${turnId}-initialize`, tool, arguments: input }).then(result => {
          if (!result.success) this.errors.push(new Error(result.contentItems[0].text))
          this.finish(agentId, turnId)
        })
      })
    }
    return turnId
  }
  async steer(agentId: string, turnId: string, text: string, clientId: string) {
    this.steers.push({ agentId, text })
    this.turns.get(agentId)!.find(t => t.id === turnId)!.clientIds.push(clientId)
  }
  async compact(agentId: string) {
    this.compacts.push(agentId)
    const id = crypto.randomUUID()
    this.turns.set(agentId, [...this.turns.get(agentId)!, { id, status: 'completed', clientIds: [], compact: true }])
    this.harness.notify(agentId, 'turn/started', { turn: { id } })
    this.harness.notify(agentId, 'item/completed', { item: { type: 'contextCompaction' } })
    this.harness.notify(agentId, 'turn/completed', { turn: { id, status: 'completed' } })
  }
  async interrupt(agentId: string, turnId: string) { this.finish(agentId, turnId, 'interrupted') }
  async history(agentId: string) { return this.turns.get(agentId) ?? [] }
  async terminalInput(_id: string, data: string) { this.writes.push(data) }
  finish(agentId: string, turnId = this.harness.checkpoint().active[agentId].turnId!, status = 'completed') {
    const turn = this.turns.get(agentId)!.find(t => t.id === turnId)!
    turn.status = status
    this.harness.notify(agentId, 'turn/completed', { turn: { id: turnId, status } })
  }
}
async function setup(maxTurns = 8, saved?: LifeCheckpoint, services = new Services()) {
  const spec = structuredClone(draft.specification)
  spec.simulation.maxTurns = maxTurns
  const harness = new LifeHarness(spec, people, services, saved)
  services.harness = harness; running.add(harness)
  if (!saved) {
    await harness.begin()
    await vi.waitFor(() => { expect(services.errors).toEqual([]); expect(harness.snapshot().stage).toBe('ready') })
  }
  return { harness, services }
}
async function active(harness: LifeHarness) {
  await vi.waitFor(() => {
    expect(harness.snapshot().phase).toBe('activity')
    expect(Object.values(harness.checkpoint().active).filter(a => a.turnId)).toHaveLength(5)
  })
}
async function call(harness: LifeHarness, id: string, tool: string, args: unknown = {}, callId: string = crypto.randomUUID()) {
  const turnId = harness.checkpoint().active[id].turnId!
  return harness.tool(id, { turnId, callId, tool, arguments: args })
}

describe('Residential space', () => {
  it.each([false, true])('persists parent events, notification scope and duplicate receipts (memory=%s)', async memory => {
    const changes: LifeChange[] = [], services = new Services()
    if (memory) Object.assign(services, { memory: { initialize: () => undefined, changed: (change: LifeChange) => changes.push(structuredClone(change)) } })
    const { harness } = await setup(12, undefined, services)
    const request = { turnId: 'parent-turn', callId: 'sudden', tool: 'triggerWorldEvent', arguments: { title: '流星', type: '天候', description: '流星が見えた', target: { scope: 'actors', actorIds: ['npc0'] } } }
    expect((await harness.parentTool(request, () => false)).success).toBe(false)
    expect((await harness.parentTool(request, () => true)).success).toBe(true)
    expect(await harness.parentTool(request, () => true)).toEqual(await harness.parentTool(request, () => true))
    expect(harness.snapshot().worldEvents).toMatchObject([{ status: 'occurred', eventSequence: 6 }])
    expect(harness.snapshot().events.filter(e => e.kind === 'world')).toMatchObject([{ kind: 'world', actorId: 'parent', locationId: null, recipients: ['npc0'] }])
    expect(harness.checkpoint().jobs.filter(j => j.text.includes('worldEvent'))).toMatchObject([{ agentId: 'npc0', status: 'deferred' }])
    const restored = await setup(12, harness.checkpoint())
    expect(restored.harness.snapshot().worldEvents).toEqual(harness.snapshot().worldEvents)
    await harness.start(true); await active(harness)
    expect((await call(harness, 'npc0', 'getSituation')).contentItems[0].text).not.toContain('worldEvents')
    expect((await call(harness, 'npc0', 'triggerWorldEvent', request.arguments)).success).toBe(false)
    await expect(harness.parentTool({ ...request, arguments: { ...request.arguments, title: '別の内容' } }, () => true)).rejects.toThrow('同じTool ID')
    if (memory) expect(changes.some(c => c.history.some(h => h.kind === 'event') && c.history.some(h => h.kind === 'receipt') && c.patches.some(p => p.path.join('.') === 'world.worldEvents'))).toBe(true)
    expect(services.errors).toEqual([])
  })

  it.each([false, true])('fires scheduled events once after entry, supports cancellation and restart (memory=%s)', async memory => {
    const services = new Services(), changes: LifeChange[] = []
    if (memory) Object.assign(services, { memory: { initialize: () => undefined, changed: (change: LifeChange) => changes.push(structuredClone(change)) } })
    const { harness } = await setup(12, undefined, services)
    const issue = (tool: string, args: unknown) => harness.parentTool({ turnId: 'parent', callId: crypto.randomUUID(), tool, arguments: args }, () => true)
    const value = { title: '祭り', type: '行事', description: '市場が開く', target: { scope: 'location', locationId: 'home' }, at: { day: 1, time: 'noon' } }
    expect((await issue('scheduleWorldEvent', value)).success).toBe(true)
    const cancelled = JSON.parse((await issue('scheduleWorldEvent', { ...value, title: '取消行事' })).contentItems[0].text)
    expect((await issue('cancelWorldEvent', { eventId: cancelled.id })).success).toBe(true)
    expect(harness.snapshot().events.filter(e => e.kind === 'world')).toEqual([])
    await harness.start(true); await active(harness)
    const target = harness.snapshot().facilities.find(f => f.locationId !== 'home')!
    expect((await call(harness, 'npc0', 'moveToFacility', { facilityId: target.id })).success).toBe(true)
    for (const a of harness.snapshot().actors) { if (a.id !== 'npc0') await call(harness, a.id, 'endTurn'); services.finish(a.id) }
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('paused'))
    expect(harness.snapshot().events.filter(e => e.kind === 'world')).toEqual([])
    await harness.close(); running.delete(harness)
    const restoredServices = new Services()
    if (memory) Object.assign(restoredServices, { memory: { initialize: () => undefined, changed: (change: LifeChange) => changes.push(structuredClone(change)) } })
    const restored = await setup(12, harness.checkpoint(), restoredServices)
    await restored.harness.resume(true); await active(restored.harness)
    const events = restored.harness.snapshot().events.filter(e => e.kind === 'world')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ turn: 2, locationId: 'home', recipients: ['npc1', 'npc2', 'npc3', 'npc4'] })
    expect(restored.harness.snapshot().worldEvents?.map(p => p.status)).toEqual(['occurred', 'cancelled'])
    if (memory) expect(changes.some(c => c.history.some(h => h.kind === 'event' && h.value.kind === 'world') && c.patches.some(p => p.path.join('.') === 'world.worldEvents'))).toBe(true)
    expect((await restored.harness.parentTool({ turnId: 'parent', callId: 'cancel-late', tool: 'cancelWorldEvent', arguments: { eventId: restored.harness.snapshot().worldEvents![0].id } }, () => true)).success).toBe(false)
    for (const a of restored.harness.snapshot().actors) { await call(restored.harness, a.id, 'endTurn'); restored.services.finish(a.id) }
    await vi.waitFor(() => expect(restored.harness.snapshot().stage).toBe('paused'))
    await restored.harness.resume(true); await active(restored.harness)
    expect(restored.harness.snapshot().events.filter(e => e.kind === 'world')).toHaveLength(1)
    expect(restored.services.errors).toEqual([])
  })

  it('rejects invalid event targets and times and defers sleeping recipients', async () => {
    const { harness, services } = await setup(12)
    const issue = (tool: string, args: unknown) => harness.parentTool({ turnId: 'parent', callId: crypto.randomUUID(), tool, arguments: args }, () => true)
    const value = { title: '警報', type: '危機', description: '門で警報が鳴る', target: { scope: 'world' } }
    await harness.start(true); await active(harness)
    for (const at of [{ day: 1, time: 'morning' }, { day: 4, time: 'morning' }, { day: 0, time: 'night' }]) expect((await issue('scheduleWorldEvent', { ...value, at })).success).toBe(false)
    for (const target of [{ scope: 'location', locationId: 'missing' }, { scope: 'actors', actorIds: ['missing'] }, { scope: 'actors', actorIds: ['npc0', 'npc0'] }]) expect((await issue('triggerWorldEvent', { ...value, target })).success).toBe(false)
    expect(harness.snapshot().worldEvents).toBeUndefined()
    await call(harness, 'npc0', 'sleep')
    expect((await issue('triggerWorldEvent', value)).success).toBe(true)
    expect(harness.checkpoint().jobs.find(j => j.agentId === 'npc0' && j.text.includes('worldEvent'))?.status).toBe('deferred')
    expect(harness.snapshot().events.at(-1)?.recipients).toHaveLength(5)
    const checkpoint = harness.checkpoint()
    checkpoint.world.worldEvents![0].target = { scope: 'actors', actorIds: ['missing'] }
    await expect(setup(12, checkpoint)).rejects.toThrow('NPCが見つかりません')
    services.finish('npc0'); await harness.drain()
    expect(services.errors).toEqual([])
  })

  it.each([false, true])('builds organization facilities, gates entry until ready and restores construction (memory=%s)', async memory => {
    const changes: LifeChange[] = []
    const services = new Services()
    if (memory) Object.assign(services, { memory: { initialize: () => undefined, changed: (change: LifeChange) => changes.push(structuredClone(change)) } })
    const { harness } = await setup(12, undefined, services)
    await harness.start(true); await active(harness)
    await call(harness, 'npc0', 'createOrganization', { name: '星見会', type: '研究会', purpose: '観測', locationId: null })
    const organizationId = harness.snapshot().organizations![0].id
    const request = { turnId: harness.checkpoint().active.npc0.turnId!, callId: 'build', tool: 'buildFacility', arguments: { name: '天文台', type: 'observatory', description: '星を観測する', dimensions: { x: 20, y: 20, z: 3 }, organizationId } }
    expect((await harness.tool('npc0', request)).success).toBe(true)
    await harness.tool('npc0', request)
    const built = harness.snapshot().facilities.find(f => f.construction)!, agent = `facility-${built.id}`
    expect(harness.snapshot().facilities).toHaveLength(4)
    await vi.waitFor(() => expect(harness.checkpoint().active[agent]?.turnId).toBeTruthy())
    expect((await call(harness, 'npc0', 'moveToFacility', { facilityId: built.id })).success).toBe(false)
    const building = harness.checkpoint()
    const read = await setup(12, building, Object.assign(new Services(), { turns: structuredClone(services.turns) }))
    expect(read.harness.snapshot().facilities.at(-1)?.layout).toBeNull()
    expect((await call(harness, agent, 'initializeFacility', { regions: [], homes: [], publicState: '観測できます' })).success).toBe(true)
    services.finish(agent); await harness.drain()
    expect(harness.snapshot().organizations![0].locationId).toBe(built.locationId)
    expect((await call(harness, 'npc0', 'moveToFacility', { facilityId: built.id })).success).toBe(true)
    for (const a of harness.snapshot().actors) { if (a.id !== 'npc0') await call(harness, a.id, 'endTurn'); services.finish(a.id) }
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('paused'))
    await harness.resume(true); await active(harness)
    expect(harness.snapshot().actors[0].locationId).toBe(built.locationId)
    const use = await call(harness, 'npc0', 'useFacility', { request: '星を観測したい' })
    const requestId = JSON.parse(use.contentItems[0].text).requestId
    await vi.waitFor(() => expect(harness.checkpoint().active[agent]?.turnId).toBeTruthy())
    expect((await call(harness, agent, 'completeFacilityUse', { requestId, text: '望遠鏡で星が見えます', publicState: '観測中' })).success).toBe(true)
    services.finish(agent); await harness.drain()
    await harness.pause(); await harness.drain()
    const restored = await setup(12, harness.checkpoint())
    expect(restored.harness.snapshot().facilities.at(-1)).toEqual(harness.snapshot().facilities.at(-1))
    if (memory) expect(changes.some(c => c.patches.some(p => p.path[0] === 'world' && p.path[1] === 'facilities' && p.path[2] === 3))).toBe(true)
    expect(services.errors).toEqual([])
  })

  it('rejects construction for another organization and invalid plans without partial buildings', async () => {
    const { harness } = await setup(12)
    await harness.start(true); await active(harness)
    await call(harness, 'npc0', 'createOrganization', { name: '工房', type: '会社', purpose: '制作', locationId: null })
    const organizationId = harness.snapshot().organizations![0].id
    const plan = { name: '工房', type: 'workshop', description: '共同制作', dimensions: { x: 10, y: 10, z: 3 }, organizationId }
    expect((await call(harness, 'npc1', 'buildFacility', plan)).success).toBe(false)
    for (const input of [{ ...plan, type: 'residential' }, { ...plan, builderId: 'npc1' }, { ...plan, dimensions: { x: 0, y: 1, z: 1 } }]) expect((await call(harness, 'npc0', 'buildFacility', input)).success).toBe(false)
    expect(harness.snapshot().facilities).toHaveLength(3)
    expect((await call(harness, 'npc1', 'buildFacility', { ...plan, organizationId: null })).success).toBe(true)
    const saved = harness.checkpoint()
    saved.world.facilities.at(-1)!.construction!.connectedLocationId = 'missing'
    await expect(setup(12, saved)).rejects.toThrow('保存済み建設施設')
  })
  it.each([false, true])('creates genre-independent organizations and persists membership choices (memory=%s)', async memory => {
    const changes: LifeChange[] = []
    const services = new Services()
    if (memory) Object.assign(services, { memory: { initialize: () => undefined, changed: (change: LifeChange) => changes.push(structuredClone(change)) } })
    const { harness } = await setup(12, undefined, services)
    await harness.start(true); await active(harness)
    const request = { turnId: harness.checkpoint().active.npc0.turnId!, callId: 'found', tool: 'createOrganization', arguments: { name: '星見研究会', type: '研究会', purpose: '星図を共同制作する', locationId: null } }
    const result = await harness.tool('npc0', request)
    expect(result.success).toBe(true)
    const organization = harness.snapshot().organizations![0]
    expect(organization).toMatchObject({ ...request.arguments, founderId: 'npc0', foundedTurn: 1, members: ['npc0'] })
    expect(await harness.tool('npc0', request)).toEqual(result)
    expect(harness.snapshot().organizations).toHaveLength(1)
    expect((await call(harness, 'npc1', 'joinOrganization', { organizationId: organization.id })).success).toBe(true)
    const eventCount = harness.snapshot().events.length
    await call(harness, 'npc1', 'joinOrganization', { organizationId: organization.id })
    expect(harness.snapshot().events).toHaveLength(eventCount)
    await call(harness, 'npc0', 'leaveOrganization', { organizationId: organization.id })
    const situation = JSON.parse((await call(harness, 'npc1', 'getSituation')).contentItems[0].text)
    expect(situation.organizations[0].members).toEqual(['npc1'])
    await harness.pause(); await harness.drain()
    const restored = await setup(12, harness.checkpoint())
    expect(restored.harness.snapshot().organizations).toEqual(harness.snapshot().organizations)
    if (memory) expect(changes.some(c => c.patches.some(p => JSON.stringify(p.path) === '["world","organizations"]'))).toBe(true)
    expect(services.errors).toEqual([])
  })

  it('rejects organization impersonation, unknown locations and actions outside a live NPC turn', async () => {
    const { harness } = await setup(12)
    await harness.start(true); await active(harness)
    const input = { name: '会社', type: '商社', purpose: '商品の交換', locationId: 'home' }
    for (const invalid of [{ ...input, members: ['npc1'] }, { ...input, founderId: 'npc1' }, { ...input, locationId: 'unknown' }, { ...input, name: '   ' }]) expect((await call(harness, 'npc0', 'createOrganization', invalid)).success).toBe(false)
    expect((await harness.tool('facility-school', { turnId: 'wrong', callId: 'facility', tool: 'createOrganization', arguments: input })).success).toBe(false)
    expect((await call(harness, 'npc0', 'joinOrganization', { organizationId: 'missing' })).success).toBe(false)
    await call(harness, 'npc0', 'endTurn')
    expect((await call(harness, 'npc0', 'createOrganization', input)).success).toBe(false)
    expect(harness.snapshot().organizations ?? []).toEqual([])
  })

  it('rejects corrupted organization references while reading older worlds without organizations', async () => {
    const { harness } = await setup(12)
    const old = harness.checkpoint()
    expect((await setup(12, old)).harness.snapshot().organizations).toBeUndefined()
    old.world.organizations = [{ id: 'company', name: '会社', type: 'company', purpose: '制作', founderId: 'unknown', foundedTurn: 0, locationId: null, members: [] }]
    await expect(setup(12, old)).rejects.toThrow('保存済み組織')
  })
  it('projects departed residents into the destination with unset coordinates', async () => {
    const original = await setup()
    const saved = original.harness.checkpoint()
    saved.world.actors[2].locationId = 'school'
    const { harness } = await setup(8, saved)
    await harness.start(true); await active(harness)
    await call(harness, 'npc0', 'moveToFacility', { facilityId: 'school' })
    const situation = JSON.parse((await call(harness, 'npc2', 'getSituation')).contentItems[0].text)
    expect(situation.npcs.find((npc: { id: string }) => npc.id === 'npc0')).toMatchObject({ locationId: 'school', position: null, activity: 'ended' })
    expect(harness.snapshot().actors[0]).toMatchObject({ locationId: 'home', position: positions[0], nextFacilityId: 'school' })
  })
  it('batches queued speech with individual persisted delivery and memory evidence IDs', async () => {
    const original = await setup()
    await original.harness.start(true); await active(original.harness)
    await original.harness.pause(); await original.harness.drain()
    const saved = original.harness.checkpoint()
    saved.jobs.push(...Array.from({ length: 40 }, (_, i) => ({ id: `delivery-${i}`, agentId: 'npc1', kind: 'message' as const, status: 'queued' as const, turnId: null, completed: false, text: JSON.stringify({ kind: 'heardSpeech', eventId: i, turn: 1, speaker: { id: 'npc0', name: '話者', position: positions[0] }, volume: 'low', text: `発言${i}` }) })))
    saved.cognition = new NpcMemoryStore('batch', people.npcs.map(n => n.id)).snapshot()
    const changes: LifeChange[] = []
    const services = Object.assign(new Services(), {
      memory: { initialize: () => undefined, changed: (change: LifeChange) => { changes.push(change) } },
      cognition: { runId: 'batch', match: async () => [] }
    })
    const { harness } = await setup(8, saved, services)
    await harness.resume(true); await harness.drain()
    const batches = [...services.starts, ...services.steers].filter(s => s.agentId === 'npc1').map(s => JSON.parse(s.text))
    expect(batches.map(b => b.messages.length)).toEqual([32, 8])
    expect(batches.flatMap(b => b.messages.map((m: { deliveryId: string }) => m.deliveryId))).toEqual(Array.from({ length: 40 }, (_, i) => `delivery-${i}`))
    const jobs = harness.checkpoint().jobs.filter(j => j.kind === 'message')
    expect(jobs).toHaveLength(40)
    expect(jobs.every(j => j.status === 'running')).toBe(true)
    expect(jobs.filter(j => !j.batchId).map(j => j.id)).toEqual(['delivery-0', 'delivery-32'])
    for (const clientId of ['delivery-0', 'delivery-32']) harness.notify('npc1', 'item/completed', { item: { type: 'userMessage', clientId } })
    await harness.drain()
    const sources = changes.flatMap(c => c.history).filter(r => r.kind === 'memorySource')
    expect(sources).toHaveLength(40)
    expect(sources.every(r => r.kind === 'memorySource' && r.value.ownerId === 'npc1')).toBe(true)
    services.finish('npc1'); await harness.drain()
    expect(harness.checkpoint().jobs.some(j => j.kind === 'message')).toBe(false)
  })
  it('does not resend an uncertain speech batch after restoration', async () => {
    const original = await setup()
    await original.harness.start(true); await active(original.harness)
    await original.harness.pause(); await original.harness.drain()
    const saved = original.harness.checkpoint()
    saved.active.npc1 = { turnId: null, kind: 'normal', compactSeen: false }
    saved.jobs.push(...[0, 1].map(i => ({ id: `unknown-${i}`, ...(i ? { batchId: 'unknown-0' } : {}), agentId: 'npc1', kind: 'message' as const, status: 'requested' as const, turnId: null, completed: false, text: `発言${i}` })))
    const { harness, services } = await setup(8, saved)
    await expect(harness.resume()).rejects.toThrow()
    expect(services.starts).toEqual([])
    expect(services.steers).toEqual([])
  })
  it('requires a residential facility, dimensions and a supported end condition', () => {
    const spec = structuredClone(draft.specification)
    spec.town.facilities = spec.town.facilities.filter(f => f.type !== 'residential')
    expect(() => validateLifeSpecification(spec)).toThrow('住宅街')
    expect(() => validateLifeSpecification({ ...draft.specification, simulation: { ...draft.specification.simulation, endCondition: 'generation_zero_extinction' } })).toThrow('turn_limit')
  })
  it('assigns exactly one bounded, nonoverlapping home to every household including singles', () => {
    const ids = ['family-a', 'family-b', 'single']
    expect(validateLayout(residential, residential.layout, ids).homes).toHaveLength(3)
    expect(() => validateLayout(residential, { ...residential.layout, homes: homes.slice(0, 2) }, ids)).toThrow('全世帯')
    const overlap = structuredClone(residential.layout!)
    overlap.homes[1].bounds = structuredClone(overlap.homes[0].bounds)
    expect(() => validateLayout(residential, overlap, ids)).toThrow('重複')
    overlap.homes[1].bounds.max.x = 30
    expect(() => validateLayout(residential, overlap, ids)).toThrow('施設外')
  })
  it.each(['low', 'medium', 'high'] as const)('blocks %s voices in both directions across home boundaries', volume => {
    const inside = { x: 2, y: 0, z: 0 }, outside = { x: 3, y: 0, z: 0 }
    expect(audible(residential, inside, outside, volume)).toBe(false)
    expect(audible(residential, outside, inside, volume)).toBe(false)
    expect(audible(residential, inside, { x: 1, y: 0, z: 0 }, volume)).toBe(true)
    expect(audible(residential, outside, { x: 3, y: 1, z: 0 }, volume)).toBe(true)
    expect(audible(residential, inside, { x: 4, y: 0, z: 0 }, volume)).toBe(false)
  })
  it('uses inclusive three dimensional Euclidean distances', () => {
    const facility = { ...residential, layout: { ...residential.layout!, homes: [] } }
    expect(audible(facility, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 'low')).toBe(true)
    expect(audible(facility, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, 'low')).toBe(false)
    expect(audible(facility, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }, 'medium')).toBe(true)
    expect(audible(facility, { x: 0, y: 0, z: 0 }, { x: 3, y: 1, z: 4 }, 'medium')).toBe(false)
  })
})

describe('Autonomous life harness', () => {
  it.each([false, true])('keeps ordinary NPC thoughts and monologues out of world actions and deliveries (memory=%s)', async memory => {
    const services = new Services()
    if (memory) Object.assign(services, { memory: { initialize: () => undefined, changed: () => undefined } })
    const { harness } = await setup(8, undefined, services)
    await harness.start(true); await active(harness)
    await call(harness, 'npc1', 'endTurn')
    await harness.drain()
    const before = harness.checkpoint()
    const starts = services.starts.length
    for (const [index, text] of ['【心の声】今日は家でゆっくりしよう。', '【独り言】お茶が飲みたいな。'].entries()) {
      harness.notify('npc0', 'item/agentMessage/delta', { itemId: `thought-${index}`, delta: text })
      harness.notify('npc0', 'item/completed', { item: { id: `thought-${index}`, type: 'agentMessage', phase: index ? 'final_answer' : 'commentary', text } })
    }
    await harness.drain()
    expect(harness.checkpoint()).toEqual(before)
    expect(services.starts).toHaveLength(starts)
    expect(services.steers).toEqual([])
    expect(services.errors).toEqual([])
    expect(JSON.stringify(JSON.parse((await call(harness, 'npc1', 'getSituation')).contentItems[0].text))).not.toContain('お茶が飲みたい')
    services.finish('npc0')
    await harness.drain()
    expect(harness.snapshot()).toMatchObject({ turn: 1, phase: 'activity', stage: 'running' })
    expect(harness.snapshot().actors.find(a => a.id === 'npc0')!.activity).toBe('active')
    expect(harness.snapshot().actors.find(a => a.id === 'npc1')!.activity).toBe('ended')
    expect(harness.snapshot().events.filter(e => e.kind === 'speech')).toEqual([])
  })
  it('executes memory tools without any save acknowledgement, bounds events, and preserves duplicate results', async () => {
    const changes: LifeChange[] = []
    const services = Object.assign(new Services(), { memory: { initialize: () => undefined, changed: (change: LifeChange) => { changes.push(change) } } })
    const save = vi.spyOn(services, 'save').mockImplementation(() => { throw new Error('disk must not be on the hot path') })
    const { harness } = await setup(8, undefined, services)
    await harness.start(true); await active(harness)
    const turnId = harness.checkpoint().active.npc0.turnId!
    const speech = { turnId, callId: 'memory-speech', tool: 'sendMessage', arguments: { text: 'メモリー上の会話', volume: 'high' } }
    const receipt = await harness.tool('npc0', speech)
    for (let index = 0; index < 220; index++) expect((await call(harness, 'npc0', 'moveWithinFacility', { position: { x: index % 2, y: 0, z: 0 } })).success).toBe(true)
    const before = harness.snapshot()
    expect(before.events).toHaveLength(200)
    expect(before.events.at(-1)!.sequence).toBeGreaterThan(220)
    expect(await harness.tool('npc0', speech)).toEqual(receipt)
    expect(harness.snapshot()).toEqual(before)
    expect(harness.checkpoint().jobs.every(job => !['done', 'discarded'].includes(job.status))).toBe(true)
    expect(harness.checkpoint().receipts).toEqual({})
    expect(changes.flatMap(change => change.history).filter(record => record.kind === 'receipt' && record.key.endsWith('memory-speech'))).toHaveLength(1)
    expect(changes.flatMap(change => change.history).some(record => record.kind === 'job' && record.value.status === 'done')).toBe(true)
    expect(save).not.toHaveBeenCalled()
    expect((await call(harness, 'npc0', 'moveWithinFacility', { position: { x: -1, y: 0, z: 0 } })).success).toBe(false)
    expect(harness.snapshot().actors).toEqual(before.actors)
    expect(services.errors).toEqual([])
  })
  it('uses restored completed-job metadata to avoid treating a replayed activity input as a new conversation', async () => {
    const services = Object.assign(new Services(), { memory: { initialize: () => undefined, changed: () => undefined } })
    const { harness } = await setup(8, undefined, services)
    await harness.start(true); await active(harness)
    const job = harness.checkpoint().jobs.find(job => job.agentId === 'npc0' && job.kind === 'activity')!
    await call(harness, 'npc0', 'endTurn'); services.finish('npc0')
    await harness.pause(); await harness.drain()
    const checkpoint = harness.checkpoint()
    checkpoint.completedJobKinds = { [job.id]: job.kind }
    const restored = await setup(8, checkpoint, Object.assign(new Services(), { memory: services.memory }))
    restored.harness.notify('npc0', 'item/completed', { item: { type: 'userMessage', clientId: job.id } })
    await restored.harness.drain()
    expect(restored.harness.snapshot().actors[0].activity).toBe('ended')
    expect(restored.harness.checkpoint().completedJobKinds).toBeUndefined()
  })
  it('advances morning through night, wakes next turn and stops exactly at the limit', async () => {
    const { harness, services } = await setup(5)
    await harness.start(true)
    for (let turn = 1; turn <= 5; turn++) {
      await active(harness)
      expect(harness.snapshot()).toMatchObject({ turn, day: turn === 5 ? 2 : 1, time: ['morning', 'noon', 'evening', 'night', 'morning'][turn - 1] })
      for (const actor of harness.snapshot().actors) { expect((await call(harness, actor.id, 'sleep')).success).toBe(true); services.finish(actor.id) }
      await vi.waitFor(() => expect(harness.snapshot().stage).toBe(turn === 5 ? 'ended' : 'paused'))
      expect(services.compacts).toHaveLength(turn * 5)
      if (turn < 5) await harness.resume(true)
    }
    expect(harness.snapshot().turn).toBe(5)
    expect(services.errors).toEqual([])
  })
  it('retains successful facility layouts when a confirmed incomplete initialization is resumed', async () => {
    const services = new Services()
    services.omitInitializationFor = 'facility-residential'
    const harness = new LifeHarness(draft.specification, people, services)
    services.harness = harness; running.add(harness)
    await harness.begin()
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('error'))
    await vi.waitFor(() => expect(harness.snapshot().facilities.filter(f => f.layout)).toHaveLength(2))
    const previous = harness.snapshot().facilities.find(f => f.id === 'school')!.layout
    await harness.resume()
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('ready'))
    expect(harness.snapshot().facilities.find(f => f.id === 'school')!.layout).toEqual(previous)
    expect(services.starts.filter(s => s.agentId === 'facility-school')).toHaveLength(1)
    expect(services.starts.filter(s => s.agentId === 'facility-residential')).toHaveLength(2)
  })
  it('resumes only missing entry positions after an NPC finishes without placing itself', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    await call(harness, 'npc0', 'moveToFacility', { facilityId: 'school' })
    for (const actor of harness.snapshot().actors) {
      if (actor.id !== 'npc0') await call(harness, actor.id, 'endTurn')
      services.finish(actor.id)
    }
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('paused'))
    services.omitInitializationFor = 'npc0'
    await harness.resume(true)
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('error'))
    await harness.drain()
    expect(harness.snapshot()).toMatchObject({ turn: 2, phase: 'entry', error: '初期位置Toolが実行されていません: npc0' })
    expect(harness.snapshot().actors[0]).toMatchObject({ locationId: 'school', position: null })
    const others = structuredClone(harness.snapshot().actors.slice(1).map(a => a.position))
    const before = services.starts.length
    await harness.resume(true); await active(harness)
    expect(harness.snapshot().actors[0]).toMatchObject({ locationId: 'school', position: positions[0] })
    expect(harness.snapshot().actors.slice(1).map(a => a.position)).toEqual(others)
    expect(services.starts.slice(before).filter(s => s.text.includes('setInitialPosition')).map(s => s.agentId)).toEqual(['npc0'])
    expect(harness.snapshot().turn).toBe(2)
  })
  it('waits for a delayed steer acknowledgement even when the native inference has completed', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    const steer = services.steer.bind(services)
    let release!: () => void
    services.steer = async (...args) => { await steer(...args); await new Promise<void>(resolve => { release = resolve }) }
    await call(harness, 'npc1', 'sendMessage', { text: '家の中で一言', volume: 'low' })
    await vi.waitFor(() => expect(services.steers).toHaveLength(1))
    for (const actor of harness.snapshot().actors) { await call(harness, actor.id, 'endTurn'); services.finish(actor.id) }
    await vi.waitFor(() => expect(Object.keys(harness.checkpoint().active)).toHaveLength(0))
    expect(harness.snapshot()).toMatchObject({ turn: 1, stage: 'running' })
    expect(harness.checkpoint().jobs.filter(j => j.status === 'requested')).toHaveLength(1)
    release()
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('paused'))
  })
  it('keeps a departed actor ended when an already steered message is consumed', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    await call(harness, 'npc1', 'sendMessage', { text: 'あとで一言', volume: 'low' })
    await vi.waitFor(() => expect(services.steers).toHaveLength(1))
    await call(harness, 'npc0', 'moveToFacility', { facilityId: 'school' })
    const message = harness.checkpoint().jobs.find(j => j.kind === 'message' && j.agentId === 'npc0')!
    harness.notify('npc0', 'item/completed', { item: { type: 'userMessage', clientId: message.id } })
    await harness.drain()
    expect(harness.snapshot().actors[0].activity).toBe('ended')
    expect((await call(harness, 'npc0', 'sendMessage', { text: '返事', volume: 'low' })).success).toBe(false)
    expect(harness.snapshot().actors[0].nextFacilityId).toBe('school')
    const situation = JSON.parse((await call(harness, 'npc1', 'getSituation')).contentItems[0].text)
    expect(situation.npcs.some((npc: { id: string }) => npc.id === 'npc0')).toBe(false)
    expect(speechRecipients(residential, harness.snapshot().actors[1], harness.snapshot().actors, 'high')).not.toContain('npc0')
  })
  it('does not apply a replayed completion to a newer Compact', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    const oldTurn = harness.checkpoint().active.npc0.turnId!
    services.compact = async id => {
      services.turns.get(id)!.push({ id: 'compact-live', status: 'inProgress', clientIds: [], compact: true })
      harness.notify(id, 'turn/started', { turn: { id: 'compact-live' } })
    }
    await call(harness, 'npc0', 'sleep'); services.finish('npc0', oldTurn)
    await vi.waitFor(() => expect(harness.checkpoint().active.npc0?.turnId).toBe('compact-live'))
    harness.notify('npc0', 'turn/completed', { turn: { id: oldTurn, status: 'completed' } })
    harness.notify('npc0', 'item/completed', { item: { type: 'contextCompaction' } })
    harness.notify('npc0', 'turn/started', { turn: { id: 'compact-live' } })
    services.finish('npc0', 'compact-live')
    await vi.waitFor(() => expect(harness.snapshot().actors[0].compact).toBe('complete'))
    expect(harness.snapshot().turn).toBe(1)
    expect(services.errors).toEqual([])
  })
  it('initializes real actor-selected coordinates at turn zero and keeps household homes separate from current locations', async () => {
    const { harness } = await setup()
    expect(harness.snapshot()).toMatchObject({ stage: 'ready', turn: 0, phase: 'between' })
    expect(harness.snapshot().facilities.find(f => f.type === 'residential')!.layout!.homes).toHaveLength(3)
    expect(harness.snapshot().actors.map(a => a.position)).toEqual(positions)
  })
  it('returns every overlapping named region at the current coordinate', async () => {
    const initial = await setup()
    const saved = initial.harness.checkpoint()
    saved.world.facilities.find(f => f.type === 'residential')!.layout!.regions = ['居間', '読書スペース'].map((name, i) => ({ id: `region-${i}`, name, description: name, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } }))
    const { harness } = await setup(8, saved)
    await harness.start(true); await active(harness)
    const situation = JSON.parse((await call(harness, 'npc0', 'getSituation')).contentItems[0].text)
    expect(situation.currentRegions.map((r: { name: string }) => r.name)).toEqual(['居間', '読書スペース'])
  })
  it('allows unlimited local moves, overlapping occupants and idempotent effects with explicit invalid tool errors', async () => {
    const { harness } = await setup()
    await harness.start(true); await active(harness)
    for (let i = 0; i < 25; i++) expect((await call(harness, 'npc0', 'moveWithinFacility', { position: { x: i % 10, y: 0, z: 0 } })).success).toBe(true)
    const before = harness.snapshot().events.length
    const input = { position: positions[1] }
    const first = await call(harness, 'npc0', 'moveWithinFacility', input, 'duplicate')
    expect(await call(harness, 'npc0', 'moveWithinFacility', input, 'duplicate')).toEqual(first)
    expect(harness.snapshot().events).toHaveLength(before + 1)
    expect((await call(harness, 'npc0', 'moveWithinFacility', { position: { x: 30, y: 0, z: 0 } })).success).toBe(false)
    expect(harness.snapshot().actors[0].position).toEqual(harness.snapshot().actors[1].position)
  })
  it('defers speech for ended listeners until the next turn and keeps recipient records fixed', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    await call(harness, 'npc1', 'endTurn')
    await call(harness, 'npc0', 'sendMessage', { text: '家の中の会話', volume: 'high' })
    const speech = harness.snapshot().events.at(-1)!
    expect(speech.recipients).toEqual(['npc1'])
    expect(harness.snapshot().actors[1].activity).toBe('ended')
    expect((await call(harness, 'npc1', 'moveWithinFacility', { position: { x: 20, y: 20, z: 2 } })).success).toBe(false)
    expect(harness.snapshot().events.find(e => e.sequence === speech.sequence)!.recipients).toEqual(['npc1'])
    await harness.drain()
    expect(services.steers.some(s => s.agentId === 'npc1')).toBe(false)
    expect(harness.checkpoint().jobs.find(j => j.kind === 'message')?.status).toBe('deferred')
    const situation = JSON.parse((await call(harness, 'npc0', 'getSituation')).contentItems[0].text)
    expect(situation.npcs).toHaveLength(5)
    expect(situation.home.householdId).toBe('family-a')
    expect(situation.npcs.every((n: Record<string, unknown>) => !('temperament' in n) && !('memory' in n))).toBe(true)
    const actors = harness.snapshot().actors
    actors[1].activity = 'sleeping'; actors[2].locationId = 'school'
    expect(speechRecipients(residential, actors[4], actors, 'high')).toEqual([])
    for (const id of ['npc0', 'npc2', 'npc3', 'npc4']) await call(harness, id, 'endTurn')
    for (const actor of harness.snapshot().actors) services.finish(actor.id)
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('paused'))
    await harness.resume(true)
    await vi.waitFor(() => expect(services.starts.some(s => s.agentId === 'npc1' && s.text.includes('家の中の会話'))).toBe(true))
    expect(harness.snapshot().turn).toBe(2)
  })
  it('sleeps exactly one world turn, compacts once and executes one reserved facility transfer at the next boundary', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    await call(harness, 'npc0', 'moveToFacility', { facilityId: 'school' })
    await call(harness, 'npc4', 'sendMessage', { text: 'また明日', volume: 'high' })
    expect((await call(harness, 'npc0', 'moveToFacility', { facilityId: 'office' })).success).toBe(false)
    await call(harness, 'npc0', 'endTurn')
    await call(harness, 'npc1', 'sleep')
    expect(await harness.bufferTerminal('npc1', '起きたら読んで\r')).toBe(true)
    for (const id of ['npc2', 'npc3', 'npc4']) await call(harness, id, 'endTurn')
    await vi.waitFor(() => expect(harness.checkpoint().jobs.some(j => j.status === 'queued' || j.status === 'requested')).toBe(false))
    for (const a of harness.snapshot().actors) services.finish(a.id)
    await vi.waitFor(() => { expect(services.errors).toEqual([]); expect(harness.snapshot().stage).toBe('paused') })
    expect(harness.snapshot()).toMatchObject({ turn: 1, time: 'morning' })
    expect(harness.snapshot().actors[0].locationId).toBe('home')
    expect(services.compacts).toEqual(['npc1'])
    expect(services.writes).toEqual([])
    await harness.resume(true); await active(harness)
    expect(harness.snapshot()).toMatchObject({ turn: 2, time: 'noon' })
    expect(harness.snapshot().actors[0]).toMatchObject({ locationId: 'school', nextFacilityId: null, position: positions[0] })
    expect(harness.snapshot().actors[1]).toMatchObject({ activity: 'active', compact: 'none' })
    await vi.waitFor(() => expect(services.writes).toEqual(['起きたら読んで\r']))
  })
  it('routes facility requests asynchronously and waits for their explicit answers', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    const value = JSON.parse((await call(harness, 'npc0', 'useFacility', { request: '家の設備について教えて' })).contentItems[0].text)
    await vi.waitFor(() => expect(harness.checkpoint().active['facility-residential']?.turnId).toBeTruthy())
    expect((await call(harness, 'facility-residential', 'completeFacilityUse', { requestId: value.requestId, text: '共同の井戸があります', publicState: '井戸は利用できます' })).success).toBe(true)
    await vi.waitFor(() => expect(services.steers.some(s => s.agentId === 'npc0' && s.text.includes('共同の井戸'))).toBe(true))
    expect(harness.snapshot().facilities.find(f => f.id === 'residential')!.layout!.publicState).toBe('井戸は利用できます')
  })
  it('resumes unanswered facility use after a confirmed interruption without duplicating the request', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    const request = JSON.parse((await call(harness, 'npc0', 'useFacility', { request: '設備を利用する' })).contentItems[0].text)
    await vi.waitFor(() => expect(harness.checkpoint().active['facility-residential']?.turnId).toBeTruthy())
    await harness.pause()
    await vi.waitFor(() => expect(Object.keys(harness.checkpoint().active)).toHaveLength(0))
    await harness.resume(true)
    await vi.waitFor(() => expect(harness.checkpoint().active['facility-residential']?.turnId).toBeTruthy())
    expect(harness.checkpoint().interactions).toHaveLength(1)
    expect(services.starts.filter(s => s.agentId === 'facility-residential').at(-1)!.text).toContain(request.requestId)
    expect((await call(harness, 'facility-residential', 'completeFacilityUse', { requestId: request.requestId, text: '利用完了', publicState: '使用済み' })).success).toBe(true)
    expect(harness.checkpoint().interactions[0].done).toBe(true)
  })
  it('does not equate a Codex completion with endTurn and restores stopped worlds without repeating accepted messages', async () => {
    const { harness, services } = await setup()
    await harness.start(true); await active(harness)
    const before = services.starts.filter(s => s.agentId === 'npc0').length
    services.finish('npc0')
    await vi.waitFor(() => expect(services.starts.filter(s => s.agentId === 'npc0')).toHaveLength(before + 1))
    await call(harness, 'npc1', 'moveWithinFacility', { position: { x: 20, y: 20, z: 1 } })
    await harness.pause()
    await vi.waitFor(() => expect(Object.keys(harness.checkpoint().active)).toHaveLength(0))
    const checkpoint = harness.checkpoint()
    await harness.close(); running.delete(harness)
    const restored = await setup(8, checkpoint, services)
    expect(restored.harness.snapshot().stage).toBe('paused')
    await restored.harness.resume(true); await active(restored.harness)
    expect(restored.harness.snapshot().actors[1].position).toEqual({ x: 20, y: 20, z: 1 })
    expect(restored.harness.snapshot().turn).toBe(1)
  })
  it('stops on uncertain inference creation and never automatically resends it', async () => {
    const { harness, services } = await setup()
    services.uncertain = true
    await harness.start()
    await vi.waitFor(() => expect(harness.snapshot().stage).toBe('error'))
    const count = services.starts.length
    await expect(harness.resume()).rejects.toThrow('自動再送しません')
    expect(services.starts).toHaveLength(count)
  })
  it('commits failed inference completion before stopping peers and preserves the original error', async () => {
    const { harness, services } = await setup()
    await harness.start(); await active(harness)
    const turnId = harness.checkpoint().active.npc0.turnId!
    const interrupted: string[] = []
    const interrupt = vi.spyOn(services, 'interrupt').mockImplementation(async (id, turn) => {
      expect(harness.checkpoint().jobs.filter(j => j.turnId === turnId).every(j => j.status === 'done' && j.completed)).toBe(true)
      interrupted.push(id)
      services.finish(id, turn, 'interrupted')
      throw new Error('interrupt acknowledgement lost')
    })
    const failure = 'Invalid prompt: provider rejected this request'
    harness.notify('npc0', 'turn/completed', { turn: { id: turnId, status: 'failed', error: { message: failure } } })
    await vi.waitFor(() => expect(services.errors.length).toBe(5))
    expect(harness.snapshot()).toMatchObject({ stage: 'error', error: `推論に失敗しました: npc0/${turnId}: ${failure}` })
    await vi.waitFor(() => expect(harness.checkpoint().active).toEqual({}))
    expect(harness.checkpoint().jobs.filter(j => j.turnId === turnId).every(j => j.status === 'done' && j.completed)).toBe(true)
    expect(services.saved!.jobs.filter(j => j.turnId === turnId).every(j => j.status === 'done')).toBe(true)
    expect(interrupted).not.toContain('npc0')
    expect(services.errors.every(e => e.message.includes(failure))).toBe(true)
    await harness.fail(new Error('secondary timeout'))
    expect(interrupt).toHaveBeenCalledTimes(4)
    expect(harness.snapshot().error).toContain(failure)
  })
})
