import { describe, expect, it } from 'vitest'
import { resolveEffort, requestedEffort, validateSettings } from '../../src/core/models'
import { allocateCounts, validateAnswers, validatePopulation } from '../../src/core/population'
import { models, settings, draft, population, round, answers } from './fixtures'

describe('Model policies and population invariants', () => {
  it.each([[0, 'low'], [5, 'low'], [6, 'medium'], [17, 'medium'], [18, 'high'], [90, 'high']])('resolves age %i to %s', (age, expected) => expect(requestedEffort(age as number)).toBe(expected))
  it('maps unsupported effort to the nearest, choosing lower on a tie', () => {
    const model = { ...models[0], supportedReasoningEfforts: ['minimal', 'medium'].map(reasoningEffort => ({ reasoningEffort, description: '' })) }
    expect(resolveEffort(model, { mode: 'auto' }, 5)).toEqual({ requested: 'low', effective: 'minimal' })
    expect(() => resolveEffort(model, { mode: 'fixed', effort: 'low' }, 5)).toThrow('対応していません')
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
})
