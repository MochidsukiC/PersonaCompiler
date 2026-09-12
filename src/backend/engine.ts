import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { inputSchema, stateSchema, type AppEvent, type PreparationInput, type RunState, type WorkspaceSnapshot } from '../shared/contracts'
import { Workspace, digest, messageOf } from '../main/workspace'
import { agentModelSettingsSchema, backendCommandSchema, emptyPreparation, preparationArtifactSchema, preparationProgressSchema, type AgentModelSettings, type BackendCommand, type BackendSnapshot, type SessionBinding, type SpecificationDraft } from '../core/contracts'
import { autoModels, defaultSettings, requireModel, resolveEffort, validateSettings } from '../core/models'
import { allocateCounts, validateAnswers, validateMap, validatePopulation } from '../core/population'
import { BootstrapPrompts, type PromptProvider } from '../core/prompts'
import type { AgentRuntime } from './runtime'
import type { TerminalBridge } from './terminals'
import type { RpcNotification } from './rpc'
import { LifeHarness, lifeCheckpointSchema, type LifeCheckpoint } from '../core/life-harness'
import { lifeTools } from '../core/life-contracts'
import { validateLifeSpecification } from '../core/spatial'
import { PersistenceCoordinator } from './persistence-coordinator'
import type { PersistencePortFactory } from '../core/persistence'

const persistedSchema = z.object({ version: z.literal(1), lifeVersion: z.literal(1).optional(), memoryVersion: z.literal(1).optional(), authMode: z.enum(['chatgpt', 'apiKey']).nullable(), settings: agentModelSettingsSchema.nullable(), preparation: preparationProgressSchema, artifactHash: z.string().nullable() })
const turnEventSchema = z.object({ threadId: z.string(), turn: z.object({ id: z.string(), status: z.string().optional(), error: z.object({ message: z.string() }).passthrough().nullable().optional() }).passthrough() })
const errorMessage = (error: unknown) => messageOf(error)
const newId = () => randomUUID()

function initialState(runId: string): RunState {
  return { runId, stage: 'draft', agents: [], map: null, relationships: null, frame: { revision: 0, turn: 0, day: 1, phase: 'morning', mapRevision: null, positions: {} } }
}

export class BackendEngine {
  workspace!: Workspace
  private queue: Promise<void> = Promise.resolve()
  private closing = false
  private stopping = false
  private resourcesStopped = false
  private persistence: PersistenceCoordinator | null = null
  private publishTimer: ReturnType<typeof setTimeout> | null = null
  private stopRequested = false
  private artifactHash: string | null = null
  private lifeVersion: 1 | undefined = 1
  private memoryVersion: 1 | undefined
  private life: LifeHarness | null = null
  private lastLifeStage: import('../core/life-contracts').SimulationSnapshot['stage'] | undefined
  private world: RunState = initialState('initializing')
  private readonly activeTurns = new Map<string, string>()
  private readonly unsubscribe: () => void
  private readonly unsubscribeExit: () => void
  private view: BackendSnapshot = { connection: 'disconnected', authMode: null, authenticated: false, login: null, models: [], settings: null, preparation: emptyPreparation(), error: null }

  constructor(private readonly base: string, private readonly runtime: AgentRuntime, readonly sessions: TerminalBridge, private readonly emit: (event: AppEvent) => void, private readonly prompts: PromptProvider = new BootstrapPrompts(), private readonly persistenceFactory?: PersistencePortFactory) {
    this.unsubscribe = runtime.onNotification(event => this.notification(event))
    runtime.setToolHandler(async call => {
      if (this.persistence?.status.readOnlyReason) return { success: false, contentItems: [{ type: 'inputText', text: this.persistence.status.readOnlyReason }] }
      const binding = this.view.preparation.sessions.find(s => s.threadId === call.threadId)
      if (!binding || !this.life || call.namespace !== null) return { success: false, contentItems: [{ type: 'inputText', text: 'このConversationには生活Toolの実行権限がありません' }] }
      return this.life.tool(binding.agentId, call)
    })
    this.unsubscribeExit = sessions.onExit(() => {
      if (!this.closing) void this.serial(() => this.publishWorld()).catch(error => this.emit({ type: 'error', message: errorMessage(error) }))
    })
  }

  snapshot(): WorkspaceSnapshot { return { ...this.workspace.snapshot(), state: structuredClone(this.world), backend: this.backendStatus() } }
  backendStatus(): BackendSnapshot { return structuredClone({ ...this.view, ...(this.persistence ? { persistence: this.persistence.status } : {}) }) }
  private publish(): void {
    if (this.closing || !this.workspace) return
    if (!this.persistence) { this.emit({ type: 'workspace', snapshot: this.snapshot() }); return }
    if (!this.publishTimer) this.publishTimer = setTimeout(() => { this.publishTimer = null; if (!this.closing) this.emit({ type: 'workspace', snapshot: this.snapshot() }) }, 100)
  }
  private writable(): void {
    if (this.stopping) throw new Error('終了処理中です。新しい入力は受け付けません')
    if (this.persistence?.status.readOnlyReason) throw new Error(this.persistence.status.readOnlyReason)
  }
  private coordinator(root: string): PersistenceCoordinator {
    if (!this.persistenceFactory) throw new Error('新形式の保存Workerが設定されていません')
    return new PersistenceCoordinator(root, this.persistenceFactory, () => this.publish())
  }
  private async persist(): Promise<void> {
    if (this.persistence) {
      if (!this.persistence.status.readOnlyReason) this.persistence.setMetadata({ version: 1, lifeVersion: this.lifeVersion, memoryVersion: this.memoryVersion, authMode: this.view.authMode, settings: this.view.settings, preparation: this.view.preparation, artifactHash: this.artifactHash })
      this.publish(); return
    }
    await this.workspace.write('backend.json', JSON.stringify({ version: 1, lifeVersion: this.lifeVersion, authMode: this.view.authMode, settings: this.view.settings, preparation: this.view.preparation, artifactHash: this.artifactHash }, null, 2))
    this.publish()
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action).catch(async error => {
      const p = this.view.preparation
      const target = p.sessions.findLast(s => s.creation !== 'initialized')?.agentId ?? (p.operation ? 'parent' : 'Harness')
      const message = `[${p.phase} / ${target}] ${errorMessage(error)}`
      this.view.error = message
      this.view.preparation.error = message
      this.view.preparation.busy = false
      this.workspace.report(message)
      await this.persist()
      throw error
    })
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
  private settings(): AgentModelSettings { if (!this.view.settings) throw new Error('役割別モデル設定が未設定です'); return this.view.settings }
  private ensureIdle(): void {
    if (this.view.preparation.busy || this.activeTurns.size) throw new Error('処理中です。完了または中断後に操作してください')
  }
  private ensureConnected(): void {
    if (this.view.connection !== 'connected' || !this.view.authenticated) throw new Error('Codexへの接続と認証が必要です')
  }

