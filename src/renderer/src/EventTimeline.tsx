import { useEffect, useRef, useState } from 'react'
import type { SimulationSnapshot } from '../../core/life-contracts'
import type { EventHistoryPage } from '../../core/event-search'
import { emptyEventFilter, eventLabels, filterEvents, type EventFilter } from './event-timeline'
import { EventReportButton } from './EventReportButton'
import './event-timeline.css'

export function EventTimeline({ simulation, runId, historyAvailable, onAgent }: { simulation: SimulationSnapshot; runId: string; historyAvailable: boolean; onAgent(id: string): void }) {
  const [filter, setFilter] = useState<EventFilter>(emptyEventFilter)
  const [historyMode, setHistoryMode] = useState(false)
  const [history, setHistory] = useState<EventHistoryPage | null>(null)
  const [applied, setApplied] = useState<EventFilter>(emptyEventFilter)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  const changed = JSON.stringify(filter) !== JSON.stringify(applied)
  const searchHistory = async (offset = 0, revision: number | null = null) => {
    const id = ++request.current
    setHistoryMode(true); setBusy(true); setError(null); setHistory(null); setApplied(filter)
    try {
      const page = await window.persona.eventHistory({ runId, filter, offset, revision })
      if (id === request.current) setHistory(page)
    } catch (error) { if (id === request.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (id === request.current) setBusy(false) }
  }
  const events = historyMode ? history?.events ?? [] : filterEvents(simulation, filter)
  const names = new Map(simulation.actors.map(a => [a.id, a.name]))
  const facilities = new Map(simulation.facilities.map(f => [f.locationId, f.name]))
  const actor = (id: string) => <button className="event-person" disabled={!names.has(id)} onClick={() => onAgent(id)}>{names.get(id) ?? id}</button>
  return <section className="event-timeline" aria-label="出来事の検索">
    <header><span className="eyebrow">SIMULATION QA</span><h1>出来事をたどる</h1><p>住民の行動と、発話時に誰が受信対象だったかを確認できます。</p></header>
    <section aria-label="親セッションの世界イベント">
      <h2>世界イベントと予約</h2>
      <p className="event-note">この版で新規作成したワールドの親セッションに、突発イベントの発生、日・時間帯を指定した予約、予約の取消を依頼できます。予約は世界内の時計で発生します。対象住民は発生時に確定し、睡眠・活動終了中は次の活動で通知を受け取ります。</p>
      {!(simulation.worldEvents?.length) && <p>世界イベントの登録はありません。</p>}
      {(simulation.worldEvents ?? []).toReversed().map(plan => <article key={plan.id} className="event-record event-world">
        <div className="event-meta"><strong>{plan.status === 'scheduled' ? simulation.stage === 'ended' ? '未発生（世界終了）' : '予約中' : plan.status === 'cancelled' ? '取消済み' : '発生済み'}</strong><span>{plan.scheduledFor ? `${plan.scheduledFor.day}日目・${({ morning: '朝', noon: '昼', evening: '夕', night: '夜' })[plan.scheduledFor.time]}` : `突発 · Turn ${plan.createdTurn}`}</span></div>
        <h3>{plan.title}</h3><p>{plan.description}</p>
        <div className="event-place"><span>種類: {plan.type}</span><span>対象: {plan.target.scope === 'world' ? '世界全体' : plan.target.scope === 'location' ? facilities.get(plan.target.locationId) ?? plan.target.locationId : plan.target.actorIds.map(id => names.get(id) ?? id).join('、')}</span></div>
        <small>{plan.id}{plan.eventSequence !== null && ` · 出来事 #${plan.eventSequence}`}</small>
      </article>)}
    </section>
    <div className="event-filters">
      <label>関係する住民<select aria-label="出来事の住民" value={filter.actorId} onChange={e => setFilter({ ...filter, actorId: e.target.value })}><option value="">全住民（行動者・受信対象）</option>{simulation.actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>種類<select aria-label="出来事の種類" value={filter.kind} onChange={e => setFilter({ ...filter, kind: e.target.value as EventFilter['kind'] })}><option value="all">すべての行動</option><option value="unheard">発話（受信対象0人）</option>{Object.entries(eventLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <label>ターン<input type="number" min="0" step="1" aria-label="出来事のターン" value={filter.turn} placeholder="すべて" onChange={e => setFilter({ ...filter, turn: e.target.value })} /></label>
      <label className="event-query">本文・名前・施設<input aria-label="出来事を検索" value={filter.query} placeholder="例: 約束、図書室" onChange={e => setFilter({ ...filter, query: e.target.value })} /></label>
      <button className="button compact" onClick={() => setFilter(emptyEventFilter)}>絞り込みを解除</button>
    </div>
    {historyAvailable && <div className="event-history-controls"><button className="button compact" disabled={busy} onClick={() => void searchHistory()}>保存済み履歴を検索</button>{historyMode && <button className="button compact" onClick={() => { request.current++; setHistoryMode(false); setBusy(false); setError(null) }}>直近の出来事に戻る</button>}</div>}
    <p role="status">{historyMode ? busy ? '保存済み履歴を検索中…' : history ? `${history.total ? history.offset + 1 : 0}–${history.offset + events.length} / ${history.total}件 · 保存済み · 新しい順` : '保存済み履歴を表示できません。' : `${events.length} / ${simulation.events.length}件 · 新しい順`}</p>
    {error && <p role="alert">{error}</p>}
    <p className="event-note">{historyMode ? `確定保存された履歴を検索しています。未保存の出来事は含みません。${history ? `保存revision ${history.revision}。` : ''}最新の保存を調べる場合は再検索してください。` : '検索対象は画面に届いた直近の出来事です。過去の全履歴は含みません。'}受信対象は既読・記憶化を保証するものではありません。</p>
    {historyMode && changed && <p className="event-note">条件が変更されています。「保存済み履歴を検索」で反映してください。</p>}
    <EventReportButton key={`${runId}:${simulation.revision}:${historyMode}:${request.current}:${JSON.stringify(filter)}`} disabled={historyMode && (busy || !history || changed)} input={{ runId, simulation, filter: historyMode ? applied : filter, events, source: historyMode && history ? { kind: 'saved', revision: history.revision, savedAt: history.savedAt, offset: history.offset, total: history.total } : { kind: 'recent', available: simulation.events.length } }} />
    {historyMode && history && <div className="event-history-controls"><button className="button compact" disabled={busy || changed || history.offset === 0} onClick={() => void searchHistory(Math.max(0, history.offset - 100), history.revision)}>前の100件</button><button className="button compact" disabled={busy || changed || history.offset + events.length >= history.total} onClick={() => void searchHistory(history.offset + 100, history.revision)}>次の100件</button></div>}
    {events.length === 0 && (!historyMode || history) && <div className="event-empty">{historyMode || simulation.events.length ? '条件に一致する出来事はありません。' : 'まだ出来事はありません。生活が進むとここに表示されます。'}</div>}
    <div className="event-list">{events.map(event => <article key={event.sequence} className={`event-record event-${event.kind}`}>
      <div className="event-meta"><strong>{eventLabels[event.kind]}</strong><span>Turn {event.turn}</span><small>#{event.sequence}</small></div>
      <div className="event-place">{event.kind === 'world' ? <button className="event-person" onClick={() => onAgent('parent')}>親セッション</button> : actor(event.actorId)}<span>{event.locationId === null ? '場所指定なし' : facilities.get(event.locationId) ?? event.locationId}{event.position && ` (${event.position.x}, ${event.position.y}, ${event.position.z})`}</span></div>
      <p>{event.text}</p>
      {['speech', 'world'].includes(event.kind) && <div className="event-recipients"><span>{event.volume ? ({ low: '小声', medium: '普通の声', high: '大声' })[event.volume] : event.kind === 'world' ? 'イベント通知' : '発話'} · 受信対象 {event.recipients.length}人</span>{event.recipients.map(id => <span key={id}>{actor(id)}</span>)}</div>}
    </article>)}</div>
  </section>
}
