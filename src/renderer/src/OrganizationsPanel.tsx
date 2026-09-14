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
      <dt>施設</dt><dd>{simulation.facilities.filter(f => f.construction?.organizationId === o.id).map(f => <div key={f.id}>{f.name} · {f.layout ? <button onClick={() => onAgent(`facility-${f.id}`)}>利用可能・施設担当</button> : '建設中'}</div>)}</dd>
    </dl><small>{o.id}</small></article>)}
    <h2>住民による施設建設</h2>
    {!simulation.facilities.some(f => f.construction) && <p>まだ建設依頼はありません。</p>}
    {simulation.facilities.filter(f => f.construction).map(f => <article key={f.id} className="organization-card"><h2>{f.name} <small>{f.type} · {f.layout ? '利用可能' : '建設中'}</small></h2><p>{f.construction!.description}</p><p>建設者: <button onClick={() => onAgent(f.construction!.builderId)}>{person(f.construction!.builderId)?.name ?? f.construction!.builderId}</button> · turn {f.construction!.requestedTurn}</p><p>{f.construction!.organizationId === null ? '個人の施設' : organizations.find(o => o.id === f.construction!.organizationId)?.name}</p>{f.layout && <button onClick={() => onAgent(`facility-${f.id}`)}>施設担当を開く</button>}</article>)}
  </section>
}