  async initialize(): Promise<void> {
    await mkdir(this.base, { recursive: true })
    let runId: string | null = null
    try { runId = z.string().uuid().parse(JSON.parse(await readFile(path.join(this.base, 'active-run.json'), 'utf8')).runId) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    if (runId) {
      const root = path.join(this.base, runId)
      let memory = false
      try { await access(path.join(root, 'persistence/manifest.json')); memory = true }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
      if (memory) {
        this.persistence = this.coordinator(root)
        const loaded = await this.persistence.initialize()
        if (!loaded) throw new Error('新形式の確定保存がありません')
        const saved = persistedSchema.parse(loaded.run.metadata)
        this.world = initialState(runId); this.lifeVersion = saved.lifeVersion
        this.memoryVersion = saved.memoryVersion
        this.view.authMode = saved.authMode; this.view.settings = saved.settings; this.view.preparation = saved.preparation; this.artifactHash = saved.artifactHash
        this.view.preparation.busy = false; this.view.preparation.paused = !['idle', 'ready'].includes(saved.preparation.phase)
        this.workspace = new Workspace(root, this.world, () => this.publish(), true)
        await this.workspace.initialize()
        if (loaded.run.life) this.createLife(loaded.run.life)
        await this.publishWorld()
        return
      }
      const saved = persistedSchema.parse(JSON.parse(await readFile(path.join(root, 'backend.json'), 'utf8')))
      const world = stateSchema.parse(JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8')))
      this.world = world
      this.lifeVersion = saved.lifeVersion
      this.memoryVersion = undefined
      this.view.authMode = saved.authMode; this.view.settings = saved.settings; this.view.preparation = saved.preparation; this.artifactHash = saved.artifactHash
      this.view.preparation.busy = false
      this.view.preparation.paused = saved.preparation.phase !== 'idle' && saved.preparation.phase !== 'ready'
      this.workspace = new Workspace(root, world, () => this.publish())
      await this.workspace.initialize()
      if (this.lifeVersion && saved.preparation.population) {
        let stored: unknown
        try { stored = JSON.parse(await this.workspace.read('simulation/checkpoint.json')) }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || saved.preparation.phase === 'ready') throw error }
        if (stored) {
          const envelope = z.object({ hash: z.string(), checkpoint: lifeCheckpointSchema }).parse(stored)
          if (digest(JSON.stringify(envelope.checkpoint)) !== envelope.hash) throw new Error('生活状態ファイルが外部変更されています')
          this.createLife(envelope.checkpoint)
        }
      }
      await this.publishWorld()
    } else await this.createRun()
  }
  private async createRun(): Promise<void> {
    const runId = newId()
    this.world = initialState(runId)
    this.life = null; this.lifeVersion = 1; delete this.view.simulation
    this.memoryVersion = this.persistenceFactory ? 1 : undefined
    this.view.preparation = emptyPreparation(); this.artifactHash = null; this.view.error = null
    const root = path.join(this.base, runId)
    if (this.persistenceFactory) { this.persistence = this.coordinator(root); await this.persistence.initialize() }
    this.workspace = new Workspace(root, this.world, () => this.publish(), !!this.persistence)
    await this.workspace.initialize()
    await this.persist()
    await this.persistence?.flush()
    // The run pointer uses the same atomic writer and containment checks as workspace files.
    const pointer = new Workspace(this.base, initialState('index'), () => undefined)
    await pointer.write('active-run.json', JSON.stringify({ runId }))
  }

