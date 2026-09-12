import { expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { RpcClient } from '../../src/backend/rpc'

it('correlates RPC, sends capability authentication, redacts login errors and rejects lost responses', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  let authorization: string | undefined
  server.on('connection', (socket, request) => {
    authorization = request.headers.authorization
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString())
      if (message.id === undefined || message.method === 'never-replies') return
      if (message.method === 'disconnect') { socket.terminate(); return }
      const result = message.method === 'account/login/start' ? { error: { code: 401, message: 'secret-test-key' } } : { result: { method: message.method } }
      socket.send(JSON.stringify({ id: message.id, ...result }))
    })
  })
  const failures: Error[] = []
  const client = new RpcClient(() => undefined, error => failures.push(error))
  try {
    await client.connect(`ws://127.0.0.1:${address.port}`, 'test-capability')
    expect(authorization).toBe('Bearer test-capability')
    expect(await Promise.all([client.request('one'), client.request('two')])).toEqual([{ method: 'one' }, { method: 'two' }])
    await expect(client.request('account/login/start', { type: 'apiKey', apiKey: 'secret-test-key' })).rejects.toThrow('認証に失敗しました')
    expect(JSON.stringify(failures)).not.toContain('secret-test-key')
    await expect(client.request('never-replies', {}, 20)).rejects.toThrow('結果が未確定')
    await expect(client.request('disconnect')).rejects.toThrow('切断')
  } finally { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('answers server tool requests without blocking other RPC responses', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  const failures: Error[] = []
  let release: (value: unknown) => void = () => { throw new Error('Tool request has not arrived') }
  let requested = false
  let received: unknown
  server.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString())
    if (message.id === 'server-tool') { received = message.result; return }
    if (message.method === 'initialized') socket.send(JSON.stringify({ id: 'server-tool', method: 'item/tool/call', params: { callId: 'call-1' } }))
    else if (message.id !== undefined) socket.send(JSON.stringify({ id: message.id, result: message.method }))
  }))
  const client = new RpcClient(() => undefined, error => failures.push(error), async (method, params) => {
    expect(method).toBe('item/tool/call')
    expect(params).toEqual({ callId: 'call-1' })
    requested = true
    return new Promise(resolve => { release = resolve })
  })
  try {
    await client.connect(`ws://127.0.0.1:${address.port}`, 'fixture-token')
    await expect.poll(() => requested).toBe(true)
    expect(await client.request('while-tool-pending')).toBe('while-tool-pending')
    release({ success: true, contentItems: [] })
    await expect.poll(() => received).toEqual({ success: true, contentItems: [] })
    expect(failures).toEqual([])
  } finally {
    client.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

it('confirms interruption from the exact turn completion even when the RPC acknowledgement is lost', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  const events: string[] = []
  const failures: Error[] = []
  server.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString())
    if (message.method === 'turn/interrupt') {
      socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: 'other', turn: { id: 'target', status: 'interrupted' } } }))
      socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'older', status: 'interrupted' } } }))
      return
    }
    if (message.method === 'complete-target') socket.send(JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'target', status: 'interrupted' } } }))
    if (message.id !== undefined) socket.send(JSON.stringify({ id: message.id, result: {} }))
  }))
  const client = new RpcClient(event => events.push(JSON.stringify(event)), error => failures.push(error))
  try {
    await client.connect(`ws://127.0.0.1:${address.port}`, 'fixture-token')
    let settled = false
    const interruption = client.request<void>('turn/interrupt', { threadId: 'thread', turnId: 'target' }, 1000, event => {
      const p = event.params as { threadId: string; turn: { id: string; status: string } }
      return event.method === 'turn/completed' && p.threadId === 'thread' && p.turn.id === 'target' && p.turn.status === 'interrupted'
    }).then(() => { settled = true })
    await expect.poll(() => events.length).toBe(2)
    expect(settled).toBe(false)
    await client.request('complete-target')
    await interruption
    expect(settled).toBe(true)
    expect(failures).toEqual([])
  } finally {
    client.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
