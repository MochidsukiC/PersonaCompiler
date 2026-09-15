import { describe, expect, it } from 'vitest'
import { activeQuestDirective, defaultQuestSettings, questSettingsSchema } from '../../src/core/quest-settings'

const directive = (id: string, mode: 'fixed' | 'semi_fixed' | 'free', priority = 0) => ({ id, enabled: true, mode, fixedText: mode === 'fixed' ? '固定台詞' : '', content: '', requiredFacts: [], forbiddenFacts: [], allowedActs: [], priority, once: false })
const directives = (prefix: string, priority = 0) => ({ before_acceptance: directive(`${prefix}-before`, 'free', priority), in_progress: directive(`${prefix}-progress`, 'semi_fixed', priority), objective_complete: directive(`${prefix}-complete`, 'fixed', priority), reward_received: directive(`${prefix}-reward`, 'free', priority) })

describe('quest settings', () => {
  it('selects the current stage directive for the target NPC by priority', () => {
    const settings = questSettingsSchema.parse({ ...defaultQuestSettings(), quests: [
      { id: 'low', name: '低優先', targetNpcId: 'npc0', stage: 'in_progress', directives: directives('low', 1) },
      { id: 'high', name: '高優先', targetNpcId: 'npc0', stage: 'objective_complete', directives: directives('high', 10) }
    ] })
    expect(activeQuestDirective(settings, 'npc0')).toMatchObject({ questId: 'high', stage: 'objective_complete', directive: { id: 'high-complete', mode: 'fixed' } })
    expect(activeQuestDirective(settings, 'npc1')).toBeUndefined()
  })

  it('defaults to player interaction and migrates string facts to structured facts', () => {
    const value = questSettingsSchema.parse({ version: 1, revision: 0, quests: [{ id: 'q', name: '依頼', targetNpcId: 'npc0', stage: 'in_progress', directives: {
      ...directives('q'), in_progress: { ...directive('q-progress', 'semi_fixed'), requiredFacts: ['meeting-time'] }
    } }] })
    expect(value.quests[0].directives.in_progress).toMatchObject({ trigger: 'player_interact', requiredFacts: [{ id: 'meeting-time', value: 'meeting-time', allowParaphrase: false }] })
  })

  it('uses quest kind ordering and rejects an equal-priority conflict', () => {
    const settings = questSettingsSchema.parse({ ...defaultQuestSettings(), quests: [
      { id: 'side', name: 'サイド', kind: 'side', targetNpcId: 'npc0', stage: 'before_acceptance', directives: directives('side', 999) },
      { id: 'main', name: 'メイン', kind: 'main', targetNpcId: 'npc0', stage: 'before_acceptance', directives: directives('main', -999) }
    ] })
    expect(activeQuestDirective(settings, 'npc0')?.questId).toBe('main')
    const conflict = questSettingsSchema.parse({ ...defaultQuestSettings(), quests: [
      { id: 'a', name: 'A', kind: 'side', targetNpcId: 'npc0', stage: 'before_acceptance', directives: directives('a') },
      { id: 'b', name: 'B', kind: 'side', targetNpcId: 'npc0', stage: 'before_acceptance', directives: directives('b') }
    ] })
    expect(() => activeQuestDirective(conflict, 'npc0')).toThrow(/競合/)
  })

  it('rejects duplicate quest, directive and Fact IDs', () => {
    const duplicatedQuest = { id: 'same', name: 'A', targetNpcId: 'npc0', stage: 'before_acceptance' as const, directives: directives('a') }
    expect(() => questSettingsSchema.parse({ ...defaultQuestSettings(), quests: [duplicatedQuest, { ...duplicatedQuest, name: 'B', directives: directives('b') }] })).toThrow(/クエストIDが重複/)
    const facts = directives('facts')
    const factsWithDuplicates = { ...facts, before_acceptance: { ...facts.before_acceptance, requiredFacts: ['duplicate', 'duplicate'] } }
    expect(() => questSettingsSchema.parse({ ...defaultQuestSettings(), quests: [{ ...duplicatedQuest, directives: factsWithDuplicates }] })).toThrow(/Fact IDが重複/)
  })
})