  backendCommand(input: BackendCommand): Promise<BackendSnapshot> {
    this.writable()
    return this.serial(async () => {
      this.writable()
      const command = backendCommandSchema.parse(input)
      switch (command.type) {
        case 'connect': {
          this.ensureIdle()
          if (this.view.preparation.sessions.length && this.view.authMode !== command.authMode) throw new Error('既存Conversationの認証方式は変更できません。新しい実行を作成してください')
          await this.sessions.dispose()
          await this.persistence?.markDirty()
          this.resourcesStopped = false
          this.view.connection = 'connecting'; this.view.error = null; this.publish()
          await this.runtime.connect(command.authMode)
          this.view.authMode = command.authMode; this.view.connection = 'connected'
          await this.refreshConnection()
          if (this.view.authenticated) await this.restoreSessions()
          break
        }
        case 'loginChatGpt': {
          if (this.view.authMode !== 'chatgpt') throw new Error('ChatGPT方式で接続してください')
          this.view.login = await this.runtime.loginChatGpt(); break
        }
        case 'loginApiKey': {
          if (this.view.authMode !== 'apiKey') throw new Error('APIキー方式で接続してください')
          await this.runtime.loginApiKey(command.apiKey)
          await this.refreshConnection()
          if (this.view.authenticated) await this.restoreSessions()
          break
        }
        case 'cancelLogin': {
          if (!this.view.login) throw new Error('進行中のログインはありません')
          await this.runtime.cancelLogin(this.view.login.id); this.view.login = null; break
        }
        case 'settings': {
          this.ensureConnected(); this.ensureIdle()
          if (this.view.preparation.phase !== 'idle' || this.view.preparation.sessions.length) throw new Error('準備開始後の役割別設定は変更できません。新しい実行で指定してください')
          this.view.settings = validateSettings(command.settings, this.view.models)
          await this.ensureParent()
          break
        }
        case 'answers': {
          this.ensureConnected(); this.ensureIdle()
          const p = this.view.preparation
          if (p.phase !== 'interview' || !p.round) throw new Error('回答待ちの質問がありません')
          validateAnswers(p.round, command.value)
          p.answers.push(command.value); p.round = null
          await this.workspace.write(`preparation/answers/${command.value.roundId}.json`, JSON.stringify(command.value, null, 2))
          await this.startParent('preparation', `質問への回答です。これまでの回答を保持し、不足があれば新しいIDの質問ラウンド、十分なら地図付き仕様案をresult.jsonへ保存してください。\n${JSON.stringify(command.value)}`)
          break
        }
        case 'revise': {
          this.ensureConnected(); this.ensureIdle()
          const p = this.view.preparation
          if (p.phase !== 'review' || !p.draft || p.draft.revision !== command.revision) throw new Error('仕様revisionが古いか、レビュー中ではありません')
          await this.startParent('preparation', `仕様revision ${command.revision}への修正依頼です。更新した質問または地図付き仕様案をresult.jsonへ保存してください。\n${command.message}`)
          break
        }
        case 'approve': await this.approve(command.revision); break
        case 'retry': await this.retry(); break
        case 'startSimulation': {
          this.ensureConnected()
          if (!this.life) throw new Error('自律生活には新しい実行で住宅街付きワールドを生成してください')
          if (this.life.snapshot().stage === 'ready') await this.life.start(command.step)
          else await this.life.resume(command.step)
          break
        }
        case 'terminalReconnect': {
          this.ensureConnected()
          const binding = this.view.preparation.sessions.find(s => s.sessionId === command.sessionId)
          if (!binding?.threadId || !binding.seedPersisted) throw new Error(`保存済みConversationがありません: ${command.sessionId}`)
          if (!this.sessions.isRunning(binding.sessionId)) {
            binding.cwd = await realpath(binding.cwd)
            await this.runtime.resume(binding)
            await this.sessions.attach(binding)
          }
          await this.publishWorld()
          break
        }
      }
      await this.persist()
      return this.backendStatus()
    })
  }

  private async refreshConnection(): Promise<void> {
    const account = await this.runtime.account()
    this.view.authenticated = account.authenticated
    this.view.models = await this.runtime.models()
    if (!this.view.settings && this.view.models.some(m => m.isDefault)) this.view.settings = defaultSettings(this.view.models)
    if (account.authenticated && account.mode !== this.view.authMode) throw new Error('選択した認証方式とCodexの認証状態が一致しません')
  }

  prepare(input: PreparationInput): Promise<void> {
    this.writable()
    return this.serial(async () => {
      this.writable()
      this.ensureConnected(); this.ensureIdle()
      if (this.view.preparation.phase !== 'idle') throw new Error('準備は既に開始されています')
      const settings = validateSettings(this.settings(), this.view.models)
      const parsed = inputSchema.parse(input)
      if (parsed.images.length && !requireModel(this.view.models, settings.parent.modelId).inputModalities.includes('image')) throw new Error('親モデルが画像入力に対応していません')
      for (const image of parsed.images) validateImage(image.name, image.bytes)
      await this.workspace.write('inputs/description.md', parsed.description)
      await this.workspace.write('preparation/work/input.md', parsed.description)
      const images: string[] = []
      for (const [index, image] of parsed.images.entries()) {
        const relative = `preparation/work/images/${index + 1}-${image.name}`
        await this.workspace.write(`inputs/images/${index + 1}-${image.name}`, image.bytes)
        await this.workspace.write(relative, image.bytes)
        images.push(await this.workspace.resolve(relative))
      }
      this.view.preparation.phase = 'interview'
      await this.persist()
      await this.ensureParent()
      await this.startParent('preparation', `次の資料をもとに最初の3〜8問を質問カードとしてresult.jsonへ保存してください。まだ仕様を確定しないでください。\n${parsed.description}`, images)
    })
  }

