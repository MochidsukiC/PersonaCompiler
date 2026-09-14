import { useState } from 'react'
import type { SimulationSnapshot } from '../../core/life-contracts'
import type { EconomyRecord, Holding, Owner, Storage } from '../../core/economy-contracts'
import './economy.css'

export const ownerName = (world: SimulationSnapshot, owner: Owner) => (owner.kind === 'npc' ? world.actors.find(a => a.id === owner.id)?.name : world.organizations?.find(o => o.id === owner.id)?.name) ?? owner.id
export const storageName = (world: SimulationSnapshot, storage: Storage) => storage.kind === 'carried' ? `${world.actors.find(a => a.id === storage.actorId)?.name ?? storage.actorId}の携帯品` : storage.kind === 'home' ? world.facilities.flatMap(f => f.layout?.homes ?? []).find(h => h.id === storage.homeId)?.name ?? storage.homeId : world.facilities.find(f => f.id === storage.facilityId)?.name ?? storage.facilityId
const itemName = (world: SimulationSnapshot, id: string) => world.economy!.catalog.find(e => e.item.id === id)?.item.name ?? id
function Holdings({ world, values }: { world: SimulationSnapshot; values: Holding[] }) {
  return values.length ? <ul className="economy-holdings">{values.map(h => <li key={h.id}><strong>{itemName(world, h.itemId)}</strong> ×{h.quantity}<small>{storageName(world, h.storage)}{h.durability !== null && ` · ${h.durability === 0 ? '破損' : `耐久 ${h.durability}`}`}{h.individual && ' · 個別管理'}{world.economy!.listings.some(l => l.holdingId === h.id) && ' · 出品中'}</small></li>)}</ul> : <p className="economy-muted">品物はありません。</p>
}
function Records({ records }: { records: EconomyRecord[] }) {
  return <ol className="economy-records">{records.toReversed().map(r => <li key={r.id}><small>turn {r.turn}</small><p>{r.text}</p><details><summary>記録IDと来歴</summary><code>{r.id}</code><p>前の記録: {r.previousIds.join(', ') || 'なし'}</p></details></li>)}</ol>
}
export function NpcEconomyPanel({ world, actorId }: { world: SimulationSnapshot; actorId: string }) {
  const [history, setHistory] = useState<EconomyRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const economy = world.economy!, v = economy.vitals[actorId], wallet = economy.accounts[`npc:${actorId}`]
  const load = async () => {
    try { const result = await window.persona.inventory(actorId); setHistory(result.provenance); setError(null) }
    catch (e) { setError(String(e)) }
  }
  return <section className="economy-panel economy-person" aria-label="持ち物・状態">
    <h2>持ち物・状態</h2>
    <div className="economy-vitals">{([['hp', 'HP'], ['hunger', '空腹'], ['san', 'SAN値']] as const).map(([key, label]) => <label key={key}>{label} <strong>{v[key]} / 100</strong><meter value={v[key]} min={0} max={100} low={20} high={60} optimum={100} /></label>)}</div>
    <p className="economy-muted">空腹は0が飢餓、100が満腹です。</p>
    <p className="economy-balance">所持金 <strong>{wallet.balance.toLocaleString()} {economy.currency}</strong></p>
    <p>相続先: {v.heirId ? world.actors.find(a => a.id === v.heirId)?.name ?? v.heirId : '家族へ既定順で継承'}</p>
    <h3>携帯品</h3><Holdings world={world} values={economy.holdings.filter(h => h.owner.kind === 'npc' && h.owner.id === actorId && h.storage.kind === 'carried')} />
    <h3>家・施設の保管品</h3><Holdings world={world} values={economy.holdings.filter(h => h.owner.kind === 'npc' && h.owner.id === actorId && h.storage.kind !== 'carried')} />
    <h3>雇用</h3>{economy.employment.filter(c => c.employeeId === actorId).map(c => <p key={c.id}>{ownerName(world, { kind: 'organization', id: c.organizationId })} · {c.status === 'active' ? '雇用中' : '提案中'} · 1勤務 {c.wage} {economy.currency}<small>{c.description}</small></p>)}
    <button className="button compact" onClick={() => void load()}>所持品の来歴を読む・更新</button>
    {error && <p role="alert">{error}</p>}{history && <Records records={history} />}
  </section>
}
export function CompanyEconomy({ world, organizationId }: { world: SimulationSnapshot; organizationId: string }) {
  const economy = world.economy!, company = economy.companies[organizationId], a = economy.accounts[`organization:${organizationId}`]
  return <div className="economy-company"><p>経営者: {company.managerId ? world.actors.find(n => n.id === company.managerId)?.name ?? company.managerId : '不在・経営停止'}</p><dl className="economy-totals">
    <dt>会社資金</dt><dd>{a.balance.toLocaleString()} {economy.currency}</dd><dt>売上・町外出荷</dt><dd>{(a.sales + a.exports).toLocaleString()}</dd><dt>仕入支出</dt><dd>{a.purchases.toLocaleString()}</dd><dt>給与支出</dt><dd>{a.wages.toLocaleString()}</dd><dt>差引収支</dt><dd>{(a.sales + a.exports - a.purchases - a.wages).toLocaleString()}</dd>
  </dl><h3>会社在庫</h3><Holdings world={world} values={economy.holdings.filter(h => h.owner.kind === 'organization' && h.owner.id === organizationId)} />
  <h3>求人・従業員</h3>{economy.employment.filter(c => c.organizationId === organizationId).map(c => <p key={c.id}>{c.employeeId ? world.actors.find(a => a.id === c.employeeId)?.name ?? c.employeeId : '公開求人'} · {c.status === 'active' ? '雇用中' : '提案中'} · 1勤務 {c.wage} {economy.currency}<small>{c.description}</small></p>)}</div>
}
export function EconomyPanel({ world, onAgent }: { world: SimulationSnapshot; onAgent: (id: string) => void }) {
  const [history, setHistory] = useState<EconomyRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hasEarlier, setHasEarlier] = useState(true)
  const economy = world.economy!
  const load = async (earlier: boolean) => {
    try {
      const rows = await window.persona.economyHistory(undefined, earlier ? history[0]?.id : undefined)
      setHistory(earlier ? [...rows, ...history] : rows); setHasEarlier(rows.length === 100); setError(null)
    } catch (e) { setError(String(e)) }
  }
  const status = { queued: '審査待ち', running: '審査中', approved: '許可', rejected: '拒否', failed: '実行失敗', uncertain: '結果不明' }
  return <section className="economy-panel" aria-label="経済"><header><h1>経済・アイテム</h1><p>住民の仕事と取引、品物の動きを観測します。</p></header>
    <div className="economy-summary"><span>町の資金 <strong>{Object.values(economy.accounts).reduce((n, a) => n + a.balance, 0).toLocaleString()} {economy.currency}</strong></span><span>登録品 <strong>{economy.catalog.length}種類</strong></span><span>出品 <strong>{economy.listings.length}件</strong></span></div>
    <h2>住民の状態</h2><div className="economy-residents">{world.actors.map(a => <button key={a.id} onClick={() => onAgent(a.id)}>{a.name}{a.activity === 'dead' ? '（故人）' : ''}<small>HP {economy.vitals[a.id].hp} · 空腹 {economy.vitals[a.id].hunger} · SAN {economy.vitals[a.id].san}</small></button>)}</div>
    <h2>カタログ</h2><div className="economy-grid">{economy.catalog.map(({ item, licensees, publicAcquisition }) => <article key={item.id}><h3>{item.name}</h3><p>{item.description}</p><p>{item.primary ? `一次産品 · 1勤務 ${item.primary.yield}個 · 出荷単価 ${item.primary.exportPrice}${economy.currency}` : `生成費用 ${item.cost}${economy.currency}`}</p><p>HP {item.effects.hp >= 0 ? '+' : ''}{item.effects.hp} / 空腹 {item.effects.hunger >= 0 ? '+' : ''}{item.effects.hunger} / SAN {item.effects.san >= 0 ? '+' : ''}{item.effects.san}{item.durability !== null && ` / 耐久 ${item.durability}`}</p><small>{publicAcquisition ? '初期公開品 · 誰でも取得可能' : `取得権: ${licensees.map(o => ownerName(world, o)).join('、')}`}</small></article>)}</div>
    <h2>販売・贈与</h2>{!economy.listings.length && <p className="economy-muted">現在の出品はありません。</p>}{economy.listings.map(l => { const h = economy.holdings.find(h => h.id === l.holdingId)!; return <article key={l.id}><h3>{itemName(world, h.itemId)} ×{l.quantity}</h3><p>{l.unitPrice === 0 ? '贈与' : `単価 ${l.unitPrice}${economy.currency}`} · {ownerName(world, h.owner)} · {storageName(world, h.storage)}</p><small>{l.targetId ? `受取人: ${world.actors.find(a => a.id === l.targetId)?.name ?? l.targetId}` : '公開販売'}</small></article> })}
    <h2>登録申請</h2>{!economy.requests.length && <p className="economy-muted">申請はありません。</p>}{economy.requests.map(r => <article key={r.id}><h3>{r.name} <small>{status[r.status]}</small></h3><p>{r.description}</p><p>{r.reason}</p><button onClick={() => onAgent(r.actorId)}>{world.actors.find(a => a.id === r.actorId)?.name ?? r.actorId}</button></article>)}
    <h2>取引・町外出荷の履歴</h2><button className="button compact" onClick={() => void load(false)}>最新100件を読む・更新</button>{error && <p role="alert">{error}</p>}<Records records={history} />{history.length > 0 && hasEarlier && <button className="button compact" onClick={() => void load(true)}>さらに前の100件</button>}
  </section>
}
