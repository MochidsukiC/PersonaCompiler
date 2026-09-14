import type { CharacterPackageInspection } from './compiler-contracts'

type File = CharacterPackageInspection['files'][number]
export type PackageFileChange = 'added' | 'removed' | 'changed' | 'same' | 'unavailable'
export interface PackageComparison {
  files: { path: string; kind: PackageFileChange; before: File | null; after: File | null }[]
}
export const packageChangeLabels = { added: '追加', removed: '削除', changed: '内容変更', same: '内容一致', unavailable: '比較不能（欠損）' }

export function compareCharacterPackages(before: CharacterPackageInspection, after: CharacterPackageInspection): PackageComparison {
  if (before.runId !== after.runId || before.npcId !== after.npcId) throw new Error('比較するワールドまたはNPCが一致しません')
  const previous = new Map(before.files.map(file => [file.path, file]))
  const current = new Map(after.files.map(file => [file.path, file]))
  return { files: [...new Set([...previous.keys(), ...current.keys()])].sort().map(path => {
    const a = previous.get(path) ?? null, b = current.get(path) ?? null
    const kind: PackageFileChange = a?.actualHash === null || b?.actualHash === null ? 'unavailable'
      : !a ? 'added' : !b ? 'removed' : a.actualHash === b.actualHash ? 'same' : 'changed'
    return { path, kind, before: a, after: b }
  }) }
}

export function packageComparisonSummary(comparison: PackageComparison): string {
  return (['added', 'removed', 'changed', 'same', 'unavailable'] as const).map(kind => `${packageChangeLabels[kind]} ${comparison.files.filter(file => file.kind === kind).length}件`).join(' · ')
}

export function packageComparisonMarkdown(before: CharacterPackageInspection, after: CharacterPackageInspection, capturedAt: string): string {
  const comparison = compareCharacterPackages(before, after)
  const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&')
  const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${escape(line)}`).join('\n')
  const lines = ['# NPCパッケージのファイル比較', '', '形式: persona-package-comparison/v1', '',
    quote(`ワールドID: ${after.runId}\nNPC ID: ${after.npcId}\nレポート採取時刻: ${capturedAt}`), '', packageComparisonSummary(comparison), '',
    '比較方向は「基準 → 現在」です。両manifestに登録されたパスの集合と、照合時に読み込んだバイト列のSHA-256を比較します。未登録ファイルは対象外です。改名は削除と追加になります。', '',
    '「内容一致」は両側の実ファイルの一致です。manifestとの一致とは別であり、両側とも外部変更された同じ内容でも一致になります。欠損した登録ファイルは追加・削除と断定せず、比較不能として残します。', '',
    '各ファイルは順に読み込まれ、同時点のスナップショットではありません。コピー時の再照合・内容の意味的な比較・manifestの真正性の判定は行いません。', '']
  for (const [title, inspection] of [['基準', before], ['現在', after]] as const) lines.push(`## ${title}の照合`, '',
    quote(`manifest: ${inspection.manifestPath}\nmanifestのSHA-256: ${inspection.manifestHash}\n照合時刻: ${inspection.checkedAt}\n世界revision: ${inspection.sourceRevision}\n生成モデル: ${inspection.modelId}`), '')
  for (const file of comparison.files) {
    lines.push(`## ${packageChangeLabels[file.kind]}`, '', quote(file.path), '')
    for (const [title, side] of [['基準', file.before], ['現在', file.after]] as const) lines.push(quote(side
      ? `${title}: ${side.actualHash === null ? '登録あり・ファイル欠損' : `${side.bytes} bytes`}\nmanifestとの照合: ${side.status}\nmanifestのSHA-256: ${side.expectedHash}\n読み込んだSHA-256: ${side.actualHash ?? '取得できません'}`
      : `${title}: manifestに登録なし`), '')
  }
  lines.push('## 比較と両側の照合結果のJSON', '', '```json', JSON.stringify({ format: 'persona-package-comparison/v1', capturedAt, before, after, comparison }, null, 2), '```', '')
  return lines.join('\n')
}
