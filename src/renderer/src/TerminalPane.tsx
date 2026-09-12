import { useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { MessageCircle, Square, TerminalSquare } from 'lucide-react'
import type { AgentDescriptor, TerminalChunk } from '../../shared/contracts'
import { roleLabels } from './labels'
import { MessageView } from './MessageView'
import { MemoryPanel } from './MemoryPanel'

export function TerminalPane({ agent, real = false, connected = true, memoryEnabled = false, onError }: { agent: AgentDescriptor; real?: boolean; connected?: boolean; memoryEnabled?: boolean; onError: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [view, setView] = useState<'codex' | 'messages' | 'memory'>('codex')
  const reconnect = async () => {
    setReconnecting(true)
    try { await window.persona.backendCommand({ type: 'terminalReconnect', sessionId: agent.sessionId }); setGeneration(value => value + 1) }
    catch (error) { onError(error instanceof Error ? error.message : String(error)) }
    finally { setReconnecting(false) }
  }
  useLayoutEffect(() => {
    setReady(false)
    if (!container.current || !connected) return
    const terminal = new Terminal({
      cursorBlink: true, scrollback: 3000, fontFamily: '"Cascadia Code", "Yu Gothic UI", Consolas, monospace', fontSize: 12, lineHeight: 1.6,
      theme: { background: '#101514', foreground: '#cdd6d1', cursor: '#b8d3ba', selectionBackground: '#374e43', black: '#101514', green: '#a5cda9', brightGreen: '#c2e7c4', cyan: '#94bdc3' }
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container.current)
    let disposed = false
    let initialized = false
    let sequence = 0
    let pending: TerminalChunk[] = []
    let resizing: Promise<void> = Promise.resolve()
    const report = (error: unknown) => { if (!disposed) onError(error instanceof Error ? error.message : String(error)) }
    terminal.attachCustomKeyEventHandler(event => {
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
        event.preventDefault()
        if (event.type === 'keydown' && !event.repeat) void navigator.clipboard.writeText(terminal.getSelection()).catch(report)
        return false
      }
      return true
    })
    const apply = (chunk: TerminalChunk) => {
      if (chunk.sequence <= sequence) return
      if (chunk.sequence !== sequence + 1) {
        onError(`端末出力の連番が不連続です: ${agent.sessionId} / ${sequence} → ${chunk.sequence}`)
        return
      }
      terminal.write(chunk.data)
      sequence = chunk.sequence
    }
    const unsubscribe = window.persona.onEvent(event => {
      if (event.type !== 'terminal' || event.chunk.sessionId !== agent.sessionId) return
      if (initialized) apply(event.chunk)
      else pending.push(event.chunk)
    })
    const fitTerminal = () => {
      if (!initialized || disposed || container.current?.hidden) return
      const dimensions = fit.proposeDimensions()
      if (!dimensions || dimensions.cols < 2 || dimensions.rows < 1) return
      const cols = Math.min(500, dimensions.cols)
      const rows = Math.min(200, dimensions.rows)
      if (terminal.cols === cols && terminal.rows === rows) return
      terminal.resize(cols, rows)
      resizing = resizing.then(() => window.persona.terminalResize(agent.sessionId, cols, rows))
      void resizing.catch(report)
    }
    void window.persona.terminalSnapshot(agent.sessionId).then(snapshot => {
      if (disposed) return
      terminal.resize(snapshot.columns, snapshot.rows)
      terminal.write(snapshot.data, () => {
        if (disposed) return
        sequence = snapshot.sequence
        initialized = true
        for (const chunk of pending) apply(chunk)
        pending = []
        fitTerminal()
        setReady(true)
      })
    }, report)
    const input = terminal.onData(data => {
      const action = data === '\x03' ? window.persona.terminalInterrupt(agent.sessionId) : window.persona.terminalInput(agent.sessionId, data)
      void action.catch(report)
    })
    const observer = new ResizeObserver(fitTerminal)
    observer.observe(container.current)
    return () => {
      disposed = true
      unsubscribe()
      observer.disconnect()
      input.dispose()
      terminal.dispose()
    }
  }, [agent.sessionId, connected, generation, onError])

  return <section className="terminal-panel" aria-label={`${agent.name}の端末`}>
    <div className="pane-heading"><span><TerminalSquare size={15} /> SESSION <span className="muted">/ {agent.id}</span></span><span className="demo-tag">{real ? agent.role === 'parent' ? 'CODEX CLI · 代理承認' : 'CODEX CLI' : 'DEMO'}</span></div>
    <div className="terminal-person"><span className="avatar" style={{ '--agent-color': agent.color } as React.CSSProperties}>{agent.name.slice(-1)}</span><div><strong>{agent.name}</strong><small>{roleLabels[agent.role]} <span>• {!connected ? 'Codexへの接続待ち' : agent.status === 'ended' ? '端末終了・会話は保存済み' : agent.status === 'interrupted' ? '中断中' : agent.status === 'idle' ? '入力待ち' : '接続中'}</span></small></div>{real && <button className="button compact" disabled={!connected || reconnecting || agent.status !== 'ended'} onClick={() => void reconnect()}>{reconnecting ? '再接続中…' : '再接続'}</button>}<button className="icon-button interrupt" disabled={!connected || agent.status === 'ended'} title="処理に割り込む（Sessionは保持）" aria-label="処理に割り込む" onClick={() => void window.persona.terminalInterrupt(agent.sessionId).catch(onError)}><Square size={13} /></button></div>
    {agent.role === 'npc' && <div className="chat-view-switch" role="group" aria-label="チャット表示"><button aria-pressed={view === 'codex'} onClick={() => setView('codex')}><TerminalSquare size={14} />Codex</button><button aria-pressed={view === 'messages'} onClick={() => setView('messages')}><MessageCircle size={14} />メッセージ</button></div>}
    <div className="terminal-host" hidden={view !== 'codex'} ref={container} data-testid="terminal" data-ready={ready} />
    {agent.role === 'npc' && memoryEnabled && <button className="button compact" onClick={() => setView('memory')} aria-pressed={view === 'memory'}>記憶・未来の意図</button>}
    {view === 'memory' && <MemoryPanel key={agent.id} agentId={agent.id} />}
    <div className="terminal-footer" hidden={view !== 'codex'}><span className="status-dot" /> 選択中のCtrl+Cはコピー／未選択は割り込み<span>UTF-8</span></div>
    {view === 'messages' && (real ? <MessageView agent={agent} connected={connected} /> : <div className="message-view"><p className="message-empty">メッセージ履歴は実Codex接続時に利用できます。</p></div>)}
  </section>
}
