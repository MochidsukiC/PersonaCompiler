import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { inputSchema, type AppEvent, type PreparationInput, type RelationshipSnapshot } from '../shared/contracts'
import { demoMap, descriptions, initialState, observer, residents } from './fixtures'
import { SessionManager } from './sessions'
import { Workspace, digest, messageOf } from './workspace'

export class DemoEngine {
  workspace!: Workspace
  readonly sessions: SessionManager
  private timer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private closing = false
  private pausedStage: 'preparing' | 'running' = 'running'

  constructor(private readonly base: string, private readonly emit: (event: AppEvent) => void, private readonly interval = 1800) {
    this.sessions = new SessionManager(chunk => emit({ type: 'terminal', chunk }))
  }

  async initialize(): Promise<void> { await mkdir(this.base, { recursive: true }); await this.createRun() }

  private async createRun(): Promise<void> {
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    this.workspace = new Workspace(path.join(this.base, runId), initialState(runId), snapshot => this.emit({ type: 'workspace', snapshot }))
    this.sessions.create('parent')
    await this.sessions.write('parent', '\x1b[38;5;151mPERSONA COMPILER\x1b[0m  /  ORCHESTRATOR\r\n\x1b[2m模擬Session · モデル未接続\x1b[0m\r\n\r\n準備ができました。地域の説明と画像を渡してください。\r\n› ')
    await this.workspace.initialize()
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation)
    this.queue = result.catch(error => this.workspace.report(messageOf(error)))
    return result
  }

  prepare(input: PreparationInput): Promise<void> {
    return this.serialize(async () => {
      const parsed = inputSchema.parse(input)
      const state = await this.workspace.readState()
      if (state.stage !== 'draft') throw new Error(`準備を開始できない状態です: ${state.stage}`)
      for (const image of parsed.images) {
        if (path.basename(image.name) !== image.name || /[<>:"/\\|?*]/.test(image.name) || Array.from(image.name).some(c => c.charCodeAt(0) < 32)) throw new Error(`画像ファイル名が不正です: ${image.name}`)
        const ext = path.extname(image.name).toLowerCase()
        const bytes = Buffer.from(image.bytes)
        const png = ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        const jpg = ['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        const webp = ext === '.webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        if (!png && !jpg && !webp) throw new Error(`PNG・JPEG・WebP画像を指定してください: ${image.name}`)
      }
      await this.workspace.write('inputs/description.md', parsed.description)
      for (const [index, image] of parsed.images.entries()) await this.workspace.write(`inputs/images/${index + 1}-${image.name}`, image.bytes)
      await this.sessions.write('parent', '\r\n\x1b[38;5;151m● PREPARATION\x1b[0m\r\n入力資料をディスクに保存しました。\r\n[DEMO] サンプル「木漏れ日の町」の地図を構成しています…\r\n')
      await this.workspace.commit({ ...state, stage: 'preparing', agents: state.agents.map(a => ({ ...a, status: 'running' })) })
      this.schedule()
    })
  }

  private schedule(): void {
    if (this.closing) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.step().then(() => {
        const stage = this.workspace.snapshot().state.stage
        if (stage === 'preparing' || stage === 'running') this.schedule()
      }, async error => {
        const message = `デモを停止しました: ${messageOf(error)}`
        this.workspace.report(message)
        this.emit({ type: 'error', message })
        await this.serialize(async () => {
          const state = await this.workspace.readState()
          await this.workspace.commit({ ...state, stage: 'error' })
        }).catch(persistenceError => this.emit({ type: 'error', message: `${message}\n停止状態の保存にも失敗しました: ${messageOf(persistenceError)}` }))
      })
    }, this.interval)
  }

  step(): Promise<void> {
    return this.serialize(async () => {
      const state = await this.workspace.readState()
      if (state.stage !== 'preparing' && state.stage !== 'running') return
      if (!state.map) {
        await this.workspace.commit({ ...state, map: demoMap, frame: { ...state.frame, mapRevision: 1, revision: state.frame.revision + 1 } })
        await this.sessions.write('parent', '\x1b[38;5;151m✓\x1b[0m 地図を確定しました。3地域 / 6施設\r\n初期住民のSessionを展開します。\r\n')
        return
      }
      const turn = state.frame.turn + 1
      const phase = (['morning', 'noon', 'evening', 'night'] as const)[(turn - 1) % 4]
      const day = Math.floor((turn - 1) / 4) + 1
      const people = residents.slice(0, turn >= 5 ? 6 : 4)
      const newPeople = people.filter(person => !state.agents.some(a => a.id === person.id))
      for (const person of newPeople) {
        this.sessions.create(person.sessionId)
        await this.sessions.write(person.sessionId, `\x1b[38;5;151m${person.name}\x1b[0m / NPC SESSION\r\n\x1b[2m模擬Session · ${person.id}\x1b[0m\r\n\r\n新しい一日が始まる。\r\n`)
        await this.workspace.write(`agents/${person.id}/memory.md`, `# ${person.name}の記憶\n\n> デモで生成された主観的な記憶です。外部エディターで編集できます。\n\n## 日々の出来事\n`)
        await this.sessions.write('parent', `  ↳ ${person.name} / Sessionを作成\r\n`)
      }
      if (!this.sessions.has('observer')) {
        this.sessions.create('observer')
        await this.sessions.write('observer', '\x1b[38;5;183mOBSERVER\x1b[0m / 観測専用の模擬Session\r\n一日の終わりに記憶ファイルの版とデモの関係を記録します。\r\n')
      }
      const existingStatuses = new Map(state.agents.map(a => [a.id, a.status]))
      const agents = [state.agents[0], observer, ...people].map(a => existingStatuses.has(a.id) ? { ...a, status: existingStatuses.get(a.id)! } : a)
      const places = phase === 'morning' ? ['park', 'park', 'library', 'workshop', null, 'cafe']
        : phase === 'noon' ? ['cafe', 'cafe', 'cafe', 'park', 'library', 'workshop']
        : phase === 'evening' ? ['library', 'workshop', 'library', 'cafe', 'park', 'park']
        : ['home-west', 'home-east', 'home-west', 'home-east', 'home-west', 'home-east']
      const positions: Record<string, string | null> = {}
      for (const [index, person] of people.entries()) {
        if (existingStatuses.get(person.id) === 'interrupted') {
          positions[person.id] = state.frame.positions[person.id]
          continue
        }
        positions[person.id] = places[index]
        const memoryPath = `agents/${person.id}/memory.md`
        const note = descriptions[(turn - 1) % 4]
        await this.workspace.append(memoryPath, `\n- Day ${day} / ${phase}: ${note}\n`)
        await this.sessions.write(person.id, `\r\n\x1b[2mDAY ${String(day).padStart(2, '0')} · ${phase.toUpperCase()}\x1b[0m\r\n${note}\r\n\x1b[38;5;109m  memory.write → ${memoryPath}\x1b[0m\r\n› `)
      }
      let relationships = state.relationships
      if (phase === 'night' && existingStatuses.get('observer') !== 'interrupted') {
        relationships = await this.observe(turn, day)
        await this.workspace.write(`observations/day-${day}.json`, JSON.stringify(relationships, null, 2))
        await this.sessions.write('observer', `\r\nDay ${day} の観測が完了しました。\r\n  3つの方向付き関係 / 根拠ファイルの版を保存\r\n  [DEMO] 意味の抽出はサンプルデータです。\r\n`)
      }
      await this.workspace.commit({ ...state, stage: 'running', agents, relationships,
        frame: { revision: state.frame.revision + 1, turn, day, phase, mapRevision: state.map.revision, positions } })
    })
  }

  private async observe(turn: number, day: number): Promise<RelationshipSnapshot> {
    const relations = [
      { id: 'hana-yuto', source: 'hana', target: 'yuto', label: day > 1 ? 'また話したい' : '話しやすい', description: '花は悠斗との会話に安心感を覚えている。互いの認識が同じとは限らない。' },
      { id: 'yuto-hana', source: 'yuto', target: 'hana', label: '気になる人', description: '悠斗は花の考え方に興味を持ち、もう少し知りたいと思っている。' },
      { id: 'mei-hana', source: 'mei', target: 'hana', label: '顔なじみ', description: '芽衣は図書室で顔を合わせた花を覚えている。' }
    ]
    return { observedAt: new Date().toISOString(), observedTurn: turn, day, relations: await Promise.all(relations.map(async relation => {
      const evidencePath = `agents/${relation.source}/memory.md`
      return { ...relation, evidence: [{ path: evidencePath, hash: digest(await this.workspace.read(evidencePath)) }] }
    })) }
  }

  pause(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    return this.serialize(async () => {
      const state = await this.workspace.readState()
      if (state.stage !== 'running' && state.stage !== 'preparing') throw new Error(`一時停止できない状態です: ${state.stage}`)
      this.pausedStage = state.stage
      await this.workspace.commit({ ...state, stage: 'paused' })
    })
  }

  resume(): Promise<void> {
    return this.serialize(async () => {
      const state = await this.workspace.readState()
      if (state.stage !== 'paused') throw new Error(`再開できない状態です: ${state.stage}`)
      await this.workspace.commit({ ...state, stage: this.pausedStage, agents: state.agents.map(a => a.role === 'parent' ? { ...a, status: 'running' } : a) })
      this.schedule()
    })
  }

  interrupt(sessionId: string): Promise<void> {
    return this.serialize(async () => {
      const state = await this.workspace.readState()
      const agent = state.agents.find(a => a.sessionId === sessionId)
      if (!agent) throw new Error(`割り込み対象が不明です: ${sessionId}`)
      await this.sessions.write(sessionId, '\r\n\x1b[38;5;173m^C 処理を中断しました。Sessionと端末は保持されています。\x1b[0m\r\n› ')
      const pauseAll = agent.role === 'parent' && ['preparing', 'running'].includes(state.stage)
      if (pauseAll) {
        if (this.timer) { clearTimeout(this.timer); this.timer = null }
        this.pausedStage = state.stage as 'preparing' | 'running'
      }
      await this.workspace.commit({ ...state, stage: pauseAll ? 'paused' : state.stage,
        agents: state.agents.map(a => a.id === agent.id ? { ...a, status: 'interrupted' } : a) })
    })
  }

  terminalInput(id: string, data: string): Promise<void> {
    return this.serialize(async () => {
      if (data.includes('\x03')) {
        throw new Error('Ctrl+Cは割り込み操作として送信してください')
      }
      const state = await this.workspace.readState()
      const agent = state.agents.find(a => a.sessionId === id)
      if (!agent) throw new Error(`入力対象が不明です: ${id}`)
      await this.sessions.input(id, data)
      if (agent.status === 'interrupted' && /[\r\n]/.test(data)) {
        await this.workspace.commit({ ...state, agents: state.agents.map(a => a.id === agent.id ? { ...a, status: 'running' } : a) })
      }
    })
  }

  newRun(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    return this.serialize(async () => {
      await this.workspace.close()
      await this.sessions.dispose()
      await this.createRun()
    })
  }

  async close(): Promise<void> {
    this.closing = true
    if (this.timer) clearTimeout(this.timer)
    await this.queue
    await this.workspace.close()
    await this.sessions.dispose()
  }
}