  private parent(): SessionBinding {
    const parent = this.view.preparation.sessions.find(s => s.role === 'parent')
    if (!parent?.threadId || !parent.seedPersisted) throw new Error('親Conversationが初期化されていません')
    return parent
  }
  private async ensureParent(): Promise<void> {
    if (this.view.preparation.sessions.some(s => s.role === 'parent')) { this.parent(); return }
    const settings = this.settings()
    await this.createBinding({ agentId: 'parent', sessionId: 'parent', role: 'parent', modelId: settings.parent.modelId, effort: settings.parent.effort, cwd: path.join(this.workspace.root, 'preparation/work'), threadId: null, creation: 'requested', seedPersisted: false }, this.prompts.parent(), `準備フェーズを開始します。資料入力を待ってください。仕様の承認はHarnessからのみ通知されます。\n\n${this.modelSettingsPrompt()}`)
  }
  private modelSettingsPrompt(): string {
    const settings = validateSettings(this.settings(), this.view.models)
    const candidates = settings.npc.model.mode === 'auto' ? autoModels(this.view.models) : [requireModel(this.view.models, settings.npc.model.modelId)]
    return `Harnessの確定済みモデル設定（画面で保存済み。ユーザーへの再確認は不要）:
<harness_model_settings>
${JSON.stringify({ settings, npcModelCandidates: candidates.map(model => ({ modelId: model.model, description: model.description })) })}
</harness_model_settings>
settings.npc.model.modeがfixedなら全NPCのbirthModelIdをsettings.npc.model.modelIdにし、modelSelectionReasonに固定設定に従ったことを記載してください。autoならnpcModelCandidatesからNPCごとに選び、理由を記載してください。どちらのモードでもbirthModelIdとmodelSelectionReasonは必須です。
NPCのモデルAutoとeffort Autoは独立しています。effortはsettings.npc.effortに基づきHarnessが適用します。親・施設のmodelIdをNPCの設定として流用しないでください。`
  }
  private async startParent(kind: 'preparation' | 'population', text: string, images: string[] = []): Promise<void> {
    const modelSettings = this.modelSettingsPrompt()
    const p = this.view.preparation
    p.error = null; this.view.error = null; p.busy = true; p.paused = false; this.stopRequested = false
    p.operation = { id: newId(), kind, output: 'preparation/work/result.json', turnId: null }
    await this.persist()
    const id = await this.runtime.startTurn(this.parent(), `${text}\n\n${modelSettings}`, images)
    p.operation.turnId = id
    await this.persist()
  }

  private async approve(revision: number): Promise<void> {
    this.ensureConnected(); this.ensureIdle()
    const p = this.view.preparation
    if (p.phase !== 'review' || !p.draft || p.round || p.error || !p.answers.length || p.draft.revision !== revision) throw new Error('承認できません。仕様revision・回答・検証状態を確認してください')
    const diskDraft = JSON.parse(await this.workspace.read(`preparation/drafts/${revision}.json`))
    if (digest(JSON.stringify(diskDraft)) !== digest(JSON.stringify(p.draft))) throw new Error('仕様ファイルが外部変更されています。修正依頼から再レビューしてください')
    validateMap(p.draft.specification, p.draft.map)
    if (this.lifeVersion) validateLifeSpecification(p.draft.specification)
    p.lock = { revision, hash: digest(JSON.stringify(p.draft)), approvedAt: new Date().toISOString() }
    await this.workspace.write('preparation/locked.json', JSON.stringify(p.draft, null, 2))
    p.phase = 'locked'; await this.persist()
    await this.generatePopulation()
  }
  private async lockedDraft(): Promise<SpecificationDraft> {
    const p = this.view.preparation
    if (!p.lock || !p.draft) throw new Error('承認済み仕様がありません')
    const contents = JSON.parse(await this.workspace.read('preparation/locked.json'))
    if (digest(JSON.stringify(contents)) !== p.lock.hash || digest(JSON.stringify(p.draft)) !== p.lock.hash) throw new Error('承認済み仕様が変更されています。生成を停止しました')
    return p.draft
  }
  private async generatePopulation(): Promise<void> {
    const draft = await this.lockedDraft()
    const population = draft.specification.population
    this.view.preparation.phase = 'generating'
    await this.startParent('population', `Harnessより: 仕様revision ${draft.revision}がユーザーに承認されました。初期人口だけをresult.jsonへ保存してください。Session生成はHarnessが行います。\n承認仕様: ${JSON.stringify(draft.specification)}\n地図: ${JSON.stringify(draft.map)}\n年齢帯ごとの確定人数: ${JSON.stringify(allocateCounts(population.count, population.ageDistribution.map(a => a.ratio)))}\n性別区分ごとの確定人数: ${JSON.stringify(allocateCounts(population.count, population.sexRatio.map(s => s.ratio)))}\nモデル設定は末尾のHarness確定設定に従ってください。非家族関係・人生経験の生成は禁止です。`)
  }

  private async createBinding(binding: SessionBinding, instructions: string, seed: string): Promise<void> {
    if (this.persistence) binding.persistenceVersion = 2
    if (this.lifeVersion && binding.role !== 'parent') binding.lifeToolsVersion = 1
    if (this.memoryVersion && binding.role === 'npc') binding.memoryVersion = this.memoryVersion
    const p = this.view.preparation
    if (p.sessions.some(s => s.agentId === binding.agentId)) throw new Error(`Session生成が既に記録されています: ${binding.agentId}`)
    await mkdir(binding.cwd, { recursive: true })
    binding.cwd = await realpath(binding.cwd)
    p.sessions.push(binding); await this.persist()
    await this.persistence?.markDirty()
    binding.threadId = await this.runtime.create(binding, instructions, this.lifeVersion && binding.role !== 'parent' ? { tools: lifeTools(binding.role, binding.memoryVersion === 1), disableEnvironment: true } : undefined)
    binding.creation = 'created'; await this.persist()
    await this.runtime.seed(binding, seed)
    binding.seedPersisted = true; await this.persist()
    await this.sessions.attach(binding)
    binding.creation = 'initialized'; await this.persist()
    await this.publishWorld()
  }

