import { expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { TerminalRelay } from '../../src/backend/terminal-relay'
import { RpcClient } from '../../src/backend/rpc'
import type { SessionBinding } from '../../src/core/contracts'

it.each(['client', 'upstream'] as const)('rejects malformed RPC envelopes from %s and continues serving valid messages', async direction => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing upstream port')
  const forwarded: unknown[] = []
  server.on('connection', socket => socket.on('message', bytes => { forwarded.push(JSON.parse(bytes.toString())); socket.send(bytes.toString()) }))
  const failures: Error[] = []
  const relay = new TerminalRelay(`ws://127.0.0.1:${address.port}`, 'token', error => failures.push(error))
  let client: WebSocket | undefined
  try {
    await relay.open()
    const endpoint = relay.register({ agentId: 'npc', sessionId: 'npc', role: 'npc', threadId: 'thread', cwd: 'work', modelId: 'fixture', effort: 'low', creation: 'initialized', seedPersisted: true, lifeToolsVersion: 1 })
    const connect = async () => {
      client = new WebSocket(endpoint, { headers: { Authorization: 'Bearer token' } })
      await new Promise<void>((resolve, reject) => { client!.once('open', resolve); client!.once('error', reject) })
      await vi.waitFor(() => expect(server.clients.size).toBe(1))
      return client
    }
    const invalid = ['{broken', ...[null, [], false, 'invalid', { id: [] }, { method: 9 }, ...(direction === 'client' ? [{ method: 'turn/start', params: 'invalid' }, { method: 'turn/start', params: [] }] : [])].map(value => JSON.stringify(value))]
    for (const raw of invalid) {
      const connected = await connect()
      let closeCode: number | undefined
      connected.once('close', code => { closeCode = code })
      if (direction === 'client') connected.send(raw)
      else [...server.clients][0].send(raw)
      await vi.waitFor(() => expect(connected.readyState).toBe(WebSocket.CLOSED), { timeout: 1000 })
      if (direction === 'client') expect(closeCode).toBe(1007)
      await vi.waitFor(() => expect(server.clients.size).toBe(0))
    }
    expect(forwarded).toEqual([])
    if (direction === 'upstream') {
      expect(failures.filter(error => error.message.includes('不正なRPC'))).toHaveLength(invalid.length)
      expect(failures[0].cause).toBeInstanceOf(Error)
      expect((failures[0].cause as Error).cause).toBeInstanceOf(SyntaxError)
    }
    else expect(failures).toEqual([])
    const connected = await connect()
    const valid = { jsonrpc: '2.0', id: 42, method: 'thread/read', params: null, extension: { keep: true } }
    const response = new Promise<unknown>(resolve => connected.once('message', bytes => resolve(JSON.parse(bytes.toString()))))
    connected.send(JSON.stringify(valid))
    expect(await response).toEqual(valid)
    expect(forwarded).toEqual([valid])
  } finally { client?.terminate(); await relay.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('authenticates the TUI relay and keeps life environment, model and effort overrides on the same thread', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing upstream port')
  let authorization: string | undefined
  server.on('connection', (socket, request) => {
    authorization = request.headers.authorization
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString())
      if (message.id !== undefined) socket.send(JSON.stringify({ id: message.id, result: message.params }))
    })
  })
  const failures: Error[] = []
  const relay = new TerminalRelay(`ws://127.0.0.1:${address.port}`, 'test-token', error => failures.push(error))
  const client = new RpcClient(() => undefined, error => failures.push(error))
  const rejected: Error[] = []
  const stranger = new RpcClient(() => undefined, error => rejected.push(error))
  const binding: SessionBinding = { agentId: 'npc0', sessionId: 'npc0', role: 'npc', threadId: 'thread0', cwd: 'C:/life/npc0', modelId: 'gpt-5.6-luna', effort: 'low', creation: 'initialized', seedPersisted: true, lifeToolsVersion: 1 }
  try {
    await relay.open()
    const endpoint = relay.register(binding)
    await expect(stranger.connect(endpoint, 'wrong-token')).rejects.toThrow('401')
    expect(rejected.some(e => e.message.includes('401'))).toBe(true)
    stranger.close()
    await client.connect(endpoint, 'test-token')
    expect(authorization).toBe('Bearer test-token')
    expect(await client.request('turn/start', { threadId: 'thread0', cwd: 'C:/other', environments: [{ environmentId: 'default' }], model: 'wrong', effort: 'high', input: [{ type: 'text', text: '誘導' }] })).toEqual({ threadId: 'thread0', environments: [], model: binding.modelId, effort: 'low', input: [{ type: 'text', text: '誘導' }] })
    await expect(client.request('thread/settings/update', { threadId: 'thread0', effort: 'high' })).rejects.toThrow('役割設定')
    expect(await client.request('thread/resume', { threadId: 'thread0', cwd: 'C:/other', model: null })).toEqual({ threadId: 'thread0', model: binding.modelId, effort: 'low' })
    expect(await client.request('turn/interrupt', { threadId: 'thread0', turnId: 'turn0' })).toEqual({ threadId: 'thread0', turnId: 'turn0' })
    const parent = { ...binding, agentId: 'parent', sessionId: 'parent', role: 'parent' as const, threadId: 'parent-thread', lifeToolsVersion: undefined, persistenceVersion: 2 as const }
    relay.register(parent)
    expect(await client.request('turn/start', { threadId: parent.threadId, cwd: 'parent-workspace', input: [] })).toEqual({ threadId: parent.threadId, cwd: 'parent-workspace', input: [] })
    await relay.quiesce()
    await expect(client.request('turn/start', { threadId: 'thread0', input: [] })).rejects.toThrow('終了処理中')
    await expect(client.request('turn/steer', { threadId: parent.threadId, input: [] })).rejects.toThrow('終了処理中')
    relay.acceptInputs()
    expect(await client.request('turn/start', { threadId: parent.threadId, input: [] })).toEqual({ threadId: parent.threadId, input: [] })
    expect(failures).toEqual([])
  } finally {
    stranger.close(); client.close(); await relay.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

it('waits for in-flight CLI mutation acknowledgement while still forwarding its notifications', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing upstream port')
  let finish: (() => void) | undefined
  server.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString())
    if (message.method === 'turn/start') { finish = () => { socket.send(JSON.stringify({ method: 'turn/started', params: { turn: { id: 'turn' } } })); socket.send(JSON.stringify({ id: message.id, result: { turn: { id: 'turn' } } })) }; return }
    if (message.id !== undefined) socket.send(JSON.stringify({ id: message.id, result: {} }))
  }))
  const relay = new TerminalRelay(`ws://127.0.0.1:${address.port}`, 'token', error => { throw error })
  const notifications: string[] = []
  const client = new RpcClient(event => notifications.push(event.method), error => { throw error })
  try {
    await relay.open()
    const endpoint = relay.register({ agentId: 'parent', sessionId: 'parent', role: 'parent', threadId: 'thread', cwd: 'work', modelId: 'fixture', effort: 'low', creation: 'initialized', seedPersisted: true, persistenceVersion: 2 })
    await client.connect(endpoint, 'token')
    const inference = client.request('turn/start', { threadId: 'thread' })
    await vi.waitFor(() => expect(finish).toBeDefined())
    let stopped = false
    const stopping = relay.quiesce().then(() => { stopped = true })
    await client.request('thread/read', { threadId: 'thread' })
    expect(stopped).toBe(false)
    finish!(); await inference; await stopping
    expect(notifications).toContain('turn/started')
  } finally { client.close(); await relay.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
