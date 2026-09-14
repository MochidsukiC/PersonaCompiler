import type { SimulationSnapshot } from '../../core/life-contracts'
import './organizations.css'

export function OrganizationsPanel({ simulation, onAgent }: { simulation: SimulationSnapshot; onAgent: (id: string) => void }) {
  const organizations = simulation.organizations ?? []
  const person = (id: string) => simulation.actors.find(a => a.id === id)
  return <section className="organizations-panel" aria-label="組織一覧">
    <header><h1>組織・会社 <small>{organizations.length}件</small></h1><p>住民が自分の意思で設立・参加する、世界の中の組織です。</p></header>
    {!organizations.length && <p className="organization-empty">まだ組織はありません。対応する住民が生活中に設立すると、ここに表示されます。</p>}
    {organizations.map(o => <article key={o.id} className="organization-card"><h2>{o.name} <small>{o.type}</small></h2><p>{o.purpose}</p><dl>
      <dt>設立者</dt><dd><button onClick={() => onAgent(o.founderId)}>{person(o.founderId)?.name ?? o.founderId}</button> · turn {o.foundedTurn}</dd>
      <dt>所在地</dt><dd>{o.locationId === null ? '固定の所在地なし' : simulation.facilities.find(f => f.locationId === o.locationId)?.name ?? o.locationId}</dd>
      <dt>構成員</dt><dd>{o.members.length ? o.members.map(id => <button key={id} onClick={() => onAgent(id)}>{person(id)?.name ?? id}{person(id)?.activity === 'dead' ? '（故人）' : ''}</button>) : '現在の構成員なし'}</dd>
    </dl><small>{o.id}</small></article>)}
  </section>
}
