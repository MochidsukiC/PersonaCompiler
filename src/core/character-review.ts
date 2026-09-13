import { z } from 'zod'
import type { CompilerInput } from './compiler'
import type { CharacterPackage } from './compiler-contracts'

export const characterReviewSchema = z.object({
  version: z.literal(1), npcId: z.string(), name: z.string(), sourceRevision: z.number().int(), modelId: z.string(),
  memoryCount: z.number().int().nonnegative(), relationshipCount: z.number().int().nonnegative(),
  sections: z.array(z.object({ title: z.string(), claims: z.array(z.object({ text: z.string(), evidence: z.array(z.string()).min(1) })) })),
  sources: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })),
  runtimeGuidance: z.string(), systemPrompt: z.string()
}).superRefine((value, context) => {
  const ids = new Set(value.sources.map(s => s.id))
  if (ids.size !== value.sources.length) context.addIssue({ code: 'custom', message: '制作レビューの根拠IDが重複しています' })
  for (const section of value.sections) for (const claim of section.claims) for (const id of claim.evidence) {
    if (!ids.has(id)) context.addIssue({ code: 'custom', message: `制作レビューの根拠がありません: ${id}` })
  }
})
export type CharacterReview = z.infer<typeof characterReviewSchema>

export function buildCharacterReview(input: CompilerInput, result: CharacterPackage, sourceRevision: number, modelId: string): CharacterReview {
  const sections = [
    { title: '人生の要約', claims: result.lifeSummary }, { title: '人格', claims: result.personality },
    { title: '話し方', claims: result.speechTendency }, { title: '外見', claims: result.appearance },
    { title: '目標', claims: result.goals }, { title: '観測された行動', claims: result.behavior },
    { title: '予定', claims: result.schedule.map(s => ({ text: `${s.time} · ${s.activity}`, evidence: s.evidence })) }
  ]
  const references = [...new Set(sections.flatMap(s => s.claims.flatMap(c => c.evidence)))]
  const sources = new Map<string, CharacterReview['sources'][number]>()
  const add = (id: string, title: string, value: unknown) => {
    if (references.includes(id)) sources.set(id, { id, title, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) })
  }
  add('identity', '人物の初期条件・現在の属性', input.identity)
  for (const memory of input.memories) add(`memory:${memory.id}:${memory.revision}`, `本人の記憶 · 整理 turn ${memory.organizedTurn} · revision ${memory.revision}`, memory)
  for (const relation of input.relations) add(`relation:${relation.target}`, `本人から ${relation.target} への認識`, relation)
  for (const turn of input.conversation) add(`conversation:${turn.id}`, `本人のConversation · ${turn.status}`, turn)
  for (const event of input.events) add(`event:${event.sequence}`, `出来事 · turn ${event.turn} · ${event.kind}`, event)
  const cited = references.map(id => {
    const source = sources.get(id)
    if (!source || !input.evidenceIds.includes(id)) throw new Error(`制作レビューの根拠を解決できません: ${id}`)
    return source
  })
  return characterReviewSchema.parse({ version: 1, npcId: result.npcId, name: input.identity.name, sourceRevision, modelId,
    memoryCount: result.memoryIds.length, relationshipCount: result.relationshipTargets.length,
    sections, sources: cited, runtimeGuidance: result.runtimeGuidance, systemPrompt: result.systemPrompt })
}

export function characterReviewMarkdown(review: CharacterReview): string {
  const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&')
  const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${escape(line)}`).join('\n')
  const number = (id: string) => review.sources.findIndex(s => s.id === id) + 1
  const lines = ['# NPC制作レビュー', '', quote(`${review.name} (${review.npcId})`), '',
    `世界revision ${review.sourceRevision} · モデル ${escape(review.modelId)}`, '',
    `採用記憶 ${review.memoryCount}件 · 関係 ${review.relationshipCount}件`, '',
    '根拠はCompilation時点の保存資料です。参照の存在と、解釈の妥当性は別です。内容を確認してゲームへ採用してください。', '']
  for (const section of review.sections) {
    lines.push(`## ${section.title}`, '')
    if (!section.claims.length) lines.push('生成された設定はありません。', '')
    for (const claim of section.claims) lines.push(quote(claim.text), '', `根拠: ${claim.evidence.map(id => `[${number(id)}]`).join('、')}`, '')
  }
  lines.push('## Runtime向けの指針', '', quote(review.runtimeGuidance), '', '## Runtime Prompt', '', quote(review.systemPrompt), '', '## 根拠資料', '')
  review.sources.forEach((source, index) => lines.push(`### [${index + 1}] ${escape(source.title)}`, '', quote(source.id), '', quote(source.text), ''))
  return lines.join('\n')
}