  private async initializePopulation(): Promise<void> {
    const p = this.view.preparation
    if (!p.population) throw new Error('初期人口データがありません')
    const draft = await this.lockedDraft()
    const settings = this.settings()
    p.busy = true; await this.persist()
    for (const npc of p.population.npcs) {
      if (this.stopRequested) { p.paused = true; p.busy = false; await this.persist(); return }
      if (p.sessions.some(s => s.agentId === npc.id)) continue
      const effort = resolveEffort(requireModel(this.view.models, npc.birthModelId), settings.npc.effort, npc.age)
      await this.workspace.write(`agents/${npc.id}/character.json`, JSON.stringify(npc, null, 2))
      await this.workspace.write(`agents/${npc.id}/memory.md`, `# ${npc.name}\n\n初期化時点です。まだシミュレーション上の経験はありません。\n`)
      await this.createBinding({ agentId: npc.id, sessionId: npc.id, role: 'npc', modelId: npc.birthModelId, effort: effort.effective, cwd: path.join(this.workspace.root, `agents/${npc.id}`), threadId: null, creation: 'requested', seedPersisted: false }, this.prompts.npc(npc, draft.specification, this.memoryVersion === 1), JSON.stringify({ initialConditions: npc, town: draft.specification.town.setting, turn: 0, effectiveEffort: effort }))
    }
    for (const facility of draft.specification.town.facilities) {
      if (this.stopRequested) { p.paused = true; p.busy = false; await this.persist(); return }
      const id = `facility-${facility.id}`
      if (p.sessions.some(s => s.agentId === id)) continue
      await this.workspace.write(`facilities/${facility.id}/facility.json`, JSON.stringify(facility, null, 2))
      await this.createBinding({ agentId: id, sessionId: id, role: 'facility', modelId: settings.facility.modelId, effort: settings.facility.effort, cwd: path.join(this.workspace.root, `facilities/${facility.id}`), threadId: null, creation: 'requested', seedPersisted: false }, this.prompts.facility(facility, draft.specification), JSON.stringify({ facility, turn: 0 }))
    }
    if (p.sessions.some(s => s.creation !== 'initialized')) throw new Error('未初期化のSessionが残っています')
    if (this.lifeVersion) {
      p.operation = null; p.error = null
      if (!this.life) { this.createLife(); await this.life!.begin() }
      else await this.life.resume()
      await this.persist(); await this.publishWorld()
      return
    }
    p.phase = 'ready'; p.busy = false; p.paused = false; p.error = null; p.operation = null
    await this.persist(); await this.publishWorld()
  }

  private async restoreSessions(): Promise<void> {
    if (!this.view.preparation.sessions.length) return
    validateSettings(this.settings(), this.view.models)
    const p = this.view.preparation
    if (p.lock) await this.lockedDraft()
    if (p.population && p.draft) validatePopulation(p.population, p.draft.specification, p.draft.map, this.settings(), this.view.models)
    for (const binding of this.view.preparation.sessions) {
      if (!binding.threadId) throw new Error(`Session生成結果が未確定です。重複生成を避けるため自動再送しません: ${binding.agentId}`)
      if (!binding.seedPersisted) throw new Error(`初期文脈の保存結果が未確定です: ${binding.agentId} / ${binding.threadId}`)
      requireModel(this.view.models, binding.modelId)
      binding.cwd = await realpath(binding.cwd)
      const npc = p.population?.npcs.find(n => n.id === binding.agentId)
      if (binding.role === 'npc' && (!npc || npc.birthModelId !== binding.modelId)) throw new Error(`保存済みSessionと出生時モデルが一致しません: ${binding.agentId}`)
      let instructions = binding.role === 'parent' ? this.prompts.parent() : undefined
      if (binding.role === 'npc' && binding.lifeToolsVersion) {
        if (!npc || !p.draft) throw new Error(`NPCの再接続に必要な初期情報と仕様がありません: ${binding.agentId}`)
        instructions = this.prompts.npc(npc, p.draft.specification, binding.memoryVersion === 1)
      }
      await this.runtime.resume(binding, instructions)
      await this.sessions.attach(binding)
      binding.creation = 'initialized'
    }
    await this.persist()
    await this.publishWorld()
  }

  private createLife(saved?: LifeCheckpoint): void {
    const p = this.view.preparation
    if (!p.draft || !p.population) throw new Error('生活初期化には承認仕様と初期人口が必要です')
    const workspace = this.workspace
    const runId = this.world.runId
    const binding = (agentId: string): SessionBinding => {
      this.ensureConnected()
      const value = this.view.preparation.sessions.find(s => s.agentId === agentId)
      if (!value?.threadId || !value.seedPersisted) throw new Error(`生活Conversationが未初期化です: ${agentId}`)
      const model = requireModel(this.view.models, value.modelId)
      if (value.role === 'npc') {
        const npc = this.view.preparation.population!.npcs.find(n => n.id === agentId)
        if (!npc || npc.birthModelId !== value.modelId) throw new Error(`NPCの先天的モデルが変更されています: ${agentId}`)
        return { ...value, effort: resolveEffort(model, this.settings().npc.effort, npc.age).effective }
      }
      const fixed = this.settings().facility
      if (value.modelId !== fixed.modelId) throw new Error(`施設モデルが変更されています: ${agentId}`)
      return { ...value, effort: resolveEffort(model, { mode: 'fixed', effort: fixed.effort }, 18).effective }
    }
    this.life = new LifeHarness(p.draft.specification, p.population, {
      ...(this.memoryVersion ? { cognition: { runId, match: async (id: string, cue: string, records: import('../core/memory-contracts').MemoryRecord[], signal: AbortSignal, progress: (value: import('./memory-matcher').MemoryMatchProgress) => Promise<void>) => {
        const npc = binding(id)
        if (npc.memoryVersion !== 1 || !this.runtime.matchMemories) throw new Error(`記憶照合に対応していないConversationです: ${id}`)
        return this.runtime.matchMemories({ agentId: id, modelId: npc.modelId, effort: npc.effort, cwd: npc.cwd, cue, memories: records.map(record => ({ id: record.id, text: `${record.text}\n本人にとっての意味: ${record.meaning}`, ...record.cues })) }, signal, progress)
      } } } : {}),
      start: (id, text, clientId) => this.runtime.startTurn(binding(id), text, [], clientId),
      steer: (id, turnId, text, clientId) => this.runtime.steer(binding(id).threadId!, turnId, text, clientId),
      compact: id => this.runtime.compact(binding(id).threadId!),
      interrupt: (id, turnId) => {
        const value = p.sessions.find(s => s.agentId === id)
        if (!value?.threadId) throw new Error(`中断対象のConversationがありません: ${id}`)
        return this.runtime.interrupt(value.threadId, turnId)
      },
      history: id => this.runtime.history(binding(id).threadId!),
      terminalInput: (id, text) => this.sessions.input(binding(id).sessionId, text),
      save: async checkpoint => {
        const canonical = lifeCheckpointSchema.parse(checkpoint)
        await workspace.write('simulation/checkpoint.json', JSON.stringify({ hash: digest(JSON.stringify(canonical)), checkpoint: canonical }, null, 2))
      },
      ...(this.persistence ? { memory: { initialize: (checkpoint: LifeCheckpoint) => this.persistence!.initializeLife(checkpoint), changed: (change: import('../core/persistence').LifeChange) => this.persistence!.life(change) } } : {}),
      changed: value => {
        if (this.closing) return
        const stageChanged = this.lastLifeStage !== value.stage
        this.lastLifeStage = value.stage
        void this.serial(async () => {
          if (this.world.runId !== runId) return
          this.view.simulation = value
          if (value.stage === 'ready') { p.phase = 'ready'; p.busy = false; p.error = null; p.paused = false; p.operation = null }
          else if (value.stage === 'initializing') { p.busy = true; p.paused = false }
          else if (value.turn === 0 && ['paused', 'error'].includes(value.stage)) { p.busy = false; p.paused = true; p.error = value.error }
          await this.persist(); await this.publishWorld()
          if (this.persistence && stageChanged && ['ready', 'ended', 'paused'].includes(value.stage)) this.saveInBackground()
        }).catch(error => this.emit({ type: 'error', message: errorMessage(error) }))
      },
      failed: error => { workspace.report(error.message); this.emit({ type: 'error', message: error.message }) }
    }, saved)
    this.view.simulation = this.life.snapshot()
    this.lastLifeStage = this.view.simulation.stage
  }

