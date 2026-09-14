import type { CharacterReview } from './character-review'
import { searchCharacterReview, type ReviewSearchScope } from './review-search'

export interface ReviewSearchReportInput {
  runId: string
  path: string
  hash: string
  review: CharacterReview
  query: string
  scope: ReviewSearchScope
}

export function reviewSearchMarkdown(input: ReviewSearchReportInput, capturedAt: string): string {
  const result = searchCharacterReview(input.review, input.query, input.scope)
  const sections = result.sections.filter(section => section.claims.length)
  const cited = new Set(sections.flatMap(section => section.claims.flatMap(claim => claim.evidence)))
  const sources = input.review.sources.filter(source => cited.has(source.id))
  const labels = { claims: '設定本文・見出し', evidence: '根拠資料', all: '設定と根拠資料' }
  const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&')
  const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${escape(line)}`).join('\n')
  const data = { version: 1, capturedAt, runId: input.runId,
    source: { path: input.path, hash: input.hash, npcId: input.review.npcId, name: input.review.name, sourceRevision: input.review.sourceRevision, modelId: input.review.modelId },
    query: { text: input.query, scope: input.scope }, totalClaims: result.count, matchedClaims: result.visible, sections, sources }
  const lines = ['# NPC設定の検索レポート', '', '形式: persona-review-search/v1', '',
    quote(`ワールドID: ${input.runId}\nNPC: ${input.review.name} (${input.review.npcId})\n採取時刻: ${capturedAt}\nファイル: ${input.path}\n元ファイルのSHA-256: ${input.hash}\n世界revision: ${input.review.sourceRevision}\n生成モデル: ${input.review.modelId}`), '',
    '## 検索条件', '', quote(`対象: ${labels[input.scope]}\nキーワード: ${input.query}`), '',
    `${result.visible} / ${result.count}件の設定。前後の空白を除去し、大文字・小文字を区別せず文字列を検索します。空の検索条件では全設定を収録します。`, '',
    '読み込み済み資料から抽出した設定と、その設定が参照する全根拠を収録します。検索に一致しない根拠も含みます。解釈の妥当性・品質は判定しません。', '']
  if (!result.visible) lines.push('検索結果は0件です。', '')
  for (const section of sections) {
    lines.push('## 設定の区分', '', quote(section.title), '')
    for (const claim of section.claims) lines.push(quote(claim.text), '', quote(`根拠ID: ${[...new Set(claim.evidence)].join('、')}`), '')
  }
  lines.push('## 参照した根拠資料', '')
  for (const source of sources) lines.push(quote(`${source.title}\nID: ${source.id}`), '', quote(source.text), '')
  lines.push('## 検索結果のJSON', '',
    'hashは読み込んだ元ファイル全体のバイト列に対するものです。この抜粋JSONのhashではありません。ディスク上の最新版は保証しません。Runtime Prompt・検索対象外の設定は収録しません。', '',
    '```json', JSON.stringify(data, null, 2), '```', '')
  return lines.join('\n')
}
