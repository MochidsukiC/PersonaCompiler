import { describe, expect, it } from 'vitest'
import { resolveEffort, requestedEffortForTier, validateSettings } from '../../src/core/models'
import { allocateCounts, validateAnswers, validatePopulation } from '../../src/core/population'
import { models, settings, draft, population, round, answers } from './fixtures'

describe('Model policies and population invariants', () => {
  it.each([[0, 'minimal'], [1, 'low'], [2, 'medium'], [3, 'high']] as const)('resolves Tier %i to %s', (tier, expected) => expect(requestedEffortForTier(tier)).toBe(expected))
  it('maps unsupported effort to the nearest, choosing lower on a tie', () => {
    const model = { ...models[0], supportedReasoningEfforts: ['minimal', 'medium'].map(reasoningEffort => ({ reasoningEffort, description: '' })) }
    expect(resolveEffort(model, { mode: 'auto' }, 1)).toEqual({ requested: 'low', effective: 'minimal' })
    expect(() => resolveEffort(model, { mode: 'fixed', effort: 'low' }, 1)).toThrow('対応していません')
  })
  it('supports all four NPC policy combinations and rejects incompatible fixed effort', () => {
    for (const model of [{ mode: 'fixed', modelId: models[0].model }, { mode: 'auto' }] as const) for (const effort of [{ mode: 'fixed', effort: 'medium' }, { mode: 'auto' }] as const) expect(validateSettings({ ...settings, npc: { model, effort } }, models)).toBeDefined()
    expect(() => validateSettings({ ...settings, npc: { model: { mode: 'auto' }, effort: { mode: 'fixed', effort: 'ultra' } } }, models)).toThrow()
    expect(() => validateSettings({ ...settings, npc: { model: { mode: 'auto' }, effort: { mode: 'auto' } } }, [{ ...models[0], model: 'unknown' }])).toThrow()
  })
  it('allocates remainders deterministically and requires every question answer', () => {
    expect(allocateCounts(5, [0.5, 0.5])).toEqual([3, 2])
    expect(allocateCounts(7, [1 / 3, 1 / 3, 1 / 3])).toEqual([3, 2, 2])
    expect(() => validateAnswers(round, answers)).not.toThrow()
    expect(() => validateAnswers(round, { ...answers, answers: answers.answers.slice(1) })).toThrow()
  })
  it('validates totals, IDs, family, location and fixed birth models without changing them', () => {
    expect(validatePopulation(population, draft.specification, draft.map, settings, models)).toEqual(population)
    const change = structuredClone(population)
    change.npcs[0].family.push({ npcId: 'missing', relation: 'parent' })
    expect(() => validatePopulation(change, draft.specification, draft.map, settings, models)).toThrow('家族')
    change.npcs[0].family = []
    change.npcs[0].birthModelId = models[1].model
    expect(() => validatePopulation(change, draft.specification, draft.map, settings, models)).toThrow('出生時モデル')
    change.npcs[0].birthModelId = models[0].model
    expect(() => validatePopulation(change, draft.specification, draft.map, settings, [models[1]])).toThrow('利用できません')
  })
  it.each([false, true])('interprets family relations as the referenced relative and diagnoses reversed parentage (parent first=%s)', parentFirst => {
    const input = structuredClone(population)
    input.npcs[0].family = [{ npcId: 'npc3', relation: 'parent' }]
    input.npcs[3].family = [{ npcId: 'npc0', relation: 'child' }]
    if (parentFirst) input.npcs.reverse()
    expect(validatePopulation(input, draft.specification, draft.map, settings, models)).toEqual(input)
    for (const npc of input.npcs) for (const relative of npc.family) relative.relation = relative.relation === 'parent' ? 'child' : 'parent'
    const before = structuredClone(input)
    expect(() => validatePopulation(input, draft.specification, draft.map, settings, models)).toThrow(parentFirst ? 'npc3(40歳) → npc0(5歳), relation=parent' : 'npc0(5歳) → npc3(40歳), relation=child')
    expect(() => validatePopulation(input, draft.specification, draft.map, settings, models)).toThrow('本人から見た相手の続柄')
    expect(input).toEqual(before)
  })
})
