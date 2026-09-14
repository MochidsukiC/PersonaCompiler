import { vi, expect } from 'vitest'
import { LifeHarness, type LifeServices } from '../../src/core/life-harness'
import type { ItemDecision } from '../../src/core/economy-contracts'
import { draft, population } from './fixtures'
import { seed, savedEconomy, wheat, chicken } from '../fixtures/economy'
export { seed, savedEconomy, wheat, chicken, personal, facilityStorage } from '../fixtures/economy'

export async function economyHarness(saved = savedEconomy(), decide: NonNullable<LifeServices['economy']>['request'] = async request => ({ decision: 'approved', reason: '世界の暮らしに適合します', item: request.name === '小麦' ? wheat : chicken } satisfies ItemDecision), overrides: Partial<LifeServices> = {}) {
  const errors: Error[] = []
  const services: LifeServices = {
    economy: { seed, request: decide }, lifecycle: { seed: 'economy-test', birth: async () => { throw Error('unexpected birth') } },
    async start(agentId, text) {
      const id = crypto.randomUUID()
      harness.notify(agentId, 'turn/started', { turn: { id } })
      if (text.includes('deathNotice') || text.includes('economyNotice')) queueMicrotask(() => harness.notify(agentId, 'turn/completed', { turn: { id, status: 'completed' } }))
      return id
    },
    async steer() {}, async compact(agentId) {
      const id = crypto.randomUUID()
      harness.notify(agentId, 'turn/started', { turn: { id } }); harness.notify(agentId, 'item/completed', { item: { type: 'contextCompaction' } }); harness.notify(agentId, 'turn/completed', { turn: { id, status: 'completed' } })
    },
    async interrupt(agentId, id) { harness.notify(agentId, 'turn/completed', { turn: { id, status: 'interrupted' } }) }, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed(error) { errors.push(error) }, ...overrides
  }
  const harness: LifeHarness = new LifeHarness(draft.specification, population, services, saved)
  await harness.resume(true)
  await vi.waitFor(() => expect(Object.values(harness.checkpoint().active).filter(a => a.turnId)).toHaveLength(saved.world.actors.filter(a => a.activity !== 'dead').length))
  const call = async (actorId: string, tool: string, args: unknown, callId = crypto.randomUUID()) => {
    const active = harness.checkpoint().active[actorId]
    if (!active?.turnId) throw Error(`No active turn: ${actorId}`)
    const result = await harness.tool(actorId, { turnId: active.turnId, callId, tool, arguments: args })
    return { ...result, value: JSON.parse(result.contentItems[0].text) }
  }
  return { harness, errors, services, call }
}
