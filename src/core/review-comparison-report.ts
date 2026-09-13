import type { CharacterReview } from './character-review'
import { compareCharacterReviews } from './review-comparison'

export interface ReviewComparisonReportInput {
  runId: string
  before: { path: string; hash: string; review: CharacterReview }
  after: { path: string; hash: string; review: CharacterReview }
}

export function reviewComparisonMarkdown(input: ReviewComparisonReportInput, capturedAt: string): string {
  const comparison = compareCharacterReviews(input.before.review, input.after.review)
  const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&')
  const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${escape(line)}`).join('\n')
  const labels = { added: '追加', removed: '削除', evidence: '根拠変更' }
  const lines = ['# NPC制作レビューの比較レポート', '', '形式: persona-review-comparison/v1', '',
    quote(`ワールドID: ${input.runId}\nNPC ID: ${input.after.review.npcId}\n採取時刻: ${capturedAt}`), '',
    '比較方向は「基準 → 現在」です。読み込み済みの資料を記録しており、ディスク上の最新版を保証しません。', '']
  for (const [title, artifact] of [['基準', input.before], ['現在', input.after]] as const) {
    lines.push(`## ${title}の資料`, '', quote(`ファイル: ${artifact.path}\nファイルのSHA-256: ${artifact.hash}\n名前: ${artifact.review.name}\n世界revision: ${artifact.review.sourceRevision}\n生成モデル: ${artifact.review.modelId}`), '')
  }
  lines.push('## 変更件数', '', `追加 ${comparison.changes.filter(c => c.kind === 'added').length}件 · 削除 ${comparison.changes.filter(c => c.kind === 'removed').length}件 · 根拠変更 ${comparison.changes.filter(c => c.kind === 'evidence').length}件 · 設定一致 ${comparison.unchanged}件`, '',
    '文章が変わった設定は削除と追加で表します。意味の同一性・解釈の妥当性・品質は判定しません。採用記憶・関係は件数のみの比較です。', '')
  if (!comparison.changes.length && !comparison.fields.length) lines.push('比較対象の設定・根拠・指針・メタデータは一致しています。', '')
  comparison.changes.forEach((change, index) => {
    lines.push(`## 設定の変更 ${index + 1} · ${labels[change.kind]}`, '', quote(`区分: ${change.section}`), '', quote(change.text), '')
    for (const [title, sources] of [['基準の根拠', change.before], ['現在の根拠', change.after]] as const) {
      lines.push(`### ${title}`, '')
      if (!sources.length) lines.push('設定なし', '')
      for (const source of sources) lines.push(quote(`${source.title}\nID: ${source.id}`), '', quote(source.text), '')
    }
  })
  for (const field of comparison.fields) lines.push(`## ${field.title}の変更`, '', '### 基準', '', quote(field.before), '', '### 現在', '', quote(field.after), '')
  lines.push('## 比較結果と読み込み済み資料のJSON', '',
    'ファイルのhashは読み込んだ元ファイルのバイト列に対するものです。以下のJSONは検証済みの制作レビューデータで、元ファイルの整形や未知の項目は保持しません。', '',
    '```json', JSON.stringify({ version: 1, capturedAt, ...input, comparison }, null, 2), '```', '')
  return lines.join('\n')
}
