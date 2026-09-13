import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { modelSchema, type ModelInfo, type SessionBinding } from '../core/contracts'
import { RpcClient, RpcError, type RpcNotification } from './rpc'
import { TurnAlreadyEndedError, type LifeHistoryTurn } from '../core/life-harness'
import { TerminalRelay } from './terminal-relay'
import { conversationTurnSchema, type ConversationTurn } from '../shared/conversation'
import { matchMemories, type MemoryMatchInput, type MemoryMatchProgress } from './memory-matcher'

export interface RuntimeTool { type: 'function'; name: string; description: string; inputSchema: unknown }
export const toolCallSchema = z.object({ threadId: z.string(), turnId: z.string(), callId: z.string(), namespace: z.string().nullable(), tool: z.string(), arguments: z.unknown() })
export type RuntimeToolCall = z.infer<typeof toolCallSchema>
export interface RuntimeToolResult { contentItems: { type: 'inputText'; text: string }[]; success: boolean }
export interface RuntimeThreadOptions { tools: RuntimeTool[]; disableEnvironment: boolean }
const completedTurnSchema = z.object({ threadId: z.string(), turn: z.object({ id: z.string(), status: z.enum(['completed', 'failed', 'interrupted']) }) })

export interface RuntimeAccount { authenticated: boolean; mode: 'chatgpt' | 'apiKey' | null }
export interface AgentRuntime {
  fork?(binding: SessionBinding, lastTurnId: string | null, instructions?: string): Promise<string>
  setThreadPolicy?(binding: SessionBinding, readOnly: boolean): void
  matchMemories?(input: MemoryMatchInput, signal: AbortSignal, progress: (value: MemoryMatchProgress) => Promise<void>): Promise<string[]>
  setToolHandler(handler: (call: RuntimeToolCall) => Promise<RuntimeToolResult>): void
  onNotification(listener: (event: RpcNotification) => void): () => void
  connect(mode: 'chatgpt' | 'apiKey'): Promise<void>
  account(): Promise<RuntimeAccount>
  models(): Promise<ModelInfo[]>
  loginChatGpt(): Promise<{ id: string; url: string }>
  loginApiKey(key: string): Promise<void>
  cancelLogin(id: string): Promise<void>
  create(binding: SessionBinding, instructions: string, options?: RuntimeThreadOptions): Promise<string>
  seed(binding: SessionBinding, text: string): Promise<void>
  resume(binding: SessionBinding, instructions?: string): Promise<void>
  startTurn(binding: SessionBinding, text: string, imagePaths?: string[], clientUserMessageId?: string): Promise<string>
  steer(threadId: string, turnId: string, text: string, clientUserMessageId?: string): Promise<void>
  compact(threadId: string): Promise<void>
  history(threadId: string): Promise<LifeHistoryTurn[]>
  conversation(threadId: string): Promise<ConversationTurn[]>
  interrupt(threadId: string, turnId: string): Promise<void>
  inspect(threadId: string): Promise<'idle' | 'active' | 'error'>
  turn(threadId: string, turnId: string): Promise<{ status: string; error?: string } | null>
  close(): Promise<void>
  prepareShutdown?(): Promise<void>
  cancelShutdown?(): void
}

export async function findCodexExecutable(): Promise<string> {
  const explicit = process.env.PERSONA_CODEX_BIN
  if (explicit) { if (!path.isAbsolute(explicit)) throw new Error('PERSONA_CODEX_BINは絶対パスで指定してください'); await access(explicit); return explicit }
  const executable = process.platform === 'win32' ? 'codex.exe' : 'codex'
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory, executable)
    try { await access(candidate); return candidate }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  }
  throw new Error('Codex CLIが見つかりません。インストールするかPERSONA_CODEX_BINを設定してください')
}

export class CodexRuntime implements AgentRuntime {
  matchMemories(input: MemoryMatchInput, signal: AbortSignal, progress: (value: MemoryMatchProgress) => Promise<void>): Promise<string[]> {
    this.client()
    return matchMemories(this.endpoint, this.token, input, signal, progress)
  }
  private readonly listeners = new Set<(event: RpcNotification) => void>()
  private process: ChildProcess | null = null
  private rpc: RpcClient | null = null
  private shuttingDown = false
  private toolHandler: ((call: RuntimeToolCall) => Promise<RuntimeToolResult>) | null = null
  private relay: TerminalRelay | null = null
  private readonly completedTurns = new Map<string, string>()
  private readonly interruptions = new Map<string, Promise<void>>()
  executable = ''
  endpoint = ''
  token = ''
  environment: NodeJS.ProcessEnv = {}