  private async retry(): Promise<void> {
    this.ensureConnected(); this.ensureIdle()
    const p = this.view.preparation
    await this.restoreSessions()
    if (this.life) { await this.life.resume(); return }
    p.error = null; this.view.error = null; p.paused = false; this.stopRequested = false
    if (p.operation) {
      const threadId = this.parent().threadId!
      if (await this.runtime.inspect(threadId) === 'active') { p.busy = true; await this.persist(); return }
      if (p.operation.turnId) {
        const turn = await this.runtime.turn(threadId, p.operation.turnId)
        if (turn && turn.status !== 'inProgress') { await this.parentCompleted(p.operation.turnId, turn.status, turn.error); return }
      }
      throw new Error('中断した推論の完了状態を確定できません。接続済み親端末で成果物を確認・修正し、応答を完了してください')
    }
    if (p.phase === 'locked' || p.phase === 'generating') {
      if (p.population) await this.initializePopulation()
      else await this.generatePopulation()
    } else if (p.phase === 'interview' && !p.round) {
      await this.startParent('preparation', '前回の準備処理を再開してください。回答履歴を維持し、result.jsonに質問カードまたは地図付き仕様案を保存してください。')
    }
    await this.persist()
  }

  private notification(event: RpcNotification): void {
    if (this.closing) return
    if (this.life && ['turn/started', 'turn/completed', 'item/completed'].includes(event.method)) {
      const value = z.object({ threadId: z.string() }).safeParse(event.params)
      const binding = value.success ? this.view.preparation.sessions.find(s => s.threadId === value.data.threadId && s.role !== 'parent') : undefined
      if (binding) this.life.notify(binding.agentId, event.method, event.params)
    }
    if (event.method === 'turn/started' || event.method === 'turn/completed') {
      const parsed = turnEventSchema.safeParse(event.params)
      if (!parsed.success) { this.emit({ type: 'error', message: `不正なTurn通知: ${event.method}` }); return }
      const { threadId, turn } = parsed.data
      if (event.method === 'turn/started') this.activeTurns.set(threadId, turn.id)
      else this.activeTurns.delete(threadId)
      void this.serial(async () => {
        const binding = this.view.preparation.sessions.find(s => s.threadId === threadId)
        if (!binding) return
        if (binding.role === 'parent') {
          if (event.method === 'turn/started') {
            const p = this.view.preparation
            if (p.phase !== 'ready') {
              if (!p.operation) p.operation = { id: newId(), kind: p.phase === 'generating' ? 'population' : 'preparation', output: 'preparation/work/result.json', turnId: turn.id }
              p.operation.turnId = turn.id
              p.busy = true; await this.persist()
            }
          } else await this.parentCompleted(turn.id, turn.status, turn.error?.message)
        }
        await this.publishWorld()
      }).catch(error => this.emit({ type: 'error', message: errorMessage(error) }))
    } else if (event.method === 'account/login/completed' || event.method === 'account/updated') {
      void this.serial(async () => {
        const value = z.object({ success: z.boolean().optional(), error: z.string().nullable().optional() }).parse(event.params)
        this.view.login = null
        if (value.success === false) throw new Error('ログインが完了しませんでした。接続画面で再度ログインしてください')
        await this.refreshConnection()
        if (this.view.authenticated) await this.restoreSessions()
        await this.persist()
      }).catch(error => this.emit({ type: 'error', message: errorMessage(error) }))
    } else if (event.method === 'terminal/error') {
      this.emit({ type: 'error', message: z.object({ message: z.string() }).parse(event.params).message })
    } else if (event.method === 'runtime/error') {
      const value = z.object({ message: z.string() }).parse(event.params)
      this.activeTurns.clear()
      this.view.connection = 'error'; this.view.error = value.message
      this.view.preparation.busy = false; this.view.preparation.error = value.message; this.publish()
      if (this.life) void this.life.fail(new Error(value.message), false).catch(error => this.emit({ type: 'error', message: errorMessage(error) }))
    }
  }

