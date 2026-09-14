import WebSocket from 'ws'
import { z } from 'zod'
import { rpcEnvelopeSchema } from './rpc-envelope'

export interface RpcNotification { method: string; params: unknown }
export type RpcRequestHandler = (method: string, params: unknown) => Promise<unknown>
export class RpcError extends Error {
  constructor(readonly method: string, readonly code: number, message: string) { super(`${method}: ${message} (${code})`); this.name = 'RpcError' }
}

export class RpcClient {
  private sequence = 0
  private readonly pending = new Map<number, { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; completedBy?: (event: RpcNotification) => boolean }>()
  private socket: WebSocket | null = null
  private closing = false
  constructor(private readonly notify: (event: RpcNotification) => void, private readonly failed: (error: Error) => void, private readonly handleRequest?: RpcRequestHandler) {}

  async connect(url: string, token: string): Promise<void> {
    this.closing = false
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 10000 })
    this.socket = socket
    socket.on('message', data => {
      if (this.socket !== socket) return
      let parsed: z.infer<typeof rpcEnvelopeSchema>
      try { parsed = rpcEnvelopeSchema.parse(JSON.parse(data.toString())) }
      catch (error) { this.fail(new Error('Codexから不正なRPCメッセージを受信しました', { cause: error })); return }
      if (parsed.method) {
        if (parsed.id !== undefined) {
          const id = parsed.id
          const method = parsed.method
          const response = this.handleRequest
            ? Promise.resolve().then(() => this.handleRequest!(method, parsed.params))
            : Promise.reject(new RpcError(method, -32601, '未対応のCodex要求です'))
          void response.then(result => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, result }), error => { if (error) this.fail(error) })
          }, error => {
            const failure = error instanceof Error ? error : new Error(String(error))
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, error: { code: failure instanceof RpcError ? failure.code : -32603, message: failure.message } }), sendError => { if (sendError) this.fail(sendError) })
            this.failed(failure)
          })
        } else {
          const event = { method: parsed.method, params: parsed.params }
          for (const [id, pending] of this.pending) if (pending.completedBy?.(event)) {
            clearTimeout(pending.timer); this.pending.delete(id); pending.resolve(undefined)
          }
          this.notify(event)
        }
      } else if (typeof parsed.id === 'number') {
        const pending = this.pending.get(parsed.id)
        if (!pending) return
        clearTimeout(pending.timer); this.pending.delete(parsed.id)
        if (parsed.error) pending.reject(new RpcError(pending.method, parsed.error.code, pending.method === 'account/login/start' ? '認証に失敗しました' : parsed.error.message))
        else pending.resolve(parsed.result)
      }
    })
    socket.on('error', error => { if (this.socket === socket) this.fail(error) })
    socket.on('close', () => { if (this.socket === socket && !this.closing) this.fail(new Error('Codex App Serverとの接続が切断されました')) })
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    await this.request('initialize', { clientInfo: { name: 'persona_compiler', version: '0.1.0' }, capabilities: { experimentalApi: true } })
    socket.send(JSON.stringify({ method: 'initialized' }))
  }

  request<T = unknown>(method: string, params: unknown = {}, timeoutMs = 30000, completedBy?: (event: RpcNotification) => boolean): Promise<T> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`Codexに接続されていません: ${method}`))
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex要求の結果が未確定です: ${method} / request=${id}`)) }, timeoutMs)
      this.pending.set(id, { method, resolve: value => resolve(value as T), reject, timer, completedBy })
      socket.send(JSON.stringify({ id, method, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
      })
    })
  }

  private fail(error: Error): void {
    const socket = this.socket
    this.socket = null
    socket?.terminate()
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error) }
    this.pending.clear()
    if (!this.closing) this.failed(error)
  }
  close(): void {
    this.closing = true
    this.fail(new Error('Codex接続を終了しました'))
  }
}
