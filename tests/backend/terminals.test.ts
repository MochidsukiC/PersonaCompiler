import { afterEach, expect, it, vi } from 'vitest'
import { spawn, type IPty } from 'node-pty'
import { CodexRuntime } from '../../src/backend/runtime'
import { PtyTerminals } from '../../src/backend/terminals'
import type { SessionBinding } from '../../src/core/contracts'

vi.mock('node-pty', () => ({ spawn: vi.fn() }))
afterEach(() => { vi.restoreAllMocks() })

function fixture(pid = 0) {
  let data: (value: string) => void = () => undefined
  let exit: (value: { exitCode: number }) => void = () => undefined
  const child = {
    pid,
    write: vi.fn(),
    onData: (listener: typeof data) => { data = listener; return { dispose() {} } },
    onExit: (listener: typeof exit) => { exit = listener; return { dispose() {} } }
  }
  vi.mocked(spawn).mockReturnValue(child as unknown as IPty)
  const runtime = new CodexRuntime('unused-fixture-home')
  vi.spyOn(runtime, 'terminalEndpoint').mockReturnValue('ws://127.0.0.1/fixture')
  const terminals = new PtyTerminals(runtime, () => undefined, () => undefined)
  const binding: SessionBinding = { agentId: 'parent', sessionId: 'parent', role: 'parent', cwd: '.', modelId: 'gpt-5.6-luna', effort: 'low', threadId: 'fixture-thread', creation: 'initialized', seedPersisted: true }
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
  return { child, terminals, binding, kill, data: (value: string) => data(value), exit: (code = 0) => exit({ exitCode: code }) }
}

it('waits for a delayed PTY startup before allowing time for graceful shutdown', async () => {
  const f = fixture()
  let requested = false
  f.child.write.mockImplementation(() => { requested = true; if (f.child.pid > 0) setTimeout(() => f.exit(), 50) })
  await f.terminals.attach(f.binding)
  const startup = setTimeout(() => { f.child.pid = 12345; f.data('Codex fixture\r\n'); if (requested) setTimeout(() => f.exit(), 50) }, 1900)
  try {
    await f.terminals.dispose()
    expect(f.kill).not.toHaveBeenCalled()
    expect(f.terminals.has('parent')).toBe(false)
  } finally { clearTimeout(startup); f.exit(); await f.terminals.dispose() }
})

it('reports an unconfirmed startup without sending a signal to PID zero', async () => {
  const f = fixture()
  await f.terminals.attach(f.binding)
  try {
    await expect(f.terminals.dispose()).rejects.toThrow('起動を確認できません')
    expect(f.kill).not.toHaveBeenCalled()
    expect(f.terminals.has('parent')).toBe(true)
  } finally { f.exit(); await f.terminals.dispose() }
})

it('finishes shutdown when startup fails before there is a process ID', async () => {
  const f = fixture()
  await f.terminals.attach(f.binding)
  const failed = setTimeout(() => f.exit(1), 25)
  try {
    await f.terminals.dispose()
    expect(f.kill).not.toHaveBeenCalled()
    expect(f.terminals.has('parent')).toBe(false)
  } finally { clearTimeout(failed); f.exit(); await f.terminals.dispose() }
})

it('still terminates the owned positive PID when graceful exit does not finish', async () => {
  const f = fixture(12345)
  f.kill.mockImplementation(() => { f.exit(); return true })
  await f.terminals.attach(f.binding)
  try {
    await f.terminals.dispose()
    expect(f.kill).toHaveBeenCalledExactlyOnceWith(12345)
    expect(f.terminals.has('parent')).toBe(false)
  } finally { f.exit(); await f.terminals.dispose() }
})
