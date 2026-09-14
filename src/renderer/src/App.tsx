import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ArrowRight, CircleHelp, ExternalLink, FileText, FolderOpen, GitBranch, Globe2, ImagePlus, Layers3, Map, Pause, Play, Plus, RotateCcw, Sun, X } from 'lucide-react'
import type { AgentDescriptor, FilePreview, ImageInput, WorkspaceSnapshot } from '../../shared/contracts'
import { Explorer } from './Explorer'
import { TerminalPane } from './TerminalPane'
import { WorldView } from './WorldView'
import { BackendPanel } from './BackendPanel'
import { LifecyclePanel } from './LifecyclePanel'
import { PersistencePanel } from './PersistencePanel'
import { DevPanel } from './DevPanel'
import { CharacterReview } from './CharacterReview'
import { PackageInspection } from './PackageInspection'
import { EventTimeline } from './EventTimeline'

const phaseLabels = { morning: '朝', noon: '昼', evening: '夕', night: '夜' }
const stageLabels = { draft: '準備前', preparing: '準備中', ready: '準備完了', running: 'シミュレーション中', paused: '一時停止中', ended: '終了', error: 'エラー' }

export default function App() {
  const [devOpen, setDevOpen] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [tabs, setTabs] = useState(['parent'])
  const [activeId, setActiveId] = useState<string | null>('parent')
  const [unread, setUnread] = useState<Set<string>>(new Set())
  const activeRef = useRef<string | null>(null)
  const agentsRef = useRef<AgentDescriptor[]>([])
  agentsRef.current = workspace ? workspace.state.agents : []
  activeRef.current = agentsRef.current.find(agent => agent.id === activeId)?.sessionId ?? null
  const [mode, setMode] = useState<'map' | 'relationships' | 'events'>('map')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRequest, setPreviewRequest] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [leftWidth, setLeftWidth] = useState(230)
  const [rightWidth, setRightWidth] = useState(440)
  const report = useCallback((value: unknown) => setError(value instanceof Error ? value.message : String(value)), [])

  useEffect(() => {
    const resize = () => setRightWidth(previous => Math.max(310, Math.min(window.innerWidth - leftWidth - 350, previous)))
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [leftWidth])

  useEffect(() => {
    const unsubscribe = window.persona.onEvent(event => {
      if (event.type === 'workspace') setWorkspace(previous => !previous || previous.root !== event.snapshot.root || event.snapshot.version >= previous.version ? event.snapshot : previous)
      if (event.type === 'error') report(event.message)
      if (event.type === 'terminal' && event.chunk.sessionId !== activeRef.current) setUnread(previous => previous.has(event.chunk.sessionId) ? previous : new Set([...previous, event.chunk.sessionId]))
    })
    void window.persona.snapshot().then(snapshot => setWorkspace(previous => previous ?? snapshot), report)
    return unsubscribe
  }, [report])
  const runId = workspace?.state.runId
  useEffect(() => {
    setTabs(['parent']); setActiveId('parent'); setUnread(new Set()); setSelectedFile(null); setPreview(null); setPreviewError(null); setError(null); setMode('map')
  }, [runId])

  const previewVersion = workspace?.fileVersions ? (selectedFile ? workspace.fileVersions[selectedFile] : 0) : workspace?.version
  useEffect(() => {
    if (!selectedFile) { setPreview(null); setPreviewError(null); return }
    let cancelled = false
    void window.persona.preview(selectedFile).then(value => {
      if (!cancelled) { setPreview(value); setPreviewError(null) }
    }, reason => { if (!cancelled) setPreviewError(String(reason)) })
    return () => { cancelled = true }
  }, [selectedFile, previewVersion, previewRequest])

  const openAgent = useCallback((id: string) => {
    setTabs(previous => previous.includes(id) ? previous : [...previous, id])
    setActiveId(id)
    const sessionId = agentsRef.current.find(agent => agent.id === id)?.sessionId
    if (sessionId) setUnread(previous => { const next = new Set(previous); next.delete(sessionId); return next })
  }, [])
  const openFile = useCallback((file: string) => {
    if (file === selectedFile) {
      if (!previewError) return
      setPreviewRequest(value => value + 1)
    }
    setSelectedFile(file); setPreview(null); setPreviewError(null)
  }, [selectedFile, previewError])
  const closeTab = (id: string) => {
    const next = tabs.filter(tab => tab !== id)
    setTabs(next)
    if (activeId === id) setActiveId(next.length ? next[next.length - 1] : null)
  }
  const action = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation() } catch (reason) { report(reason) } finally { setBusy(false) }
  }
  const beginResize = (event: React.PointerEvent<HTMLDivElement>, side: 'left' | 'right') => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = event.clientX
    const width = side === 'left' ? leftWidth : rightWidth
    const target = event.currentTarget
    const move = (next: PointerEvent) => {
      const delta = next.clientX - start
      if (side === 'left') setLeftWidth(Math.max(180, Math.min(360, width + delta)))
      else setRightWidth(Math.max(310, Math.min(window.innerWidth - leftWidth - 350, width - delta)))
    }
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end) }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end)
  }

  if (!workspace) return <div className="loading"><Layers3 size={32} /><strong>Persona Compiler</strong><span>{error ?? 'ワークスペースを開いています…'}</span></div>
  const { state } = workspace
  const readOnly = !!workspace.backend?.persistence?.readOnlyReason
  const agent = state.agents.find(item => item.id === activeId)
  const npcs = state.agents.filter(item => item.role === 'npc')
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-symbol"><Layers3 size={21} /></span><strong>Persona<span>Compiler</span></strong><span className="build-label">PREVIEW 0.1</span></div><div className="project-title"><Globe2 size={13} />{state.map?.name ?? '新しいシミュレーション'}<span>/ LOCAL</span></div><div className="header-right"><span className="demo-badge">{workspace.backend ? 'CODEX CLI' : 'DEMO MODE'}</span><button className="icon-button" title={workspace.backend ? 'Codex App Serverと実CLIに接続します。初期生成後はturn=0で停止します。' : 'この初期版は模擬Sessionです。ファイル操作は実際のディスクを使用します。'} aria-label="動作モードについて"><CircleHelp size={17} /></button></div></header>
    <div className="run-toolbar"><div className="run-state"><span className={`status-dot ${state.stage === 'paused' ? 'paused' : ''}`} /><strong>{stageLabels[state.stage]}</strong><span className="toolbar-divider" /><span className="time-day">DAY {String(state.frame.day).padStart(2, '0')}</span><Sun size={14} /><span>{phaseLabels[state.frame.phase]}</span><span className="muted">Turn {String(state.frame.turn).padStart(3, '0')}</span></div><div className="run-actions">{workspace.backend && <button className={`button compact ${devOpen ? 'primary' : 'ghost'}`} onClick={() => setDevOpen(!devOpen)}>DEV{workspace.backend.dev ? ' ON' : ''}</button>}{['running', 'preparing', 'paused'].includes(state.stage) && <button className="button compact" disabled={busy || readOnly} onClick={() => void action(() => state.stage === 'paused' ? window.persona.resume() : window.persona.pause())}>{state.stage === 'paused' ? <Play size={13} /> : <Pause size={13} />}{state.stage === 'paused' ? '再開' : '一時停止'}</button>}<button className="button ghost compact" disabled={busy} onClick={() => void action(() => window.persona.newRun())}><Plus size={14} />新しい実行</button></div></div>
    {state.simulation && ['ready', 'paused', 'error'].includes(state.stage) && <div className="life-controls"><span>{state.simulation.error ?? (state.stage === 'ready' ? '住宅街と住民の準備が整いました。' : '確定した行動を保持して停止しています。')}</span><button className="button compact primary" disabled={busy || readOnly || !workspace.backend?.authenticated || workspace.backend.connection !== 'connected'} onClick={() => void action(() => window.persona.startSimulation(false))}><Play size={12} />{state.stage === 'ready' ? '生活を開始' : '生活を再開'}</button><button className="button compact" disabled={busy || readOnly || !workspace.backend?.authenticated || workspace.backend.connection !== 'connected'} onClick={() => void action(() => window.persona.startSimulation(true))}>1ターン実行</button></div>}
    {(error || workspace.error) && <div className="error-banner" role="alert"><Activity size={14} /><span>{error || workspace.error}{workspace.error && ' — 表示データは最新ではありません。'}</span>{error && <button className="icon-button" onClick={() => setError(null)} aria-label="エラーを閉じる"><X size={14} /></button>}</div>}
    {workspace.backend?.persistence && <PersistencePanel status={workspace.backend.persistence} onError={report} />}
    <main className="workspace" style={{ gridTemplateColumns: `${leftWidth}px 5px minmax(260px, 1fr) 5px ${rightWidth}px 48px` }}>
      <Explorer projectName={state.map?.name ?? '新しいシミュレーション'} files={workspace.files} agents={state.agents} selected={selectedFile} activeAgent={activeId} onSelect={openFile} onAgent={openAgent} onReveal={() => void window.persona.reveal('').catch(report)} />
      <div className="resize-handle" role="separator" aria-label="エクスプローラー幅" aria-orientation="vertical" onPointerDown={event => beginResize(event, 'left')} />
      <section className="center-panel">
        <div className="center-tabs"><button className={!selectedFile && mode === 'map' ? 'active' : ''} onClick={() => { setSelectedFile(null); setMode('map') }}><Map size={15} />ワールド</button><button className={!selectedFile && mode === 'relationships' ? 'active' : ''} onClick={() => { setSelectedFile(null); setMode('relationships') }}><GitBranch size={15} />関係図</button>{state.simulation && <button className={!selectedFile && mode === 'events' ? 'active' : ''} onClick={() => { setSelectedFile(null); setMode('events') }}><Activity size={15} />出来事</button>}{selectedFile && <button className="active file-tab" onClick={() => setSelectedFile(null)}><FileText size={14} /><span>{selectedFile.split('/').at(-1)}</span><X size={13} /></button>}<span className="view-label">{selectedFile ? 'FILE PREVIEW' : 'OBSERVATORY'}</span></div>
        {devOpen && workspace.backend && <DevPanel key={`dev:${runId}`} view={workspace.backend} onError={report} />}
        {state.simulation?.lifecycle && !selectedFile && mode !== 'events' && <LifecyclePanel simulation={state.simulation} backend={workspace.backend} onAgent={openAgent} onFile={openFile} onError={report} />}
        {workspace.backend && !selectedFile && mode !== 'events' && <BackendPanel key={runId} view={workspace.backend} onError={report} />}
        {selectedFile ? <div className="file-preview"><div className="file-preview-heading"><span title={selectedFile}>{selectedFile}</span><button className="icon-button" aria-label="外部エディターで開く" title="外部エディターで開く" onClick={() => void window.persona.openExternal(selectedFile).catch(report)}><ExternalLink size={15} /></button><button className="icon-button" aria-label="Windows Explorerで表示" title="Windows Explorerで表示" onClick={() => void window.persona.reveal(selectedFile).catch(report)}><FolderOpen size={15} /></button></div>{previewError && <div className="preview-error" role="alert">{previewError} {preview && '前回の内容を表示しています。'} <button className="button compact" onClick={() => openFile(selectedFile)}>プレビューを再読み込み</button></div>}{preview ? preview.kind === 'image' ? <img className="image-preview" alt={selectedFile} src={preview.content} /> : selectedFile.startsWith('compilation/') && selectedFile.endsWith('/review.json') ? <CharacterReview key={`${selectedFile}:${preview.hash}`} content={preview.content} currentPath={selectedFile} currentHash={preview.hash} runId={workspace.state.runId} files={workspace.files} fileVersions={workspace.fileVersions} workspaceVersion={workspace.version} /> : /^compilation\/[^/]+\/npcs\/[^/]+\/manifest\.json$/.test(selectedFile) ? <PackageInspection key={`${selectedFile}:${preview.hash}`} manifestPath={selectedFile} content={preview.content} files={workspace.files} /> : <pre data-testid="file-content">{preview.content}</pre> : !previewError && <p className="muted">読み込み中…</p>}<div className="preview-footer">READ ONLY VIEW <span>編集は外部エディターへ · 保存すると自動反映</span></div></div>
          : mode === 'events' && state.simulation ? <EventTimeline key={runId} runId={state.runId} historyAvailable={!!workspace.backend?.persistence} simulation={state.simulation} onAgent={openAgent} />
          : state.map ? <WorldView key={`world:${runId}`} state={state} mode={mode === 'events' ? 'map' : mode} onAgent={openAgent} staleRelations={workspace.staleRelations} onFile={openFile} />
          : state.stage === 'draft' && (!workspace.backend || workspace.backend.preparation.sessions.length > 0) ? <Preparation real={!!workspace.backend} busy={busy || (!!workspace.backend && (!workspace.backend.authenticated || workspace.backend.preparation.busy))} onPrepare={(description, images) => void action(() => window.persona.prepare({ description, images }))} onError={report} />
          : <div className="preparing"><div className="preparing-icon"><Globe2 size={35} /></div><span className="eyebrow">PREPARATION PHASE</span><h2>{workspace.backend?.preparation.phase === 'idle' ? '世界を始める準備' : '町の輪郭を描いています'}</h2><p>{workspace.backend?.preparation.phase === 'idle' ? '接続・認証後に役割別設定を保存してください。' : '親エージェントと、地図と住民のための場所を準備中。'}</p>{!workspace.backend && <span className="demo-explanation">デモの地図を生成しています</span>}</div>}
        <div className="world-footer"><span><span className="status-dot" />{npcs.length} 人の住民</span><span>{state.map?.locations.length ?? 0} 施設</span><span>{state.relationships?.relations.length ?? 0} 関係</span><span className="footer-right">{state.map ? '人物をクリックして端末を開く' : 'まずは世界の準備から'}</span></div>
      </section>
      <div className="resize-handle" role="separator" aria-label="端末幅" aria-orientation="vertical" onPointerDown={event => beginResize(event, 'right')} />
      {agent ? <TerminalPane key={`${runId}:${agent.sessionId}`} agent={agent} readOnly={state.simulation?.actors.some(a => a.id === agent.id && (a.activity === 'dead' || state.simulation?.stage === 'ended'))} real={!!workspace.backend} memoryEnabled={workspace.backend?.preparation.sessions.some(s => s.agentId === agent.id && s.memoryVersion === 1)} connected={!readOnly && (!workspace.backend || (workspace.backend.connection === 'connected' && workspace.backend.authenticated))} onError={report} /> : <div className="terminal-empty"><Layers3 size={24} /><strong>端末を選択してください</strong><p>地図やエージェント一覧から開けます。<br />非表示のSessionも継続しています。</p></div>}
      <nav className="vertical-tabs" aria-label="端末タブ">{tabs.map(id => {
        const person = state.agents.find(item => item.id === id)
        if (!person) return null
        return <div key={id} className={`vertical-tab ${activeId === id ? 'active' : ''}`} style={{ '--agent-color': person.color } as React.CSSProperties}><button className="tab-select" onClick={() => openAgent(id)} aria-label={`${person.name}のタブ`} title={person.name}><span className={`tab-dot ${person.status}`} /><span className="vertical-label">{person.role === 'parent' ? '親エージェント' : person.name}</span>{unread.has(person.sessionId) && <span className="unread-dot" aria-label="未確認の更新" />}</button><button className="tab-close" onClick={() => closeTab(id)} aria-label={`${person.name}のタブを閉じる`} title="表示のみ閉じる"><X size={12} /></button></div>
      })}</nav>
    </main>
    <footer className="status-bar"><span><span className="status-dot" /> ローカル接続</span><span>{workspace.backend ? `Codex CLI / ${workspace.backend.authenticated ? '認証済み' : '認証待ち'}` : '模擬Session / 実モデル未接続'}</span><span className="status-path" title={workspace.root}>{workspace.root}</span><span><Activity size={11} /> DISK SYNC</span></footer>
  </div>
}

