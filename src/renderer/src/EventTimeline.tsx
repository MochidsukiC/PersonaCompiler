import { useState } from 'react'
import type { SimulationSnapshot } from '../../core/life-contracts'
import { emptyEventFilter, eventLabels, filterEvents, type EventFilter } from './event-timeline'
import './event-timeline.css'

export function EventTimeline({ simulation, onAgent }: { simulation: SimulationSnapshot; onAgent(id: string): void }) {
  const [filter, setFilter] = useState<EventFilter>(emptyEventFilter)
  const events = filterEvents(simulation, filter)
  const names = new Map(simulation.actors.map(a => [a.id, a.name]))
  const facilities = new Map(simulation.facilities.map(f => [f.locationId, f.name]))
  const actor = (id: string) => <button className="event-person" disabled={!names.has(id)} onClick={() => onAgent(id)}>{names.get(id) ?? id}</button>
  return <section className="event-timeline" aria-label="出来事の検索">
    <header><span className="eyebrow">SIMULATION QA</span><h1>出来事をたどる</h1><p>住民の行動と、発話時に誰が受信対象だったかを確認できます。</p></header>
    <div className="event-filters">
      <label>関係する住民<select aria-label="出来事の住民" value={filter.actorId} onChange={e => setFilter({ ...filter, actorId: e.target.value })}><option value="">全住民（行動者・受信対象）</option>{simulation.actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>種類<select aria-label="出来事の種類" value={filter.kind} onChange={e => setFilter({ ...filter, kind: e.target.value as EventFilter['kind'] })}><option value="all">すべての行動</option><option value="unheard">発話（受信対象0人）</option>{Object.entries(eventLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <label>ターン<input type="number" min="0" step="1" aria-label="出来事のターン" value={filter.turn} placeholder="すべて" onChange={e => setFilter({ ...filter, turn: e.target.value })} /></label>
      <label className="event-query">本文・名前・施設<input aria-label="出来事を検索" value={filter.query} placeholder="例: 約束、図書室" onChange={e => setFilter({ ...filter, query: e.target.value })} /></label>
      <button className="button compact" onClick={() => setFilter(emptyEventFilter)}>絞り込みを解除</button>
    </div>
    <p role="status">{events.length} / {simulation.events.length}件 · 新しい順</p>
    <p className="event-note">検索対象は画面に届いた直近の出来事です。過去の全履歴は含みません。受信対象は既読・記憶化を保証するものではありません。</p>
    {events.length === 0 && <div className="event-empty">{simulation.events.length ? '条件に一致する出来事はありません。' : 'まだ出来事はありません。生活が進むとここに表示されます。'}</div>}
    <div className="event-list">{events.map(event => <article key={event.sequence} className={`event-record event-${event.kind}`}>
      <div className="event-meta"><strong>{eventLabels[event.kind]}</strong><span>Turn {event.turn}</span><small>#{event.sequence}</small></div>
      <div className="event-place">{actor(event.actorId)}<span>{facilities.get(event.locationId) ?? event.locationId}{event.position && ` (${event.position.x}, ${event.position.y}, ${event.position.z})`}</span></div>
      <p>{event.text}</p>
      {event.kind === 'speech' && <div className="event-recipients"><span>{event.volume ? ({ low: '小声', medium: '普通の声', high: '大声' })[event.volume] : '発話'} · 受信対象 {event.recipients.length}人</span>{event.recipients.map(id => <span key={id}>{actor(id)}</span>)}</div>}
    </article>)}</div>
  </section>
}