  constructor(private readonly homeRoot: string, private readonly fixtureConfig?: string) {}
  onNotification(listener: (event: RpcNotification) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  setToolHandler(handler: (call: RuntimeToolCall) => Promise<RuntimeToolResult>): void { this.toolHandler = handler }
  private notify(event: RpcNotification): void {
    if (event.method === 'turn/completed') {
      const completed = completedTurnSchema.safeParse(event.params)
      if (completed.success) this.completedTurns.set(completed.data.threadId, completed.data.turn.id)
    }
    for (const listener of this.listeners) listener(event)
  }
  private client(): RpcClient { if (!this.rpc) throw new Error('Codex接続がありません'); return this.rpc }

  async connect(mode: 'chatgpt' | 'apiKey'): Promise<void> {
    await this.close()
    let connected = false
    try { await this.start(mode); connected = true }
    finally { if (!connected) await this.close() }
  }
  private async start(mode: 'chatgpt' | 'apiKey'): Promise<void> {
    this.shuttingDown = false
    this.executable = await findCodexExecutable()
    const requestedHome = path.join(this.homeRoot, mode)
    await mkdir(requestedHome, { recursive: true })
    const home = await realpath(requestedHome)
    if (this.fixtureConfig) await writeFile(path.join(home, 'config.toml'), await readFile(this.fixtureConfig))
    const reservation = net.createServer()
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('App Server用ポートを取得できません')
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
    this.endpoint = `ws://127.0.0.1:${address.port}`
    this.token = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(this.token).digest('hex')
    this.environment = { ...process.env, CODEX_HOME: home, TERM: 'xterm-256color' }
    delete this.environment.OPENAI_API_KEY
    delete this.environment.CODEX_API_KEY
    const child = spawn(this.executable, ['app-server', '--listen', this.endpoint, '--ws-auth', 'capability-token', '--ws-token-sha256', tokenHash, '-c', 'cli_auth_credentials_store="keyring"'], { env: this.environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    this.process = child
    let startupError: Error | null = null
    child.on('error', error => { startupError = error })
    child.stdout?.resume(); child.stderr?.resume()
    child.on('exit', code => { if (!this.shuttingDown) this.notify({ method: 'runtime/error', params: { message: `Codex App Serverが終了しました: code=${code}` } }) })
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (startupError) throw startupError
      if (child.exitCode !== null) throw new Error(`Codex App Serverの起動に失敗しました: code=${child.exitCode}`)
      try { ready = (await fetch(`http://127.0.0.1:${address.port}/readyz`, { signal: AbortSignal.timeout(1000) })).ok }
      catch (error) {
        const refused = error instanceof TypeError && error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'ECONNREFUSED'
        if (!refused) throw error
      }
      if (ready) break
      await delay(100)
    }
    if (!ready) throw new Error('Codex App Serverが10秒以内に起動しませんでした')
    this.rpc = new RpcClient(event => this.notify(event), error => this.notify({ method: 'runtime/error', params: { message: error.message } }), async (method, params) => {
      if (method !== 'item/tool/call' || !this.toolHandler) throw new RpcError(method, -32601, '未対応のCodex要求です')
      return this.toolHandler(toolCallSchema.parse(params))
    })
    await this.rpc.connect(this.endpoint, this.token)
    this.relay = new TerminalRelay(this.endpoint, this.token, error => this.notify({ method: 'terminal/error', params: { message: error.message } }))
    await this.relay.open()
  }
  terminalEndpoint(binding: SessionBinding): string {
    if (!binding.lifeToolsVersion && !binding.persistenceVersion) return this.endpoint
    if (!this.relay) throw new Error('端末中継に接続されていません')
    return this.relay.register(binding)
  }
  async account(): Promise<RuntimeAccount> {
    const value = z.object({ account: z.object({ type: z.string() }).passthrough().nullable() }).parse(await this.client().request('account/read'))
    if (value.account === null) return { authenticated: false, mode: null }
    if (value.account.type !== 'chatgpt' && value.account.type !== 'apiKey') throw new Error(`未対応の認証方式です: ${value.account.type}`)
    return { authenticated: true, mode: value.account.type }
  }
  async models(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = []
    let cursor: string | null = null
    do {
      const result = z.object({ data: z.array(modelSchema), nextCursor: z.string().nullable() }).parse(await this.client().request('model/list', { limit: 100, cursor, includeHidden: false }))
      models.push(...result.data); cursor = result.nextCursor
    } while (cursor !== null)
    return models
  }
  async loginChatGpt(): Promise<{ id: string; url: string }> {
    const value = z.object({ loginId: z.string(), authUrl: z.url() }).parse(await this.client().request('account/login/start', { type: 'chatgpt' }))
    return { id: value.loginId, url: value.authUrl }
  }
  async loginApiKey(key: string): Promise<void> { await this.client().request('account/login/start', { type: 'apiKey', apiKey: key }) }
  async cancelLogin(id: string): Promise<void> { await this.client().request('account/login/cancel', { loginId: id }) }
  async create(binding: SessionBinding, instructions: string, options?: RuntimeThreadOptions): Promise<string> {
    binding = { ...binding, cwd: await realpath(binding.cwd) }
    const result = z.object({ thread: z.object({ id: z.string() }), model: z.string() }).parse(await this.client().request('thread/start', {
      model: binding.modelId, allowProviderModelFallback: false, cwd: binding.cwd, runtimeWorkspaceRoots: [binding.cwd],
      ...this.approvals(binding), sandbox: 'workspace-write', baseInstructions: instructions,
      config: this.configuration(binding), serviceName: 'persona_compiler',
      ...(options ? { dynamicTools: options.tools, ...(options.disableEnvironment ? { environments: [] } : {}) } : {})
    }))
    if (result.model !== binding.modelId) throw new Error(`モデルが意図せず変更されました: ${binding.modelId} → ${result.model}; thread=${result.thread.id}`)
    return result.thread.id
  }
  async seed(binding: SessionBinding, text: string): Promise<void> {
    await this.configure(binding)
    await this.client().request('thread/inject_items', { threadId: binding.threadId, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }] })
  }
  async fork(binding: SessionBinding, lastTurnId: string | null, instructions?: string): Promise<string> {
    const cwd = await realpath(binding.cwd)
    const result = z.object({ thread: z.object({ id: z.string() }), model: z.string() }).parse(await this.client().request('thread/fork', {
      threadId: binding.threadId, ...(lastTurnId ? { lastTurnId } : {}), model: binding.modelId, cwd,
      ...this.approvals(binding), sandbox: 'workspace-write', config: this.configuration({ ...binding, cwd }),
      ...(instructions === undefined ? {} : { baseInstructions: instructions })
    }))
    if (result.thread.id === binding.threadId || result.model !== binding.modelId) throw new Error(`Conversation分岐結果が不正です: ${binding.agentId}/${result.thread.id}`)
    return result.thread.id
  }
  async resume(binding: SessionBinding, instructions?: string): Promise<void> {
    binding = { ...binding, cwd: await realpath(binding.cwd) }
    const result = z.object({ thread: z.object({ id: z.string() }), model: z.string() }).parse(await this.client().request('thread/resume', { threadId: binding.threadId, model: binding.modelId, ...(binding.lifeToolsVersion ? {} : { cwd: binding.cwd, runtimeWorkspaceRoots: [binding.cwd] }), ...this.approvals(binding), sandbox: 'workspace-write', config: this.configuration(binding), ...(instructions === undefined ? {} : { baseInstructions: instructions }) }))
    if (result.thread.id !== binding.threadId || result.model !== binding.modelId) throw new Error(`Session再開結果が保存済みの設定と一致しません: ${binding.agentId}`)
    await this.configure(binding)
  }
  private configuration(binding: SessionBinding): Record<string, unknown> {
    return { model_reasoning_effort: binding.effort, 'sandbox_workspace_write.writable_roots': [binding.cwd], 'sandbox_workspace_write.network_access': false, 'agents.enabled': false }
  }
  private approvals(binding: SessionBinding) {
    return binding.role === 'parent'
      ? { approvalPolicy: 'on-request' as const, approvalsReviewer: 'auto_review' as const }
      : { approvalPolicy: 'never' as const, approvalsReviewer: 'user' as const }
  }
  private async configure(binding: SessionBinding): Promise<void> {
    binding = { ...binding, cwd: await realpath(binding.cwd) }
    await this.client().request('thread/settings/update', {
      threadId: binding.threadId, model: binding.modelId, effort: binding.effort, ...this.approvals(binding),
      ...(binding.lifeToolsVersion ? {} : { cwd: binding.cwd, sandboxPolicy: { type: 'workspaceWrite', writableRoots: [binding.cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } })
    })
  }
  async startTurn(binding: SessionBinding, text: string, imagePaths: string[] = [], clientUserMessageId?: string): Promise<string> {
    binding = { ...binding, cwd: await realpath(binding.cwd) }
    if (binding.lifeToolsVersion) this.terminalEndpoint(binding)
    const result = z.object({ turn: z.object({ id: z.string() }) }).parse(await this.client().request('turn/start', {
      threadId: binding.threadId, model: binding.modelId, effort: binding.effort, ...this.approvals(binding),
      ...(binding.lifeToolsVersion ? { environments: [] } : { cwd: binding.cwd, sandboxPolicy: { type: 'workspaceWrite', writableRoots: [binding.cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } }),
      input: [{ type: 'text', text }, ...imagePaths.map(image => ({ type: 'localImage', path: image }))],
      ...(clientUserMessageId ? { clientUserMessageId } : {})
    }))
    return result.turn.id
  }
  setThreadPolicy(binding: SessionBinding, readOnly: boolean): void {
    this.terminalEndpoint(binding)
    this.relay?.setReadOnly(binding.threadId!, readOnly)
  }
  async interrupt(threadId: string, turnId: string): Promise<void> {
    if (this.completedTurns.get(threadId) === turnId) return
    const key = `${threadId}:${turnId}`
    const pending = this.interruptions.get(key)
    if (pending) return pending
    const request = this.client().request<void>('turn/interrupt', { threadId, turnId }, 30000, event => {
      if (event.method !== 'turn/completed') return false
      const completed = completedTurnSchema.safeParse(event.params)
      return completed.success && completed.data.threadId === threadId && completed.data.turn.id === turnId
    })
    this.interruptions.set(key, request)
    try { await request } finally { this.interruptions.delete(key) }
  }
  async steer(threadId: string, turnId: string, text: string, clientUserMessageId?: string): Promise<void> {
    try { await this.client().request('turn/steer', { threadId, expectedTurnId: turnId, input: [{ type: 'text', text }], ...(clientUserMessageId ? { clientUserMessageId } : {}) }) }
    catch (error) {
      if (error instanceof RpcError && error.code === -32600 && error.message === 'turn/steer: no active turn to steer (-32600)') throw new TurnAlreadyEndedError(error.message)
      throw error
    }
  }
  async compact(threadId: string): Promise<void> { await this.client().request('thread/compact/start', { threadId }) }
  async history(threadId: string): Promise<LifeHistoryTurn[]> {
    const result = z.object({ thread: z.object({ turns: z.array(z.object({ id: z.string(), status: z.string(), items: z.array(z.object({ type: z.string(), clientId: z.string().nullable().optional() }).passthrough()), itemsView: z.unknown().optional() })) }) }).parse(await this.client().request('thread/read', { threadId, includeTurns: true }))
    return result.thread.turns.map(turn => ({ id: turn.id, status: turn.status, clientIds: turn.items.filter(i => i.type === 'userMessage' && i.clientId).map(i => i.clientId!), compact: turn.items.some(i => i.type === 'contextCompaction') }))
  }
  async conversation(threadId: string): Promise<ConversationTurn[]> {
    const result = z.object({ thread: z.object({ turns: z.array(conversationTurnSchema) }) }).parse(await this.client().request('thread/read', { threadId, includeTurns: true }))
    return result.thread.turns
  }
  async inspect(threadId: string): Promise<'idle' | 'active' | 'error'> {
    const result = z.object({ thread: z.object({ status: z.object({ type: z.string() }) }) }).parse(await this.client().request('thread/read', { threadId }))
    return result.thread.status.type === 'active' ? 'active' : result.thread.status.type === 'systemError' ? 'error' : 'idle'
  }
  async turn(threadId: string, turnId: string): Promise<{ status: string; error?: string } | null> {
    const result = z.object({ thread: z.object({ turns: z.array(z.object({ id: z.string(), status: z.string(), error: z.object({ message: z.string() }).nullable() })) }) }).parse(await this.client().request('thread/read', { threadId, includeTurns: true }))
    const turn = result.thread.turns.find(t => t.id === turnId)
    return turn ? { status: turn.status, error: turn.error?.message } : null
  }
  async prepareShutdown(): Promise<void> { await this.relay?.quiesce() }
  cancelShutdown(): void { this.relay?.acceptInputs() }
  async close(): Promise<void> {
    this.shuttingDown = true
    await this.relay?.close(); this.relay = null
    this.rpc?.close(); this.rpc = null
    this.completedTurns.clear()
    const child = this.process
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
      if (!child.killed) child.kill()
      await Promise.race([exited, delay(3000)])
      if (child.exitCode === null && child.signalCode === null) throw new Error(`Codex App Serverの停止を確認できません: pid=${child.pid}`)
    }
    this.process = null
    child?.stdout?.destroy(); child?.stderr?.destroy()
  }
}