function Preparation({ busy, real, onPrepare, onError }: { busy: boolean; real: boolean; onPrepare: (description: string, images: ImageInput[]) => void; onError: (error: unknown) => void }) {
  const [description, setDescription] = useState('緑に囲まれた小さな町。住宅街の向こうに公園があり、町の中心には喫茶店、図書室、小さな工房があります。住民たちが日常の中で出会い、それぞれの関係を築いていきます。')
  const [images, setImages] = useState<ImageInput[]>([])
  const [loading, setLoading] = useState(false)
  const chooseImages = async (files: FileList | null) => {
    if (!files) return
    setLoading(true)
    try {
      if (files.length > 10) throw new Error('画像は10枚まで選択できます')
      const selected = await Promise.all(Array.from(files).map(async file => {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: 画像は20MB以下にしてください`)
        return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
      }))
      setImages(selected)
    } catch (error) { onError(error) } finally { setLoading(false) }
  }
  return <div className="preparation-scroll"><form className="preparation" onSubmit={event => { event.preventDefault(); onPrepare(description, images) }}><div className="setup-kicker"><span>01</span> WORLD PREPARATION</div><div className="setup-illustration"><Globe2 size={37} strokeWidth={1.1} /><span className="orbit-dot" /></div><h1>世界の、はじまり。</h1><p className="setup-intro">舞台となる町について教えてください。<br />地図を用意して、住民たちの暮らしを観測しましょう。</p><label className="field-label" htmlFor="description">地域の説明<span>TEXT / MARKDOWN</span></label><textarea id="description" value={description} onChange={event => setDescription(event.target.value)} required maxLength={50000} rows={5} /><label className="image-drop"><ImagePlus size={20} /><span>参考の地図や手描き図を追加<small>PNG・JPEG・WebP / 各20MBまで</small></span><Plus size={16} /><input type="file" accept=".png,.jpg,.jpeg,.webp" multiple onChange={event => void chooseImages(event.target.files)} /></label>{images.length > 0 && <div className="chosen-images">{images.map((image, index) => <span key={`${image.name}:${index}`}>{image.name}<button type="button" aria-label={`${image.name}を外す`} onClick={() => setImages(previous => previous.filter((_, i) => i !== index))}><X size={12} /></button></span>)}</div>}{!real && <div className="demo-notice"><RotateCcw size={14} /><p>今回はサンプルの町で動作を確認します。<br /><span>入力は保存されます。任意の資料からの地図生成は今後接続します。</span></p></div>}<button className="button primary start-demo" type="submit" disabled={busy || loading || !description.trim()}>{busy ? '準備を開始しています…' : real ? '資料を送信してヒアリングを開始' : 'デモを開始'}<ArrowRight size={16} /></button><div className="setup-footnote">{real ? '質問に回答し、地図付き仕様を承認して初期世界を生成します' : '6つの施設 · 最大6人の住民 · 一日4フェーズ'}</div></form></div>
}
