import { useEffect, useState } from 'react'
import { characterReviewSchema, type CharacterReview } from '../../core/character-review'
import { compareCharacterReviews } from '../../core/review-comparison'
import type { FileEntry } from '../../shared/contracts'

const paths = (files: FileEntry[]): string[] => files.flatMap(file => file.kind === 'file' ? [file.path] : paths(file.children ?? []))
const labels = { added: '追加', removed: '削除', evidence: '根拠変更' }

export function ReviewComparison({ review, currentPath, files, fileVersions, workspaceVersion }: { review: CharacterReview; currentPath: string; files: FileEntry[]; fileVersions?: Record<string, number>; workspaceVersion: number }) {
  const [selected, setSelected] = useState('')
  const [generation, setGeneration] = useState(0)
  const revision = fileVersions ? fileVersions[selected] : workspaceVersion
  const candidates = paths(files).filter(file => {
    const parts = file.split('/')
    return file !== currentPath && parts.length === 5 && parts[0] === 'compilation' && parts[2] === 'npcs' && parts[3] === review.npcId && parts[4] === 'review.json'
  }).sort()
  return <details className="review-comparison"><summary>別の出力と比較</summary><section aria-label="制作レビューの比較">
    <p className="review-note">基準側から、開いている出力への変更を表示します。文章が変わった設定は削除と追加で表示し、意味の同一性や品質は判定しません。採用記憶・関係の比較は件数のみです。</p>
    <label>基準の制作レビュー<select aria-label="比較の基準" value={selected} onChange={event => setSelected(event.target.value)}><option value="">比較する出力を選択</option>{candidates.map(file => <option key={file} value={file}>Compilation {file.split('/')[1]}</option>)}</select></label>
    {candidates.length === 0 && <p className="review-note">同じNPCの別の制作レビューが保存されると比較できます。</p>}
    {selected && <button className="button compact" onClick={() => setGeneration(value => value + 1)}>基準を再読み込み</button>}
    {selected && <ComparisonResult key={`${selected}:${revision}:${generation}`} selected={selected} review={review} />}
  </section></details>
}

function ComparisonResult({ selected, review }: { selected: string; review: CharacterReview }) {
  const [baseline, setBaseline] = useState<CharacterReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.persona.preview(selected).then(preview => {
      const parsed = characterReviewSchema.parse(JSON.parse(preview.content))
      if (parsed.npcId !== review.npcId) throw new Error(`比較するNPCが一致しません: ${parsed.npcId} / ${review.npcId}`)
      if (!cancelled) setBaseline(parsed)
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [selected, review.npcId])
  const comparison = baseline ? compareCharacterReviews(baseline, review) : null
  return <>
    {error && <p role="alert">比較できません: {error}</p>}
    {!baseline && !error && <p role="status">基準を読み込み中…</p>}
    {comparison && baseline && <>
      <p className="review-note">基準: revision {baseline.sourceRevision} · {baseline.modelId}<br />現在: revision {review.sourceRevision} · {review.modelId}</p>
      <p role="status">追加 {comparison.changes.filter(c => c.kind === 'added').length}件 · 削除 {comparison.changes.filter(c => c.kind === 'removed').length}件 · 根拠変更 {comparison.changes.filter(c => c.kind === 'evidence').length}件 · 設定一致 {comparison.unchanged}件</p>
      {comparison.changes.length === 0 && comparison.fields.length === 0 && <p>比較対象の設定・根拠・指針・メタデータは一致しています。</p>}
      {comparison.changes.map((change, index) => <div className={`review-change review-change-${change.kind}`} key={index}><strong>{labels[change.kind]} · {change.section}</strong><p>{change.text}</p><details><summary>両側の根拠を見る</summary>{([{ title: '基準', sources: change.before }, { title: '現在', sources: change.after }]).map(side => <div key={side.title}><h3>{side.title}</h3>{side.sources.length === 0 ? <p>設定なし</p> : side.sources.map(source => <div key={source.id}><small>{source.title} · {source.id}</small><pre>{source.text}</pre></div>)}</div>)}</details></div>)}
      {comparison.fields.map(field => <details key={field.title}><summary>{field.title}の変更</summary><h3>基準</h3><pre>{field.before}</pre><h3>現在</h3><pre>{field.after}</pre></details>)}
    </>}
  </>
}
