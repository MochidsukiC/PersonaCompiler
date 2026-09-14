import { expect, it } from 'vitest'
import type { CharacterReview } from '../../src/core/character-review'
import { reviewFullMarkdown } from '../../src/core/review-full-report'

const review: CharacterReview = { version: 1, npcId: 'actor:any', name: '合成資料', sourceRevision: 8, modelId: 'fixture', memoryCount: 2, relationshipCount: 1,
  sections: [{ title: '経路', claims: [{ text: '相手を待つ', evidence: ['script:A', 'translation:B'] }] }, { title: '経路', claims: [] }],
  sources: [{ id: 'script:A', title: '台本', text: '青い扉で相談した' }, { id: 'translation:B', title: '翻訳', text: '補足資料' }, { id: 'unused', title: '未引用', text: '残しておく資料' }],
  runtimeGuidance: '指針の全文', systemPrompt: 'Promptの全文' }
const input = { runId: 'world', path: 'compilation/test/npcs/actor/review.json', hash: 'a'.repeat(64), review }
const parse = (markdown: string) => {
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(1)
  return JSON.parse(blocks[0][1])
}

it('exports the complete review including empty duplicate sections, unused sources and runtime instructions', () => {
  const before = structuredClone(input)
  const capturedAt = '2026-09-14T05:00:00.000Z'
  const markdown = reviewFullMarkdown(input, capturedAt)
  expect(parse(markdown)).toEqual({ format: 'persona-review-full/v1', capturedAt, runId: input.runId, source: { path: input.path, hash: input.hash }, review })
  for (const text of ['設定 1件 · 根拠資料 3件', '採用記憶 2件 · 関係 1件', '設定はありません。', '残しておく資料', '指針の全文', 'Promptの全文']) expect(markdown).toContain(text)
  expect(input).toEqual(before)
})

it('preserves an empty review without inventing content', () => {
  const empty = { ...review, memoryCount: 0, relationshipCount: 0, sections: [], sources: [], runtimeGuidance: '', systemPrompt: '' }
  const markdown = reviewFullMarkdown({ ...input, review: empty }, 'now')
  expect(parse(markdown).review).toEqual(empty)
  expect(markdown).toContain('設定 0件 · 根拠資料 0件')
})

it('quotes arbitrary metadata, headings, citations and prompt text while preserving exact JSON values', () => {
  const text = '<img src=x onerror=alert(1)>\n```json\n[open](https://example.com)\n# title\r# carriage-return title'
  const changed = { ...review, name: text, npcId: text, modelId: text, sections: [{ title: text, claims: [{ text, evidence: [text] }] }], sources: [{ id: text, title: text, text }], runtimeGuidance: text, systemPrompt: text }
  const markdown = reviewFullMarkdown({ runId: text, path: text, hash: input.hash, review: changed }, text)
  const prose = markdown.split('```json')[0]
  expect(prose).not.toContain('<img src=x onerror=alert(1)>')
  expect(prose).not.toContain('[open](https://example.com)')
  expect(prose).not.toContain('\n# title')
  expect(prose).not.toContain('\r')
  expect(prose).toContain('> \\<img src=x onerror=alert\\(1\\)\\>')
  expect(parse(markdown)).toEqual({ format: 'persona-review-full/v1', capturedAt: text, runId: text, source: { path: text, hash: input.hash }, review: changed })
})
