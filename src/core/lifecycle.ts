import { createHash } from 'node:crypto'
import type { Population } from './contracts'
import { lifecycleToolSchemas, type Lifecycle, type Resident } from './lifecycle-contracts'
import { LifeRuleError } from './spatial'

export function initializeLifecycle(population: Population, seed: string): Lifecycle {
  return { version: 1, seed, processedDay: 0, proposals: [], births: [], homes: [], endReason: null,
    residents: population.npcs.map(n => ({ ...structuredClone(n), sexCategory: n.sex === '男性' || n.sex === 'male' ? 'male' : n.sex === '女性' || n.sex === 'female' ? 'female' : 'other', generation: 0, bornTurn: 0, diedTurn: null })) }
}
export function resident(state: Lifecycle, id: string): Resident {
  const person = state.residents.find(n => n.id === id)
  if (!person) throw new LifeRuleError(`住民が見つかりません: ${id}`)
  return person
}
export function living(state: Lifecycle, id: string): Resident {
  const person = resident(state, id)
  if (person.diedTurn !== null) throw new LifeRuleError(`死亡した住民です: ${id}`)
  return person
}
export function related(state: Lifecycle, a: Resident, b: Resident): boolean {
  const ancestors = (person: Resident, depth: number, visited = new Set<string>()): Set<string> => {
    if (!depth) return visited
    for (const link of person.family.filter(f => f.relation === 'parent')) {
      if (visited.has(link.npcId)) continue
      visited.add(link.npcId); ancestors(resident(state, link.npcId), depth - 1, visited)
    }
    return visited
  }
  if (a.family.some(f => f.npcId === b.id && f.relation !== 'spouse')) return true
  if (ancestors(a, state.residents.length).has(b.id) || ancestors(b, state.residents.length).has(a.id)) return true
  const aa = ancestors(a, 2), bb = ancestors(b, 2)
  return [...aa].some(id => bb.has(id))
}
export function birthEligible(a: Resident, b: Resident): boolean {
  return a.diedTurn === null && b.diedTurn === null && [a, b].every(n => n.age >= 18 && n.age <= 49) &&
    ((a.sexCategory === 'male' && b.sexCategory === 'female') || (a.sexCategory === 'female' && b.sexCategory === 'male'))
}
export function marry(state: Lifecycle, actorId: string, input: unknown) {
  const value = lifecycleToolSchemas.marry.parse(input), a = living(state, actorId), b = living(state, value.partnerId)
  if (value.withdraw) { state.proposals = state.proposals.filter(p => !(p.actorId === actorId && p.partnerId === b.id)); return { status: 'withdrawn' } }
  if (a.id === b.id || a.age < 18 || b.age < 18 || related(state, a, b)) throw new LifeRuleError('結婚の年齢・血縁条件を満たしていません')
  if (![a.id, b.id].includes(value.homeParentId)) throw new LifeRuleError('子の世帯には当事者の親を指定してください')
  for (const n of [a, b]) if (n.family.some(f => f.relation === 'spouse' && ![a.id, b.id].includes(f.npcId) && resident(state, f.npcId).diedTurn === null)) throw new LifeRuleError('既存の配偶者がいます')
  if (value.children && !birthEligible(a, b)) throw new LifeRuleError('出生には男女の両親が18〜49歳である必要があります')
  const outstanding = state.births.filter(v => ['scheduled', 'requested'].includes(v.status))
  if (outstanding.some(v => v.parents.includes(a.id) && v.parents.includes(b.id))) throw new LifeRuleError('このカップルの出生予約は既にあります')
  for (const n of [a, b]) {
    const children = new Set(n.family.filter(f => f.relation === 'child').map(f => f.npcId)).size
    if (children + outstanding.filter(v => v.parents.includes(n.id)).length + value.children > 4) throw new LifeRuleError(`実子と予約を含む生涯上限4人を超えます: ${n.id}`)
  }
  state.proposals = state.proposals.filter(p => p.actorId !== actorId)
  state.proposals.push({ actorId, partnerId: b.id, children: value.children, homeParentId: value.homeParentId })
  const agreement = state.proposals.find(p => p.actorId === b.id && p.partnerId === a.id && p.children === value.children && p.homeParentId === value.homeParentId)
  if (!agreement) return { status: 'proposed' }
  for (const [n, other] of [[a, b], [b, a]]) if (!n.family.some(f => f.npcId === other.id && f.relation === 'spouse')) n.family.push({ npcId: other.id, relation: 'spouse' })
  state.proposals = state.proposals.filter(p => ![a.id, b.id].includes(p.actorId))
  const parents = [a.id, b.id].sort() as [string, string]
  let day = state.processedDay
  for (let i = 0; i < value.children; i++) {
    const index = state.births.length
    day += 1 + createHash('sha256').update(JSON.stringify([state.seed, parents, index])).digest().readUInt32BE(0) % 3
    state.births.push({ id: `birth-${index + 1}`, parents, homeParentId: value.homeParentId, dueDay: day, status: 'scheduled', childId: null, reason: null })
  }
  return { status: 'married', births: state.births.filter(v => v.parents.includes(a.id) && v.parents.includes(b.id)) }
}
export function ageDay(state: Lifecycle, turn: number): Resident[] {
  const day = Math.floor(turn / 4)
  if (day <= state.processedDay) return []
  if (day !== state.processedDay + 1) throw new LifeRuleError(`日次処理の境界が不正です: ${state.processedDay}/${day}`)
  state.processedDay = day
  const deaths: Resident[] = []
  for (const n of state.residents) if (n.diedTurn === null) {
    n.age++
    if (n.age >= 80) { n.diedTurn = turn; deaths.push(n) }
  }
  for (const birth of state.births) if (birth.status === 'scheduled' && !birthEligible(resident(state, birth.parents[0]), resident(state, birth.parents[1]))) {
    birth.status = 'cancelled'; birth.reason = '両親の生存・18〜49歳・男女ペアの条件を満たさなくなりました'
  }
  state.proposals = state.proposals.filter(p => resident(state, p.actorId).diedTurn === null && resident(state, p.partnerId).diedTurn === null)
  return deaths
}
export function endReason(state: Lifecycle, condition: string, turn: number, maxTurns: number): Lifecycle['endReason'] {
  const alive = state.residents.filter(n => n.diedTurn === null)
  if (!alive.length) return 'population_extinction'
  if (condition !== 'turn_limit' && !alive.some(n => n.generation === 0)) return 'generation_zero_extinction'
  if (condition !== 'generation_zero_extinction' && turn >= maxTurns) return 'turn_limit'
  return null
}
