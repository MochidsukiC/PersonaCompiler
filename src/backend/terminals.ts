import headless from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { spawn, type IPty } from 'node-pty'
import { setTimeout as delay } from 'node:timers/promises'
import type { TerminalChunk, TerminalSnapshot } from '../shared/contracts'
import type { SessionBinding } from '../core/contracts'
import type { CodexRuntime } from './runtime'

export interface TerminalBridge {
  has(id: string): boolean
  isRunning(id: string): boolean
  onExit(listener: (id: string) => void): () => void
  attach(binding: SessionBinding): Promise<void>
  snapshot(id: string): Promise<TerminalSnapshot>
  input(id: string, data: string): Promise<void>
  resize(id: string, columns: number, rows: number): Promise<void>
  dispose(): Promise<void>
}
interface TerminalSession {
  terminal: headless.Terminal
  serializer: SerializeAddon
  process: IPty
  sequence: number
  queue: Promise<void>
  exited: boolean
  started: Promise<void>
  done: Promise<void>
}

export class PtyTerminals implements TerminalBridge {
  private readonly sessions = new Map<string, TerminalSession>()
  private closing = false
  private readonly exitListeners = new Set<(id: string) => void>()
  constructor(private readonly runtime: CodexRuntime, private readonly emit: (chunk: TerminalChunk) => void, private readonly failed: (message: string) => void) {}
  has(id: string): boolean { return this.sessions.has(id) }
  isRunning(id: string): boolean { const session = this.sessions.get(id); return !!session && !session.exited }
  onExit(listener: (id: string) => void): () => void { this.exitListeners.add(listener); return () => { this.exitListeners.delete(listener) } }
  private get(id: string): TerminalSession { const value = this.sessions.get(id); if (!value) throw new Error(`端末がありません: ${id}`); return value }

  async attach(binding: SessionBinding): Promise<void> {
    const previous = this.sessions.get(binding.sessionId)
    if (previous && !previous.exited) return
    if (previous) await previous.queue
    if (!binding.threadId || !binding.seedPersisted) throw new Error(`Conversationが永続化されていません: ${binding.agentId}`)
    this.closing = false
    const terminal = previous ? previous.terminal : new headless.Terminal({ cols: 100, rows: 30, scrollback: 3000, allowProposedApi: true })
    const serializer = previous ? previous.serializer : new SerializeAddon()
    if (!previous) terminal.loadAddon(serializer)
    let child: IPty
    try {
      child = spawn(this.runtime.executable, ['resume', '--remote', this.runtime.terminalEndpoint(binding), '--remote-auth-token-env', 'PERSONA_RPC_TOKEN', '--no-alt-screen', binding.threadId], {
        cwd: binding.cwd, env: { ...this.runtime.environment, PERSONA_RPC_TOKEN: this.runtime.token }, name: 'xterm-256color', cols: terminal.cols, rows: terminal.rows
      })
    } catch (error) { if (!previous) terminal.dispose(); throw new Error(`Codex CLI端末を起動できません: ${binding.agentId}`, { cause: error }) }
    let finish!: () => void
    let start!: () => void
    const started = new Promise<void>(resolve => { start = resolve })
    const done = new Promise<void>(resolve => { finish = resolve })
    const session: TerminalSession = previous ?? { terminal, serializer, process: child, sequence: 0, queue: Promise.resolve(), exited: false, started, done }
    session.process = child; session.exited = false; session.started = started; session.done = done
    this.sessions.set(binding.sessionId, session)
    if (!previous) terminal.onData(data => { if (!session.exited) session.process.write(data) })
    child.onData(data => {
      start()
      const write = session.queue.then(() => new Promise<void>(resolve => terminal.write(data, () => {
        session.sequence++
        this.emit({ sessionId: binding.sessionId, sequence: session.sequence, data })
        resolve()
      })))
      session.queue = write.then(() => undefined, error => this.failed(`端末出力 ${binding.sessionId}: ${String(error)}`))
    })
    child.onExit(event => {
      session.exited = true; start(); finish()
      if (!this.closing) {
        for (const listener of this.exitListeners) listener(binding.sessionId)
        if (event.exitCode !== 0) this.failed(`Codex CLI端末が終了しました: ${binding.sessionId} / code=${event.exitCode}。Conversationは保存されています。端末の「再接続」を押してください`)
      }
    })
  }
  async snapshot(id: string): Promise<TerminalSnapshot> {
    const session = this.get(id)
    return session.queue.then(() => ({ sessionId: id, sequence: session.sequence, columns: session.terminal.cols, rows: session.terminal.rows, data: session.serializer.serialize() }))
  }
  async input(id: string, data: string): Promise<void> {
    const session = this.get(id)
    if (session.exited) throw new Error(`CLI端末は終了しています: ${id}`)
    session.process.write(data)
  }
  async resize(id: string, columns: number, rows: number): Promise<void> {
    const session = this.get(id)
    await session.queue
    if (!session.exited) session.process.resize(columns, rows)
    session.terminal.resize(columns, rows)
  }
  async dispose(): Promise<void> {
    this.closing = true
    const sessions = [...this.sessions.values()]
    await Promise.all(sessions.map(async s => {
      if (!s.exited && s.process.pid <= 0) await Promise.race([s.started, delay(6000)])
      if (!s.exited && s.process.pid <= 0) throw new Error(`Codex CLI端末の起動を確認できません: pid=${s.process.pid}`)
    }))
    for (const s of sessions) if (!s.exited) s.process.write('\x03\x15/exit\r')
    await Promise.all(sessions.map(s => Promise.race([s.done, delay(1500)])))
    for (const s of sessions) {
      // Remote TUI has no model subprocesses; terminate this owned process directly.
      // node-pty.kill() launches an AttachConsole helper that fails in a Windows sandbox.
      if (!s.exited) {
        try { process.kill(s.process.pid) }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error }
        await Promise.race([s.done, delay(1500)])
        if (!s.exited) throw new Error(`Codex CLI端末の停止を確認できません: pid=${s.process.pid}`)
      }
      await s.queue
      s.terminal.dispose()
    }
    this.sessions.clear()
  }
}
