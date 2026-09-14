import WebSocket, { WebSocketServer } from 'ws'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { IncomingMessage } from 'node:http'
import type { SessionBinding } from '../core/contracts'

const relayEnvelopeSchema = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string().optional() }).passthrough()
const clientEnvelopeSchema = relayEnvelopeSchema.extend({ params: z.record(z.string(), z.unknown()).nullable().optional() })
interface PendingRequest { method: string; id: string | number; disconnected: boolean }

// Remote TUI supplies cwd on turn/start, which enables the default environment.
// Keep the host's life-thread capabilities when forwarding that request.
export class TerminalRelay {
  private server: WebSocketServer | null = null
  private readonly bindings = new Map<string, SessionBinding>()
  private readonly upstreams = new Set<WebSocket>()
  private endpoint = ''
  private accepting = true
  private readonly readOnly = new Set<string>()
  private readonly pending = new Set<PendingRequest>()
  private readonly waiters = new Set<() => void>()
  constructor(private readonly upstream: string, private readonly token: string, private readonly failed: (error: Error) => void) {}

  async open(): Promise<void> {
    const expected = Buffer.from(`Bearer ${this.token}`)
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: ({ req }: { req: IncomingMessage }) => {
      const supplied = Buffer.from(req.headers.authorization ?? '')
      return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    } })
    this.server = server
    server.on('connection', client => {
      const upstream = new WebSocket(this.upstream, { headers: { Authorization: `Bearer ${this.token}` }, handshakeTimeout: 10000 })
      this.upstreams.add(upstream)
      const queued: string[] = []
      const requests = new Map<string | number, PendingRequest>()
      const fail = (error: Error) => { this.failed(new Error(`生活端末接続: ${error.message}`, { cause: error })); client.terminate(); upstream.terminate() }
      client.on('error', fail); upstream.on('error', fail)
      client.on('close', () => upstream.terminate())
      upstream.on('close', () => {
        this.upstreams.delete(upstream)
        for (const request of requests.values()) request.disconnected = true
        for (const wake of this.waiters) wake()
        client.close()
      })
      upstream.on('open', () => { for (const message of queued) upstream.send(message); queued.length = 0 })
      upstream.on('message', data => {
        let message: { id?: string | number; method?: string }
        try { message = relayEnvelopeSchema.parse(JSON.parse(data.toString())) }
        catch (error) { fail(new Error('App Serverが不正なRPCメッセージを返しました', { cause: error })); return }
        if (!message.method && message.id !== undefined) {
          const request = requests.get(message.id)
          if (request) { this.pending.delete(request); requests.delete(message.id); for (const wake of this.waiters) wake() }
        }
        if (client.readyState === WebSocket.OPEN) client.send(data.toString())
      })
      client.on('message', data => {
        let message: z.infer<typeof clientEnvelopeSchema>
        try { message = clientEnvelopeSchema.parse(JSON.parse(data.toString())) }
        catch { client.close(1007, 'Invalid RPC message'); return }
        const params = message.params
        const inference = ['turn/start', 'turn/steer', 'thread/compact/start', 'thread/inject_items', 'thread/start'].includes(message.method ?? '')
        if (inference && typeof params?.threadId === 'string' && this.readOnly.has(params.threadId)) {
          client.send(JSON.stringify({ id: message.id, error: { code: -32600, message: 'このConversationは現在閲覧専用です' } }))
          return
        }
        if (inference && !this.accepting) {
          client.send(JSON.stringify({ id: message.id, error: { code: -32600, message: 'アプリの終了処理中です。新規入力は受け付けません' } }))
          return
        }
        if (inference && message.id !== undefined) {
          const request = { method: message.method!, id: message.id, disconnected: false }
          requests.set(message.id, request); this.pending.add(request)
        }
        const binding = typeof params?.threadId === 'string' ? this.bindings.get(params.threadId) : undefined
        if (binding?.lifeToolsVersion && params) {
          if (message.method === 'turn/start') {
            delete params.cwd; delete params.runtimeWorkspaceRoots; delete params.sandboxPolicy; delete params.permissions
            params.environments = []; params.model = binding.modelId; params.effort = binding.effort
          }
          if (message.method === 'thread/resume' || message.method === 'thread/settings/update') {
            if (message.method === 'thread/settings/update' && ((params.model != null && params.model !== binding.modelId) || (params.effort != null && params.effort !== binding.effort))) {
              client.send(JSON.stringify({ id: message.id, error: { code: -32600, message: '生活用Conversationのモデル・effortはアプリの役割設定で管理されています' } }))
              return
            }
            params.model = binding.modelId; params.effort = binding.effort
            delete params.cwd; delete params.runtimeWorkspaceRoots; delete params.sandboxPolicy; delete params.permissions
          }
        }
        const encoded = JSON.stringify(message)
        if (upstream.readyState === WebSocket.OPEN) upstream.send(encoded)
        else if (upstream.readyState === WebSocket.CONNECTING) queued.push(encoded)
        else client.close(1011, 'App Server disconnected')
      })
    })
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('端末中継ポートを取得できません')
    this.endpoint = `ws://127.0.0.1:${address.port}`
  }
  register(binding: SessionBinding): string {
    if (!binding.threadId) throw new Error(`Conversationがありません: ${binding.agentId}`)
    this.bindings.set(binding.threadId, binding)
    return this.endpoint
  }
  setReadOnly(threadId: string, value: boolean): void { if (value) this.readOnly.add(threadId); else this.readOnly.delete(threadId) }
  async quiesce(): Promise<void> {
    this.accepting = false
    if (!this.pending.size) return
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        const disconnected = [...this.pending].filter(request => request.disconnected)
        if (disconnected.length) {
          clearTimeout(timer); this.waiters.delete(finish)
          reject(new Error(`端末接続が終了し、CLI要求の結果を確認できません: ${disconnected.map(request => `${request.method}/${request.id}`).join(', ')}`))
        } else if (!this.pending.size) { clearTimeout(timer); this.waiters.delete(finish); resolve() }
      }
      const timer = setTimeout(() => { this.waiters.delete(finish); reject(new Error(`CLI要求の完了を確認できません: ${[...this.pending].map(request => `${request.method}/${request.id}`).join(', ')}`)) }, 30_000)
      this.waiters.add(finish); finish()
    })
  }
  acceptInputs(): void { this.accepting = true }
  async close(): Promise<void> {
    for (const socket of this.upstreams) socket.terminate()
    if (this.server) {
      for (const socket of this.server.clients) socket.terminate()
      await new Promise<void>((resolve, reject) => this.server!.close(error => error ? reject(error) : resolve()))
      this.server = null
    }
  }
}