  private async parentCompleted(turnId: string, status?: string, error?: string): Promise<void> {
    const p = this.view.preparation
    if (p.operation?.turnId && p.operation.turnId !== turnId) return
    p.busy = false
    if (status !== 'completed') { p.operation = null; throw new Error(`親の推論が${status === 'interrupted' ? '中断' : '失敗'}しました: ${error ?? turnId}`) }
    const operation = p.operation
    if (!operation) return
    p.operation = null
    const text = await this.workspace.read(operation.output)
    const hash = digest(text)
    if (hash === this.artifactHash) throw new Error('親の推論は完了しましたがresult.jsonが更新されていません。親端末へ成果物の修正を依頼してください')
    const input: unknown = JSON.parse(text)
    if (operation.kind === 'population') {
      const draft = await this.lockedDraft()
      p.population = validatePopulation(input, draft.specification, draft.map, this.settings(), this.view.models)
      this.artifactHash = hash
      await this.workspace.write('population.json', JSON.stringify(p.population, null, 2))
      await this.persist(); await this.initializePopulation()
    } else {
      if (p.lock) throw new Error('仕様は承認済みです。変更には新しい実行を作成してください')
      const artifact = preparationArtifactSchema.parse(input)
      if (artifact.kind === 'questions') {
        if (p.answers.some(a => a.roundId === artifact.round.id)) throw new Error('回答済み質問ラウンドのIDが再利用されています')
        p.round = artifact.round; p.phase = 'interview'
        await this.workspace.write(`preparation/questions/${artifact.round.id}.json`, JSON.stringify(artifact.round, null, 2))
      } else {
        if (!p.answers.length || p.round) throw new Error('仕様案の前に質問ラウンドへの回答が必要です')
        validateMap(artifact.draft.specification, artifact.draft.map)
        if (this.lifeVersion) validateLifeSpecification(artifact.draft.specification)
        p.revision++
        p.draft = { ...artifact.draft, revision: p.revision }
        p.phase = 'review'
        await this.workspace.write(`preparation/drafts/${p.revision}.json`, JSON.stringify(p.draft, null, 2))
      }
      this.artifactHash = hash; p.error = null; this.view.error = null
      await this.persist()
    }
  }

  private async publishWorld(): Promise<void> {
    const p = this.view.preparation
    const state = this.world
    const map = p.draft?.map ?? null
    const positions: Record<string, string | null> = {}
    const agents: RunState['agents'] = p.sessions.filter(s => s.creation === 'initialized').map(binding => {
      const npc = p.population?.npcs.find(n => n.id === binding.agentId)
      const facility = p.draft?.specification.town.facilities.find(f => `facility-${f.id}` === binding.agentId)
      if (npc) positions[binding.agentId] = npc.locationId
      return { id: binding.agentId, sessionId: binding.sessionId, parentId: binding.role === 'parent' ? null : 'parent', role: binding.role, name: npc?.name ?? facility?.name ?? 'オーケストレーター', color: binding.role === 'npc' ? '#9dbafa' : binding.role === 'facility' ? '#8bcdb0' : '#b0c0f4', status: !this.sessions.isRunning(binding.sessionId) ? 'ended' : binding.threadId && this.activeTurns.has(binding.threadId) ? 'running' : 'idle' }
    })
    const simulation = this.life?.snapshot()
    if (simulation) {
      this.view.simulation = simulation
      for (const a of simulation.actors) positions[a.id] = a.locationId
    }
    this.world = stateSchema.parse({ ...state, agents, map,
      ...(this.life?.memoryRelations() ? { relationships: { observedAt: new Date().toISOString(), observedTurn: simulation!.turn, day: simulation!.day, relations: this.life.memoryRelations()!.map(r => ({ ...r, id: `${r.source}->${r.target}`, evidence: r.evidence.map(e => ({ ...e, ownerId: r.source })) })) } } : {}),
      stage: simulation ? simulation.stage === 'initializing' ? 'preparing' : simulation.stage : p.phase === 'idle' ? 'draft' : p.phase === 'ready' ? 'ready' : p.paused ? 'paused' : 'preparing',
      frame: { revision: state.frame.revision + 1, turn: simulation?.turn ?? 0, day: simulation?.day ?? 1, phase: simulation?.time ?? 'morning', mapRevision: map?.revision ?? null, positions },
      ...(simulation ? { simulation } : {}) })
    await this.workspace.commit(this.world)
  }

