import { useEffect, useState } from 'react'
import type { CharacterPackageInspection } from '../../core/compiler-contracts'
import { packageInspectionMarkdown } from '../../core/package-inspection-report'
import { ReportCopyControl } from './ReportCopyControl'
import { PackageComparison } from './PackageComparison'
import type { FileEntry } from '../../shared/contracts'
import './package-inspection.css'

export function PackageInspection({ manifestPath, content, files }: { manifestPath: string; content: string; files: FileEntry[] }) {
  const [revision, setRevision] = useState(0)
  const [inspection, setInspection] = useState<CharacterPackageInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.persona.inspectCharacterPackage(manifestPath).then(value => { if (active) setInspection(value) }, error => { if (active) setError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [manifestPath, revision])
  const matched = inspection?.files.filter(file => file.status === 'match').length ?? 0
  return <article className="package-inspection" aria-label="NPCパッケージの整合性">
    <header><span className="eyebrow">CHARACTER PACKAGE</span><h1>成果物の整合性</h1><p>manifestに記録されたSHA-256と、現在の各ファイルを照合します。</p></header>
    <button className="button compact" disabled={!inspection && !error} onClick={() => { setInspection(null); setError(null); setRevision(value => value + 1) }}>もう一度照合</button>
    <p role="status">{error ? '照合できませんでした。' : !inspection ? '成果物を照合中…' : matched === inspection.files.length ? `全${matched}ファイルが一致しました。` : `${inspection.files.length - matched}ファイルに差異があります。`}</p>
    {error && <p role="alert">{error}</p>}
    {inspection && <ReportCopyControl label="照合レポートをコピー" description="表示中の結果・照合時刻・ファイルのhashをMarkdownとJSONでコピーします。" text={() => packageInspectionMarkdown(inspection)} success="照合結果とファイルの参照情報をコピーしました。" />}
    {inspection && <PackageComparison manifestPath={manifestPath} npcId={inspection.npcId} files={files} />}
    {inspection && <><p>{inspection.npcId} · 世界revision {inspection.sourceRevision} · {inspection.modelId}</p><ul>{inspection.files.map(file => <li key={file.path} className={`package-file-${file.status}`}><strong>{file.path}</strong><span>{({ match: '一致', changed: '内容が変更されています', missing: 'ファイルが見つかりません' })[file.status]}{file.bytes !== null && ` · ${file.bytes.toLocaleString()} bytes`}</span><details><summary>SHA-256</summary><p>manifest: <code>{file.expectedHash}</code></p><p>現在: <code>{file.actualHash ?? '取得できません'}</code></p></details></li>)}</ul><p>照合時刻: {new Date(inspection.checkedAt).toLocaleString()}</p></>}
    <p className="package-inspection-note">照合は読取専用です。差異がある場合は外部編集・コピー漏れを確認してください。manifest自体の真正性や内容の意味的な品質は、この照合では保証しません。</p>
    <details><summary>manifestの内容</summary><pre>{content}</pre></details>
  </article>
}
