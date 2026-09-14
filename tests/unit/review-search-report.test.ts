import { expect, it } from 'vitest'
import type { CharacterReview } from '../../src/core/character-review'
import { searchCharacterReview } from '../../src/core/review-search'
import { reviewSearchMarkdown } from '../../src/core/review-search-report'

const review: CharacterReview = { version: 1, npcId: 'actor:any', name: '合成資料', sourceRevision: 8, modelId: 'fixture', memoryCount: 0, relationshipCount: 0,
  sections: [{ title: '分岐', claims: [{ text: '相手を待つ', evidence: ['Script:Route-B/phase-2', 'translation:line-7'] }, { text: '扉を開ける', evidence: ['unused'] }] },
    { title: '話し方', claims: [{ text: '理由を説明する', evidence: ['Script:Route-B/phase-2'] }] }],
  sources: [{ id: 'Script:Route-B/phase-2', title: '保存台本', text: '青い扉で相談した' }, { id: 'translation:line-7', title: '別言語の記録', text: '根拠の補足' }, { id: 'unused', title: '別資料', text: '無関係な記録' }],
  runtimeGuidance: '指針は検索対象外', systemPrompt: 'Promptは検索対象外' }
const input = { runId: 'world', path: 'compilation/test/npcs/actor/review.json', hash: 'a'.repeat(64), review, query: ' 青い扉 ', scope: 'evidence' as const }
const parse = (markdown: string) => {
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(1)
  return JSON.parse(blocks[0][1])
}

it('exports matching settings with every cited source and exact original reference metadata', () => {
  const before = structuredClone(review)
  const report = reviewSearchMarkdown(input, '2026-09-14T03:00:00.000Z')
  const data = parse(report)
  expect(data).toMatchObject({ version: 1, runId: 'world', capturedAt: '2026-09-14T03:00:00.000Z', query: { text: input.query, scope: 'evidence' }, totalClaims: 3, matchedClaims: 2,
    source: { path: input.path, hash: input.hash, npcId: review.npcId, name: review.name, sourceRevision: 8, modelId: 'fixture' } })
  expect(data.sections.flatMap((section: CharacterReview['sections'][number]) => section.claims)).toEqual([review.sections[0].claims[0], review.sections[1].claims[0]])
  expect(data.sources).toEqual(review.sources.slice(0, 2))
  expect(report).not.toContain('無関係な記録')
  expect(report).not.toContain(review.systemPrompt)
  expect(report).not.toContain(review.runtimeGuidance)
  expect(review).toEqual(before)
})

it.each([
  { scope: 'claims' as const, query: '分岐', expected: 2 },
  { scope: 'evidence' as const, query: '  SCRIPT:route-b/PHASE-2 ', expected: 2 },
  { scope: 'all' as const, query: '扉', expected: 3 }
])('uses the same $scope search for the screen and report', ({ scope, query, expected }) => {
  const result = searchCharacterReview(review, query, scope)
  const data = parse(reviewSearchMarkdown({ ...input, query, scope }, 'now'))
  expect(data.matchedClaims).toBe(expected)
  expect(data.sections).toEqual(result.sections.filter(section => section.claims.length))
})

it('records zero matches honestly and includes all settings for an empty query', () => {
  const empty = parse(reviewSearchMarkdown({ ...input, query: '存在しない' }, 'now'))
  expect(empty).toMatchObject({ totalClaims: 3, matchedClaims: 0, sections: [], sources: [] })
  const all = parse(reviewSearchMarkdown({ ...input, query: '  ' }, 'now'))
  expect(all).toMatchObject({ totalClaims: 3, matchedClaims: 3, sections: review.sections, sources: review.sources })
})

it('quotes arbitrary Markdown and HTML without losing the original values in JSON', () => {
  const text = '<img src=x onerror=alert(1)>\n```json\n[open](https://example.com)\n# title'
  const changed = { ...review, name: text, sections: [{ title: text, claims: [{ text, evidence: ['script:arbitrary'] }] }], sources: [{ id: 'script:arbitrary', title: text, text }] }
  const markdown = reviewSearchMarkdown({ ...input, review: changed, query: '' }, 'now')
  expect(markdown.split('```json')[0]).not.toContain('<img src=x onerror=alert(1)>')
  expect(markdown.split('```json')[0]).toContain('> \\<img src=x onerror=alert\\(1\\)\\>')
  expect(markdown.split('```json')[0]).not.toContain('[open](https://example.com)')
  expect(parse(markdown).sections).toEqual(changed.sections)
  expect(parse(markdown).sources).toEqual(changed.sources)
})
