import { LifeHarness, type LifeCheckpoint } from '../../src/core/life-harness'
import { initializeEconomy } from '../../src/core/economy'
import type { EconomySeed, ItemDefinition, Owner } from '../../src/core/economy-contracts'
import { draft, population } from '../backend/fixtures'

export const personal = (id = 'npc0'): Owner => ({ kind: 'npc', id })
export const facilityStorage = { kind: 'facility' as const, facilityId: 'office' }
export const chicken: ItemDefinition = { id: 'chicken', name: 'ファミチキ', description: '食事として楽しむ揚げ鶏', kind: 'consumable', cost: 100, effects: { hp: 0, hunger: 40, san: 10 }, durability: null, primary: null }
export const wheat: ItemDefinition = { id: 'wheat', name: '小麦', description: '農場で生産する作物', kind: 'consumable', cost: null, effects: { hp: 0, hunger: 10, san: 0 }, durability: null, primary: { facilityId: 'office', yield: 5, toolItemId: null, exportPrice: 50 } }
export const seed: EconomySeed = { currency: '円', balances: population.npcs.map(n => ({ npcId: n.id, amount: 1000 })), catalog: [], holdings: [] }
export function savedEconomy(initial: EconomySeed = seed): LifeCheckpoint {
  const base = new LifeHarness(draft.specification, population, { lifecycle: { seed: 'economy-test', birth: async () => { throw Error('unexpected birth') } }, async start() { return null }, async steer() {}, async compact() {}, async interrupt() {}, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed() {} }).checkpoint()
  base.world.stage = 'running'; base.world.phase = 'activity'; base.world.turn = 1
  for (const f of base.world.facilities) f.layout = { publicState: '開放', regions: [], homes: f.type === 'residential' ? population.npcs.map((n, i) => ({ id: `home-${i}`, householdId: n.householdId, name: `${n.name}の家`, description: '家', bounds: { min: { x: i * 4, y: 0, z: 0 }, max: { x: i * 4 + 2, y: 2, z: 1 } } })) : [] }
  for (const a of base.world.actors) { a.activity = 'active'; a.locationId = 'office'; a.position = { x: 0, y: 0, z: 0 } }
  base.economyArchive = initializeEconomy(base.world, initial)
  return base
}
