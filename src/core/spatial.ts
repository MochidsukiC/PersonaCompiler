import type { Population, Specification } from './contracts'
import { facilityLayoutSchema, type FacilityLayout, type LifeActor, type LifeFacility, type Volume, type Voxel, type Voice } from './life-contracts'

export class LifeRuleError extends Error {
  constructor(message: string) { super(message); this.name = 'LifeRuleError' }
}
export function contains(bounds: Volume, p: Voxel): boolean {
  return (['x', 'y', 'z'] as const).every(axis => p[axis] >= bounds.min[axis] && p[axis] <= bounds.max[axis])
}
export function overlaps(a: Volume, b: Volume): boolean {
  return (['x', 'y', 'z'] as const).every(axis => a.min[axis] <= b.max[axis] && b.min[axis] <= a.max[axis])
}
export function validPosition(dimensions: Voxel, p: Voxel): boolean {
  return (['x', 'y', 'z'] as const).every(axis => Number.isSafeInteger(p[axis]) && p[axis] >= 0 && p[axis] < dimensions[axis])
}
export function validateLifeSpecification(spec: Specification, lifecycle = false): void {
  if (!lifecycle && spec.simulation.endCondition !== 'turn_limit') throw new LifeRuleError('この実装段階の終了条件はturn_limitです')
  if (spec.town.facilities.filter(f => f.type === 'residential').length !== 1) throw new LifeRuleError('住宅街(type=residential)を必ず1施設含めてください')
  if (new Set(spec.town.facilities.map(f => f.locationId)).size !== spec.town.facilities.length) throw new LifeRuleError('各施設のlocationIdは一意にしてください')
  for (const f of spec.town.facilities) {
    if (!f.dimensions || !(['x', 'y', 'z'] as const).every(axis => Number.isSafeInteger(f.dimensions![axis]) && f.dimensions![axis] > 0)) throw new LifeRuleError(`施設の3次元サイズがありません: ${f.id}`)
  }
}
export function validateLayout(facility: LifeFacility, input: unknown, householdIds: string[]): FacilityLayout {
  const layout = facilityLayoutSchema.parse(input)
  const regions = [...layout.regions, ...layout.homes]
  if (new Set(regions.map(r => r.id)).size !== regions.length) throw new LifeRuleError(`領域IDが重複しています: ${facility.id}`)
  for (const r of regions) {
    if (!validPosition(facility.dimensions, r.bounds.min) || !validPosition(facility.dimensions, r.bounds.max) || !(['x', 'y', 'z'] as const).every(a => r.bounds.min[a] <= r.bounds.max[a])) throw new LifeRuleError(`領域が施設外または逆転しています: ${facility.id}/${r.id}`)
  }
  if (facility.type === 'residential') {
    const assigned = layout.homes.map(h => h.householdId)
    if (assigned.length !== householdIds.length || new Set(assigned).size !== assigned.length || householdIds.some(id => !assigned.includes(id))) throw new LifeRuleError('住宅街には全世帯それぞれに1軒の家が必要です')
    for (let i = 0; i < layout.homes.length; i++) for (let j = i + 1; j < layout.homes.length; j++) {
      if (overlaps(layout.homes[i].bounds, layout.homes[j].bounds)) throw new LifeRuleError(`家の範囲が重複しています: ${layout.homes[i].id}/${layout.homes[j].id}`)
    }
  } else if (layout.homes.length) throw new LifeRuleError(`世帯の家は住宅街へ配置してください: ${facility.id}`)
  return layout
}
export function homeAt(facility: LifeFacility, position: Voxel) {
  return facility.layout?.homes.find(h => contains(h.bounds, position))
}
export function audible(facility: LifeFacility, source: Voxel, target: Voxel, voice: Voice): boolean {
  const home = homeAt(facility, source)
  if (home && !contains(home.bounds, target)) return false
  if (voice === 'high') return true
  const radius = voice === 'low' ? 1 : 5
  return (source.x - target.x) ** 2 + (source.y - target.y) ** 2 + (source.z - target.z) ** 2 <= radius ** 2
}
export function speechRecipients(facility: LifeFacility, source: LifeActor, actors: LifeActor[], voice: Voice): string[] {
  if (!source.position) throw new LifeRuleError(`発話者の座標が未設定です: ${source.id}`)
  const position = source.position
  return actors.filter(a => a.id !== source.id && a.locationId === source.locationId && a.activity !== 'sleeping' && a.activity !== 'dead' && a.position && audible(facility, position, a.position, voice)).map(a => a.id)
}
export function households(population: Population) {
  return [...new Set(population.npcs.map(n => n.householdId))].map(id => ({ id, members: population.npcs.filter(n => n.householdId === id).map(n => ({ id: n.id, name: n.name, age: n.age })) }))
}
