import type { CharacterReview } from './character-review'

type Source = CharacterReview['sources'][number]
interface Claim { section: string; text: string; sources: Source[] }
export interface ReviewComparison {
  unchanged: number
  changes: { kind: 'added' | 'removed' | 'evidence'; section: string; text: string; before: Source[]; after: Source[] }[]
  fields: { title: string; before: string; after: string }[]
}

export function compareCharacterReviews(before: CharacterReview, after: CharacterReview): ReviewComparison {
  if (before.npcId !== after.npcId) throw new Error(`比較するNPCが一致しません: ${before.npcId} / ${after.npcId}`)
  const claims = (review: CharacterReview): Claim[] => review.sections.flatMap(section => section.claims.map(claim => ({
    section: section.title, text: claim.text,
    sources: [...new Set(claim.evidence)].sort().map(id => review.sources.find(source => source.id === id)!)
  })))
  const remaining = claims(after)
  const result: ReviewComparison = { unchanged: 0, changes: [], fields: [] }
  const pending: Claim[] = []
  const sourceKey = (claim: Claim) => JSON.stringify(claim.sources.map(source => [source.id, source.title, source.text]))
  for (const previous of claims(before)) {
    const index = remaining.findIndex(current => current.section === previous.section && current.text === previous.text && sourceKey(current) === sourceKey(previous))
    if (index < 0) pending.push(previous)
    else { remaining.splice(index, 1); result.unchanged++ }
  }
  for (const previous of pending) {
    const index = remaining.findIndex(current => current.section === previous.section && current.text === previous.text)
    if (index < 0) result.changes.push({ kind: 'removed', section: previous.section, text: previous.text, before: previous.sources, after: [] })
    else {
      const [current] = remaining.splice(index, 1)
      result.changes.push({ kind: 'evidence', section: current.section, text: current.text, before: previous.sources, after: current.sources })
    }
  }
  for (const current of remaining) result.changes.push({ kind: 'added', section: current.section, text: current.text, before: [], after: current.sources })
  for (const [key, title] of [['name', '名前'], ['sourceRevision', '世界revision'], ['modelId', '生成モデル'], ['memoryCount', '採用記憶の件数'], ['relationshipCount', '関係の件数'], ['runtimeGuidance', 'Runtime向けの指針'], ['systemPrompt', 'Runtime Prompt']] as const) {
    if (before[key] !== after[key]) result.fields.push({ title, before: String(before[key]), after: String(after[key]) })
  }
  return result
}