  async saveNow(): Promise<void> { if (this.persistence) { await this.persist(); await this.persistence.flush() } else await this.persist() }
  private saveInBackground(): void { void this.saveNow().catch(error => this.emit({ type: 'error', message: `自動保存に失敗しました。生活は継続します: ${errorMessage(error)}` })) }
  async pause(): Promise<void> {
    this.writable()
    await this.pauseExecution()
    if (this.persistence) { await this.life?.drain(); await this.queue; await this.saveNow() }
  }
  private pauseExecution(): Promise<void> {
    if (this.life) return this.life.pause()
    this.stopRequested = true
    return Promise.all([...this.activeTurns].map(([threadId, turnId]) => this.runtime.interrupt(threadId, turnId))).then(() => this.serial(async () => {
      this.view.preparation.paused = true; this.view.preparation.busy = false
      await this.persist(); await this.publishWorld()
    }))
  }
  resume(): Promise<void> { this.writable(); return this.serial(async () => { this.ensureConnected(); if (this.life) await this.life.resume(); else await this.retry() }) }
  async interrupt(id: string): Promise<void> {
    this.writable()
    const binding = this.view.preparation.sessions.find(s => s.sessionId === id)
    if (!binding?.threadId) throw new Error(`Sessionがありません: ${id}`)
    const turn = this.activeTurns.get(binding.threadId)
    if (turn) await this.runtime.interrupt(binding.threadId, turn)
  }
  async terminalInput(id: string, data: string): Promise<void> {
    this.writable()
    const binding = this.view.preparation.sessions.find(s => s.sessionId === id)
    if (this.life && binding && data !== '\x03' && await this.life.bufferTerminal(binding.agentId, data)) return
    await this.sessions.input(id, data)
  }
  async conversation(id: string) {
    this.ensureConnected()
    const binding = this.view.preparation.sessions.find(s => s.sessionId === id)
    if (!binding?.threadId) throw new Error(`Conversationがありません: ${id}`)
    return this.runtime.conversation(binding.threadId)
  }
  memoryInspection(id: string) { if (!this.life) throw new Error('生活ワールドがありません'); return this.life.memoryInspection(id) }
  memoryDetail(id: string, memoryId: string, revision: number) { if (!this.life) throw new Error('生活ワールドがありません'); return this.life.memoryDetail(id, memoryId, revision) }
  newRun(): Promise<void> {
    if (this.persistence) return this.newMemoryRun()
    this.stopRequested = true
    return this.serial(async () => {
      if (this.life) { await this.life.close(this.view.connection === 'connected'); this.life = null }
      for (const [id, turn] of this.activeTurns) await this.runtime.interrupt(id, turn)
      this.activeTurns.clear()
      await this.sessions.dispose(); await this.workspace.close(); await this.createRun()
    })
  }
  async close(): Promise<void> {
    if (this.persistence) {
      await this.stopMemoryRun()
      await this.disposeMemoryRun()
      this.unsubscribe(); this.unsubscribeExit()
      return
    }
    if (this.closing) return
    this.closing = true; this.stopRequested = true
    if (this.life) await this.life.close(this.view.connection === 'connected')
    for (const [id, turn] of this.activeTurns) if (this.view.connection === 'connected') await this.runtime.interrupt(id, turn)
    await this.queue
    await this.sessions.dispose(); await this.runtime.close(); await this.workspace.close(); this.unsubscribe(); this.unsubscribeExit()
  }
  private async stopMemoryRun(): Promise<void> {
    this.stopping = true; this.stopRequested = true
    if (!this.resourcesStopped) {
      if (!this.persistence!.status.readOnlyReason) {
        await Promise.all([this.pauseExecution(), this.runtime.prepareShutdown?.()])
        await this.sessions.dispose()
        await this.life?.drain()
        for (const [id, turn] of this.activeTurns) await this.runtime.interrupt(id, turn)
        await this.life?.settle()
        await this.queue
        if (this.view.connection === 'connected') for (const binding of this.view.preparation.sessions) {
          if (binding.threadId && await this.runtime.inspect(binding.threadId) !== 'idle') throw new Error(`Conversationの停止を確認できません: ${binding.agentId}/${binding.threadId}`)
        }
        if (this.activeTurns.size || this.view.preparation.operation || this.view.preparation.sessions.some(s => !s.threadId || !s.seedPersisted)) throw new Error('外部操作の結果を確定できないため正常終了として保存できません')
      }
      try { await this.sessions.dispose(); await this.runtime.close() }
      finally { this.view.connection = 'disconnected'; this.view.authenticated = false; this.publish() }
      await this.life?.drain(); await this.queue
      if (!this.persistence!.status.readOnlyReason) {
        this.life?.assertStopped()
        if (this.activeTurns.size) throw new Error(`App Server停止後も未確定の推論があります: ${[...this.activeTurns.keys()].join(', ')}`)
      }
      this.resourcesStopped = true; this.view.connection = 'disconnected'; this.view.authenticated = false
      await this.publishWorld()
    }
    if (!this.persistence!.status.readOnlyReason) { await this.persist(); await this.persistence!.flush(true) }
  }
  private async disposeMemoryRun(): Promise<void> {
    this.closing = true
    if (this.publishTimer) { clearTimeout(this.publishTimer); this.publishTimer = null }
    await this.persistence!.close(); await this.workspace.close()
    this.life = null
  }
  cancelClose(): void { this.stopping = false; this.closing = false; this.stopRequested = false; this.runtime.cancelShutdown?.(); this.publish() }
  async discardClose(): Promise<void> {
    this.stopping = true; this.closing = true
    await this.sessions.dispose(); await this.runtime.close()
    if (this.persistence) await this.disposeMemoryRun()
    else await this.workspace.close()
    this.unsubscribe(); this.unsubscribeExit()
  }
  private async newMemoryRun(): Promise<void> {
    try { await this.stopMemoryRun(); await this.disposeMemoryRun() }
    catch (error) { this.cancelClose(); throw error }
    this.persistence = null; this.closing = false; this.stopping = false; this.stopRequested = false; this.resourcesStopped = false
    this.activeTurns.clear()
    await this.createRun()
  }
}

function validateImage(name: string, data: Uint8Array): void {
  if (path.basename(name) !== name || /[<>:"/\\|?*]/.test(name) || [...name].some(c => c.charCodeAt(0) < 32)) throw new Error(`画像ファイル名が不正です: ${name}`)
  const ext = path.extname(name).toLowerCase()
  const bytes = Buffer.from(data)
  const png = ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpg = ['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = ext === '.webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!png && !jpg && !webp) throw new Error(`PNG・JPEG・WebP画像を指定してください: ${name}`)
}
