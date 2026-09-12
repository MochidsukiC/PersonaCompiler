import { afterEach, describe, expect, it } from 'vitest'
import headless from '@xterm/headless'
import { SessionManager } from '../../src/main/sessions'
import type { TerminalChunk } from '../../src/shared/contracts'

const managers: SessionManager[] = []
afterEach(async () => { await Promise.all(managers.splice(0).map(manager => manager.dispose())) })

function setup() {
  const chunks: TerminalChunk[] = []
  const manager = new SessionManager(chunk => chunks.push(chunk))
  managers.push(manager)
  manager.create('npc')
  return { manager, chunks }
}

describe('Session lifetime and terminal state', () => {
  it('keeps output without a visible terminal, with ordered snapshot/chunk boundaries', async () => {
    const { manager, chunks } = setup()
    await manager.write('npc', 'before\r\n')
    const first = await manager.snapshot('npc')
    const background = manager.write('npc', '\x1b[32mhidden 日本語\x1b[0m\r\n')
    const snapshotPromise = manager.snapshot('npc')
    const later = manager.write('npc', 'after\r\n')
    await Promise.all([background, later])
    const snapshot = await snapshotPromise
    expect(snapshot.sequence).toBe(first.sequence + 1)
    expect(snapshot.data).toContain('hidden 日本語')
    expect(snapshot.data).not.toContain('after')
    expect(chunks.filter(c => c.sequence > snapshot.sequence).map(c => c.data)).toEqual(['after\r\n'])
  })

  it('restores cursor rewriting, colors, alternate screen and dimensions', async () => {
    const { manager } = setup()
    await manager.resize('npc', 60, 20)
    await manager.write('npc', 'old text\r\x1b[2K\x1b[32mnew text\x1b[0m\r\n')
    await manager.write('npc', '\x1b[?1049h\x1b[HCLI TUI\r\nline two')
    const snapshot = await manager.snapshot('npc')
    const terminal = new headless.Terminal({ cols: snapshot.columns, rows: snapshot.rows, allowProposedApi: true })
    await new Promise<void>(resolve => terminal.write(snapshot.data, resolve))
    expect(terminal.cols).toBe(60)
    expect(terminal.rows).toBe(20)
    expect(terminal.buffer.active.type).toBe('alternate')
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('CLI TUI')
    await new Promise<void>(resolve => terminal.write('\x1b[?1049l', resolve))
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('new text')
    terminal.dispose()
  })

  it('accepts Japanese input and reports missing/duplicate sessions explicitly', async () => {
    const { manager } = setup()
    await manager.input('npc', 'こんにちは\r')
    expect((await manager.snapshot('npc')).data).toContain('入力を受信: こんにちは')
    expect(() => manager.create('npc')).toThrow('既に存在')
    expect(() => manager.snapshot('missing')).toThrow('存在しません')
  })
})
