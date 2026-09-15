import { describe, expect, it } from 'vitest'
import { BootstrapPrompts } from '../../src/core/prompts'
import { defaultDirectionSettings, resolveDialogueRequest, resolveDialogueSettings, resolveNpcDialogueSettings, type DirectionSettings } from '../../src/core/direction-settings'
import { validatePopulation } from '../../src/core/population'
import { LifeHarness } from '../../src/core/life-harness'
import { draft, models, population, settings as modelSettings } from './fixtures'

const configured = (): DirectionSettings => ({
  version: 1,
  revision: 7,
  world: { tier: 1, directionProfile: 'classic', expressionIntensity: 1, dialogueMode: 'free' },
  regions: { town: { tier: 2, directionProfile: 'life_sim' } },
  npcs: { npc0: { expressionIntensity: 2, dialogueMode: 'semi_fixed' } }
})

describe('Research direction settings', () => {
  it('resolves each field world < region < NPC < quest < utterance', () => {
    const base = resolveNpcDialogueSettings(configured(), 'npc0', 'town')
    expect(base).toEqual({ tier: 2, directionProfile: 'life_sim', expressionIntensity: 2, dialogueMode: 'semi_fixed' })
    expect(resolveDialogueRequest(base, {
      quest: { tier: 0, dialogueMode: 'fixed' },
      utterance: { tier: 3, directionProfile: 'comedy' }
    })).toEqual({ tier: 3, directionProfile: 'comedy', expressionIntensity: 2, dialogueMode: 'fixed' })
  })

  it('uses an inert compatibility policy when individual layers are absent', () => {
    expect(defaultDirectionSettings().world).toEqual({ tier: 3, directionProfile: 'classic', expressionIntensity: 0, dialogueMode: 'free' })
    expect(resolveDialogueSettings({})).toEqual(defaultDirectionSettings().world)
  })

  it('freezes trusted resolved settings and their map-area provenance during population validation', () => {
    const result = validatePopulation(population, draft.specification, draft.map, modelSettings, models, undefined, undefined, configured())
    expect(result.npcs[0].resolvedDialogueSettings).toEqual({ tier: 2, directionProfile: 'life_sim', expressionIntensity: 2, dialogueMode: 'semi_fixed' })
    expect(result.npcs[0].dialogueSettingsResolution).toEqual({ directionRevision: 7, regionId: 'town' })
    expect(result.npcs[1].resolvedDialogueSettings).toEqual({ tier: 2, directionProfile: 'life_sim', expressionIntensity: 1, dialogueMode: 'free' })
  })

  it('adds the frozen private policy to NPC prompts without changing legacy prompts', () => {
    const prompts = new BootstrapPrompts()
    const legacy = prompts.npc(population.npcs[0], draft.specification)
    expect(legacy).not.toContain('<harness_direction_policy>')
    const npc = validatePopulation(population, draft.specification, draft.map, modelSettings, models, undefined, undefined, configured()).npcs[0]
    const prompt = prompts.npc(npc, draft.specification)
    expect(prompt).toContain('<harness_direction_policy>')
    expect(prompt).toContain('"directionProfile":"life_sim"')
    expect(prompt).toContain('内部名や値を台詞へ出さず')
  })

  it('keeps the frozen policy in the private checkpoint and out of the public world snapshot', () => {
    const people = validatePopulation(population, draft.specification, draft.map, modelSettings, models, undefined, undefined, configured())
    const service = { start: async () => '', steer: async () => undefined, compact: async () => undefined, interrupt: async () => undefined,
      history: async () => [], terminalInput: async () => undefined, save: async () => undefined, changed: () => undefined, failed: () => undefined }
    const harness = new LifeHarness(draft.specification, people, service)
    expect(harness.checkpoint().actorDirectionSettings?.npc0).toMatchObject({ directionRevision: 7, regionId: 'town', lockedAtTurn: 0 })
    expect(JSON.stringify(harness.snapshot())).not.toContain('directionProfile')
  })
})
