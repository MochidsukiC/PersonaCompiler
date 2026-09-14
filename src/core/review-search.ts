import type { CharacterReview } from './character-review'

export type ReviewSearchScope = 'claims' | 'evidence' | 'all'

export function searchCharacterReview(review: CharacterReview, query: string, scope: ReviewSearchScope) {
  const search = query.trim().toLocaleLowerCase()
  const matchingSources = new Set(review.sources.filter(source => `${source.id} ${source.title} ${source.text}`.toLocaleLowerCase().includes(search)).map(source => source.id))
  const sections = review.sections.map(section => ({ ...section, claims: section.claims.filter(claim => !search
    || (scope !== 'evidence' && `${section.title} ${claim.text}`.toLocaleLowerCase().includes(search))
    || (scope !== 'claims' && claim.evidence.some(id => matchingSources.has(id)))) }))
  return { search, matchingSources, sections, count: review.sections.reduce((n, s) => n + s.claims.length, 0), visible: sections.reduce((n, s) => n + s.claims.length, 0) }
}
