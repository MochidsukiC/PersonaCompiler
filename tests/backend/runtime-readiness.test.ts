import { afterEach, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { CodexRuntime } from '../../src/backend/runtime'
import { RpcClient } from '../../src/backend/rpc'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

async function fixture() {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/runtime-readiness-'))
  vi.stubEnv('PERSONA_CODEX_BIN', process.execPath)
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, killed: false,
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => { child.exitCode = 0; child.killed = true; child.emit('exit', 0); return true }) })
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess)
  const rpc = vi.spyOn(RpcClient.prototype, 'connect').mockRejectedValue(new Error('fixture: reached RPC'))
  const fetch = vi.spyOn(globalThis, 'fetch')
  const runtime = new CodexRuntime(root)
  return { child, rpc, fetch, runtime }
}

it('releases every readiness body before retrying or opening RPC, including non-success responses', async () => {
  const f = await fixture()
  const released: string[] = []
  const pending = new Response(new ReadableStream({ cancel: () => { released.push('pending') } }), { status: 503 })
  const ready = new Response(new ReadableStream({ cancel: () => { released.push('ready') } }), { status: 200 })
  f.fetch.mockRejectedValueOnce(new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }))
    .mockResolvedValueOnce(pending).mockImplementationOnce(async () => {
      expect(released).toEqual(['pending'])
      return ready
    })
  f.rpc.mockImplementationOnce(async () => {
    expect(released).toEqual(['pending', 'ready'])
    throw new Error('fixture: reached RPC')
  })
  try {
    await expect(f.runtime.connect('chatgpt')).rejects.toThrow('fixture: reached RPC')
    expect(f.fetch).toHaveBeenCalledTimes(3)
    expect(pending.bodyUsed).toBe(true)
    expect(ready.bodyUsed).toBe(true)
    expect(f.child.kill).toHaveBeenCalledOnce()
  } finally { await f.runtime.close() }
})

it('accepts a successful readiness response with no body', async () => {
  const f = await fixture()
  f.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
  try {
    await expect(f.runtime.connect('chatgpt')).rejects.toThrow('fixture: reached RPC')
    expect(f.rpc).toHaveBeenCalledOnce()
  } finally { await f.runtime.close() }
})

it('propagates a readiness body cancellation error and closes the child without starting RPC', async () => {
  const f = await fixture()
  const failure = new TypeError('fixture: body cancellation failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) })
  f.fetch.mockRejectedValue(new Error('fixture: unexpected retry')).mockResolvedValueOnce(new Response(new ReadableStream({ cancel: () => { throw failure } }), { status: 200 }))
  try {
    await expect(f.runtime.connect('chatgpt')).rejects.toBe(failure)
    expect(f.fetch).toHaveBeenCalledOnce()
    expect(f.rpc).not.toHaveBeenCalled()
    expect(f.child.kill).toHaveBeenCalledOnce()
  } finally { await f.runtime.close() }
})

it('does not retry readiness fetch failures other than a refused connection', async () => {
  const f = await fixture()
  const failure = new TypeError('fetch failed', { cause: Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' }) })
  f.fetch.mockRejectedValueOnce(failure)
  try {
    await expect(f.runtime.connect('chatgpt')).rejects.toBe(failure)
    expect(f.fetch).toHaveBeenCalledOnce()
    expect(f.rpc).not.toHaveBeenCalled()
    expect(f.child.kill).toHaveBeenCalledOnce()
  } finally { await f.runtime.close() }
})
