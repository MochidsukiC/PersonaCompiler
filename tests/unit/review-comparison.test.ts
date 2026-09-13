import { expect, it } from 'vitest'
import { characterReviewSchema, type CharacterReview } from '../../src/core/character-review'
import { compareCharacterReviews } from '../../src/core/review-comparison'

const review = (): CharacterReview => characterReviewSchema.parse({
  version: 1, npcId: 'npc0', name: '葵', sourceRevision: 1, modelId: 'fixture', memoryCount: 2, relationshipCount: 1,
  sections: [{ title: '人格', claims: [{ text: '約束を大切にする', evidence: ['a', 'b'] }, { text: '工房で働く', evidence: ['a'] }] }],
  sources: [{ id: 'a', title: '出来事', text: '明日、返します' }, { id: 'b', title: '記憶', text: '返却の約束' }], runtimeGuidance: '工房を探す', systemPrompt: '人物として応答する'
})

it('compares changed settings and runtime instructions without interpreting game-specific content', () => {
  const before = review(), after = review()
  after.sections[0].claims[1].text = '宇宙船を修理する'
  after.systemPrompt = '船員として応答する'
  after.sourceRevision = 3
  after.memoryCount = 3
  const result = compareCharacterReviews(before, after)
  expect(result.unchanged).toBe(1)
  expect(result.changes.map(c => [c.kind, c.text])).toEqual([['removed', '工房で働く'], ['added', '宇宙船を修理する']])
  expect(result.fields.map(f => [f.title, f.before, f.after])).toEqual([['世界revision', '1', '3'], ['採用記憶の件数', '2', '3'], ['Runtime Prompt', '人物として応答する', '船員として応答する']])
  expect(() => compareCharacterReviews(before, { ...after, npcId: 'other' })).toThrow('NPCが一致しません')
})

it('ignores citation ordering but detects changed source text with the same evidence ID', () => {
  const before = review(), after = review()
  after.sections[0].claims[0].evidence = ['b', 'a', 'a']
  after.sources.reverse()
  expect(compareCharacterReviews(before, after)).toEqual({ unchanged: 2, changes: [], fields: [] })
  after.sources.find(s => s.id === 'b')!.text = '約束は取り消した'
  const result = compareCharacterReviews(before, after)
  expect(result.unchanged).toBe(1)
  expect(result.changes).toHaveLength(1)
  expect(result.changes[0]).toMatchObject({ kind: 'evidence', text: '約束を大切にする' })
  expect(result.changes[0].before[1].text).toBe('返却の約束')
  expect(result.changes[0].after[1].text).toBe('約束は取り消した')
})

it('matches unchanged duplicates before pairing changed evidence and preserves section identity', () => {
  const before = review(), after = review()
  before.sections[0].claims = [{ text: '同じ文', evidence: ['a'] }, { text: '同じ文', evidence: ['b'] }]
  after.sections[0].claims = [{ text: '同じ文', evidence: ['b'] }]
  const result = compareCharacterReviews(before, after)
  expect(result.unchanged).toBe(1)
  expect(result.changes).toEqual([{ kind: 'removed', section: '人格', text: '同じ文', before: [before.sources[0]], after: [] }])
  after.sections[0].title = '目標'
  expect(compareCharacterReviews(before, after).changes.map(c => c.kind)).toEqual(['removed', 'removed', 'added'])
})
