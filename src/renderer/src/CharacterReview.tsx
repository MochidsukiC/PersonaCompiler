import { useEffect, useRef, useState } from 'react'
import { characterReviewSchema } from '../../core/character-review'
import type { FileEntry } from '../../shared/contracts'
import { ReviewComparison } from './ReviewComparison'
import './character-review.css'

export function CharacterReview({ content, currentPath, files, fileVersions, workspaceVersion }: { content: string; currentPath: string; files: FileEntry[]; fileVersions?: Record<string, number>; workspaceVersion: number }) {
  const [query, setQuery] = useState('')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const evidence = useRef<HTMLElement>(null)
  useEffect(() => { if (sourceId) evidence.current?.scrollIntoView({ block: 'nearest' }) }, [sourceId])
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { return <p role="alert">制作レビューのJSONを読み取れません。</p> }
  const result = characterReviewSchema.safeParse(parsed)
  if (!result.success) return <p role="alert">制作レビューの形式が不正です: {result.error.message}</p>
  const review = result.data
  const selected = review.sources.find(s => s.id === sourceId)
  const count = review.sections.reduce((n, s) => n + s.claims.length, 0)
  const search = query.trim().toLocaleLowerCase()
  const sections = review.sections.map(section => ({ ...section, claims: section.claims.filter(c => `${section.title} ${c.text}`.toLocaleLowerCase().includes(search)) }))
  const visible = sections.reduce((n, s) => n + s.claims.length, 0)
  return <article className="character-review" aria-label="NPC制作レビュー">
    <header><span className="eyebrow">CHARACTER PRODUCTION REVIEW</span><h1>{review.name}</h1><p>{review.npcId} · 世界revision {review.sourceRevision}</p></header>
    <div className="review-metrics"><strong>根拠付き設定 {count}件</strong><span>採用記憶 {review.memoryCount}件</span><span>関係 {review.relationshipCount}件</span></div>
    <p className="review-note">Compilation時点の資料から、設定とその根拠を確認できます。根拠の存在は、モデルの解釈の正しさを保証しません。</p>
    <ReviewComparison review={review} currentPath={currentPath} files={files} fileVersions={fileVersions} workspaceVersion={workspaceVersion} />
    <label>設定を検索<input aria-label="制作レビューを検索" value={query} onChange={event => setQuery(event.target.value)} placeholder="例: 話し方、約束、工房" /></label>
    <p role="status">{visible} / {count}件の設定</p>
    {visible === 0 && <p>{search ? '検索条件に一致する設定はありません。' : '生成された設定はありません。'}</p>}
    {sections.filter(s => s.claims.length).map(section => <section key={section.title}><h2>{section.title}</h2>{section.claims.map((claim, index) => <div className="review-claim" key={index}><p>{claim.text}</p><div className="review-citations">{[...new Set(claim.evidence)].map(id => <button key={id} aria-pressed={sourceId === id} onClick={() => setSourceId(id)}>根拠 {review.sources.findIndex(s => s.id === id) + 1}</button>)}</div></div>)}</section>)}
    {selected && <section ref={evidence} className="review-evidence" aria-label="設定の根拠"><button className="button compact" onClick={() => setSourceId(null)}>根拠を閉じる</button><h2>{selected.title}</h2><small>{selected.id}</small><pre>{selected.text}</pre></section>}
    <details><summary>Runtime向けの指針</summary><p>{review.runtimeGuidance || '追加の指針はありません。'}</p></details>
    <details><summary>Runtime Prompt</summary><pre>{review.systemPrompt}</pre></details>
    <p className="review-note">生成モデル: {review.modelId} · 同じ保存フォルダーのreview.mdでレポートを持ち出せます。</p>
  </article>
}
