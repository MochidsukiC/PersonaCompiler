import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { LifeChange, LifeHistoryRecord } from './persistence'
import { lifeTransaction, plainLifeValue } from './life-transaction'
import type { Population, Specification } from './contracts'
import { lifeToolSchemas, simulationSchema, type LifeActor, type LifeFacility, type SimulationSnapshot } from './life-contracts'
import { contains, households, LifeRuleError, speechRecipients, validPosition, validateLayout, validateLifeSpecification } from './spatial'

const jobSchema = z.object({
  id: z.string(), agentId: z.string(), text: z.string(), kind: z.enum(['layout', 'position', 'activity', 'message', 'facility', 'reply', 'compact', 'user']),
  status: z.enum(['queued', 'deferred', 'requested', 'running', 'done', 'discarded']), turnId: z.string().nullable(), completed: z.boolean()
})
const resultSchema = z.object({ success: z.boolean(), contentItems: z.array(z.object({ type: z.literal('inputText'), text: z.string() })) })
export const lifeCheckpointSchema = z.object({
  world: simulationSchema, jobs: z.array(jobSchema),
  active: z.record(z.string(), z.object({ turnId: z.string().nullable(), kind: z.enum(['normal', 'compact']), compactSeen: z.boolean() })),
  interactions: z.array(z.object({ id: z.string(), npcId: z.string(), facilityId: z.string(), request: z.string(), done: z.boolean() })),
  receipts: z.record(z.string(), z.object({ fingerprint: z.string(), result: resultSchema })), terminalInputs: z.record(z.string(), z.string()), terminalWrites: z.record(z.string(), z.string()),
  completedJobKinds: z.record(z.string(), jobSchema.shape.kind).optional()
})
export type LifeCheckpoint = z.infer<typeof lifeCheckpointSchema>
type Job = LifeCheckpoint['jobs'][number]
type ToolResult = z.infer<typeof resultSchema>
export interface LifeHistoryTurn { id: string; status: string; clientIds: string[]; compact: boolean }
export class TurnAlreadyEndedError extends Error {}
export interface LifeServices {
  start(agentId: string, text: string, clientId: string): Promise<string>
  steer(agentId: string, turnId: string, text: string, clientId: string): Promise<void>
  compact(agentId: string): Promise<void>
  interrupt(agentId: string, turnId: string): Promise<void>
  history(agentId: string): Promise<LifeHistoryTurn[]>
  terminalInput(agentId: string, data: string): Promise<void>
  save(value: LifeCheckpoint): Promise<void>
  memory?: { initialize(value: LifeCheckpoint): void; changed(value: LifeChange): void }
  changed(value: SimulationSnapshot): void
  failed(error: Error): void
}
const reply = (value: unknown, success = true): ToolResult => ({ success, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] })
const unique = () => crypto.randomUUID()

export class LifeHarness {
  private data: LifeCheckpoint
  private queue: Promise<unknown> = Promise.resolve()
  private scheduled = false
  private closed = false
  private stopTask: Promise<void> | null = null
  private readonly pending = new Set<Promise<unknown>>()
  private readonly receipts = new Map<string, LifeCheckpoint['receipts'][string]>()
  private readonly completedKinds = new Map<string, Job['kind']>()

