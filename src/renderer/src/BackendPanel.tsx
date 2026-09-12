import { useEffect, useState } from 'react'
import type { AgentModelSettings, BackendCommand, BackendSnapshot, ModelInfo, QuestionRound } from '../../core/contracts'
import { autoModels, resolveEffort, supportedEfforts, validateSettings } from '../../core/models'
import { allocateCounts } from '../../core/population'

export function BackendPanel({ view, onError }: { view: BackendSnapshot; onError: (error: unknown) => void }) {
  const [pending, setPending] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [settings, setSettings] = useState<AgentModelSettings | null>(view.settings)
  const [revisionMessage, setRevisionMessage] = useState('')
  const savedSettings = JSON.stringify(view.settings)
  useEffect(() => { setSettings(JSON.parse(savedSettings) as AgentModelSettings | null) }, [savedSettings])
  const command = async (value: BackendCommand) => {
    setPending(true)
    try { await window.persona.backendCommand(value) } catch (error) { onError(error) } finally { setPending(false) }
  }
  const p = view.preparation
  const busy = pending || p.busy
  const fixed = p.sessions.length > 0
  let settingsError: string | null = null
  if (settings) { try { validateSettings(settings, view.models) } catch (e) { settingsError = e instanceof Error ? e.message : String(e) } }
  const draft = p.draft
  if (view.persistence?.readOnlyReason) return null
  if (view.simulation && p.phase === 'ready' && view.authenticated && view.connection === 'connected') {
    const simulation = view.simulation
    const recent = simulation.events.slice(-20).reverse()
    return <div className="backend-panel life-summary"><div className="backend-heading"><strong>{simulation.stage === 'ready' ? '初期ワールドの準備完了' : simulation.stage === 'ended' ? 'ターン上限に到達しました' : '住民の自律生活'}</strong><span>{simulation.actors.length}人 · {simulation.facilities.reduce((n, f) => n + (f.layout?.homes.length ?? 0), 0)}軒の家</span></div><details className="backend-section"><summary>最近の出来事・保存済み設定</summary><p>親: {view.settings?.parent.modelId} · 施設: {view.settings?.facility.modelId} · NPC: {view.settings?.npc.model.mode === 'auto' ? 'Auto（先天的モデル）' : view.settings?.npc.model.modelId}</p><p>初期状態はturn=0です。実行中も端末へ誘導メッセージを入力できます。</p>{recent.map(e => <p key={e.sequence}><small>Turn {e.turn} · {simulation.actors.find(a => a.id === e.actorId)?.name}</small> {e.text}</p>)}</details></div>
  }
  return <div className={`backend-panel ${draft ? 'with-map' : ''}`}>
    <div className="backend-heading"><strong>{p.phase === 'idle' ? '接続とモデル設定' : p.phase === 'interview' ? '世界のヒアリング' : p.phase === 'review' ? `仕様レビュー · revision ${p.revision}` : p.phase === 'ready' ? '初期ワールドの準備完了' : '初期人口・施設を生成中'}</strong><span>{view.connection === 'connected' ? view.authenticated ? '認証済み' : '認証待ち' : '未接続'}</span></div>
    {(view.connection !== 'connected' || !view.authenticated) && <div className="backend-section">
      <p>アプリ専用のCodexへ接続します。認証情報はCodexのkeyringに保存します。</p>
      <div className="backend-actions"><button className="button" disabled={busy} onClick={() => void command({ type: 'connect', authMode: 'chatgpt' })}>ChatGPTで接続</button><button className="button" disabled={busy} onClick={() => void command({ type: 'connect', authMode: 'apiKey' })}>APIキーで接続</button></div>
      {view.connection === 'connected' && view.authMode === 'chatgpt' && !view.authenticated && <div className="backend-actions"><button className="button primary" disabled={busy || !!view.login} onClick={() => void command({ type: 'loginChatGpt' })}>{view.login ? 'ブラウザーでのログインを待っています' : 'ChatGPTにログイン'}</button>{view.login && <button className="button" disabled={pending} onClick={() => void command({ type: 'cancelLogin' })}>キャンセル</button>}</div>}
      {view.connection === 'connected' && view.authMode === 'apiKey' && !view.authenticated && <form onSubmit={e => { e.preventDefault(); const key = apiKey; setApiKey(''); void command({ type: 'loginApiKey', apiKey: key }) }}><label>APIキー<input aria-label="APIキー" type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} required maxLength={1000} /></label><button className="button primary" disabled={busy || !apiKey.trim()}>キーで認証</button></form>}
    </div>}
    {view.authenticated && settings && <details className="backend-section" open={p.phase === 'idle'}><summary>役割別モデル・effort {fixed && '（保存済み）'}</summary><fieldset disabled={busy || fixed}>
      <FixedRole label="親" value={settings.parent} models={view.models} onChange={parent => setSettings({ ...settings, parent })} />
      <div className="model-row"><strong>NPC</strong><label>モデル<select aria-label="NPCモデル" value={settings.npc.model.mode === 'auto' ? 'auto' : settings.npc.model.modelId} onChange={e => {
        const id = e.target.value
        const model = view.models.find(m => m.model === id)
        setSettings({ ...settings, npc: { ...settings.npc, model: id === 'auto' ? { mode: 'auto' } : { mode: 'fixed', modelId: id }, effort: model && settings.npc.effort.mode === 'fixed' ? { mode: 'fixed', effort: model.defaultReasoningEffort } : settings.npc.effort } })
      }}><option value="auto" disabled={!autoModels(view.models).length}>Auto · 出生時に親が選択</option>{view.models.map(m => <option key={m.model} value={m.model}>{m.displayName}</option>)}</select></label><label>effort<select aria-label="NPC effort" value={settings.npc.effort.mode === 'auto' ? 'auto' : settings.npc.effort.effort} onChange={e => setSettings({ ...settings, npc: { ...settings.npc, effort: e.target.value === 'auto' ? { mode: 'auto' } : { mode: 'fixed', effort: e.target.value } } })}><option value="auto">Auto · 年齢に応じる</option>{npcEfforts(settings, view.models).map(e => <option key={e} value={e}>{e}</option>)}</select></label></div>
      <FixedRole label="施設" value={settings.facility} models={view.models} onChange={facility => setSettings({ ...settings, facility })} />
      {settings.npc.effort.mode === 'auto' && <table><caption>NPC年齢 → 要求effort → 実効effort</caption><thead><tr><th>モデル</th><th>0〜5歳 · low</th><th>6〜17歳 · medium</th><th>18歳〜 · high</th></tr></thead><tbody>{npcModels(settings, view.models).map(m => <tr key={m.model}><th>{m.displayName}</th>{[0, 6, 18].map(age => <td key={age}>{mapping(m, age)}</td>)}</tr>)}</tbody></table>}
      {settings.npc.model.mode === 'auto' && <p>モデルはスポーン時に先天的特徴として決まり、生涯固定されます。候補: {autoModels(view.models).map(m => m.displayName).join('、') || 'なし'}</p>}
      {settingsError && <p role="alert">{settingsError}</p>}
      {!fixed && <button className="button primary" disabled={busy || !!settingsError} onClick={() => void command({ type: 'settings', settings })}>設定を保存して親端末を作成</button>}
    </fieldset></details>}
    {p.round && <Questions key={p.round.id} round={p.round} busy={busy || !view.authenticated} submit={value => command({ type: 'answers', value })} />}
    {draft && <div className="backend-section"><h3>{draft.specification.town.name} · {draft.specification.population.count}人</h3><p>{draft.specification.town.setting}</p><div className="population-summary"><div><strong>年齢分布</strong>{draft.specification.population.ageDistribution.map((a, i, rows) => <p key={i}>{a.min}〜{a.max}歳: {a.ratio * 100}% → {allocateCounts(draft.specification.population.count, rows.map(r => r.ratio))[i]}人</p>)}</div><div><strong>性別比率</strong>{draft.specification.population.sexRatio.map((a, i, rows) => <p key={a.sex}>{a.sex}: {a.ratio * 100}% → {allocateCounts(draft.specification.population.count, rows.map(r => r.ratio))[i]}人</p>)}</div></div><p>施設: {draft.specification.town.facilities.map(f => `${f.name}（${f.type}${f.dimensions ? ` / ${f.dimensions.x} × ${f.dimensions.y} × ${f.dimensions.z}` : ''}）`).join('、')}</p><p>ターン上限: {draft.specification.simulation.maxTurns} · 終了条件: {endLabels[draft.specification.simulation.endCondition]}</p>
      {p.phase === 'review' && <><label>地図・仕様への修正依頼<textarea aria-label="仕様の修正依頼" rows={2} value={revisionMessage} maxLength={50000} onChange={e => setRevisionMessage(e.target.value)} /></label><div className="backend-actions"><button className="button" disabled={busy || !revisionMessage.trim() || !view.authenticated} onClick={() => void command({ type: 'revise', revision: draft.revision, message: revisionMessage })}>親へ修正を依頼</button><button className="button primary" disabled={busy || !!p.error || !view.authenticated} onClick={() => void command({ type: 'approve', revision: draft.revision })}>revision {draft.revision}を承認</button></div></>}
      {p.lock && <p className="lock-record">承認済み revision {p.lock.revision} · hash {p.lock.hash.slice(0, 12)}</p>}
    </div>}
    {busy && <p className="backend-section" role="status">{pending ? '処理中…' : '親の応答・初期化を待っています。端末でも確認できます。'}</p>}
    {p.phase === 'ready' && <p className="backend-section">初期NPC {p.population?.npcs.length}人と施設のConversationを用意しました。地図・一覧から実端末を開けます。世界時刻はturn=0で停止しています。</p>}
    {(p.error || p.paused) && <div className="backend-section"><p role="alert">{p.error ?? '準備を一時停止しています。'}</p><button className="button" disabled={busy || !view.authenticated} onClick={() => void command({ type: 'retry' })}>保存済みの状態から再開</button></div>}
  </div>
}
const endLabels = { turn_limit: 'ターン上限', generation_zero_extinction: '初期世代の全員死亡', generation_zero_extinction_with_turn_limit: '初期世代の全員死亡、またはターン上限' }
function npcModels(settings: AgentModelSettings, models: ModelInfo[]) { const policy = settings.npc.model; return policy.mode === 'auto' ? autoModels(models) : models.filter(m => m.model === policy.modelId) }
function npcEfforts(settings: AgentModelSettings, models: ModelInfo[]) { const candidates = npcModels(settings, models); return candidates.length ? supportedEfforts(candidates[0]).filter(e => candidates.every(m => supportedEfforts(m).includes(e))) : [] }
function mapping(model: ModelInfo, age: number) { try { return resolveEffort(model, { mode: 'auto' }, age).effective } catch { return '対応するeffortなし' } }
function FixedRole({ label, value, models, onChange }: { label: string; value: AgentModelSettings['parent']; models: ModelInfo[]; onChange: (value: AgentModelSettings['parent']) => void }) {
  const model = models.find(m => m.model === value.modelId)
  return <div className="model-row"><strong>{label}</strong><label>モデル<select aria-label={`${label}モデル`} value={value.modelId} onChange={e => { const m = models.find(m => m.model === e.target.value); if (m) onChange({ modelId: m.model, effort: m.defaultReasoningEffort }) }}>{models.map(m => <option key={m.model} value={m.model}>{m.displayName}</option>)}</select></label><label>effort<select aria-label={`${label} effort`} value={value.effort} onChange={e => onChange({ ...value, effort: e.target.value })}>{model?.supportedReasoningEfforts.map(e => <option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort}</option>)}</select></label></div>
}
function Questions({ round, busy, submit }: { round: QuestionRound; busy: boolean; submit: (value: { roundId: string; answers: { questionId: string; optionId: string | null; text: string }[] }) => Promise<void> }) {
  const [answers, setAnswers] = useState(round.questions.map(q => ({ questionId: q.id, optionId: null as string | null, text: '' })))
  return <form className="backend-section question-form" onSubmit={e => { e.preventDefault(); void submit({ roundId: round.id, answers }) }}>{round.questions.map((q, i) => <fieldset key={q.id} disabled={busy}><legend>{i + 1}. {q.question}</legend><p>{q.reason}</p>{q.options.map(o => <label className="question-option" key={o.id}><input type="radio" name={q.id} checked={answers[i].optionId === o.id} onChange={() => setAnswers(answers.map((a, j) => j === i ? { ...a, optionId: o.id } : a))} /><span>{o.label}{q.recommendedOptionId === o.id && <small> 推奨</small>}<em>{o.description}</em></span></label>)}<label className="question-option"><input type="radio" name={q.id} checked={answers[i].optionId === null} onChange={() => setAnswers(answers.map((a, j) => j === i ? { ...a, optionId: null } : a))} />自由記述</label><textarea aria-label={`${q.question} 自由記述`} value={answers[i].text} maxLength={10000} rows={2} onChange={e => setAnswers(answers.map((a, j) => j === i ? { ...a, text: e.target.value } : a))} /></fieldset>)}<button className="button primary" disabled={busy || answers.some(a => !a.optionId && !a.text.trim())}>まとめて回答を送信</button></form>
}
