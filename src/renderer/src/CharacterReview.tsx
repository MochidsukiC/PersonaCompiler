import { useEffect, useRef, useState } from 'react'
import { characterReviewSchema } from '../../core/character-review'
import type { FileEntry } from '../../shared/contracts'
import { ReviewComparison } from './ReviewComparison'
import './character-review.css'

export function CharacterReview({ content, currentPath, currentHash, runId, files, fileVersions, workspaceVersion }: { content: string; currentPath: string; currentHash: string; runId: string; files: FileEntry[]; fileVersions?: Record<string, number>; workspaceVersion: number }) {
  const [query, setQuery] = useState('')
  const [searchScope, setSearchScope] = useState('claims')
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
  const matchingSources = new Set(review.sources.filter(source => `${source.id} ${source.title} ${source.text}`.toLocaleLowerCase().includes(search)).map(source => source.id))
  const sections = review.sections.map(section => ({ ...section, claims: section.claims.filter(claim => !search
    || (searchScope !== 'evidence' && `${section.title} ${claim.text}`.toLocaleLowerCase().includes(search))
    || (searchScope !== 'claims' && claim.evidence.some(id => matchingSources.has(id)))) }))
  const visible = sections.reduce((n, s) => n + s.claims.length, 0)
  return <article className="character-review" aria-label="NPC制作レビュー">
    <header><span className="eyebrow">CHARACTER PRODUCTION REVIEW</span><h1>{review.name}</h1><p>{review.npcId} · 世界revision {review.sourceRevision}</p></header>
    <div className="review-metrics"><strong>根拠付き設定 {count}件</strong><span>採用記憶 {review.memoryCount}件</span><span>関係 {review.relationshipCount}件</span></div>
    <p className="review-note">Compilation時点の資料から、設定とその根拠を確認できます。根拠の存在は、モデルの解釈の正しさを保証しません。</p>
    <ReviewComparison review={review} currentPath={currentPath} currentHash={currentHash} runId={runId} files={files} fileVersions={fileVersions} workspaceVersion={workspaceVersion} />
    <div className="review-search"><label>検索対象<select aria-label="制作レビューの検索対象" value={searchScope} onChange={event => setSearchScope(event.target.value)}><option value="claims">設定本文・見出し</option><option value="evidence">根拠資料</option><option value="all">設定と根拠資料</option></select></label>
      <label>キーワード<input aria-label="制作レビューを検索" value={query} onChange={event => setQuery(event.target.value)} placeholder="例: 話し方、約束、資料のID" /></label></div>
    {searchScope !== 'claims' && <p className="review-note">根拠のID・題名・本文を検索し、その資料を参照する設定を表示します。文字列の一致を調べるもので、解釈の妥当性は判定しません。</p>}
    <p role="status">{visible} / {count}件の設定</p>
    {visible === 0 && <p>{search ? '検索条件に一致する設定はありません。' : '生成された設定はありません。'}</p>}
    {sections.filter(s => s.claims.length).map(section => <section key={section.title}><h2>{section.title}</h2>{section.claims.map((claim, index) => <div className="review-claim" key={index}><p>{claim.text}</p><div className="review-citations">{[...new Set(claim.evidence)].map(id => <button key={id} aria-pressed={sourceId === id} onClick={() => setSourceId(id)}>根拠 {review.sources.findIndex(s => s.id === id) + 1}{search && searchScope !== 'claims' && matchingSources.has(id) && ' · 検索一致'}</button>)}</div></div>)}</section>)}
    {selected && <section ref={evidence} className="review-evidence" aria-label="設定の根拠"><button className="button compact" onClick={() => setSourceId(null)}>根拠を閉じる</button><h2>{selected.title}</h2><small>{selected.id}</small><pre>{selected.text}</pre></section>}
    <details><summary>Runtime向けの指針</summary><p>{review.runtimeGuidance || '追加の指針はありません。'}</p></details>
    <details><summary>Runtime Prompt</summary><pre>{review.systemPrompt}</pre></details>
    <p className="review-note">生成モデル: {review.modelId} · 同じ保存フォルダーのreview.mdでレポートを持ち出せます。</p>
  </article>
}
