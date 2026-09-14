import type { CharacterReview } from './character-review'

export interface ReviewFullReportInput {
  runId: string
  path: string
  hash: string
  review: CharacterReview
}

export function reviewFullMarkdown(input: ReviewFullReportInput, capturedAt: string): string {
  const { review } = input
  const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&')
  const quote = (text: string) => text.split(/\r\n?|\n/).map(line => `> ${escape(line)}`).join('\n')
  const count = review.sections.reduce((total, section) => total + section.claims.length, 0)
  const lines = ['# NPC制作レビューの全体レポート', '', '形式: persona-review-full/v1', '',
    quote(`ワールドID: ${input.runId}\nNPC: ${review.name} (${review.npcId})\n採取時刻: ${capturedAt}\nファイル: ${input.path}\n元ファイルのSHA-256: ${input.hash}\n世界revision: ${review.sourceRevision}\n生成モデル: ${review.modelId}`), '',
    `設定 ${count}件 · 根拠資料 ${review.sources.length}件 · 採用記憶 ${review.memoryCount}件 · 関係 ${review.relationshipCount}件`, '',
    '読み込み済みの制作レビュー全体です。画面の検索条件は適用せず、空の区分・未引用の根拠資料・Runtime向けの指針・Runtime Promptも収録します。', '',
    'コピー時の再読み込みは行わず、ディスク上の最新版は保証しません。根拠の存在とモデルの解釈の妥当性は別です。内容を確認してゲームへの採用を判断してください。', '']
  review.sections.forEach((section, index) => {
    lines.push(`## 設定の区分 ${index + 1}`, '', quote(section.title), '')
    if (!section.claims.length) lines.push('設定はありません。', '')
    for (const claim of section.claims) lines.push(quote(claim.text), '', quote(`根拠ID: ${claim.evidence.join('、')}`), '')
  })
  lines.push('## Runtime向けの指針', '', quote(review.runtimeGuidance), '', '## Runtime Prompt', '', quote(review.systemPrompt), '', '## 全根拠資料', '')
  review.sources.forEach((source, index) => lines.push(`### 根拠 ${index + 1}`, '', quote(`${source.title}\nID: ${source.id}`), '', quote(source.text), ''))
  lines.push('## 制作レビュー全体のJSON', '',
    'hashは読み込んだ元ファイル全体のバイト列に対するものです。以下のJSONには、形式検証を通過した既知の項目を収録します。元ファイルの整形や未知の項目は保持しません。', '',
    '```json', JSON.stringify({ format: 'persona-review-full/v1', capturedAt, runId: input.runId, source: { path: input.path, hash: input.hash }, review }, null, 2), '```', '')
  return lines.join('\n')
}
