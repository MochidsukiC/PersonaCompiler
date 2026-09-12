import { createHash } from 'node:crypto'
import { MEMORY_BUDGET, memoryToolSchemas, type MemoryArchive, type MemoryCandidate, type MemoryDetail, type MemoryInspection, type MemoryMutation, type MemoryOwner, type MemoryProgress, type MemoryRecord, type MemorySnapshot, type MemorySource, type RecallOperation } from './memory-contracts'
import { LifeRuleError } from './spatial'

export function normalizeCue(cue: string): string { return cue.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja') }
export function recallable(runId: string, ownerId: string, turn: number, memory: MemoryRecord): boolean {
  const p = Math.min(0.95, Math.max(0.05, memory.importance * 2 ** (-(turn - memory.strengthenedTurn) / MEMORY_BUDGET.halfLife)))
  const n = createHash('sha256').update(JSON.stringify([runId, ownerId, turn, memory.id])).digest().readUInt32BE(0) / 0x100000000
  return n < p
}
const blank = (): MemoryOwner => ({ revision: 0, candidates: [], records: [], relations: [], consolidation: 'none', organizedTurn: null, recalls: [], recallTurn: 0 })
export class NpcMemoryStore {
  private state: MemorySnapshot
  private readonly sources = new Map<string, MemorySource>()
  private readonly versions = new Map<string, MemoryRecord>()
  private readonly recentSources = new Map<string, MemorySource[]>()
  private readonly archivedReminders = new Map<string, Map<string, MemoryRecord>>()
  private readonly recalls = new Map<string, { turn: number; cues: Map<string, RecallOperation> }>()
  constructor(runId: string, owners: string[], saved?: MemorySnapshot, archive: MemoryArchive[] = []) {
    this.state = saved ?? { version: 1, runId, owners: Object.fromEntries(owners.map(id => [id, blank()])) }
    if (this.state.runId !== runId || Object.keys(this.state.owners).length !== owners.length || owners.some(id => !this.state.owners[id])) throw new LifeRuleError('記憶の所有NPCまたはrunIdが一致しません')
    for (const item of archive) this.index(item)
    for (const owner of Object.values(this.state.owners)) for (const record of owner.records) this.index({ kind: 'memoryRecord', value: record })
    for (const [id, owner] of Object.entries(this.state.owners)) {
      if (new Set(owner.records.map(r => r.id)).size !== owner.records.length || new Set(owner.candidates.map(c => c.id)).size !== owner.candidates.length) throw new LifeRuleError(`保存済み記憶IDが重複しています: ${id}`)
      for (const record of [...owner.records, ...owner.candidates]) {
        if (record.ownerId !== id) throw new LifeRuleError(`保存済み記憶の所有者が異なります: ${id}/${record.id}`)
        this.validateSources(id, record.sourceIds)
      }
      for (const relation of owner.relations) {
        if (relation.source !== id || !owners.includes(relation.target)) throw new LifeRuleError(`保存済み関係の所有者・相手が不正です: ${id}`)
        for (const ref of relation.evidence) this.detail(id, ref.memoryId, ref.revision)
      }
    }
  }
  private key(owner: string, id: string, revision?: number) { return JSON.stringify([owner, id, revision]) }
  private index(item: MemoryArchive) {
    if (item.kind === 'memorySource') {
      const key = this.key(item.value.ownerId, item.value.id)
      if (this.sources.has(key)) return
      this.sources.set(key, item.value)
      const recent = this.recentSources.get(item.value.ownerId) ?? []
      recent.push(item.value)
      this.recentSources.set(item.value.ownerId, recent.slice(-30))
    }
    if (item.kind === 'memoryRecord') {
      this.versions.set(this.key(item.value.ownerId, item.value.id, item.value.revision), item.value)
      if (item.value.reminder && item.value.status === 'forgotten') {
        const records = this.archivedReminders.get(item.value.ownerId) ?? new Map<string, MemoryRecord>()
        records.set(item.value.id, item.value); this.archivedReminders.set(item.value.ownerId, records)
      }
    }
    if (item.kind === 'memoryRecall') {
      const previous = this.recalls.get(item.value.ownerId)
      if (previous && previous.turn > item.value.turn) return
      const cache = previous?.turn === item.value.turn ? previous : { turn: item.value.turn, cues: new Map<string, RecallOperation>() }
      cache.cues.set(item.value.cue, item.value); this.recalls.set(item.value.ownerId, cache)
    }
  }
  owner(id: string): MemoryOwner { const value = this.state.owners[id]; if (!value) throw new LifeRuleError(`記憶を持つNPCが見つかりません: ${id}`); return value }
  addOwner(id: string): MemoryMutation {
    if (this.state.owners[id]) throw new LifeRuleError(`記憶の所有者が既に存在します: ${id}`)
    return { ownerId: id, owner: blank(), archive: [] }
  }
  snapshot(): MemorySnapshot { return structuredClone(this.state) }
  prepare(id: string, change: (owner: MemoryOwner, archive: MemoryArchive[]) => void): MemoryMutation {
    const owner = structuredClone(this.owner(id)), archive: MemoryArchive[] = []
    change(owner, archive); owner.revision++
    owner.recalls = owner.recalls.filter(r => !['completed', 'cancelled'].includes(r.status))
    return { ownerId: id, owner, archive }
  }
  commit(mutation: MemoryMutation) {
    if (mutation.ownerId && mutation.owner) this.state.owners[mutation.ownerId] = mutation.owner
    for (const item of mutation.archive) this.index(item)
  }
  source(ownerId: string, id: string, turn: number, text: string, kind: MemorySource['kind']): MemoryMutation {
    return { archive: [{ kind: 'memorySource', value: { id, ownerId, turn, text: text.slice(0, 2000), kind } }] }
  }
  availableSources(owner: string): MemorySource[] { return this.recentSources.get(owner) ?? [] }
  recalled(owner: string, turn: number, cue: string): RecallOperation | undefined {
    const cache = this.recalls.get(owner)
    return cache?.turn === turn ? cache.cues.get(cue) : undefined
  }
  progress(id: string): MemoryProgress {
    const o = this.owner(id)
    return { revision: o.revision, candidates: o.candidates.length, retained: o.records.length, reminders: o.records.filter(m => m.reminder?.status === 'pending').length, consolidation: o.consolidation, recalling: o.recalls.filter(r => ['requested', 'running'].includes(r.status)).length, error: o.recalls.find(r => ['failed', 'uncertain'].includes(r.status))?.error ?? null }
  }
  inspect(id: string): MemoryInspection {
    const o = this.owner(id)
    const descriptor = ({ text: _text, meaning: _meaning, sourceIds: _sources, ...record }: MemoryRecord) => record
    return structuredClone({ ownerId: id, progress: this.progress(id), candidates: o.candidates, records: o.records.map(descriptor), archivedReminders: [...(this.archivedReminders.get(id)?.values() ?? [])].map(descriptor), relations: o.relations, recalls: [...(this.recalls.get(id)?.cues.values() ?? [])] })
  }
  detail(owner: string, id: string, revision: number): MemoryDetail {
    this.owner(owner)
    const record = this.versions.get(this.key(owner, id, revision))
    if (!record) throw new LifeRuleError(`記憶revisionが見つかりません: ${owner}/${id}/${revision}`)
    return structuredClone({ record, sources: record.sourceIds.map(sourceId => { const source = this.sources.get(this.key(owner, sourceId)); if (!source) throw new LifeRuleError(`記憶の根拠がありません: ${owner}/${sourceId}`); return source }) })
  }
  private validateSources(owner: string, ids: string[]) { for (const id of ids) if (!this.sources.has(this.key(owner, id))) throw new LifeRuleError(`本人の経験ではない根拠です: ${owner}/${id}`) }
  remember(ownerId: string, turn: number, input: unknown): { mutation: MemoryMutation; candidate: MemoryCandidate } {
    const value = memoryToolSchemas.remember.parse(input); this.validateSources(ownerId, value.sourceIds)
    const candidate = { ...value, id: crypto.randomUUID(), ownerId, createdTurn: turn }
    const mutation = this.prepare(ownerId, (owner, archive) => {
      if (owner.candidates.length >= MEMORY_BUDGET.candidates) throw new LifeRuleError('未整理の記憶候補が100件です。睡眠時に整理してください')
      owner.candidates.push(candidate); archive.push({ kind: 'memoryCandidate', value: candidate })
    })
    return { mutation, candidate }
  }
  remind(ownerId: string, turn: number, input: unknown, people: string[], facilities: string[]) {
    const value = memoryToolSchemas.remindMe.parse(input)
    let id = value.action === 'create' ? crypto.randomUUID() : value.memoryId
    const mutation = this.prepare(ownerId, (owner, archive) => {
      if (value.action === 'create') {
        this.validateSources(ownerId, value.sourceIds)
        const t = value.trigger
        if (t.afterTurn === null && t.facilityId === null && t.personId === null) throw new LifeRuleError('予定には最低1つの条件が必要です')
        if ((t.personId && !people.includes(t.personId)) || (t.facilityId && !facilities.includes(t.facilityId))) throw new LifeRuleError('予定の人物または施設が存在しません')
        if (owner.records.length >= MEMORY_BUDGET.records) throw new LifeRuleError('保持記憶が100件です。睡眠時に整理してください')
        const record: MemoryRecord = { text: value.text, meaning: value.meaning, cues: value.cues, importance: value.importance, sourceIds: value.sourceIds, id, ownerId, kind: 'prospective', revision: 1, createdTurn: turn, organizedTurn: turn, recalledTurn: null, strengthenedTurn: turn, status: 'retained', reminder: { ...t, status: 'pending', notifiedTurn: null } }
        owner.records.push(record); archive.push({ kind: 'memoryRecord', value: record })
      } else {
        const record = owner.records.find(m => m.id === value.memoryId)
        if (!record?.reminder || record.reminder.status !== 'pending') throw new LifeRuleError(`未完了の予定がありません: ${value.memoryId}`)
        id = record.id; record.revision++; record.reminder.status = value.action === 'complete' ? 'done' : 'cancelled'; record.status = 'forgotten'
        owner.records = owner.records.filter(m => m.id !== id); archive.push({ kind: 'memoryRecord', value: record })
      }
    })
    return { mutation, id }
  }
  consolidate(ownerId: string, turn: number, input: unknown, people: string[]): MemoryMutation {
    const value = memoryToolSchemas.consolidateMemory.parse(input)
    return this.prepare(ownerId, (owner, archive) => {
      if (owner.consolidation !== 'running') throw new LifeRuleError('記憶整理の実行段階ではありません')
      if (value.memories.filter(m => m.id === null).length > MEMORY_BUDGET.newPerSleep) throw new LifeRuleError('新規記憶は睡眠1回につき最大5件です')
      const touched = new Set<string>(), aliases = new Map<string, string>(), removed = new Set(value.forgetIds)
      if (removed.size !== value.forgetIds.length) throw new LifeRuleError('忘却対象が重複しています')
      for (const m of value.memories) for (const id of m.mergeIds) { if (removed.has(id)) throw new LifeRuleError(`統合・忘却の指定が重複しています: ${id}`); removed.add(id) }
      for (const id of removed) if (!owner.records.some(m => m.id === id)) throw new LifeRuleError(`忘却対象がありません: ${id}`)
      for (const edit of value.memories) {
        this.validateSources(ownerId, edit.sourceIds)
        for (const id of edit.candidateIds) if (!owner.candidates.some(c => c.id === id)) throw new LifeRuleError(`候補がありません: ${id}`)
        if (!edit.id && !edit.candidateIds.length && !edit.mergeIds.length) throw new LifeRuleError('新規記憶には候補または統合元が必要です')
        const old = edit.id ? owner.records.find(m => m.id === edit.id) : undefined
        if (edit.id && (!old || old.kind === 'prospective' || removed.has(edit.id) || touched.has(edit.id))) throw new LifeRuleError(`更新対象が不正です: ${edit.id}`)
        const id = edit.id ?? crypto.randomUUID(); touched.add(id)
        for (const candidate of edit.candidateIds) { if (aliases.has(candidate)) throw new LifeRuleError(`候補を複数の新規記憶へ重複使用しています: ${candidate}`); aliases.set(candidate, id) }
        const record: MemoryRecord = { text: edit.text, meaning: edit.meaning, cues: edit.cues, importance: edit.importance, sourceIds: edit.sourceIds, id, ownerId, kind: edit.kind, revision: (old?.revision ?? 0) + 1, createdTurn: old?.createdTurn ?? turn, organizedTurn: turn, recalledTurn: old?.recalledTurn ?? null, strengthenedTurn: old?.strengthenedTurn ?? turn, status: 'retained', reminder: null }
        owner.records = owner.records.filter(m => m.id !== id); owner.records.push(record); archive.push({ kind: 'memoryRecord', value: record })
      }
      for (const record of owner.records.filter(m => removed.has(m.id))) archive.push({ kind: 'memoryRecord', value: { ...record, revision: record.revision + 1, status: 'forgotten', organizedTurn: turn } })
      owner.records = owner.records.filter(m => !removed.has(m.id))
      if (owner.records.length > MEMORY_BUDGET.records) throw new LifeRuleError('保持記憶は予定を含め最大100件です')
      if (new Set(value.relations.map(r => r.target)).size !== value.relations.length) throw new LifeRuleError('関係の相手が重複しています')
      owner.relations = value.relations.map(relation => {
        if (relation.target === ownerId || !people.includes(relation.target)) throw new LifeRuleError(`関係の相手が不正です: ${relation.target}`)
        const evidence = relation.memoryIds.map(id => {
          let record = owner.records.find(m => m.id === (aliases.get(id) ?? id))
          if (!record) record = this.owner(ownerId).records.find(m => m.id === id)
          if (!record) {
            const historical = this.owner(ownerId).relations.flatMap(r => r.evidence).find(e => e.memoryId === id)
            if (historical) record = this.detail(ownerId, id, historical.revision).record
          }
          if (!record) throw new LifeRuleError(`本人の整理材料に関係の根拠がありません: ${id}`)
          return { memoryId: record.id, revision: record.revision }
        })
        return { source: ownerId, target: relation.target, label: relation.label, description: relation.description, evidence, observedTurn: turn }
      })
      owner.candidates = []; owner.organizedTurn = turn; owner.consolidation = 'complete'
      archive.push({ kind: 'memoryRelations', ownerId, turn, value: owner.relations })
    })
  }
}
