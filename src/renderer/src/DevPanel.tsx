import { useEffect, useState } from 'react'
import './dev.css'
import type { BackendSnapshot, BackendCommand } from '../../core/contracts'
import type { DevPanelState, DevState, PromptKey } from '../../core/dev-contracts'

const labels: Record<PromptKey, string> = { parent: '親Agent / System', npc: '住民 / System', facility: '施設 / System', memoryMatcher: '記憶照合 / System', consolidation: '記憶整理 / 依頼文', compiler: 'Character Compilation / 依頼文' }
export function DevPanel({ view, onError }: { view: BackendSnapshot; onError(error: unknown): void }) {
  const [panel, setPanel] = useState<DevPanelState | null>(null)
  const [key, setKey] = useState<PromptKey>('npc')
  const [prompts, setPrompts] = useState<DevState['prompts']>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [point, setPoint] = useState('')
  const [promptMode, setPromptMode] = useState<'latest' | 'checkpoint'>('latest')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let cancelled = false
    void window.persona.devPanel().then(value => {
      if (!cancelled) { setPanel(value); if (!dirty) setPrompts(value.state?.prompts ?? {}) }
    }, onError)
    return () => { cancelled = true }
  }, [view.dev?.revision, view.dev?.checkpoints, view.dev?.operation, dirty, onError])
  const run = async (command: BackendCommand) => {
    setBusy(true); setNotice('')
    try {
      await window.persona.backendCommand(command)
      const value = await window.persona.devPanel()
      setPanel(value); setPrompts(value.state?.prompts ?? {}); setDirty(false)
      setNotice(command.type === 'devPrompts' ? '保存し、既存Conversationへ適用しました。次の推論から使用します。' : command.type === 'devBranch' ? '実験分岐を作成しました。内容を確認して再開できます。' : 'この地点からチェックポイントを記録します。')
    } catch (error) { onError(error) } finally { setBusy(false) }
  }
  const active = view.preparation.busy || ['running', 'initializing'].includes(view.simulation?.stage ?? '')
  const blocked = busy || !!view.dev?.busy || active || !!view.persistence?.readOnlyReason || !!view.dev?.operation
  const selected = panel?.checkpoints.find(p => `${p.runId}:${p.id}` === point)
  return <section className="dev-panel" aria-label="DEV研究モード">
    <div className="dev-heading"><strong>DEV · プロンプト研究</strong><span>{panel?.state ? `Prompt revision ${panel.state.revision}` : '無効'}</span></div>
    <p>生成前と時間ターン終了時に保存します。巻き戻しは元の履歴を残す実験分岐です。有効化する前の地点は記録されません。</p>
    {!panel?.state ? <button className="button primary" disabled={blocked || !panel} onClick={() => void run({ type: 'devEnable' })}>DEVを有効にする</button> : <>
      {panel.state.origin && <p>分岐元: {panel.state.origin.runId} / {panel.state.origin.checkpointId}</p>}
      {view.dev?.operation && <p role="alert">DEV操作の結果が未確定です: {view.dev.operation.error ?? view.dev.operation.kind}。確定済みチェックポイントから分岐できます。</p>}
      <label>編集対象<select aria-label="DEV編集対象" value={key} onChange={event => setKey(event.target.value as PromptKey)}>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <p>住民は {'{{townName}}'} と {'{{birthModelId}}'}、施設は {'{{townName}}'} と {'{{facilityName}}'} を各Sessionの値に置き換えます。Toolの権限・Schema検証はHarnessが管理します。</p>
      <textarea aria-label="DEVプロンプト" spellCheck={false} value={prompts[key] ?? panel.defaults[key]} onChange={event => { setPrompts({ ...prompts, [key]: event.target.value }); setDirty(true) }} />
      <div className="dev-actions"><button className="button" disabled={blocked || !dirty} onClick={() => void run({ type: 'devPrompts', prompts })}>保存して適用</button><button className="button ghost" disabled={busy} onClick={() => { const next = { ...prompts }; delete next[key]; setPrompts(next); setDirty(true) }}>標準に戻す</button><span>{dirty ? '未適用の編集があります' : '保存済み'}{active ? ' · 適用するには一時停止してください' : ''}</span></div>
      {view.simulation?.stage === 'ended' && <button className="button" disabled={blocked || dirty || !view.authenticated || view.compilation?.status === 'running'} onClick={() => void run({ type: 'recompile' })}>この世界からCompilationを生成</button>}
      <label>戻る地点<select aria-label="DEVチェックポイント" value={point} onChange={event => setPoint(event.target.value)}><option value="">保存地点を選択</option>{panel.checkpoints.map(p => <option key={`${p.runId}:${p.id}`} value={`${p.runId}:${p.id}`}>{p.label} · {new Date(p.createdAt).toLocaleString()} · prompt {p.promptRevision} · {p.runId.slice(0, 8)}</option>)}</select></label>
      <label>復元後のプロンプト<select aria-label="DEV復元プロンプト" value={promptMode} onChange={event => setPromptMode(event.target.value as 'latest' | 'checkpoint')}><option value="latest">保存・適用済みの最新版を維持</option><option value="checkpoint">保存地点の版へ戻す</option></select></label>
      <div className="dev-actions"><button className="button" disabled={busy || dirty || !selected || (view.preparation.sessions.length > 0 && !view.persistence?.readOnlyReason && (!view.authenticated || view.connection !== 'connected'))} onClick={() => selected && void run({ type: 'devBranch', checkpointId: selected.id, runId: selected.runId, prompts: promptMode })}>この地点から実験分岐を作る</button><button className="button ghost" onClick={() => void window.persona.reveal('').catch(onError)}>保存フォルダー</button></div>
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
