import type { MapDocument } from '../shared/contracts'
import { populationSchema, type AgentModelSettings, type DesignIssue, type ModelInfo, type Population, type QuestionAnswers, type QuestionRound, type Specification } from './contracts'
import { autoModels, requireModel, resolveEffort } from './models'

export function allocateCounts(total: number, ratios: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !ratios.length || ratios.some(r => !Number.isFinite(r) || r < 0) || Math.abs(ratios.reduce((a, b) => a + b, 0) - 1) > 0.000001) throw new Error('人口配分の人数または比率が不正です')
  const sum = ratios.reduce((a, b) => a + b, 0)
  const exact = ratios.map(r => total * r / sum)
  const counts = exact.map(Math.floor)
  const order = exact.map((v, i) => ({ i, remainder: v - counts[i] })).sort((a, b) => b.remainder - a.remainder || a.i - b.i)
  const rest = total - counts.reduce((a, b) => a + b, 0)
  for (let i = 0; i < rest; i++) counts[order[i].i]++
  return counts
}
export function validateAnswers(round: QuestionRound, answers: QuestionAnswers): void {
  if (answers.roundId !== round.id || answers.answers.length !== round.questions.length || new Set(answers.answers.map(a => a.questionId)).size !== round.questions.length) throw new Error('質問ラウンドが古いか、未回答・重複回答があります')
  for (const q of round.questions) {
    const a = answers.answers.find(value => value.questionId === q.id)
    if (!a || (a.optionId === null && !a.text.trim()) || (a.optionId !== null && !q.options.some(o => o.id === a.optionId))) throw new Error(`質問 ${q.id} の回答が不正です`)
  }
}
export function validateMap(spec: Specification, map: MapDocument): void {
  const locations = new Set(map.locations.map(l => l.id))
  const areas = new Set(map.areas.map(a => a.id))
  if (locations.size !== map.locations.length || areas.size !== map.areas.length || new Set(map.connections.map(c => c.id)).size !== map.connections.length) throw new Error('地図のIDが重複しています')
  for (const location of map.locations) if (!areas.has(location.areaId) || location.position.x < 0 || location.position.y < 0 || location.position.x > map.bounds.width || location.position.y > map.bounds.height) throw new Error(`地図の地域または座標が不正です: ${location.id}`)
  for (const connection of map.connections) if (!locations.has(connection.from) || !locations.has(connection.to)) throw new Error(`道の接続先が不明です: ${connection.id}`)
  for (const facility of spec.town.facilities) if (!locations.has(facility.locationId)) throw new Error(`施設の所在地が不明です: ${facility.id}`)
}
export function inspectPopulation(input: unknown, spec: Specification, map: MapDocument, settings: AgentModelSettings, models: ModelInfo[]): { population: Population; issues: DesignIssue[] } {
  const population = populationSchema.parse(input)
  const { npcs } = population
  if (new Set(npcs.map(n => n.id)).size !== npcs.length) throw new Error('NPC IDが重複しています')
  const locations = new Set(map.locations.map(l => l.id))
  const allowed = settings.npc.model.mode === 'auto' ? autoModels(models).map(m => m.model) : [settings.npc.model.modelId]
  const inverse = { parent: 'child', child: 'parent', sibling: 'sibling', spouse: 'spouse' } as const
  for (const npc of npcs) {
    if (npc.id === 'parent' || npc.id.startsWith('facility-') || !locations.has(npc.locationId)) throw new Error(`NPC IDまたは所在地が不正です: ${npc.id}`)
    if (!allowed.includes(npc.birthModelId)) throw new Error(`NPC ${npc.id} の出生時モデルが設定と一致しません: ${npc.birthModelId}`)
    resolveEffort(requireModel(models, npc.birthModelId), settings.npc.effort, npc.age)
    if (new Set(npc.family.map(f => f.npcId)).size !== npc.family.length) throw new Error(`家族参照が重複しています: ${npc.id}`)
    for (const relation of npc.family) {
      const other = npcs.find(n => n.id === relation.npcId)
      if (!other || other.id === npc.id || !other.family.some(f => f.npcId === npc.id && f.relation === inverse[relation.relation])) throw new Error(`家族関係の参照または相互関係が不正です: ${npc.id} → ${relation.npcId}`)
      if ((relation.relation === 'parent' && other.age <= npc.age) || (relation.relation === 'child' && other.age >= npc.age)) throw new Error(`親子の年齢が逆転しています: ${npc.id}`)
    }
  }
  const issues: DesignIssue[] = []
  if (npcs.length !== spec.population.count) issues.push({ code: 'population.count', message: '人口総数が承認済みの人数と一致しません', details: [{ label: '人口総数', expected: spec.population.count, actual: npcs.length }] })
  const ageCounts = allocateCounts(spec.population.count, spec.population.ageDistribution.map(a => a.ratio))
  const ages = spec.population.ageDistribution.map((band, i) => ({ label: `${band.min}〜${band.max}歳`, expected: ageCounts[i], actual: npcs.filter(n => n.age >= band.min && n.age <= band.max).length }))
  const outsideAges = npcs.filter(n => !spec.population.ageDistribution.some(band => n.age >= band.min && n.age <= band.max)).length
  if (outsideAges) ages.push({ label: '承認された年齢帯の外', expected: 0, actual: outsideAges })
  if (ages.some(row => row.actual !== row.expected)) issues.push({ code: 'population.ageDistribution', message: '年齢分布が承認済みの人口配分と一致しません', details: ages })
  const sexCounts = allocateCounts(spec.population.count, spec.population.sexRatio.map(a => a.ratio))
  const sexes = spec.population.sexRatio.map((row, i) => ({ label: row.sex, expected: sexCounts[i], actual: npcs.filter(n => n.sex === row.sex).length }))
  for (const sex of new Set(npcs.map(n => n.sex))) if (!spec.population.sexRatio.some(row => row.sex === sex)) sexes.push({ label: sex, expected: 0, actual: npcs.filter(n => n.sex === sex).length })
  if (sexes.some(row => row.actual !== row.expected)) issues.push({ code: 'population.sexRatio', message: '性別比率が承認済みの人口配分と一致しません', details: sexes })
  return { population, issues }
}

export function validatePopulation(input: unknown, spec: Specification, map: MapDocument, settings: AgentModelSettings, models: ModelInfo[], accepted?: { population: Population; specificationHash: string; decision: string }, specificationHash?: string): Population {
  const result = inspectPopulation(input, spec, map, settings, models)
  if (result.issues.length && !(accepted?.decision === 'accepted' && accepted.specificationHash === specificationHash && JSON.stringify(accepted.population) === JSON.stringify(result.population))) throw new Error(result.issues.map(issue => issue.message).join('\n'))
  return result.population
}
