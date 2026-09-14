import { useEffect, useRef, useState } from 'react'
import { characterReviewSchema } from '../../core/character-review'
import { searchCharacterReview, type ReviewSearchScope } from '../../core/review-search'
import { reviewSearchMarkdown } from '../../core/review-search-report'
import { reviewFullMarkdown } from '../../core/review-full-report'
import type { FileEntry } from '../../shared/contracts'
import { ReviewComparison } from './ReviewComparison'
import { ReportCopyControl } from './ReportCopyControl'
import './character-review.css'

export function CharacterReview({ content, currentPath, currentHash, runId, files, fileVersions, workspaceVersion }: { content: string; currentPath: string; currentHash: string; runId: string; files: FileEntry[]; fileVersions?: Record<string, number>; workspaceVersion: number }) {
  const [query, setQuery] = useState('')
  const [searchScope, setSearchScope] = useState<ReviewSearchScope>('claims')
  const [sourceSelection, setSourceSelection] = useState<{ id: string } | null>(null)
  const evidence = useRef<HTMLElement>(null)
  useEffect(() => { if (sourceSelection) evidence.current?.scrollIntoView({ block: 'nearest' }) }, [sourceSelection])
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { return <p role="alert">制作レビューのJSONを読み取れません。</p> }
  const result = characterReviewSchema.safeParse(parsed)
  if (!result.success) return <p role="alert">制作レビューの形式が不正です: {result.error.message}</p>
  const review = result.data
  const selected = review.sources.find(s => s.id === sourceSelection?.id)
  const { count, search, matchingSources, sections, visible } = searchCharacterReview(review, query, searchScope)
  return <article className="character-review" aria-label="NPC制作レビュー">
    <header><span className="eyebrow">CHARACTER PRODUCTION REVIEW</span><h1>{review.name}</h1><p>{review.npcId} · 世界revision {review.sourceRevision}</p></header>
    <div className="review-metrics"><strong>根拠付き設定 {count}件</strong><span>採用記憶 {review.memoryCount}件</span><span>関係 {review.relationshipCount}件</span></div>
    <p className="review-note">読み込み済みの制作レビューから、設定とその根拠を確認できます。根拠の存在は、モデルの解釈の正しさを保証しません。</p>
    <ReportCopyControl label="制作レビュー全体をコピー" description="検索条件によらず、全設定・全根拠・Runtime PromptをMarkdownとJSONでコピーします。"
      text={() => reviewFullMarkdown({ runId, path: currentPath, hash: currentHash, review }, new Date().toISOString())}
      success="制作レビュー全体と元資料の参照情報をコピーしました。" />
    <ReviewComparison review={review} currentPath={currentPath} currentHash={currentHash} runId={runId} files={files} fileVersions={fileVersions} workspaceVersion={workspaceVersion} />
    <div className="review-search"><label>検索対象<select aria-label="制作レビューの検索対象" value={searchScope} onChange={event => setSearchScope(event.target.value as ReviewSearchScope)}><option value="claims">設定本文・見出し</option><option value="evidence">根拠資料</option><option value="all">設定と根拠資料</option></select></label>
      <label>キーワード<input aria-label="制作レビューを検索" value={query} onChange={event => setQuery(event.target.value)} placeholder="例: 話し方、約束、資料のID" /></label></div>
    {searchScope !== 'claims' && <p className="review-note">根拠のID・題名・本文を検索し、その資料を参照する設定を表示します。文字列の一致を調べるもので、解釈の妥当性は判定しません。</p>}
    <p role="status">{visible} / {count}件の設定</p>
    <ReportCopyControl key={`${searchScope}:${query}`} label="設定の検索レポートをコピー" description="表示中の設定・全根拠・検索条件をMarkdownとJSONでコピーします。"
      text={() => reviewSearchMarkdown({ runId, path: currentPath, hash: currentHash, review, query, scope: searchScope }, new Date().toISOString())}
      success="設定の検索結果と根拠をコピーしました。" />
    {visible === 0 && <p>{search ? '検索条件に一致する設定はありません。' : '生成された設定はありません。'}</p>}
    {sections.map((section, sectionIndex) => section.claims.length > 0 && <section key={sectionIndex}><h2>{section.title}</h2>{section.claims.map((claim, index) => <div className="review-claim" key={index}><p>{claim.text}</p><div className="review-citations">{[...new Set(claim.evidence)].map(id => <button key={id} aria-pressed={sourceSelection?.id === id} onClick={() => setSourceSelection({ id })}>根拠 {review.sources.findIndex(s => s.id === id) + 1}{search && searchScope !== 'claims' && matchingSources.has(id) && ' · 検索一致'}</button>)}</div></div>)}</section>)}
    {selected && <section ref={evidence} className="review-evidence" aria-label="設定の根拠"><button className="button compact" onClick={() => setSourceSelection(null)}>根拠を閉じる</button><h2>{selected.title}</h2><small>{selected.id}</small><pre>{selected.text}</pre></section>}
    <details><summary>Runtime向けの指針</summary><p>{review.runtimeGuidance || '追加の指針はありません。'}</p></details>
    <details><summary>Runtime Prompt</summary><pre>{review.systemPrompt}</pre></details>
    <p className="review-note">生成モデル: {review.modelId} · review.mdは生成時のレポートです。外部編集後の内容を持ち出す場合は「制作レビュー全体をコピー」を使ってください。</p>
  </article>
}
