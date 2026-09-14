import { expect, it } from 'vitest'
import { inspectPopulation, validatePopulation } from '../../src/core/population'
import { draft, models, population, settings } from './fixtures'

it('reports design differences with approved and actual counts without changing generated people', () => {
  const input = structuredClone(population)
  input.npcs[0].age = 25; input.npcs[0].sex = 'その他'
  input.npcs.push({ ...input.npcs[0], id: 'extra' })
  const result = inspectPopulation(input, draft.specification, draft.map, settings, models)
  expect(result.population).toEqual(input)
  expect(result.issues.map(issue => issue.code)).toEqual(['population.count', 'population.ageDistribution', 'population.sexRatio'])
  expect(result.issues[1].details[0]).toEqual({ label: '0〜17歳', expected: 2, actual: 1 })
  expect(result.issues[2].details).toContainEqual({ label: 'その他', expected: 0, actual: 2 })
  expect(() => validatePopulation(input, draft.specification, draft.map, settings, models)).toThrow('年齢分布')
  const accepted = { decision: 'accepted', specificationHash: 'approved', population: input }
  expect(validatePopulation(input, draft.specification, draft.map, settings, models, accepted, 'approved')).toEqual(input)
  expect(() => validatePopulation(input, draft.specification, draft.map, settings, models, accepted, 'different')).toThrow('年齢分布')
  input.npcs[1].age = 26
  expect(() => validatePopulation(input, draft.specification, draft.map, settings, models, { ...accepted, population }, 'approved')).toThrow('年齢分布')
})

it.each(['duplicate', 'location', 'model', 'family'] as const)('continues rejecting structural or execution violations: %s', kind => {
  const input = structuredClone(population)
  input.npcs[0].age = 25
  if (kind === 'duplicate') input.npcs[1].id = input.npcs[0].id
  if (kind === 'location') input.npcs[0].locationId = 'missing'
  if (kind === 'model') input.npcs[0].birthModelId = 'unavailable'
  if (kind === 'family') input.npcs[0].family.push({ npcId: 'missing', relation: 'parent' })
  expect(() => inspectPopulation(input, draft.specification, draft.map, settings, models)).toThrow()
  expect(() => validatePopulation(input, draft.specification, draft.map, settings, models, { decision: 'accepted', specificationHash: 'approved', population: input }, 'approved')).toThrow()
})
