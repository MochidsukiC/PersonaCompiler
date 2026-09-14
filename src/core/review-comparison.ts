import type { CharacterReview } from './character-review'

type Source = CharacterReview['sources'][number]
interface Claim { section: string; text: string; sources: Source[]; identity: string; exact: string; matched: boolean }
export interface ReviewComparison {
  unchanged: number
  changes: { kind: 'added' | 'removed' | 'evidence'; section: string; text: string; before: Source[]; after: Source[] }[]
  fields: { title: string; before: string; after: string }[]
}

export function compareCharacterReviews(before: CharacterReview, after: CharacterReview): ReviewComparison {
  if (before.npcId !== after.npcId) throw new Error(`比較するNPCが一致しません: ${before.npcId} / ${after.npcId}`)
  const sourceKeys = new Map<string, number>()
  const claims = (review: CharacterReview): Claim[] => {
    const sources = new Map(review.sources.map(source => {
      const key = JSON.stringify([source.id, source.title, source.text])
      if (!sourceKeys.has(key)) sourceKeys.set(key, sourceKeys.size)
      return [source.id, { source, key: sourceKeys.get(key)! }] as const
    }))
    return review.sections.flatMap(section => section.claims.map(claim => {
      const evidence = [...new Set(claim.evidence)].sort().map(id => sources.get(id)!)
      return { section: section.title, text: claim.text, sources: evidence.map(item => item.source),
        identity: JSON.stringify([section.title, claim.text]), exact: JSON.stringify([section.title, claim.text, evidence.map(item => item.key)]), matched: false }
    }))
  }
  const remaining = claims(after)
  const exact = new Map<string, Claim[]>()
  for (const current of [...remaining].reverse()) {
    const entries = exact.get(current.exact) ?? []
    entries.push(current); exact.set(current.exact, entries)
  }
  const result: ReviewComparison = { unchanged: 0, changes: [], fields: [] }
  const pending: Claim[] = []
  for (const previous of claims(before)) {
    const current = exact.get(previous.exact)?.pop()
    if (!current) pending.push(previous)
    else { current.matched = true; result.unchanged++ }
  }
  const changed = new Map<string, Claim[]>()
  for (const current of [...remaining].reverse()) if (!current.matched) {
    const entries = changed.get(current.identity) ?? []
    entries.push(current); changed.set(current.identity, entries)
  }
  for (const previous of pending) {
    const current = changed.get(previous.identity)?.pop()
    if (!current) result.changes.push({ kind: 'removed', section: previous.section, text: previous.text, before: previous.sources, after: [] })
    else {
      current.matched = true
      result.changes.push({ kind: 'evidence', section: current.section, text: current.text, before: previous.sources, after: current.sources })
    }
  }
  for (const current of remaining) if (!current.matched) result.changes.push({ kind: 'added', section: current.section, text: current.text, before: [], after: current.sources })
  for (const [key, title] of [['name', '名前'], ['sourceRevision', '世界revision'], ['modelId', '生成モデル'], ['memoryCount', '採用記憶の件数'], ['relationshipCount', '関係の件数'], ['runtimeGuidance', 'Runtime向けの指針'], ['systemPrompt', 'Runtime Prompt']] as const) {
    if (before[key] !== after[key]) result.fields.push({ title, before: String(before[key]), after: String(after[key]) })
  }
  return result
}
