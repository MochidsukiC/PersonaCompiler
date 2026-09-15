import { describe, expect, it } from 'vitest'
import { COMPATIBLE_DIALOGUE_SETTINGS, defaultDirectionSettings } from '../../src/core/direction-settings'
import {
  compactDirectionSettings,
  intensityOptions,
  modeOptions,
  profileOptions,
  resolveDirectionSettings,
  tierOptions,
  updateDirectionOverride,
  type DirectionSettings
} from '../../src/renderer/src/direction-settings'

describe('direction settings renderer model', () => {
  it('exposes every supported value without inventing a legacy migration', () => {
    expect(tierOptions).toEqual([0, 1, 2, 3])
    expect(intensityOptions).toEqual([0, 1, 2, 3])
    expect(profileOptions).toEqual(['classic', 'life_sim', 'dark_restrained', 'comedy'])
    expect(modeOptions).toEqual(['fixed', 'semi_fixed', 'free'])
    expect(COMPATIBLE_DIALOGUE_SETTINGS).toEqual({ tier: 3, directionProfile: 'classic', expressionIntensity: 0, dialogueMode: 'free' })
  })

  it('shows field-wise effective values in world, region and NPC priority order', () => {
    const settings: DirectionSettings = {
      version: 1,
      revision: 8,
      world: { tier: 1, directionProfile: 'classic', expressionIntensity: 1, dialogueMode: 'free' },
      regions: { north: { tier: 2, directionProfile: 'life_sim' } },
      npcs: { npc1: { expressionIntensity: 3, dialogueMode: 'fixed' } }
    }
    expect(resolveDirectionSettings(settings, COMPATIBLE_DIALOGUE_SETTINGS, 'north', 'npc1')).toEqual({
      tier: 2,
      directionProfile: 'life_sim',
      expressionIntensity: 3,
      dialogueMode: 'fixed'
    })
    expect(resolveDirectionSettings(settings, COMPATIBLE_DIALOGUE_SETTINGS, 'south', 'npc1')).toEqual({
      tier: 1,
      directionProfile: 'classic',
      expressionIntensity: 3,
      dialogueMode: 'fixed'
    })
  })

  it('represents inheritance by deleting a field and omits empty override records before saving', () => {
    const inherited = updateDirectionOverride({ tier: 0, dialogueMode: 'fixed' }, 'tier', undefined)
    expect(inherited).toEqual({ dialogueMode: 'fixed' })
    const settings = defaultDirectionSettings()
    expect(compactDirectionSettings({ ...settings, regions: { town: {}, park: { tier: 1 } }, npcs: { npc0: {} } })).toEqual({
      ...settings,
      regions: { park: { tier: 1 } },
      npcs: {}
    })
  })
})
