import type { BackendSnapshot } from '../../core/contracts'
import type { SimulationSnapshot } from '../../core/life-contracts'
import './lifecycle.css'

const reasons = { turn_limit: '指定ターンに到達', generation_zero_extinction: '初期世代の全員死亡', population_extinction: '全住民死亡' }
const statuses = { pending: '準備待ち', prepared: '資料保存済み', requested: '生成中', running: '生成中', completed: '完了', failed: '失敗', empty: '生存者なし', scheduled: '予定', complete: '完了', cancelled: '取消', consent: '入居同意待ち', building: '建築中' }
export function LifecyclePanel({ simulation, backend, onAgent, onFile, onError }: { simulation: SimulationSnapshot; backend?: BackendSnapshot; onAgent(id: string): void; onFile(path: string): void; onError(message: string): void }) {
  const state = simulation.lifecycle
  if (!state) return null
  const alive = state.residents.filter(n => n.diedTurn === null), dead = state.residents.filter(n => n.diedTurn !== null)
  const compilation = backend?.compilation
  return <section className="lifecycle-panel" aria-label="住民と世代交代">
    <div className="lifecycle-summary"><strong>生存 {alive.length}人 · 初期世代 {alive.filter(n => n.generation === 0).length}人</strong><span>1日で1歳 · 老衰80歳</span>{state.endReason && <strong data-testid="end-reason">{reasons[state.endReason]}</strong>}</div>
    <details><summary>住民台帳・家族・世帯</summary><div className="lifecycle-residents">{alive.map(n => <button key={n.id} onClick={() => onAgent(n.id)}><strong>{n.name} · {n.age}歳 · 第{n.generation}世代</strong><small>{n.householdId}</small><small>{n.family.map(f => `${({ parent: '親', child: '子', sibling: '兄弟姉妹', spouse: '配偶者' })[f.relation]}: ${state.residents.find(p => p.id === f.npcId)?.name ?? f.npcId}`).join(' / ')}</small></button>)}</div></details>
    <details><summary>故人の履歴 · {dead.length}人</summary>{dead.map(n => <button key={n.id} onClick={() => onAgent(n.id)}>{n.name} · {n.age}歳 · 第{n.generation}世代 · turn {n.diedTurn}</button>)}</details>
    <details><summary>出生予約 {state.births.filter(b => b.status === 'scheduled').length}件 / 新居申請 {state.homes.filter(h => ['consent', 'building'].includes(h.status)).length}件</summary>{state.births.map(b => <p key={b.id}>{b.id} · 経過{b.dueDay}日後 · {statuses[b.status]} {b.reason}</p>)}{state.homes.map(h => <p key={h.id}>{h.id} · {statuses[h.status]} · {h.description} {h.reason}</p>)}</details>
    {compilation && <div className="compilation-panel" aria-label="Character Compilation"><strong>NPCパッケージ · {statuses[compilation.status]}</strong><p>シミュレーション終了後に自動生成します。</p>{compilation.tasks.map(task => <div key={task.npcId}><span>{task.name} · {statuses[task.status]}</span>{task.error && <p role="alert">{task.error}</p>}{task.status === 'completed' && <><button onClick={() => onFile(`${task.output}/character.json`)}>人物情報</button><button onClick={() => onFile(`${task.output}/system_prompt.md`)}>Runtime Prompt</button><button onClick={() => void window.persona.reveal(task.output).catch(e => onError(String(e)))}>保存フォルダー</button></>}</div>)}{['completed', 'failed'].includes(compilation.status) && <button disabled={!backend?.authenticated || !!backend.persistence?.readOnlyReason} onClick={() => void window.persona.backendCommand({ type: 'recompile' }).catch(e => onError(String(e)))}>新しい出力として再生成</button>}</div>}
  </section>
}
