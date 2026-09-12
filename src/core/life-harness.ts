import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { LifeChange, LifeHistoryRecord } from './persistence'
import { lifeTransaction, plainLifeValue } from './life-transaction'
import type { NpcInitialization, Population, Specification } from './contracts'
import { lifeToolSchemas, simulationSchema, type LifeActor, type LifeFacility, type SimulationSnapshot } from './life-contracts'
import { overlaps, contains, households, LifeRuleError, speechRecipients, validPosition, validateLayout, validateLifeSpecification } from './spatial'
import { MEMORY_BUDGET, MEMORY_CONSOLIDATION_PROMPT, MemoryMatchUncertainError, memoryArchiveSchema, memoryReferenceSchema, memorySnapshotSchema, memoryToolSchemas, type MemoryMutation, type MemoryRecord, type RecallOperation } from './memory-contracts'
import { NpcMemoryStore, normalizeCue, recallable } from './memory-store'

import { lifecycleToolSchemas, identitySchema, type Birth, type Resident } from './lifecycle-contracts'
import { initializeLifecycle, ageDay, endReason, marry, living, resident } from './lifecycle'

const jobSchema = z.object({
  homeRequestId: z.string().optional(),
  id: z.string(), agentId: z.string(), text: z.string(), kind: z.enum(['layout', 'position', 'activity', 'message', 'facility', 'reply', 'compact', 'user', 'consolidation', 'home', 'notice']),
  status: z.enum(['queued', 'deferred', 'requested', 'running', 'done', 'discarded']), turnId: z.string().nullable(), completed: z.boolean(), reminders: z.array(memoryReferenceSchema).optional(), consolidationError: z.string().optional()
})
const resultSchema = z.object({ success: z.boolean(), contentItems: z.array(z.object({ type: z.literal('inputText'), text: z.string() })) })
export const lifeCheckpointSchema = z.object({
  cognition: memorySnapshotSchema.optional(), memoryArchive: z.array(memoryArchiveSchema).optional(),
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
  lifecycle?: { seed: string; birth(request: Birth, parents: Resident[], turn: number): Promise<NpcInitialization> }
  start(agentId: string, text: string, clientId: string): Promise<string>
  steer(agentId: string, turnId: string, text: string, clientId: string): Promise<void>
  compact(agentId: string): Promise<void>
  interrupt(agentId: string, turnId: string): Promise<void>
  history(agentId: string): Promise<LifeHistoryTurn[]>
  terminalInput(agentId: string, data: string): Promise<void>
  save(value: LifeCheckpoint): Promise<void>
  memory?: { initialize(value: LifeCheckpoint): void; changed(value: LifeChange): void }
  cognition?: {
    runId: string
    match(agentId: string, cue: string, records: MemoryRecord[], signal: AbortSignal, progress: (value: { threadId: string; turnId: string | null }) => Promise<void>): Promise<string[]>
  }
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
  private readonly cognition: NpcMemoryStore | null
  private memoryChanges: MemoryMutation[] = []
  private readonly recallTasks = new Map<string, { fingerprint: string; task: Promise<ToolResult>; abort: AbortController }>()
  private readonly cueTasks = new Map<string, Promise<ToolResult>>()

  constructor(private readonly specification: Specification, private readonly population: Population, private readonly services: LifeServices, saved?: LifeCheckpoint) {
    validateLifeSpecification(specification, !!services.lifecycle)
    if (saved) {
      this.data = lifeCheckpointSchema.parse(saved)
      const expected = specification.town.facilities
      const people = this.data.world.lifecycle?.residents ?? population.npcs
      if (!!this.data.world.lifecycle !== !!services.lifecycle) throw new LifeRuleError('保存済み生活versionとサービスが一致しません')
      if (this.data.world.facilities.length !== expected.length || this.data.world.actors.length !== people.length) throw new LifeRuleError('保存済み世界と承認仕様の人数・施設数が一致しません')
      if (new Set(this.data.world.facilities.map(f => f.id)).size !== expected.length || new Set(this.data.world.actors.map(a => a.id)).size !== people.length) throw new LifeRuleError('保存済み世界の施設IDまたはNPC IDが重複しています')
      for (const f of this.data.world.facilities) {
        const source = expected.find(v => v.id === f.id && v.locationId === f.locationId)
        if (!source || (this.data.world.lifecycle && f.type === 'residential' ? (['x', 'y', 'z'] as const).some(axis => f.dimensions[axis] < source.dimensions![axis]) : JSON.stringify(source.dimensions) !== JSON.stringify(f.dimensions))) throw new LifeRuleError(`保存済み施設と承認仕様が一致しません: ${f.id}`)
        if (f.layout) validateLayout(f, f.layout, this.data.world.lifecycle ? f.layout.homes.map(h => h.householdId) : households(population).map(h => h.id))
      }
      for (const a of this.data.world.actors) {
        if (!people.some(n => n.id === a.id && n.householdId === a.householdId)) throw new LifeRuleError(`保存済みNPCが初期人口と一致しません: ${a.id}`)
        if (a.position && !validPosition(this.facility(this.data, a.locationId).dimensions, a.position)) throw new LifeRuleError(`保存済み座標が不正です: ${a.id}`)
      }
      if (!['ready', 'ended'].includes(this.data.world.stage)) this.data.world.stage = 'paused'
    } else {
      const facilities = specification.town.facilities.map(f => ({ id: f.id, locationId: f.locationId, name: f.name, type: f.type, dimensions: f.dimensions!, layout: null }))
      for (const n of population.npcs) if (!facilities.some(f => f.locationId === n.locationId)) throw new LifeRuleError(`NPCの初期位置に施設がありません: ${n.id}/${n.locationId}`)
      this.data = {
        world: { ...(services.lifecycle ? { lifecycle: initializeLifecycle(population, services.lifecycle.seed) } : {}), version: 1, revision: 0, stage: 'initializing', phase: 'facilities', turn: 0, day: 1, time: 'morning', step: false, facilities,
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
    if (saved && services.cognition && !this.data.cognition) throw new LifeRuleError('記憶対応ワールドの保存済み記憶状態がありません')
    this.cognition = services.cognition ? new NpcMemoryStore(services.cognition.runId, this.people().map(n => n.id), this.data.cognition, this.data.memoryArchive) : null
    if (this.data.cognition && !this.cognition) throw new LifeRuleError('保存済みの記憶機能に対応するサービスがありません')
    delete this.data.cognition; delete this.data.memoryArchive
  }
  people(): NpcInitialization[] { return this.data.world.lifecycle?.residents ?? this.population.npcs }
  isDead(id: string): boolean { return this.data.world.actors.some(a => a.id === id && a.activity === 'dead') }
  memoryRecords(id: string) { return this.cognition ? structuredClone(this.cognition.owner(id).records) : [] }
  snapshot(): SimulationSnapshot { return structuredClone(this.data.world) }
  checkpoint(): LifeCheckpoint { return { ...structuredClone(this.data), ...(this.cognition ? { cognition: this.cognition.snapshot() } : {}) } }
  memoryInspection(id: string) { if (!this.cognition) throw new LifeRuleError('このワールドは記憶機能の対象外です'); return this.cognition.inspect(id) }
  memoryDetail(id: string, memoryId: string, revision: number) { if (!this.cognition) throw new LifeRuleError('このワールドは記憶機能の対象外です'); return this.cognition.detail(id, memoryId, revision) }
  memoryRelations() { return this.cognition ? this.people().flatMap(n => this.cognition!.owner(n.id).relations) : null }
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
      this.memoryChanges = []
      const transaction = this.services.memory ? lifeTransaction(this.data) : null
      const next = transaction ? transaction.value : structuredClone(this.data)
      const result = work(transaction ? transaction.draft : next)
      if (this.memoryChanges.length || (transaction ? transaction.changed.size > 0 : JSON.stringify(next) !== JSON.stringify(this.data))) {
        next.world.revision++
        for (const change of this.memoryChanges) if (change.ownerId && change.owner) {
          const o = change.owner
          next.world.memoryProgress = { ...next.world.memoryProgress, [change.ownerId]: { revision: o.revision, candidates: o.candidates.length, retained: o.records.length, reminders: o.records.filter(r => r.reminder?.status === 'pending').length, consolidation: o.consolidation, recalling: o.recalls.filter(r => ['requested', 'running'].includes(r.status)).length, error: o.recalls.find(r => ['failed', 'uncertain'].includes(r.status))?.error ?? null } }
        }
        if (this.services.memory) this.commitMemory(next)
        else if (this.cognition) throw new LifeRuleError('記憶にはIn-Memory保存サービスが必要です')
        else await this.services.save(next)
        for (const change of this.memoryChanges) this.cognition!.commit(change)
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
    for (const change of this.memoryChanges) {
      if (change.ownerId && change.owner) patches.push({ path: ['cognition', 'owners', change.ownerId], value: change.owner })
      history.push(...change.archive)
    }
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
    return !d.world.lifecycle?.births.some(b => b.status === 'requested') && !this.recallTasks.size && !Object.keys(d.active).length && !Object.keys(d.terminalWrites).length && !d.jobs.some(j => ['queued', 'requested', 'running'].includes(j.status)) && !d.interactions.some(i => !i.done)
  }
  private situation(d: LifeCheckpoint, id: string) {
    const actor = this.actor(d, id)
    const facility = this.facility(d, actor.locationId)
    const residential = d.world.facilities.find(f => f.type === 'residential')!
    return { turn: d.world.turn, day: d.world.day, time: d.world.time, phase: d.world.phase, self: actor,
      facility, currentRegions: facility.layout?.regions.filter(region => actor.position && contains(region.bounds, actor.position)),
      ...(d.world.lifecycle ? { identity: resident(d.world.lifecycle, id), marriageProposals: d.world.lifecycle.proposals.filter(p => p.actorId === id || p.partnerId === id), homeRequests: d.world.lifecycle.homes.filter(h => h.sponsorId === id || h.members.includes(id)), birthPlans: d.world.lifecycle.births.filter(b => b.parents.includes(id)) } : {}),
      home: residential.layout?.homes.find(h => h.householdId === actor.householdId), homeLocationId: residential.locationId,
      npcs: d.world.actors.filter(a => a.activity !== 'dead' && a.locationId === actor.locationId).map(a => ({ id: a.id, name: a.name, position: a.position, activity: a.activity })),
      destinations: d.world.facilities.map(f => ({ id: f.id, name: f.name, locationId: f.locationId })),
      ...(this.cognition ? { memorySources: this.cognition.availableSources(id), memoryProgress: this.cognition.progress(id) } : {}) }
  }
  private event(d: LifeCheckpoint, actor: LifeActor, kind: SimulationSnapshot['events'][number]['kind'], text: string, recipients: string[] = []) {
    const event = { sequence: (d.world.events.at(-1)?.sequence ?? 0) + 1, turn: d.world.turn, kind, actorId: actor.id, text, recipients, locationId: actor.locationId, position: actor.position }
    d.world.events.push(event)
    if (this.cognition && kind !== 'facility') this.memoryChanges.push(this.cognition.source(actor.id, `event:${event.sequence}`, d.world.turn, text, 'action'))
    return event
  }
  async begin(): Promise<void> {
    if (this.services.memory) this.services.memory.initialize(this.checkpoint())
    else await this.services.save(this.data)
    this.services.changed(this.snapshot())
    await this.update(d => {
      if (d.jobs.length) throw new LifeRuleError('初期化は既に開始されています')
      if (this.cognition) for (const npc of this.people()) this.memoryChanges.push(this.cognition.source(npc.id, `initial:${npc.id}`, 0, JSON.stringify(npc), 'initial'))
      this.enqueueMissingInitialization(d)
    })
  }
  private enqueueMissingInitialization(d: LifeCheckpoint): void {
    const pending = (id: string) => d.jobs.some(j => j.agentId === id && !['done', 'discarded'].includes(j.status))
    if (d.world.phase === 'facilities') for (const f of d.world.facilities) {
      const id = `facility-${f.id}`
      if (!f.layout && !pending(id)) this.enqueue(d, id, 'layout', `施設初期化です。initializeFacilityで領域を確定したら応答を終了してください。施設のサイズは変更できません。\n${JSON.stringify({ facility: f, households: f.type === 'residential' ? households(this.population) : [], bounds: 'min/maxは両端を含む整数座標。家同士の範囲は重複不可。全世帯に1軒ずつ必要。' })}`)
    }
    if (['positions', 'entry'].includes(d.world.phase) || (d.world.lifecycle && d.world.phase === 'between')) for (const a of d.world.actors) {
      if (a.activity !== 'dead' && !a.position && !pending(a.id)) this.enqueue(d, a.id, 'position', `入場位置の設定を再開します。setInitialPositionで選び、応答を終了してください。\n${JSON.stringify(this.situation(d, a.id))}`)
    }
  }
  private enterNextTurn(d: LifeCheckpoint): void {
    d.world.turn++
    d.world.day = Math.floor((d.world.turn - 1) / 4) + 1
    d.world.time = (['morning', 'noon', 'evening', 'night'] as const)[(d.world.turn - 1) % 4]
    d.world.phase = 'entry'
    for (const actor of d.world.actors) {
      if (actor.activity === 'dead') continue
      if (actor.activity === 'sleeping') this.event(d, actor, 'wake', '起床しました')
      actor.activity = 'active'; actor.wakeAt = null; actor.compact = 'none'
      if (actor.nextFacilityId) {
        const destination = d.world.facilities.find(f => f.id === actor.nextFacilityId)!
        actor.locationId = destination.locationId; actor.position = null; actor.activity = 'entering'; actor.nextFacilityId = null
        if (d.world.lifecycle) resident(d.world.lifecycle, actor.id).locationId = destination.locationId
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
    for (const request of this.recallTasks.values()) request.abort.abort(new LifeRuleError('記憶照合を一時停止しました'))
    await Promise.all(Object.entries(this.data.active).flatMap(([id, active]) => active.turnId ? [this.services.interrupt(id, active.turnId)] : []))
  }
  async resume(step = false): Promise<void> {
    if (this.cognition) for (const npc of this.people()) {
      const owner = this.cognition.owner(npc.id)
      if (owner.recalls.some(r => r.status === 'failed') || owner.consolidation === 'failed') throw new LifeRuleError(`中断した記憶操作は自動再送しません: ${npc.id}`)
    }
    await this.reconcile()
    await this.stopTask
    this.stopTask = null
    await this.update(d => {
      if (!['paused', 'error'].includes(d.world.stage)) throw new LifeRuleError('世界は停止中ではありません')
      d.world.error = null; d.world.step = step
      d.world.stage = d.world.turn === 0 ? 'initializing' : 'running'
      if (this.cognition) for (const npc of this.people()) if (this.cognition.owner(npc.id).consolidation === 'interrupted') this.memoryChanges.push(this.cognition.prepare(npc.id, owner => { owner.consolidation = 'pending' }))
      this.enqueueMissingInitialization(d)
      for (const facility of d.world.facilities) {
        const id = `facility-${facility.id}`
        const unanswered = d.interactions.filter(i => i.facilityId === facility.id && !i.done)
        if (unanswered.length && !d.active[id] && !d.jobs.some(j => j.agentId === id && ['queued', 'requested', 'running'].includes(j.status))) this.enqueue(d, id, 'facility', `中断した施設利用への回答を再開してください。確定済みの回答は再送しません。\n${JSON.stringify(unanswered)}`)
      }
      if (d.world.lifecycle) this.requestHomes(d)
      if (d.world.phase === 'between' && (!d.world.lifecycle || (this.quiet(d) && !d.world.lifecycle.births.some(b => b.status === 'scheduled' && b.dueDay <= d.world.lifecycle!.processedDay)))) this.enterNextTurn(d)
    })
  }
  private async reconcile(): Promise<void> {
    if (this.data.world.lifecycle?.births.some(b => b.status === 'requested')) throw new LifeRuleError('新生児生成の結果が未確定です。自動再送しません')
    if (this.cognition) for (const npc of this.people()) {
      const owner = this.cognition.owner(npc.id)
      if (owner.recalls.some(r => ['requested', 'running', 'uncertain'].includes(r.status)) || owner.consolidation === 'running') throw new LifeRuleError(`記憶操作が未確定です。自動再送しません: ${npc.id}`)
    }
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
      if (d.world.actors.some(a => a.activity !== 'dead' && !a.position)) throw new LifeRuleError('初期位置が未設定のNPCがいます')
      d.world.stage = 'ready'; d.world.phase = 'between'
    } else if (d.world.phase === 'entry' && this.quiet(d)) {
      if (d.world.actors.some(a => a.activity !== 'dead' && !a.position)) throw new LifeRuleError('入場位置が未設定のNPCがいます')
      d.world.phase = 'activity'
      for (const a of d.world.actors) if (a.activity !== 'dead') a.activity = 'active'
      for (const j of d.jobs) if (j.status === 'deferred') j.status = 'queued'
    } else if (d.world.phase === 'activity' && this.quiet(d) && d.world.actors.every(a => a.activity === 'dead' || a.activity === 'ended' || (a.activity === 'sleeping' && a.compact === 'complete'))) {
      d.world.phase = 'between'
      if (d.world.lifecycle) { this.lifecycleBoundary(d); return }
      if (d.world.turn >= this.specification.simulation.maxTurns) { d.world.stage = 'ended'; d.world.phase = 'complete' }
      else if (d.world.step) d.world.stage = 'paused'
      else this.enterNextTurn(d)
    } else if (d.world.lifecycle && d.world.phase === 'between' && d.world.stage === 'running' && this.quiet(d)) this.lifecycleBoundary(d)
  }
  private lifecycleBoundary(d: LifeCheckpoint): void {
    const state = d.world.lifecycle!
    if (d.world.turn % 4 === 0) for (const dead of ageDay(state, d.world.turn)) {
      const actor = this.actor(d, dead.id)
      actor.activity = 'dead'; actor.position = null; actor.nextFacilityId = null; actor.wakeAt = null; actor.compact = 'none'
      delete d.terminalInputs[dead.id]
      for (const job of d.jobs) if (job.agentId === dead.id && job.status === 'deferred') job.status = 'discarded'
      const recipients = state.residents.filter(n => n.diedTurn === null && (n.family.some(f => f.npcId === dead.id) || this.actor(d, n.id).locationId === actor.locationId)).map(n => n.id)
      const event = this.event(d, actor, 'death', `${dead.name}が${dead.age}歳で老衰しました`, recipients)
      for (const id of recipients) this.enqueue(d, id, 'notice', `${JSON.stringify({ kind: 'deathNotice', eventId: event.sequence, text: event.text })}\n日次境界の通知です。必要ならremember・remindMeで自分の記憶を登録し、推論を終了してください。生活行動は次ターンまで待ってください。`)
      for (const home of state.homes) if (['consent', 'building'].includes(home.status) && (home.sponsorId === dead.id || home.members.includes(dead.id))) { home.status = 'cancelled'; home.reason = '申請者または入居者が死亡しました' }
    }
    if (!this.quiet(d) || state.births.some(b => b.status === 'scheduled' && b.dueDay <= state.processedDay)) return
    state.endReason = endReason(state, this.specification.simulation.endCondition, d.world.turn, this.specification.simulation.maxTurns)
    if (state.endReason) { d.world.stage = 'ended'; d.world.phase = 'complete' }
    else if (d.world.step) d.world.stage = 'paused'
    else this.enterNextTurn(d)
  }
  private async spawnBirth(birth: Birth): Promise<void> {
    const state = this.data.world.lifecycle!
    const parents = birth.parents.map(id => structuredClone(resident(state, id)))
    const input = await this.services.lifecycle!.birth(birth, parents, this.data.world.turn)
    const npc = identitySchema.parse(input)
    await this.update(d => {
      const current = d.world.lifecycle!, request = current.births.find(b => b.id === birth.id)!
      if (request.status !== 'requested') throw new LifeRuleError(`出生処理の状態が不正です: ${birth.id}`)
      if (npc.age !== 0 || current.residents.some(n => n.id === npc.id) || npc.householdId !== resident(current, birth.homeParentId).householdId || !birth.parents.every(id => npc.family.some(f => f.npcId === id && f.relation === 'parent'))) throw new LifeRuleError(`新生児の初期情報が不正です: ${birth.id}`)
      const residential = d.world.facilities.find(f => f.type === 'residential')!
      if (npc.locationId !== residential.locationId) throw new LifeRuleError('新生児の所在地は住宅街にしてください')
      const child: Resident = { ...npc, sexCategory: npc.sex === '男性' || npc.sex === 'male' ? 'male' : npc.sex === '女性' || npc.sex === 'female' ? 'female' : 'other', generation: Math.max(...parents.map(n => n.generation)) + 1, bornTurn: d.world.turn, diedTurn: null }
      for (const sibling of current.residents.filter(n => n.family.some(f => f.relation === 'parent' && birth.parents.includes(f.npcId)))) {
        if (!child.family.some(f => f.npcId === sibling.id)) child.family.push({ npcId: sibling.id, relation: 'sibling' })
        sibling.family.push({ npcId: child.id, relation: 'sibling' })
      }
      for (const id of birth.parents) resident(current, id).family.push({ npcId: child.id, relation: 'child' })
      current.residents.push(child)
      const actor: LifeActor = { id: child.id, name: child.name, householdId: child.householdId, locationId: child.locationId, position: null, activity: 'entering', nextFacilityId: null, wakeAt: null, compact: 'none' }
      d.world.actors.push(actor)
      if (this.cognition) this.memoryChanges.push(this.cognition.addOwner(child.id))
      request.status = 'complete'; request.childId = child.id
      this.enqueue(d, actor.id, 'position', `出生しました。現在turn=${d.world.turn}です。住宅街の家にsetInitialPositionで位置を選び、応答を終了してください。\n${JSON.stringify({ identity: child, facility: residential })}`)
    })
    await this.update(d => {
      const child = this.actor(d, npc.id)
      if (this.cognition) this.memoryChanges.push(this.cognition.source(npc.id, `initial:${npc.id}`, d.world.turn, JSON.stringify(npc), 'initial'))
      this.event(d, child, 'birth', `${npc.name}が生まれました`, birth.parents)
      for (const id of birth.parents) this.enqueue(d, id, 'notice', `${JSON.stringify({ kind: 'birthNotice', child: npc })}\n日次境界の通知です。必要ならremember・remindMeで自分の記憶を登録し、推論を終了してください。生活行動は次ターンまで待ってください。`)
    })
  }
  private familyTool(d: LifeCheckpoint, actorId: string, tool: string, input: unknown): ToolResult {
    const state = d.world.lifecycle!, actor = this.actor(d, actorId)
    if (tool === 'marry') {
      const result = marry(state, actorId, input)
      if (result.status === 'married') this.event(d, actor, 'marriage', `結婚・家族計画が成立しました: ${JSON.stringify(result)}`)
      return reply(result)
    }
    if (tool === 'createHome') {
      const value = lifecycleToolSchemas.createHome.parse(input)
      if (living(state, actorId).age < 18) throw new LifeRuleError('新居の申請者は18歳以上にしてください')
      if (new Set(value.members).size !== value.members.length) throw new LifeRuleError('入居者が重複しています')
      for (const id of value.members) {
        living(state, id)
        if (state.homes.some(h => ['consent', 'building'].includes(h.status) && h.members.includes(id))) throw new LifeRuleError(`入居申請が競合しています: ${id}`)
      }
      const id = `home-${state.homes.length + 1}-${unique().slice(0, 8)}`
      state.homes.push({ id, sponsorId: actorId, members: value.members, accepted: value.members.filter(id => id === actorId || resident(state, id).age < 18), description: value.description, status: 'consent', householdId: `household-${id}`, reason: null })
      for (const id of value.members.filter(id => id !== actorId && resident(state, id).age >= 18)) this.enqueue(d, id, 'reply', `新居への入居申請があります。consentHomeで自分の意思を回答してください。${JSON.stringify(state.homes.at(-1))}`, this.actor(d, id).activity === 'sleeping')
      this.requestHomes(d)
      return reply({ requestId: id })
    }
    const value = lifecycleToolSchemas.consentHome.parse(input), home = state.homes.find(h => h.id === value.requestId)
    if (!home || home.status !== 'consent' || !home.members.includes(actorId)) throw new LifeRuleError('自分の未成立入居申請がありません')
    if (!value.accept) { home.status = 'cancelled'; home.reason = `${actorId}が入居を辞退しました` }
    else if (!home.accepted.includes(actorId)) home.accepted.push(actorId)
    this.requestHomes(d)
    return reply({ requestId: home.id, status: home.status })
  }
  private requestHomes(d: LifeCheckpoint): void {
    const facility = d.world.facilities.find(f => f.type === 'residential')!
    for (const home of d.world.lifecycle!.homes) if ((home.status === 'consent' && home.members.every(id => home.accepted.includes(id))) || (home.status === 'building' && !d.jobs.some(j => j.homeRequestId === home.id && !['done', 'discarded'].includes(j.status)))) {
      home.status = 'building'
      this.enqueue(d, `facility-${facility.id}`, 'home', `新居申請をcompleteHomeで完成させてください。既存領域を移動せず、必要なら住宅街のdimensionsを拡張できます。\n${JSON.stringify({ request: home, facility })}`)
      d.jobs[d.jobs.length - 1].homeRequestId = home.id
    }
  }
  private completeHome(d: LifeCheckpoint, agentId: string, input: unknown): ToolResult {
    const value = lifecycleToolSchemas.completeHome.parse(input), state = d.world.lifecycle!
    const facility = d.world.facilities.find(f => `facility-${f.id}` === agentId && f.type === 'residential')
    const request = state.homes.find(h => h.id === value.requestId && h.status === 'building')
    if (!facility?.layout || !request) throw new LifeRuleError('住宅街の実行中の建築依頼だけを完了できます')
    for (const id of [request.sponsorId, ...request.members]) living(state, id)
    if ((['x', 'y', 'z'] as const).some(axis => value.dimensions[axis] < facility.dimensions[axis] || value.bounds.min[axis] > value.bounds.max[axis]) || !validPosition(value.dimensions, value.bounds.min) || !validPosition(value.dimensions, value.bounds.max)) throw new LifeRuleError('新居の座標または住宅街の拡張サイズが不正です')
    if (facility.layout.homes.some(h => overlaps(h.bounds, value.bounds))) throw new LifeRuleError('新居が既存の家と重複しています')
    const previousDimensions = facility.dimensions
    facility.dimensions = value.dimensions
    facility.layout.homes.push({ id: request.id, householdId: request.householdId, name: value.name, description: value.description, bounds: value.bounds })
    for (const id of request.members) { resident(state, id).householdId = request.householdId; this.actor(d, id).householdId = request.householdId }
    request.status = 'complete'
    this.event(d, this.actor(d, request.sponsorId), 'home', `新居「${value.name}」が完成しました。${JSON.stringify({ requestId: request.id, bounds: value.bounds, previousDimensions, dimensions: value.dimensions })}`, request.members)
    for (const id of request.members) this.enqueue(d, id, 'reply', `新居「${value.name}」が完成し、所属世帯が変わりました。物理的な移動は自分で行ってください。`, this.actor(d, id).activity === 'sleeping')
    return reply({ requestId: request.id, householdId: request.householdId })
  }
  private async drive(): Promise<void> {
    const actions = await this.update(d => {
      if (this.closed || !['initializing', 'running'].includes(d.world.stage)) return []
      this.advance(d)
      if (!['initializing', 'running'].includes(d.world.stage)) return []
      if (d.world.phase === 'activity') for (const a of d.world.actors) {
        const busy = d.active[a.id] || [...this.recallTasks.keys()].some(key => key.startsWith(`${a.id}:`)) || d.jobs.some(j => j.agentId === a.id && ['queued', 'requested', 'running'].includes(j.status))
        if (busy) continue
        if (a.activity === 'active') this.enqueue(d, a.id, 'activity', `現在の状況から自分の行動を選んでください。発話・移動・施設利用はToolで行い、活動終了はendTurnまたはsleepで通知してください。推論の文章だけでは活動終了になりません。\n${JSON.stringify(this.situation(d, a.id))}`)
        if (a.activity === 'sleeping' && a.compact === 'pending') {
          if (this.cognition && this.cognition.owner(a.id).consolidation !== 'complete') {
            if (this.cognition.owner(a.id).consolidation !== 'pending') throw new LifeRuleError(`記憶整理の完了が不明です: ${a.id}`)
            this.memoryChanges.push(this.cognition.prepare(a.id, owner => { owner.consolidation = 'running' }))
            this.enqueue(d, a.id, 'consolidation', MEMORY_CONSOLIDATION_PROMPT)
          } else { a.compact = 'running'; this.enqueue(d, a.id, 'compact', '') }
        }
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
        if (this.cognition && recipient && recipient.activity !== 'sleeping') {
          const reminders = this.reminders(d, recipient)
          if (reminders.length) job.reminders = [...(job.reminders ?? []), ...reminders]
        }
        actions.push({ job: plainLifeValue(job), activeTurn: active?.turnId ?? null, steer: !!active })
      }
      return actions
    })
    const births = await this.update(d => {
      if (!d.world.lifecycle || d.world.stage !== 'running' || d.world.phase !== 'between') return []
      const due = d.world.lifecycle.births.filter(b => b.status === 'scheduled' && b.dueDay <= d.world.lifecycle!.processedDay)
      for (const b of due) b.status = 'requested'
      return plainLifeValue(due)
    })
    for (const birth of births) this.track(this.spawnBirth(birth).catch(error => this.fail(error)))
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
    let text = job.text
    if (this.cognition && (job.kind === 'consolidation' || job.reminders?.length)) {
      if (job.kind === 'consolidation') {
        const owner = this.cognition.owner(job.agentId)
        text += `\n${JSON.stringify({ candidates: owner.candidates, records: owner.records, relations: owner.relations })}`
      }
      if (job.reminders?.length) text += `\n条件から思い出した自分の予定です。実行するかは自分で判断してください。\n${JSON.stringify(job.reminders.map(ref => this.cognition!.detail(job.agentId, ref.memoryId, ref.revision).record))}`
      await this.update(d => { this.memoryChanges.push({ archive: [{ kind: 'memoryInput', value: { jobId: job.id, ownerId: job.agentId, turn: d.world.turn, text } }] }) })
    }
    if (job.kind === 'compact') await this.services.compact(job.agentId)
    else if (steer) {
      try { await this.services.steer(job.agentId, activeTurn!, text, job.id) }
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
    else turnId = await this.services.start(job.agentId, text, job.id)
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
        if (value.item.type === 'userMessage' && ['activity', 'between'].includes(d.world.phase)) {
          const actor = d.world.actors.find(a => a.id === agentId)
          const delivered = d.jobs.find(j => j.id === value.item.clientId && j.agentId === agentId)
          if (this.cognition && actor && delivered && ['message', 'reply', 'notice'].includes(delivered.kind)) this.memoryChanges.push(this.cognition.source(agentId, `delivery:${delivered.id}`, d.world.turn, delivered.text, 'received'))
          const kind = d.jobs.find(j => j.id === value.item.clientId)?.kind ?? (value.item.clientId ? this.completedKinds.get(value.item.clientId) : undefined)
          if (d.world.phase === 'activity' && actor?.activity === 'ended' && (!kind || ['message', 'reply', 'user'].includes(kind))) actor.activity = 'active'
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
          if (jobs.some(j => j.kind === 'consolidation') && this.cognition && this.cognition.owner(agentId).consolidation !== 'complete') this.memoryChanges.push(this.cognition.prepare(agentId, owner => { owner.consolidation = turn.status === 'interrupted' ? 'interrupted' : 'failed' }))
          if (active?.kind === 'compact') this.actor(d, agentId).compact = 'pending'
          if (turn.status === 'interrupted') { if (d.world.stage !== 'error') d.world.stage = 'paused' }
          else return stop(`推論に失敗しました: ${agentId}/${turn.id}: ${turn.error?.message ?? turn.status}`)
          return
        }
        if (active?.kind === 'compact') {
          if (!active.compactSeen) return stop(`Compact完了を確認できません: ${agentId}/${turn.id}`)
          this.actor(d, agentId).compact = 'complete'
        }
        if (jobs.some(j => j.kind === 'consolidation') && this.cognition?.owner(agentId).consolidation !== 'complete') {
          this.memoryChanges.push(this.cognition!.prepare(agentId, owner => { owner.consolidation = 'failed' }))
          const rejected = jobs.find(j => j.kind === 'consolidation' && j.consolidationError !== undefined)
          return stop(rejected ? `記憶整理Toolの検証に失敗したまま推論が終了しました: ${agentId}/${turn.id}: ${rejected.consolidationError}` : `記憶整理Toolが実行されていません: ${agentId}/${turn.id}`)
        }
        if (jobs.some(j => j.kind === 'home' && d.world.lifecycle?.homes.some(h => h.id === j.homeRequestId && h.status === 'building'))) return stop(`新居作成Toolが完了していません: ${agentId}`)
        if (jobs.some(j => j.kind === 'layout') && !d.world.facilities.find(f => `facility-${f.id}` === agentId)?.layout) return stop(`施設初期化Toolが実行されていません: ${agentId}`)
        if (jobs.some(j => j.kind === 'position') && !this.actor(d, agentId).position) return stop(`初期位置Toolが実行されていません: ${agentId}`)
        if (jobs.some(j => j.kind === 'facility') && d.interactions.some(i => `facility-${i.facilityId}` === agentId && !i.done)) this.enqueue(d, agentId, 'facility', `未回答の利用要求へcompleteFacilityUseで回答してください。\n${JSON.stringify(d.interactions.filter(i => `facility-${i.facilityId}` === agentId && !i.done))}`)
      }
    }).then(error => { if (error) return this.fail(error) }).catch(error => this.fail(error)))
  }
  async bufferTerminal(agentId: string, text: string): Promise<boolean> {
    const actor = this.data.world.actors.find(a => a.id === agentId)
    if (actor?.activity === 'dead') throw new LifeRuleError(`死亡した住民へ入力できません: ${agentId}`)
    if (!actor || (actor.activity !== 'sleeping' && actor.compact !== 'running')) return false
    await this.update(d => { d.terminalInputs[agentId] = (d.terminalInputs[agentId] ?? '') + text })
    return true
  }
  private reminders(d: LifeCheckpoint, actor: LifeActor): z.infer<typeof memoryReferenceSchema>[] {
    const store = this.cognition!
    if (this.memoryChanges.some(c => c.ownerId === actor.id)) return []
    const eligible = store.owner(actor.id).records.filter(record => {
      const r = record.reminder
      return r?.status === 'pending' && r.notifiedTurn !== d.world.turn && (r.afterTurn === null || d.world.turn >= r.afterTurn) &&
        (r.facilityId === null || this.facility(d, actor.locationId).id === r.facilityId) &&
        (r.personId === null || d.world.actors.some(a => a.id === r.personId && a.activity !== 'dead' && a.locationId === actor.locationId))
    })
    if (!eligible.length) return []
    const recalled: MemoryRecord[] = []
    this.memoryChanges.push(store.prepare(actor.id, (owner, archive) => {
      for (const source of eligible) {
        const record = owner.records.find(r => r.id === source.id)!
        record.reminder!.notifiedTurn = d.world.turn
        record.revision++
        if (recallable(this.services.cognition!.runId, actor.id, d.world.turn, source)) {
          record.recalledTurn = d.world.turn; record.strengthenedTurn = d.world.turn
          recalled.push(record)
        }
        archive.push({ kind: 'memoryRecord', value: record })
      }
    }))
    return recalled.map(r => ({ memoryId: r.id, revision: r.revision }))
  }
  private recall(agentId: string, call: { turnId: string; callId: string; tool: string; arguments: unknown }): Promise<ToolResult> {
    const key = `${agentId}:${call.turnId}:${call.callId}`, fingerprint = JSON.stringify({ name: call.tool, arguments: call.arguments })
    const pending = this.recallTasks.get(key)
    if (pending) return pending.fingerprint === fingerprint ? pending.task : Promise.reject(new LifeRuleError(`同じTool IDの内容が変更されています: ${key}`))
    const abort = new AbortController()
    const task = (async () => {
      const admission = await this.update(d => {
        const old = this.receipts.get(key)
        if (old) {
          if (old.fingerprint !== fingerprint) throw new LifeRuleError(`同じTool IDの内容が変更されています: ${key}`)
          return { result: old.result }
        }
        try {
          const { cue } = memoryToolSchemas.recall.parse(call.arguments)
          const actor = this.actor(d, agentId)
          if (d.world.stage !== 'running' || d.world.phase !== 'activity' || actor.activity !== 'active' || d.active[agentId]?.turnId !== call.turnId) throw new LifeRuleError(`現在は想起できません: ${agentId}/${d.world.stage}/${actor.activity}`)
          return { cue: normalizeCue(cue), turn: d.world.turn }
        } catch (error) {
          if (!(error instanceof LifeRuleError) && !(error instanceof z.ZodError)) throw error
          const result = reply({ error: error.message }, false)
          d.receipts[key] = { fingerprint, result }; return { result }
        }
      })
      if (admission.result) return admission.result
      const cueKey = JSON.stringify([agentId, admission.turn, admission.cue])
      let matching = this.cueTasks.get(cueKey)
      if (!matching) {
        matching = this.runRecall(agentId, admission.cue!, admission.turn!, abort.signal)
        this.cueTasks.set(cueKey, matching)
        void matching.finally(() => this.cueTasks.delete(cueKey)).catch(error => this.services.failed(error instanceof Error ? error : new Error(String(error))))
      }
      const result = await matching
      await this.update(d => { d.receipts[key] = { fingerprint, result } })
      return result
    })()
    this.recallTasks.set(key, { fingerprint, task, abort })
    const finished = () => { this.recallTasks.delete(key); this.kick() }
    void task.then(finished, finished)
    this.track(task)
    return task
  }
  private async runRecall(agentId: string, cue: string, turn: number, signal: AbortSignal): Promise<ToolResult> {
    const store = this.cognition!
    const operation = await this.update(() => {
      const old = store.recalled(agentId, turn, cue)
      if (old) return structuredClone(old)
      const op: RecallOperation = { id: unique(), ownerId: agentId, cue, turn, status: 'requested', threadId: null, turnId: null, selected: [], error: null }
      this.memoryChanges.push(store.prepare(agentId, (next, archive) => {
        if (next.recallTurn !== turn) { next.recalls = []; next.recallTurn = turn }
        next.recalls.push(op); archive.push({ kind: 'memoryRecall', value: op })
      }))
      return op
    })
    if (operation.status === 'completed') return reply({ memories: operation.selected.map(r => store.detail(agentId, r.memoryId, r.revision).record) })
    if (operation.status !== 'requested' || operation.threadId) return reply({ error: `照合結果が未確定です。再送しません: ${operation.id}` }, false)
    try {
      signal.throwIfAborted()
      const records = structuredClone(store.owner(agentId).records)
      const ids = records.length ? await this.services.cognition!.match(agentId, cue, records, signal, async progress => {
        await this.update(() => {
          this.memoryChanges.push(store.prepare(agentId, (owner, archive) => {
            const op = owner.recalls.find(r => r.id === operation.id)!
            Object.assign(op, progress, { status: 'running' }); archive.push({ kind: 'memoryRecall', value: op })
          }))
        })
      }) : []
      signal.throwIfAborted()
      if (ids.length > MEMORY_BUDGET.recall || new Set(ids).size !== ids.length || ids.some(id => !records.some(r => r.id === id))) throw new LifeRuleError('照合モデルが候補にないIDまたは不正な件数を返しました')
      return await this.update(d => {
        if (d.world.turn !== turn || d.world.stage !== 'running') throw new LifeRuleError(`照合中に世界が停止しました: ${operation.id}`)
        const selected: MemoryRecord[] = []
        this.memoryChanges.push(store.prepare(agentId, (owner, archive) => {
          for (const id of ids) {
            const original = records.find(r => r.id === id)!
            const current = owner.records.find(r => r.id === id)
            if (!current || !recallable(this.services.cognition!.runId, agentId, turn, original)) continue
            if (current.recalledTurn !== turn) {
              current.revision++; current.recalledTurn = turn; current.strengthenedTurn = turn
              archive.push({ kind: 'memoryRecord', value: current })
            }
            selected.push(current)
          }
          const op = owner.recalls.find(r => r.id === operation.id)!
          op.status = 'completed'; op.selected = selected.map(m => ({ memoryId: m.id, revision: m.revision }))
          archive.push({ kind: 'memoryRecall', value: op })
        }))
        return reply({ memories: selected })
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.update(() => {
        this.memoryChanges.push(store.prepare(agentId, (owner, archive) => {
          const op = owner.recalls.find(r => r.id === operation.id)!
          op.status = error instanceof MemoryMatchUncertainError ? 'uncertain' : signal.aborted ? 'cancelled' : 'failed'; op.error = message; archive.push({ kind: 'memoryRecall', value: op })
        }))
      })
      if (!signal.aborted || error instanceof MemoryMatchUncertainError) await this.fail(new LifeRuleError(`記憶照合に失敗しました: ${agentId}/${operation.id}: ${message}`))
      return reply({ error: message, operationId: operation.id }, false)
    }
  }
  async tool(agentId: string, call: { turnId: string; callId: string; tool: string; arguments: unknown }): Promise<ToolResult> {
    if (call.tool === 'recall' && this.cognition) return this.recall(agentId, call)
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
        if (!Object.hasOwn(lifeToolSchemas, call.tool) && !(d.world.lifecycle && Object.hasOwn(lifecycleToolSchemas, call.tool)) && !(this.cognition && Object.hasOwn(memoryToolSchemas, call.tool))) throw new LifeRuleError(`未対応の生活Toolです: ${call.tool}`)
        if (call.tool !== 'getSituation' && !['initializing', 'running'].includes(d.world.stage)) throw new LifeRuleError(`世界が実行中ではありません: ${d.world.stage}`)
        const active = d.active[agentId]
        if (!active || active.turnId !== call.turnId) throw new LifeRuleError(`現在の推論とTool要求が一致しません: ${agentId}/${call.turnId}`)
        result = this.applyTool(d, agentId, call.tool, call.arguments)
      } catch (error) {
        if (!(error instanceof LifeRuleError) && !(error instanceof z.ZodError)) throw error
        Object.assign(d, structuredClone(this.data))
        this.memoryChanges = []
        result = reply({ error: error.message }, false)
        if (call.tool === 'consolidateMemory') {
          const job = d.jobs.find(j => j.agentId === agentId && j.turnId === call.turnId && j.kind === 'consolidation' && ['requested', 'running'].includes(j.status))
          if (job) job.consolidationError = error.message
        }
      }
      d.receipts[key] = { fingerprint, result }
      return result
    })
  }
  private applyTool(d: LifeCheckpoint, agentId: string, tool: string, input: unknown): ToolResult {
    if (tool === 'completeHome' && d.world.lifecycle) return this.completeHome(d, agentId, input)
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
    if (actor.activity === 'dead') throw new LifeRuleError(`死亡した住民は行動できません: ${agentId}`)
    const facility = this.facility(d, actor.locationId)
    if (tool === 'consolidateMemory' && this.cognition) {
      if (actor.activity !== 'sleeping' || !d.jobs.some(j => j.agentId === agentId && j.kind === 'consolidation' && ['requested', 'running'].includes(j.status))) throw new LifeRuleError('睡眠時の記憶整理だけで使えます')
      this.memoryChanges.push(this.cognition.consolidate(agentId, d.world.turn, input, d.world.actors.map(a => a.id)))
      return reply({ consolidated: true, instruction: 'この推論を終了してください。その後にCompactを実行します。' })
    }
    const boundaryNotice = d.world.phase === 'between' && d.jobs.some(j => j.agentId === agentId && j.kind === 'notice' && ['requested', 'running'].includes(j.status))
    if (this.cognition && actor.activity === 'sleeping' && !boundaryNotice) throw new LifeRuleError('睡眠・記憶整理中は生活行動を受け付けません')
    if (tool === 'getSituation') { lifeToolSchemas.getSituation.parse(input); return reply(this.situation(d, agentId)) }
    if (tool === 'setInitialPosition') {
      const value = lifeToolSchemas.setInitialPosition.parse(input)
      if (!['positions', 'entry', 'between'].includes(d.world.phase) || actor.position || !validPosition(facility.dimensions, value.position)) throw new LifeRuleError('初期位置の設定段階または座標が不正です')
      if (d.world.lifecycle && d.world.phase === 'between' && !facility.layout?.homes.some(h => h.householdId === actor.householdId && contains(h.bounds, value.position))) throw new LifeRuleError('新生児の初期位置は所属世帯の住宅内にしてください')
      actor.position = value.position; actor.activity = 'ended'
      this.event(d, actor, 'entry', '初期位置を選びました')
      return reply({ position: actor.position, instruction: '位置を確定しました。この推論を終了し、全員の位置確定後の生活開始通知を待ってください。' })
    }
    if (!(boundaryNotice && ['remember', 'remindMe'].includes(tool)) && (d.world.phase !== 'activity' || actor.activity !== 'active')) throw new LifeRuleError(`現在は行動できません: ${d.world.phase}/${actor.activity}`)
    if (d.world.lifecycle && ['marry', 'createHome', 'consentHome'].includes(tool)) return this.familyTool(d, agentId, tool, input)
    switch (tool) {
      case 'remember': {
        const result = this.cognition!.remember(agentId, d.world.turn, input)
        this.memoryChanges.push(result.mutation)
        return reply({ candidateId: result.candidate.id, accepted: true, retained: false })
      }
      case 'remindMe': {
        const result = this.cognition!.remind(agentId, d.world.turn, input, d.world.actors.map(a => a.id), d.world.facilities.map(f => f.id))
        this.memoryChanges.push(result.mutation)
        return reply({ memoryId: result.id })
      }
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
        if (this.cognition) this.memoryChanges.push(this.cognition.source(agentId, `use:${request.id}`, d.world.turn, JSON.stringify({ facilityId: facility.id, position: actor.position, request: value.request }), 'action'))
        this.enqueue(d, `facility-${facility.id}`, 'facility', `施設利用へcompleteFacilityUseで回答してください。\n${JSON.stringify({ requestId: request.id, npc: { id: actor.id, name: actor.name, position: actor.position }, request: value.request, facility })}`)
        return reply({ requestId: request.id, instruction: '受け付けました。回答は後から届きます。' })
      }
      case 'endTurn':
        lifeToolSchemas.endTurn.parse(input); actor.activity = 'ended'; this.event(d, actor, 'end', '活動を終了しました'); return reply({ endTurn: true })
      case 'sleep':
        if (this.cognition) this.memoryChanges.push(this.cognition.prepare(agentId, owner => { owner.consolidation = 'pending' }))
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
    for (const request of this.recallTasks.values()) request.abort.abort(failure)
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
    if (this.data.world.lifecycle?.births.some(b => b.status === 'requested')) throw new LifeRuleError('新生児生成の結果が未確定です')
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