  constructor(private readonly specification: Specification, private readonly population: Population, private readonly services: LifeServices, saved?: LifeCheckpoint) {
    validateLifeSpecification(specification)
    if (saved) {
      this.data = lifeCheckpointSchema.parse(saved)
      const expected = specification.town.facilities
      if (this.data.world.facilities.length !== expected.length || this.data.world.actors.length !== population.npcs.length) throw new LifeRuleError('保存済み世界と承認仕様の人数・施設数が一致しません')
      if (new Set(this.data.world.facilities.map(f => f.id)).size !== expected.length || new Set(this.data.world.actors.map(a => a.id)).size !== population.npcs.length) throw new LifeRuleError('保存済み世界の施設IDまたはNPC IDが重複しています')
      for (const f of this.data.world.facilities) {
        const source = expected.find(v => v.id === f.id && v.locationId === f.locationId)
        if (!source || JSON.stringify(source.dimensions) !== JSON.stringify(f.dimensions)) throw new LifeRuleError(`保存済み施設と承認仕様が一致しません: ${f.id}`)
        if (f.layout) validateLayout(f, f.layout, households(population).map(h => h.id))
      }
      for (const a of this.data.world.actors) {
        if (!population.npcs.some(n => n.id === a.id && n.householdId === a.householdId)) throw new LifeRuleError(`保存済みNPCが初期人口と一致しません: ${a.id}`)
        if (a.position && !validPosition(this.facility(this.data, a.locationId).dimensions, a.position)) throw new LifeRuleError(`保存済み座標が不正です: ${a.id}`)
      }
      if (!['ready', 'ended'].includes(this.data.world.stage)) this.data.world.stage = 'paused'
    } else {
      const facilities = specification.town.facilities.map(f => ({ id: f.id, locationId: f.locationId, name: f.name, type: f.type, dimensions: f.dimensions!, layout: null }))
      for (const n of population.npcs) if (!facilities.some(f => f.locationId === n.locationId)) throw new LifeRuleError(`NPCの初期位置に施設がありません: ${n.id}/${n.locationId}`)
      this.data = {
        world: { version: 1, revision: 0, stage: 'initializing', phase: 'facilities', turn: 0, day: 1, time: 'morning', step: false, facilities,
          actors: population.npcs.map(n => ({ id: n.id, name: n.name, householdId: n.householdId, locationId: n.locationId, position: null, activity: 'entering', nextFacilityId: null, wakeAt: null, compact: 'none' })), events: [], error: null },
        jobs: [], active: {}, interactions: [], receipts: {}, terminalInputs: {}, terminalWrites: {}
      }
    }
    if (services.memory) {
      for (const [id, kind] of Object.entries(this.data.completedJobKinds ?? {})) this.completedKinds.set(id, kind)
      delete this.data.completedJobKinds
      for (const [key, value] of Object.entries(this.data.receipts)) this.receipts.set(key, value)
      this.data.receipts = {}
      for (const job of this.data.jobs) if (['done', 'discarded'].includes(job.status)) this.completedKinds.set(job.id, job.kind)
      this.data.jobs = this.data.jobs.filter(job => !['done', 'discarded'].includes(job.status))
      this.data.interactions = this.data.interactions.filter(item => !item.done)
      this.data.world.events = this.data.world.events.slice(-200)
    }
  }
  snapshot(): SimulationSnapshot { return structuredClone(this.data.world) }
  checkpoint(): LifeCheckpoint { return structuredClone(this.data) }
  private actor(d: LifeCheckpoint, id: string): LifeActor {
    const actor = d.world.actors.find(a => a.id === id)
    if (!actor) throw new LifeRuleError(`NPCが見つかりません: ${id}`)
    return actor
  }
  private facility(d: LifeCheckpoint, locationId: string): LifeFacility {
    const f = d.world.facilities.find(f => f.locationId === locationId)
    if (!f) throw new LifeRuleError(`施設が見つかりません: ${locationId}`)
    return f
  }
  private update<T>(work: (draft: LifeCheckpoint) => T): Promise<T> {
    const task = this.queue.then(async () => {
      const transaction = this.services.memory ? lifeTransaction(this.data) : null
      const next = transaction ? transaction.value : structuredClone(this.data)
      const result = work(transaction ? transaction.draft : next)
      if (transaction ? transaction.changed.size > 0 : JSON.stringify(next) !== JSON.stringify(this.data)) {
        next.world.revision++
        if (this.services.memory) this.commitMemory(next)
        else await this.services.save(next)
        this.data = next
        this.services.changed(this.snapshot())
        this.kick()
      }
      return result
    })
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }
  private commitMemory(next: LifeCheckpoint): void {
    const history: LifeHistoryRecord[] = []
    const oldJobs = new Map(this.data.jobs.map(job => [job.id, job]))
    for (const job of next.jobs) {
      if (!isDeepStrictEqual(oldJobs.get(job.id), job)) history.push({ kind: 'job', value: job })
    }
    const oldInteractions = new Map(this.data.interactions.map(item => [item.id, item]))
    for (const item of next.interactions) if (!isDeepStrictEqual(oldInteractions.get(item.id), item)) history.push({ kind: 'interaction', value: item })
    for (const [key, value] of Object.entries(next.receipts)) history.push({ kind: 'receipt', key, value })
    const lastEvent = this.data.world.events.at(-1)?.sequence ?? 0
    for (const event of next.world.events) if (event.sequence > lastEvent) history.push({ kind: 'event', value: event })
    next.jobs = next.jobs.filter(job => !['done', 'discarded'].includes(job.status))
    next.interactions = next.interactions.filter(item => !item.done)
    next.receipts = {}; next.world.events = next.world.events.slice(-200)
    const patches: LifeChange['patches'] = []
    for (const key of Object.keys(next) as (keyof LifeCheckpoint)[]) {
      if (key === 'world' || key === 'receipts') continue
      if (!isDeepStrictEqual(this.data[key], next[key])) patches.push({ path: [key], value: next[key] })
    }
    for (const key of Object.keys(next.world) as (keyof SimulationSnapshot)[]) {
      if (key === 'events') continue
      if (key === 'actors' || key === 'facilities') {
        next.world[key].forEach((value, index) => {
          if (!isDeepStrictEqual(this.data.world[key][index], value)) patches.push({ path: ['world', key, index], value })
        })
      } else if (!isDeepStrictEqual(this.data.world[key], next.world[key])) patches.push({ path: ['world', key], value: next.world[key] })
    }
    this.services.memory!.changed({ patches, history })
    for (const record of history) {
      if (record.kind === 'receipt') this.receipts.set(record.key, record.value)
      if (record.kind === 'job' && ['done', 'discarded'].includes(record.value.status)) this.completedKinds.set(record.value.id, record.value.kind)
    }
  }
  private enqueue(d: LifeCheckpoint, agentId: string, kind: Job['kind'], text: string, deferred = false): Job {
    const job: Job = { id: unique(), agentId, kind, text, status: deferred ? 'deferred' : 'queued', turnId: null, completed: false }
    d.jobs.push(job)
    return job
  }
  private quiet(d: LifeCheckpoint): boolean {
    return !Object.keys(d.active).length && !Object.keys(d.terminalWrites).length && !d.jobs.some(j => ['queued', 'requested', 'running'].includes(j.status)) && !d.interactions.some(i => !i.done)
  }
  private situation(d: LifeCheckpoint, id: string) {
    const actor = this.actor(d, id)
    const facility = this.facility(d, actor.locationId)
    const residential = d.world.facilities.find(f => f.type === 'residential')!
    return { turn: d.world.turn, day: d.world.day, time: d.world.time, phase: d.world.phase, self: actor,
      facility, currentRegions: facility.layout?.regions.filter(region => actor.position && contains(region.bounds, actor.position)),
      home: residential.layout?.homes.find(h => h.householdId === actor.householdId), homeLocationId: residential.locationId,
      npcs: d.world.actors.filter(a => a.locationId === actor.locationId).map(a => ({ id: a.id, name: a.name, position: a.position, activity: a.activity })),
      destinations: d.world.facilities.map(f => ({ id: f.id, name: f.name, locationId: f.locationId })) }
  }
  private event(d: LifeCheckpoint, actor: LifeActor, kind: SimulationSnapshot['events'][number]['kind'], text: string, recipients: string[] = []) {
    const event = { sequence: (d.world.events.at(-1)?.sequence ?? 0) + 1, turn: d.world.turn, kind, actorId: actor.id, text, recipients, locationId: actor.locationId, position: actor.position }
    d.world.events.push(event)
    return event
  }
  async begin(): Promise<void> {
    if (this.services.memory) this.services.memory.initialize(this.data)
    else await this.services.save(this.data)
    this.services.changed(this.snapshot())
    await this.update(d => {
      if (d.jobs.length) throw new LifeRuleError('初期化は既に開始されています')
      this.enqueueMissingInitialization(d)
    })
  }
  private enqueueMissingInitialization(d: LifeCheckpoint): void {
    const pending = (id: string) => d.jobs.some(j => j.agentId === id && !['done', 'discarded'].includes(j.status))
    if (d.world.phase === 'facilities') for (const f of d.world.facilities) {
      const id = `facility-${f.id}`
      if (!f.layout && !pending(id)) this.enqueue(d, id, 'layout', `施設初期化です。initializeFacilityで領域を確定したら応答を終了してください。施設のサイズは変更できません。\n${JSON.stringify({ facility: f, households: f.type === 'residential' ? households(this.population) : [], bounds: 'min/maxは両端を含む整数座標。家同士の範囲は重複不可。全世帯に1軒ずつ必要。' })}`)
    }
    if (['positions', 'entry'].includes(d.world.phase)) for (const a of d.world.actors) {
      if (!a.position && !pending(a.id)) this.enqueue(d, a.id, 'position', `入場位置の設定を再開します。setInitialPositionで選び、応答を終了してください。\n${JSON.stringify(this.situation(d, a.id))}`)
    }
  }
  private enterNextTurn(d: LifeCheckpoint): void {
    d.world.turn++
    d.world.day = Math.floor((d.world.turn - 1) / 4) + 1
    d.world.time = (['morning', 'noon', 'evening', 'night'] as const)[(d.world.turn - 1) % 4]
    d.world.phase = 'entry'
    for (const actor of d.world.actors) {
      if (actor.activity === 'sleeping') this.event(d, actor, 'wake', '起床しました')
      actor.activity = 'active'; actor.wakeAt = null; actor.compact = 'none'
      if (actor.nextFacilityId) {
        const destination = d.world.facilities.find(f => f.id === actor.nextFacilityId)!
        actor.locationId = destination.locationId; actor.position = null; actor.activity = 'entering'; actor.nextFacilityId = null
        this.enqueue(d, actor.id, 'position', `新しいターンの入場位置をsetInitialPositionで選び、応答を終了してください。生活開始は全員の入場位置確定後です。\n${JSON.stringify(this.situation(d, actor.id))}`)
      }
    }
  }
  async start(step = false): Promise<void> {
    await this.update(d => {
      if (d.world.stage !== 'ready') throw new LifeRuleError('開始できるのは準備完了の新規ワールドです')
      d.world.stage = 'running'; d.world.step = step; d.world.error = null
      this.enterNextTurn(d)
    })
  }
  async pause(): Promise<void> {
    await this.update(d => { if (!['ready', 'ended'].includes(d.world.stage)) d.world.stage = 'paused' })
    await Promise.all(Object.entries(this.data.active).flatMap(([id, active]) => active.turnId ? [this.services.interrupt(id, active.turnId)] : []))
  }
  async resume(step = false): Promise<void> {
    await this.reconcile()
    await this.stopTask
    this.stopTask = null
    await this.update(d => {
      if (!['paused', 'error'].includes(d.world.stage)) throw new LifeRuleError('世界は停止中ではありません')
      d.world.error = null; d.world.step = step
      d.world.stage = d.world.turn === 0 ? 'initializing' : 'running'
      this.enqueueMissingInitialization(d)
      for (const facility of d.world.facilities) {
        const id = `facility-${facility.id}`
        const unanswered = d.interactions.filter(i => i.facilityId === facility.id && !i.done)
        if (unanswered.length && !d.active[id] && !d.jobs.some(j => j.agentId === id && ['queued', 'requested', 'running'].includes(j.status))) this.enqueue(d, id, 'facility', `中断した施設利用への回答を再開してください。確定済みの回答は再送しません。\n${JSON.stringify(unanswered)}`)
      }
      if (d.world.phase === 'between') this.enterNextTurn(d)
    })
  }
  private async reconcile(): Promise<void> {
    if (Object.keys(this.data.terminalWrites).length) throw new LifeRuleError(`端末入力の配信結果が未確定です。自動再送しません: ${Object.keys(this.data.terminalWrites).join(', ')}`)
    const pending = this.data.jobs.filter(j => ['requested', 'running'].includes(j.status))
    const agents = [...new Set([...pending.map(j => j.agentId), ...Object.keys(this.data.active)])]
    for (const agentId of agents) {
      const turns = await this.services.history(agentId)
      await this.update(d => {
        for (const job of d.jobs.filter(j => j.agentId === agentId && ['requested', 'running'].includes(j.status))) {
          const turn = job.turnId ? turns.find(t => t.id === job.turnId) : turns.find(t => t.clientIds.includes(job.id))
          if (!turn) throw new LifeRuleError(`推論結果が未確定です。自動再送しません: ${agentId}/${job.id}`)
          if (job.kind !== 'compact' && !turn.clientIds.includes(job.id)) throw new LifeRuleError(`メッセージの配信結果が未確定です。自動再送しません: ${agentId}/${job.id}`)
          job.turnId = turn.id
          if (turn.status === 'inProgress') throw new LifeRuleError(`前回の推論が実行中です: ${agentId}/${turn.id}`)
          if (job.kind === 'compact' && (turn.status !== 'completed' || !turn.compact)) throw new LifeRuleError(`Compactの成功を確認できません: ${agentId}/${turn.id}`)
          job.status = 'done'
          if (job.kind === 'compact') this.actor(d, agentId).compact = 'complete'
        }
        const active = d.active[agentId]
        if (active) {
          const turn = turns.find(t => t.id === active.turnId)
          if (!turn) throw new LifeRuleError(`Conversationの実行結果が未確定です。自動再送しません: ${agentId}`)
          if (turn.status === 'inProgress') throw new LifeRuleError(`Conversationが実行中です: ${agentId}`)
        }
        delete d.active[agentId]
      })
    }
  }
  private kick(): void {
    if (this.scheduled || this.closed) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      const task = this.drive().catch(error => this.fail(error))
      this.track(task)
    })
  }
  private track(task: Promise<unknown>): void {
    this.pending.add(task)
    void task.then(() => this.pending.delete(task), error => { this.pending.delete(task); this.services.failed(error instanceof Error ? error : new Error(String(error))) })
  }
  private advance(d: LifeCheckpoint): void {
    if (d.world.phase === 'facilities' && this.quiet(d)) {
      if (d.world.facilities.some(f => !f.layout)) throw new LifeRuleError('初期化が完了していない施設があります')
      d.world.phase = 'positions'
      for (const actor of d.world.actors) this.enqueue(d, actor.id, 'position', `turn=0の初期位置をsetInitialPositionで選び、応答を終了してください。生活はまだ開始しません。\n${JSON.stringify(this.situation(d, actor.id))}`)
    } else if (d.world.phase === 'positions' && this.quiet(d)) {
      if (d.world.actors.some(a => !a.position)) throw new LifeRuleError('初期位置が未設定のNPCがいます')
      d.world.stage = 'ready'; d.world.phase = 'between'
    } else if (d.world.phase === 'entry' && this.quiet(d)) {
      if (d.world.actors.some(a => !a.position)) throw new LifeRuleError('入場位置が未設定のNPCがいます')
      d.world.phase = 'activity'
      for (const a of d.world.actors) a.activity = 'active'
      for (const j of d.jobs) if (j.status === 'deferred') j.status = 'queued'
    } else if (d.world.phase === 'activity' && this.quiet(d) && d.world.actors.every(a => a.activity === 'ended' || (a.activity === 'sleeping' && a.compact === 'complete'))) {
      d.world.phase = 'between'
      if (d.world.turn >= this.specification.simulation.maxTurns) { d.world.stage = 'ended'; d.world.phase = 'complete' }
      else if (d.world.step) d.world.stage = 'paused'
      else this.enterNextTurn(d)
    }
  }
  private async drive(): Promise<void> {
    const actions = await this.update(d => {
      if (this.closed || !['initializing', 'running'].includes(d.world.stage)) return []
      this.advance(d)
      if (!['initializing', 'running'].includes(d.world.stage)) return []
      if (d.world.phase === 'activity') for (const a of d.world.actors) {
        const busy = d.active[a.id] || d.jobs.some(j => j.agentId === a.id && ['queued', 'requested', 'running'].includes(j.status))
        if (busy) continue
        if (a.activity === 'active') this.enqueue(d, a.id, 'activity', `現在の状況から自分の行動を選んでください。発話・移動・施設利用はToolで行い、活動終了はendTurnまたはsleepで通知してください。推論の文章だけでは活動終了になりません。\n${JSON.stringify(this.situation(d, a.id))}`)
        if (a.activity === 'sleeping' && a.compact === 'pending') { a.compact = 'running'; this.enqueue(d, a.id, 'compact', '') }
      }
      const actions: { job: Job; activeTurn: string | null; steer: boolean }[] = []
      for (const job of d.jobs.filter(j => j.status === 'queued')) {
        const recipient = d.world.actors.find(a => a.id === job.agentId)
        if (recipient?.activity === 'sleeping' && ['message', 'reply', 'user'].includes(job.kind)) {
          job.status = job.kind === 'message' ? 'discarded' : 'deferred'
          continue
        }
        const active = d.active[job.agentId]
        if (active && (!active.turnId || active.kind === 'compact' || job.kind === 'compact')) continue
        if (active && d.jobs.some(j => j.agentId === job.agentId && j.status === 'requested')) continue
        job.status = 'requested'
        if (recipient?.activity === 'ended' && ['message', 'reply', 'user'].includes(job.kind)) recipient.activity = 'active'
        if (active) job.turnId = active.turnId
        if (!active) d.active[job.agentId] = { turnId: null, kind: job.kind === 'compact' ? 'compact' : 'normal', compactSeen: false }
        actions.push({ job: plainLifeValue(job), activeTurn: active?.turnId ?? null, steer: !!active })
      }
      return actions
    })
    for (const action of actions) this.track(this.dispatch(action.job, action.activeTurn, action.steer).catch(error => this.fail(error)))
    const writes = await this.update(d => {
      if (d.world.phase !== 'activity' || d.world.stage !== 'running') return []
      const writes: [string, string][] = []
      for (const [id, text] of Object.entries(d.terminalInputs)) {
        if (this.actor(d, id).activity === 'sleeping' || d.terminalWrites[id]) continue
        d.terminalWrites[id] = text; delete d.terminalInputs[id]; writes.push([id, text])
      }
      return writes
    })
    for (const [agentId, text] of writes) {
      await this.services.terminalInput(agentId, text)
      await this.update(d => { delete d.terminalWrites[agentId] })
    }
  }
  private async dispatch(job: Job, activeTurn: string | null, steer: boolean): Promise<void> {
    let turnId = activeTurn
    if (job.kind === 'compact') await this.services.compact(job.agentId)
    else if (steer) {
      try { await this.services.steer(job.agentId, activeTurn!, job.text, job.id) }
      catch (error) {
        if (!(error instanceof TurnAlreadyEndedError)) throw error
        await this.update(d => {
          const current = d.jobs.find(j => j.id === job.id)!
          current.status = 'queued'; current.turnId = null; current.completed = false
          if (d.active[job.agentId]?.turnId === activeTurn) delete d.active[job.agentId]
        })
        return
      }
    }
    else turnId = await this.services.start(job.agentId, job.text, job.id)
    await this.update(d => {
      const current = d.jobs.find(j => j.id === job.id)!
      if (current.status === 'done') return
      current.status = current.completed ? 'done' : 'running'
      if (turnId) current.turnId = turnId
      const active = d.active[job.agentId]
      if (active && turnId) active.turnId = turnId
    })
    if (['paused', 'error'].includes(this.data.world.stage) && turnId) await this.services.interrupt(job.agentId, turnId)
  }
  notify(agentId: string, method: string, params: unknown): void {
    if (this.closed) return
    this.track(this.update(d => {
      if (method === 'turn/started') {
        const { turn } = z.object({ turn: z.object({ id: z.string() }) }).parse(params)
        const existing = d.active[agentId]
        if (existing?.turnId === turn.id) return
        if (existing?.turnId && existing.turnId !== turn.id) throw new LifeRuleError(`同一Conversationに推論が競合しました: ${agentId}`)
        d.active[agentId] = { turnId: turn.id, kind: existing?.kind ?? 'normal', compactSeen: false }
        for (const job of d.jobs.filter(j => j.agentId === agentId && ['requested', 'running'].includes(j.status) && !j.turnId)) job.turnId = turn.id
        const actor = d.world.actors.find(a => a.id === agentId)
        if (!existing && actor?.activity === 'ended' && d.world.phase === 'activity') actor.activity = 'active'
      } else if (method === 'item/completed') {
        const value = z.object({ item: z.object({ type: z.string(), clientId: z.string().nullable().optional() }) }).parse(params)
        if (value.item.type === 'contextCompaction' && d.active[agentId]?.kind === 'compact') d.active[agentId].compactSeen = true
        if (value.item.type === 'userMessage' && d.world.phase === 'activity') {
          const actor = d.world.actors.find(a => a.id === agentId)
          const kind = d.jobs.find(j => j.id === value.item.clientId)?.kind ?? (value.item.clientId ? this.completedKinds.get(value.item.clientId) : undefined)
          if (actor?.activity === 'ended' && (!kind || ['message', 'reply', 'user'].includes(kind))) actor.activity = 'active'
        }
      } else if (method === 'turn/completed') {
        const { turn } = z.object({ turn: z.object({ id: z.string(), status: z.string(), error: z.object({ message: z.string() }).nullable().optional() }) }).parse(params)
        const active = d.active[agentId]?.turnId === turn.id ? d.active[agentId] : undefined
        const jobs = d.jobs.filter(j => j.agentId === agentId && j.turnId === turn.id && j.status !== 'done')
        if (!active && !jobs.length) return
        if (active?.turnId === turn.id) delete d.active[agentId]
        for (const job of jobs) { job.completed = true; if (job.status === 'running') job.status = 'done' }
        const stop = (message: string) => {
          const error = new LifeRuleError(message)
          if (d.world.stage !== 'error') d.world.error = message
          d.world.stage = 'error'
          return error
        }
        if (turn.status !== 'completed') {
          if (active?.kind === 'compact') this.actor(d, agentId).compact = 'pending'
          if (turn.status === 'interrupted') { if (d.world.stage !== 'error') d.world.stage = 'paused' }
          else return stop(`推論に失敗しました: ${agentId}/${turn.id}: ${turn.error?.message ?? turn.status}`)
          return
        }
        if (active?.kind === 'compact') {
          if (!active.compactSeen) return stop(`Compact完了を確認できません: ${agentId}/${turn.id}`)
          this.actor(d, agentId).compact = 'complete'
        }
        if (jobs.some(j => j.kind === 'layout') && !d.world.facilities.find(f => `facility-${f.id}` === agentId)?.layout) return stop(`施設初期化Toolが実行されていません: ${agentId}`)
        if (jobs.some(j => j.kind === 'position') && !this.actor(d, agentId).position) return stop(`初期位置Toolが実行されていません: ${agentId}`)
        if (jobs.some(j => j.kind === 'facility') && d.interactions.some(i => `facility-${i.facilityId}` === agentId && !i.done)) this.enqueue(d, agentId, 'facility', `未回答の利用要求へcompleteFacilityUseで回答してください。\n${JSON.stringify(d.interactions.filter(i => `facility-${i.facilityId}` === agentId && !i.done))}`)
      }
    }).then(error => { if (error) return this.fail(error) }).catch(error => this.fail(error)))
  }
  async bufferTerminal(agentId: string, text: string): Promise<boolean> {
    const actor = this.data.world.actors.find(a => a.id === agentId)
    if (!actor || (actor.activity !== 'sleeping' && actor.compact !== 'running')) return false
    await this.update(d => { d.terminalInputs[agentId] = (d.terminalInputs[agentId] ?? '') + text })
    return true
  }
  async tool(agentId: string, call: { turnId: string; callId: string; tool: string; arguments: unknown }): Promise<ToolResult> {
    return this.update(d => {
      const key = `${agentId}:${call.turnId}:${call.callId}`
      const fingerprint = JSON.stringify({ name: call.tool, arguments: call.arguments })
      const old = this.services.memory ? this.receipts.get(key) : d.receipts[key]
      if (old) {
        if (old.fingerprint !== fingerprint) throw new LifeRuleError(`同じTool IDの内容が変更されています: ${key}`)
        return old.result
      }
      let result: ToolResult
      try {
        if (!Object.hasOwn(lifeToolSchemas, call.tool)) throw new LifeRuleError(`未対応の生活Toolです: ${call.tool}`)
        if (call.tool !== 'getSituation' && !['initializing', 'running'].includes(d.world.stage)) throw new LifeRuleError(`世界が実行中ではありません: ${d.world.stage}`)
        const active = d.active[agentId]
        if (!active || active.turnId !== call.turnId) throw new LifeRuleError(`現在の推論とTool要求が一致しません: ${agentId}/${call.turnId}`)
        result = this.applyTool(d, agentId, call.tool, call.arguments)
      } catch (error) {
        if (!(error instanceof LifeRuleError) && !(error instanceof z.ZodError)) throw error
        Object.assign(d, structuredClone(this.data))
        result = reply({ error: error.message }, false)
      }
      d.receipts[key] = { fingerprint, result }
      return result
    })
  }
  private applyTool(d: LifeCheckpoint, agentId: string, tool: string, input: unknown): ToolResult {
    if (tool === 'initializeFacility') {
      const facility = d.world.facilities.find(f => `facility-${f.id}` === agentId)
      if (!facility || d.world.phase !== 'facilities' || facility.layout) throw new LifeRuleError('施設の初期化時だけ実行できます')
      facility.layout = validateLayout(facility, input, households(this.population).map(h => h.id))
      return reply({ initialized: facility.id })
    }
    if (tool === 'completeFacilityUse') {
      const value = lifeToolSchemas.completeFacilityUse.parse(input)
      const request = d.interactions.find(i => i.id === value.requestId && `facility-${i.facilityId}` === agentId)
      if (!request || request.done) throw new LifeRuleError(`未回答の施設利用がありません: ${value.requestId}`)
      const facility = d.world.facilities.find(f => f.id === request.facilityId)!
      if (!facility.layout) throw new LifeRuleError('施設が初期化されていません')
      request.done = true; facility.layout.publicState = value.publicState
      const actor = this.actor(d, request.npcId)
      this.enqueue(d, actor.id, 'reply', JSON.stringify({ kind: 'facilityResponse', facilityId: facility.id, text: value.text }), actor.activity === 'sleeping')
      if (actor.activity === 'ended') actor.activity = 'active'
      this.event(d, actor, 'facility', `${facility.name}: ${value.text}`, [actor.id])
      return reply({ delivered: request.id })
    }
    const actor = this.actor(d, agentId)
    const facility = this.facility(d, actor.locationId)
    if (tool === 'getSituation') { lifeToolSchemas.getSituation.parse(input); return reply(this.situation(d, agentId)) }
    if (tool === 'setInitialPosition') {
      const value = lifeToolSchemas.setInitialPosition.parse(input)
      if (!['positions', 'entry'].includes(d.world.phase) || actor.position || !validPosition(facility.dimensions, value.position)) throw new LifeRuleError('初期位置の設定段階または座標が不正です')
      actor.position = value.position; actor.activity = 'ended'
      this.event(d, actor, 'entry', '初期位置を選びました')
      return reply({ position: actor.position, instruction: '位置を確定しました。この推論を終了し、全員の位置確定後の生活開始通知を待ってください。' })
    }
    if (d.world.phase !== 'activity' || actor.activity !== 'active') throw new LifeRuleError(`現在は行動できません: ${d.world.phase}/${actor.activity}`)
    switch (tool) {
      case 'moveWithinFacility': {
        const value = lifeToolSchemas.moveWithinFacility.parse(input)
        if (!validPosition(facility.dimensions, value.position)) throw new LifeRuleError('指定座標は施設の範囲外です')
        actor.position = value.position; this.event(d, actor, 'move', `(${value.position.x}, ${value.position.y}, ${value.position.z})へ移動しました`)
        return reply({ position: actor.position })
      }
      case 'moveToFacility': {
        const value = lifeToolSchemas.moveToFacility.parse(input)
        if (actor.nextFacilityId) throw new LifeRuleError('このターンの施設間移動は既に予約されています')
        const target = d.world.facilities.find(f => f.id === value.facilityId)
        if (!target || target.locationId === actor.locationId) throw new LifeRuleError('移動先には別の施設を指定してください')
        actor.nextFacilityId = target.id; actor.activity = 'ended'; this.event(d, actor, 'travel', `次ターンに${target.name}へ移動します`)
        return reply({ reserved: target.id, endTurn: true })
      }
      case 'sendMessage': {
        const value = lifeToolSchemas.sendMessage.parse(input)
        const recipients = speechRecipients(facility, actor, d.world.actors, value.volume)
        const event = this.event(d, actor, 'speech', value.text, recipients)
        d.world.events[d.world.events.length - 1] = { ...event, volume: value.volume }
        for (const id of recipients) {
          const recipient = this.actor(d, id)
          if (recipient.activity === 'ended') recipient.activity = 'active'
          this.enqueue(d, id, 'message', JSON.stringify({ kind: 'heardSpeech', eventId: event.sequence, turn: d.world.turn, speaker: { id: actor.id, name: actor.name, position: actor.position }, volume: value.volume, text: value.text }))
        }
        return reply({ eventId: event.sequence, recipients })
      }
      case 'useFacility': {
        const value = lifeToolSchemas.useFacility.parse(input)
        const request = { id: unique(), npcId: actor.id, facilityId: facility.id, request: value.request, done: false }
        d.interactions.push(request)
        this.enqueue(d, `facility-${facility.id}`, 'facility', `施設利用へcompleteFacilityUseで回答してください。\n${JSON.stringify({ requestId: request.id, npc: { id: actor.id, name: actor.name, position: actor.position }, request: value.request, facility })}`)
        return reply({ requestId: request.id, instruction: '受け付けました。回答は後から届きます。' })
      }
      case 'endTurn':
        lifeToolSchemas.endTurn.parse(input); actor.activity = 'ended'; this.event(d, actor, 'end', '活動を終了しました'); return reply({ endTurn: true })
      case 'sleep':
        lifeToolSchemas.sleep.parse(input); actor.activity = 'sleeping'; actor.wakeAt = d.world.turn + 1; actor.compact = 'pending'; this.event(d, actor, 'sleep', '次ターンまで眠ります'); return reply({ sleeping: true, wakeAt: actor.wakeAt, instruction: 'この推論を終了してください。HarnessがCompactを実行します。' })
      default: throw new LifeRuleError(`この役割で使えないToolです: ${tool}`)
    }
  }
  fail(error: unknown, interrupt = true): Promise<void> {
    if (!this.stopTask) this.stopTask = this.stop(error, interrupt)
    return this.stopTask
  }
  private async stop(error: unknown, interrupt: boolean): Promise<void> {
    const failure = error instanceof Error ? error : new Error(String(error))
    await this.update(d => { if (d.world.stage !== 'error') d.world.error = failure.message; d.world.stage = 'error' })
    const cause = this.data.world.error!
    this.services.failed(new Error(cause))
    if (interrupt) {
      const attempts = Object.entries(this.data.active).flatMap(([id, active]) => active.turnId ? [{ id, turnId: active.turnId }] : [])
      const results = await Promise.allSettled(attempts.map(a => this.services.interrupt(a.id, a.turnId)))
      results.forEach((result, index) => {
        if (result.status === 'rejected') this.services.failed(new Error(`${cause}\nエラー停止時の推論中断を確認できません: ${attempts[index].id}/${attempts[index].turnId}: ${String(result.reason)}`))
      })
    }
  }
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending])
    await this.queue
  }
  async settle(): Promise<void> {
    await this.drain()
    await this.reconcile()
    await this.drain()
  }
  assertStopped(): void {
    const pending = this.data.jobs.filter(job => ['requested', 'running'].includes(job.status)).map(job => `${job.agentId}/${job.id}`)
    if (Object.keys(this.data.active).length || Object.keys(this.data.terminalWrites).length || pending.length) throw new LifeRuleError(`停止後も未確定の生活操作があります: ${[...Object.keys(this.data.active), ...Object.keys(this.data.terminalWrites), ...pending].join(', ')}`)
  }
  async close(interrupt = true): Promise<void> {
    if (interrupt) await this.pause()
    else await this.update(d => { if (!['ready', 'ended', 'error'].includes(d.world.stage)) d.world.stage = 'paused' })
    await this.drain()
    this.closed = true
  }
}
