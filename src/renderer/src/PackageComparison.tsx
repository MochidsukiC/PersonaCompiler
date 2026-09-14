import { useEffect, useState } from 'react'
import type { CharacterPackageInspection } from '../../core/compiler-contracts'
import { compareCharacterPackages, packageChangeLabels, packageComparisonMarkdown, packageComparisonSummary } from '../../core/package-comparison'
import type { FileEntry } from '../../shared/contracts'
import { ReportCopyControl } from './ReportCopyControl'

const paths = (files: FileEntry[]): string[] => files.flatMap(file => file.kind === 'file' ? [file.path] : paths(file.children ?? []))

export function PackageComparison({ manifestPath, npcId, files }: { manifestPath: string; npcId: string; files: FileEntry[] }) {
  const [selected, setSelected] = useState('')
  const [generation, setGeneration] = useState(0)
  const candidates = paths(files).filter(file => {
    const parts = file.split('/')
    return file !== manifestPath && parts.length === 5 && parts[0] === 'compilation' && parts[2] === 'npcs' && parts[3] === npcId && parts[4] === 'manifest.json'
  }).sort()
  return <details className="package-comparison"><summary>別のパッケージとファイルを比較</summary><section aria-label="パッケージのファイル比較">
    <p>基準から現在へのファイルの追加・削除・内容変更を確認します。両manifestの登録ファイルを読み直し、形式によらず実ファイルのSHA-256で比較します。</p>
    <label>基準のパッケージ<select aria-label="ファイル比較の基準" value={selected} onChange={event => setSelected(event.target.value)}><option value="">比較する出力を選択</option>{selected && !candidates.includes(selected) && <option value={selected}>{selected}（一覧にありません）</option>}{candidates.map(file => <option key={file} value={file}>Compilation {file.split('/')[1]}</option>)}</select></label>
    {candidates.length === 0 && <p>同じNPCの別のmanifestが保存されると比較できます。</p>}
    {selected && <><button className="button compact" onClick={() => setGeneration(value => value + 1)}>両側を再照合して比較</button><PackageComparisonResult key={`${selected}:${generation}`} beforePath={selected} afterPath={manifestPath} /></>}
  </section></details>
}

function PackageComparisonResult({ beforePath, afterPath }: { beforePath: string; afterPath: string }) {
  const [value, setValue] = useState<{ before: CharacterPackageInspection; after: CharacterPackageInspection } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void Promise.all([window.persona.inspectCharacterPackage(beforePath), window.persona.inspectCharacterPackage(afterPath)]).then(([before, after]) => {
      compareCharacterPackages(before, after)
      if (active) setValue({ before, after })
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [beforePath, afterPath])
  if (error) return <p role="alert">ファイルを比較できません: {error}</p>
  if (!value) return <p role="status">両側のファイルを照合中…</p>
  const comparison = compareCharacterPackages(value.before, value.after)
  return <>
    <p role="status">{packageComparisonSummary(comparison)}</p>
    <p className="package-inspection-note">照合時の結果です。外部編集後は再照合してください。未登録ファイルは対象外で、改名は削除と追加です。内容の意味や品質は判定しません。</p>
    <p className="package-inspection-note">内容一致とmanifestへの一致は別です。登録されたファイルが欠損している場合は比較不能です。</p>
    <details><summary>比較した資料と照合時刻</summary>{([['基準', value.before], ['現在', value.after]] as const).map(([label, side]) => <div key={label}><strong>{label}: {side.manifestPath}</strong><p>照合時刻: {side.checkedAt}</p><p>manifest SHA-256: <code>{side.manifestHash}</code></p></div>)}</details>
    <ReportCopyControl label="ファイル比較レポートをコピー" description="全ファイルの比較結果と両側の照合記録をMarkdownとJSONでコピーします。" text={() => packageComparisonMarkdown(value.before, value.after, new Date().toISOString())} success="ファイル比較と両側の照合記録をコピーしました。" />
    <ul>{comparison.files.map(file => <li key={file.path} className={`package-diff-${file.kind}`}><strong>{file.path}</strong><span>{packageChangeLabels[file.kind]}</span><details><summary>両側のファイル情報</summary>{([['基準', file.before], ['現在', file.after]] as const).map(([label, side]) => <div key={label}><strong>{label}</strong>{side ? <><p>{({ match: 'manifestと一致', changed: 'manifestから内容変更', missing: '登録あり・ファイル欠損' })[side.status]}{side.bytes !== null && ` · ${side.bytes.toLocaleString()} bytes`}</p><p>実ファイル: <code>{side.actualHash ?? '取得できません'}</code></p><p>manifest: <code>{side.expectedHash}</code></p></> : <p>manifestに登録なし</p>}</div>)}</details></li>)}</ul>
  </>
}
