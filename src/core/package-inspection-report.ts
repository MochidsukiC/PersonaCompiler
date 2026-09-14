import type { CharacterPackageInspection } from './compiler-contracts'

export function packageInspectionMarkdown(inspection: CharacterPackageInspection): string {
  const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&')
  const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${escape(line)}`).join('\n')
  const labels = { match: '一致', changed: '内容変更', missing: '欠損' }
  const count = (status: CharacterPackageInspection['files'][number]['status']) => inspection.files.filter(file => file.status === status).length
  const lines = ['# NPCパッケージ照合レポート', '', '形式: persona-package-inspection/v1', '',
    quote(`ワールドID: ${inspection.runId}\nNPC ID: ${inspection.npcId}\n世界revision: ${inspection.sourceRevision}\n生成モデル: ${inspection.modelId}\n照合時刻: ${inspection.checkedAt}`), '',
    `全${inspection.files.length}ファイル · 一致 ${count('match')}件 · 内容変更 ${count('changed')}件 · 欠損 ${count('missing')}件`, '',
    '照合時に読み込んだファイルの記録です。コピー時の再照合は行いません。各ファイルを順番に読み込むため、全ファイルが同時刻の状態であることは保証しません。', '',
    '## 照合に使用したmanifest', '', quote(`ファイル: ${inspection.manifestPath}\nSHA-256: ${inspection.manifestHash}\n記録された入力hash: ${inspection.inputHash}\n記録されたプロンプトhash: ${inspection.promptHash}`), '',
    '入力・プロンプトのhashはmanifestの記録値です。元資料との照合や、manifestの真正性・内容の意味的な品質の判定は行いません。', '', '## ファイルの照合結果', '']
  for (const file of inspection.files) lines.push(quote(`${file.path}\n結果: ${labels[file.status]}\nmanifestのSHA-256: ${file.expectedHash}\n読み込んだSHA-256: ${file.actualHash ?? '取得できません'}\nサイズ: ${file.bytes === null ? '取得できません' : `${file.bytes} bytes`}`), '')
  lines.push('## 照合結果のJSON', '', '```json', JSON.stringify({ format: 'persona-package-inspection/v1', ...inspection }, null, 2), '```', '')
  return lines.join('\n')
}
