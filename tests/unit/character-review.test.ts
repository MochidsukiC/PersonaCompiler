import { expect, it } from 'vitest'
import { buildCharacterReview, characterReviewMarkdown, characterReviewSchema } from '../../src/core/character-review'
import type { CompilerInput } from '../../src/core/compiler'
import type { CharacterPackage } from '../../src/core/compiler-contracts'
import { population } from '../backend/fixtures'

const input: CompilerInput = {
  identity: { ...population.npcs[0], sexCategory: 'female', generation: 0, bornTurn: 0, diedTurn: null },
  memories: [], relations: [], conversation: [{ id: 'turn:one', status: 'completed', items: [{ id: 'message', type: 'agentMessage', text: '本を明日返そう。' }] }],
  events: [{ sequence: 42, turn: 3, kind: 'speech', actorId: 'npc0', text: '明日本を返します。', recipients: ['npc1'], locationId: 'home', position: { x: 0, y: 0, z: 0 } }],
  evidenceIds: ['identity', 'conversation:turn:one', 'event:42']
}
const output: CharacterPackage = {
  npcId: 'npc0', lifeSummary: [{ text: '本を借りて返却を約束した。', evidence: ['event:42', 'conversation:turn:one'] }],
  personality: [{ text: '約束を大切にする。', evidence: ['event:42'] }], speechTendency: [], appearance: [], goals: [], behavior: [],
  schedule: [{ time: '翌日', activity: '本を返す', evidence: ['conversation:turn:one'] }], runtimeGuidance: 'これはゲームで使うための指針。',
  systemPrompt: 'この町で暮らした人物として応答する。', memoryIds: [], relationshipTargets: []
}

it('links claims to exact cited events and conversations while separating runtime guidance', () => {
  const review = buildCharacterReview(input, output, 15, 'fixture-model')
  expect(review.sources.map(s => s.id)).toEqual(['event:42', 'conversation:turn:one'])
  expect(JSON.parse(review.sources[0].text)).toMatchObject({ sequence: 42, recipients: ['npc1'], text: '明日本を返します。' })
  expect(JSON.parse(review.sources[1].text).items[0].text).toBe('本を明日返そう。')
  expect(review.sections.find(s => s.title === '予定')!.claims[0]).toEqual({ text: '翌日 · 本を返す', evidence: ['conversation:turn:one'] })
  expect(review.sections.flatMap(s => s.claims).some(c => c.text === output.runtimeGuidance)).toBe(false)
  const markdown = characterReviewMarkdown(review)
  expect(markdown).toContain('根拠: [1]、[2]')
  expect(markdown).toContain('### [1] 出来事 · turn 3 · speech')
  expect(markdown).toContain('## Runtime Prompt')
})

it('rejects evidence IDs without source material and broken review links', () => {
  expect(() => buildCharacterReview({ ...input, events: [] }, output, 15, 'fixture-model')).toThrow('根拠を解決できません: event:42')
  const review = buildCharacterReview(input, output, 15, 'fixture-model')
  expect(characterReviewSchema.safeParse({ ...review, sources: [] }).success).toBe(false)
  expect(characterReviewSchema.safeParse({ ...review, sources: [...review.sources, review.sources[0]] }).success).toBe(false)
})

it('keeps model-supplied HTML and Markdown as quoted text in the exported report', () => {
  const review = buildCharacterReview(input, { ...output, systemPrompt: '<script>alert(1)</script>\n[open](https://example.com)\n```html' }, 15, 'fixture-model')
  const markdown = characterReviewMarkdown(review)
  expect(markdown).not.toContain('<script>')
  expect(markdown).toContain('> \\<script\\>alert\\(1\\)\\</script\\>')
  expect(markdown).toContain('> \\[open\\]\\(https://example.com\\)')
  expect(markdown).not.toContain('```html')
})
