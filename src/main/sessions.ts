import headless from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { TerminalChunk, TerminalSnapshot } from '../shared/contracts'

const { Terminal } = headless

class Session {
  readonly terminal = new Terminal({ cols: 80, rows: 30, scrollback: 3000, allowProposedApi: true })
  readonly serializer = new SerializeAddon()
  sequence = 0
  tail: Promise<void> = Promise.resolve()
  input = ''
  constructor() { this.terminal.loadAddon(this.serializer) }
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  constructor(private readonly emit: (chunk: TerminalChunk) => void) {}

  create(id: string): void {
    if (this.sessions.has(id)) throw new Error(`Sessionは既に存在します: ${id}`)
    this.sessions.set(id, new Session())
  }

  has(id: string): boolean { return this.sessions.has(id) }

  private get(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Sessionが存在しません: ${id}`)
    return session
  }

  private enqueue<T>(id: string, operation: (session: Session) => Promise<T>): Promise<T> {
    const session = this.get(id)
    const result = session.tail.then(() => operation(session))
    session.tail = result.then(() => undefined)
    return result
  }

  write(id: string, data: string): Promise<void> {
    return this.enqueue(id, session => new Promise(resolve => {
      session.terminal.write(data, () => {
        session.sequence += 1
        this.emit({ sessionId: id, sequence: session.sequence, data })
        resolve()
      })
    }))
  }

  snapshot(id: string): Promise<TerminalSnapshot> {
    return this.enqueue(id, async session => ({
      sessionId: id, sequence: session.sequence, columns: session.terminal.cols,
      rows: session.terminal.rows, data: session.serializer.serialize()
    }))
  }

  resize(id: string, columns: number, rows: number): Promise<void> {
    return this.enqueue(id, async session => { session.terminal.resize(columns, rows) })
  }

  async input(id: string, data: string): Promise<void> {
    const session = this.get(id)
    for (const character of data) {
      if (character === '\r' || character === '\n') {
        const line = session.input
        session.input = ''
        await this.write(id, `\r\n\x1b[38;5;109m[DEMO] 入力を受信: ${line}\x1b[0m\r\n› `)
      } else if (character === '\x7f') {
        if (session.input.length > 0) {
          session.input = Array.from(session.input).slice(0, -1).join('')
          await this.write(id, '\b \b')
        }
      } else if (character >= ' ') {
        session.input += character
        await this.write(id, character)
      }
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(s => s.tail))
    for (const session of this.sessions.values()) session.terminal.dispose()
    this.sessions.clear()
  }
}
