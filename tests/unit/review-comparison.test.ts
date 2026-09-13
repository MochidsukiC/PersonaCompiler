import { expect, it } from 'vitest'
import { characterReviewSchema, type CharacterReview } from '../../src/core/character-review'
import { compareCharacterReviews } from '../../src/core/review-comparison'
import { reviewComparisonMarkdown, type ReviewComparisonReportInput } from '../../src/core/review-comparison-report'

const review = (): CharacterReview => characterReviewSchema.parse({
  version: 1, npcId: 'npc0', name: '葵', sourceRevision: 1, modelId: 'fixture', memoryCount: 2, relationshipCount: 1,
  sections: [{ title: '人格', claims: [{ text: '約束を大切にする', evidence: ['a', 'b'] }, { text: '工房で働く', evidence: ['a'] }] }],
  sources: [{ id: 'a', title: '出来事', text: '明日、返します' }, { id: 'b', title: '記憶', text: '返却の約束' }], runtimeGuidance: '工房を探す', systemPrompt: '人物として応答する'
})

const reportInput = (): ReviewComparisonReportInput => ({ runId: 'world-1', before: { path: 'compilation/a/npcs/npc0/review.json', hash: 'before-hash', review: review() }, after: { path: 'compilation/b/npcs/npc0/review.json', hash: 'after-hash', review: review() } })

it('exports comparison direction, provenance, both evidence snapshots and changed runtime instructions', () => {
  const input = reportInput()
  input.after.review.sections[0].claims[1].text = '宇宙船を修理する'
  input.after.review.sources[1].text = '約束を取り消した'
  input.after.review.systemPrompt = '船員として応答する'
  const report = reviewComparisonMarkdown(input, '2026-09-14T01:00:00Z')
  expect(report).toContain('ワールドID: world-1')
  expect(report).toContain('追加 1件 · 削除 1件 · 根拠変更 1件 · 設定一致 0件')
  expect(report).toContain('## Runtime Promptの変更')
  const blocks = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(1)
  expect(JSON.parse(blocks[0][1])).toEqual({ version: 1, capturedAt: '2026-09-14T01:00:00Z', ...input, comparison: compareCharacterReviews(input.before.review, input.after.review) })
})

it('records unchanged reviews and rejects a different NPC in the report', () => {
  const input = reportInput()
  const report = reviewComparisonMarkdown(input, 'now')
  expect(report).toContain('比較対象の設定・根拠・指針・メタデータは一致しています。')
  expect(report).toContain('採用記憶・関係は件数のみの比較')
  expect(report).toContain('元ファイルの整形や未知の項目は保持しません')
  input.before.review.npcId = 'other'
  expect(() => reviewComparisonMarkdown(input, 'now')).toThrow('NPCが一致しません')
})

it('quotes untrusted review content and preserves its exact value in the JSON snapshot', () => {
  const input = reportInput(), hostile = '<script>alert(1)</script>\n```\n# forged\n[link](https://example.com)'
  input.after.review.sections[0].title = hostile
  input.after.review.sections[0].claims[0].text = hostile
  input.after.review.sources[0].text = hostile
  input.after.review.systemPrompt = hostile
  const report = reviewComparisonMarkdown(input, 'now')
  const blocks = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(1)
  expect(JSON.parse(blocks[0][1]).after.review).toEqual(input.after.review)
  const prose = report.replace(/```json\n[\s\S]*?\n```/g, '')
  expect(prose).not.toContain('<script>')
  expect(prose).not.toContain('\n# forged')
  expect(prose).toContain('> \\# forged')
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
