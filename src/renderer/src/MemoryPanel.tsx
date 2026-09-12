import { useEffect, useState } from 'react'
import type { MemoryDetail, MemoryInspection } from '../../core/memory-contracts'
import './memory.css'

const stages = { none: '未整理', pending: '推論終了待ち', running: '整理中', complete: '整理完了', interrupted: '整理中断・再開待ち', failed: '整理失敗・自動再送なし' }
const kinds = { episodic: '経験', semantic: '理解', prospective: '予定' }
const reminderStates = { pending: '未完了', done: '完了', cancelled: '取消' }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function MemoryEvidence({ ownerId, memoryId, revision }: { ownerId: string; memoryId: string; revision: number }) {
  const [value, setValue] = useState<MemoryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    void window.persona.memoryDetail(ownerId, memoryId, revision).then(value => { if (!disposed) setValue(value) }, error => { if (!disposed) setError(message(error)) })
    return () => { disposed = true }
  }, [ownerId, memoryId, revision])
  if (error) return <p role="alert">{error}</p>
  if (!value) return <p>記憶を読み込み中…</p>
  const r = value.record
  return <article className="memory-detail" data-testid="memory-detail"><small>{kinds[r.kind]} · revision {r.revision} · {r.status === 'forgotten' ? '忘却済みの記録' : '当時の保持記憶'}</small><p>{r.text}</p><strong>本人にとっての意味</strong><p>{r.meaning}</p><small>重要度 {r.importance} · 作成 turn {r.createdTurn} · 整理 turn {r.organizedTurn} · 最終想起 {r.recalledTurn === null ? 'なし' : `turn ${r.recalledTurn}`}</small><h4>本人が得た根拠</h4>{value.sources.map(source => <blockquote key={source.id}><small>{source.id} · turn {source.turn}</small><p>{source.text}</p></blockquote>)}</article>
}

export function MemoryPanel({ agentId }: { agentId: string }) {
  const [value, setValue] = useState<MemoryInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ id: string; revision: number } | null>(null)
  useEffect(() => {
    let disposed = false, fetching = false, again = false, revision = -1
    const refresh = async () => {
      if (fetching) { again = true; return }
      fetching = true
      try {
        const next = await window.persona.memoryInspection(agentId)
        if (!disposed) { setValue(next); setError(null); revision = next.progress.revision }
      } catch (error) { if (!disposed) setError(message(error)) }
      finally { fetching = false; if (again && !disposed) { again = false; void refresh() } }
    }
    void refresh()
    const unsubscribe = window.persona.onEvent(event => {
      if (event.type !== 'workspace') return
      const next = event.snapshot.state.simulation?.memoryProgress?.[agentId]?.revision
      if (next !== undefined && next !== revision) void refresh()
    })
    return () => { disposed = true; unsubscribe() }
  }, [agentId])
  return <div className="memory-panel" data-testid="memory-panel"><p className="memory-note">本人が選んだ主観的な記憶です。この画面の内容は他のNPCへ伝わりません。</p>{error && <p role="alert">{error}</p>}{value && <>
    <div className="memory-progress"><span>{stages[value.progress.consolidation]}</span><span>保持 {value.progress.retained}/100</span><span>候補 {value.progress.candidates}/100</span><span>照合中 {value.progress.recalling}</span></div>
    {value.progress.error && <p role="alert">{value.progress.error}</p>}
    <h3>保持記憶・未来の意図</h3>{value.records.length === 0 && <p>まだ保持記憶はありません。</p>}
    {value.records.map(record => <button className="memory-card" key={record.id} onClick={() => setSelected({ id: record.id, revision: record.revision })}><strong>{kinds[record.kind]} · {record.cues.topics.join('、') || record.id}</strong><small>重要度 {record.importance} · revision {record.revision} · 整理 turn {record.organizedTurn}</small>{record.reminder && <small>条件: {record.reminder.afterTurn === null ? '' : `turn ${record.reminder.afterTurn}以降 `}{record.reminder.facilityId} {record.reminder.personId} · {record.reminder.status}</small>}</button>)}
    {selected && <MemoryEvidence key={`${selected.id}/${selected.revision}`} ownerId={agentId} memoryId={selected.id} revision={selected.revision} />}
    {value.archivedReminders.length > 0 && <><h3>完了・取消・忘却した予定</h3>{value.archivedReminders.map(r => <button className="memory-card" key={r.id} onClick={() => setSelected({ id: r.id, revision: r.revision })}>{r.cues.topics.join('、') || r.id} · {r.reminder?.status === 'pending' ? '忘却' : r.reminder && reminderStates[r.reminder.status]}</button>)}</>}
    <h3>未整理の候補</h3>{value.candidates.map(candidate => <details key={candidate.id}><summary>{candidate.cues.topics.join('、') || candidate.id} · turn {candidate.createdTurn}</summary><p>{candidate.text}</p><p>{candidate.meaning}</p></details>)}
    <h3>直近の想起</h3>{value.recalls.map(op => <p key={op.id}>turn {op.turn} · {op.cue} · {op.status} · {op.selected.length}件{op.error && ` · ${op.error}`}</p>)}
  </>}</div>
}
