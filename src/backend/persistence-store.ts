import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { publishFile } from '../main/atomic-write'
import { economyRecordSchema, type EconomyRecord } from '../core/economy-contracts'
import { lifeCheckpointSchema } from '../core/life-harness'
import { memoryArchiveSchema, type MemoryArchive } from '../core/memory-contracts'
import type { LifeHistoryRecord, LoadedMemoryRun, PersistenceChange, SaveManifest, SaveReceipt, SavedMemoryRun } from '../core/persistence'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const segmentSchema = z.object({ file: z.string().regex(/^history\/\d+-\d+-[a-f0-9]{64}\.jsonl$/), hash: z.string().regex(/^[a-f0-9]{64}$/), first: z.number().int().positive(), last: z.number().int().positive() })
export const manifestSchema = z.object({ version: z.literal(2), runId: z.string(), revision: z.number().int().nonnegative(), generation: z.number().int().positive(), slot: z.enum(['a', 'b']), hash: z.string(), dirty: z.boolean(), savedAt: z.string(), segments: z.array(segmentSchema) })
const historySchema = z.discriminatedUnion('kind', [
  ...memoryArchiveSchema.options,
  z.object({ kind: z.literal('economy'), value: economyRecordSchema }),
  z.object({ kind: z.literal('job'), value: lifeCheckpointSchema.shape.jobs.element }),
  z.object({ kind: z.literal('receipt'), key: z.string(), value: lifeCheckpointSchema.shape.receipts.valueType }),
  z.object({ kind: z.literal('event'), value: lifeCheckpointSchema.shape.world.shape.events.element }),
  z.object({ kind: z.literal('interaction'), value: lifeCheckpointSchema.shape.interactions.element })
])
const historyEntrySchema = z.object({ revision: z.number().int().positive(), records: z.array(historySchema) })

export class PersistenceStore {
  private run: SavedMemoryRun | null = null
  private revision = 0
  private manifest: SaveManifest | null = null
  private pending: { revision: number; records: LifeHistoryRecord[] }[] = []
  private saving = false
  constructor(private readonly root: string) {}

  async load(): Promise<LoadedMemoryRun | null> {
    let text: string
    try { text = await readFile(path.join(this.root, 'persistence/manifest.json'), 'utf8') }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
    const manifest = manifestSchema.parse(JSON.parse(text))
    if (manifest.runId !== path.basename(this.root)) throw new Error('保存manifestのrunIdが一致しません')
    const snapshot = await readFile(path.join(this.root, `persistence/snapshot-${manifest.slot}.json`), 'utf8')
    if (hash(snapshot) !== manifest.hash) throw new Error('確定checkpointのhashが一致しません')
    const decoded = JSON.parse(snapshot)
    if (decoded.historyRevision !== manifest.revision) throw new Error('checkpointと履歴の確定位置が一致しません')
    const saved = decoded as SavedMemoryRun
    if (saved.life) saved.life = lifeCheckpointSchema.parse(saved.life)
    const receipts: NonNullable<SavedMemoryRun['life']>['receipts'] = {}
    const memoryArchive: MemoryArchive[] = []
    const economyArchive: EconomyRecord[] = []
    const events: NonNullable<SavedMemoryRun['life']>['world']['events'] = []
    const completedJobKinds: NonNullable<NonNullable<SavedMemoryRun['life']>['completedJobKinds']> = {}
    let previous = 0
    for (const segment of manifest.segments) {
      if (segment.first <= previous || segment.last < segment.first || segment.last > manifest.revision) throw new Error(`履歴の連番が不正です: ${segment.file}`)
      const data = await readFile(path.join(this.root, 'persistence', segment.file), 'utf8')
      if (hash(data) !== segment.hash) throw new Error(`履歴のhashが一致しません: ${segment.file}`)
      const entries = data.trimEnd().split('\n').map(line => historyEntrySchema.parse(JSON.parse(line)))
      if (entries[0].revision !== segment.first || entries.at(-1)!.revision !== segment.last) throw new Error(`履歴の確定範囲が一致しません: ${segment.file}`)
      for (const entry of entries) {
        if (entry.revision <= previous) throw new Error(`履歴が重複しています: ${segment.file}/${entry.revision}`)
        for (const record of entry.records) {
          if (record.kind === 'memorySource' || record.kind === 'memoryRecord' || record.kind === 'memoryRecall') memoryArchive.push(record)
          if (record.kind === 'economy') economyArchive.push(record.value)
          if (record.kind === 'receipt') receipts[record.key] = record.value
          if (record.kind === 'job' && ['done', 'discarded'].includes(record.value.status)) completedJobKinds[record.value.id] = record.value.kind
          if (record.kind === 'event') { events.push(record.value); if (events.length > 200) events.shift() }
        }
        previous = entry.revision
      }
      previous = segment.last
    }
    this.run = structuredClone(saved); this.revision = manifest.revision; this.manifest = manifest
    if (saved.life) { saved.life.receipts = receipts; saved.life.world.events = events; saved.life.completedJobKinds = completedJobKinds }
    if (saved.life?.cognition) saved.life.memoryArchive = memoryArchive
    if (saved.life?.world.economy) saved.life.economyArchive = economyArchive
    return { manifest, run: saved }
  }
  apply(change: PersistenceChange): void {
    if (change.revision !== this.revision + 1) throw new Error(`保存変更の連番が不正です: expected=${this.revision + 1}, received=${change.revision}`)
    if (change.kind === 'metadata') {
      if (!this.run) this.run = { metadata: change.value, life: null }
      else this.run.metadata = change.value
    } else {
      if (!this.run) throw new Error('保存用metadataがありません')
      if (change.kind === 'initializeLife') {
        const value = change.value
        const records: LifeHistoryRecord[] = [
          ...(value.economyArchive ?? []).map(value => ({ kind: 'economy' as const, value })),
          ...value.jobs.map(job => ({ kind: 'job' as const, value: job })),
          ...value.interactions.map(item => ({ kind: 'interaction' as const, value: item })),
          ...value.world.events.map(event => ({ kind: 'event' as const, value: event })),
          ...Object.entries(value.receipts).map(([key, receipt]) => ({ kind: 'receipt' as const, key, value: receipt }))
        ]
        this.run.life = { ...value, jobs: value.jobs.filter(job => !['done', 'discarded'].includes(job.status)), interactions: value.interactions.filter(item => !item.done), receipts: {}, world: { ...value.world, events: [] } }
        delete this.run.life.economyArchive
        if (records.length) this.pending.push({ revision: change.revision, records })
      }
      else {
        if (!this.run.life) throw new Error('保存用生活状態がありません')
        for (const patch of change.value.patches) {
          let object: unknown = this.run.life
          for (const key of patch.path.slice(0, -1)) object = (object as Record<string | number, unknown>)[key]
          ;(object as Record<string | number, unknown>)[patch.path.at(-1)!] = patch.value
        }
        if (change.value.history.length) this.pending.push({ revision: change.revision, records: change.value.history })
      }
    }
    this.revision = change.revision
  }
  private async write(relative: string, text: string): Promise<number> {
    const target = path.join(this.root, 'persistence', relative)
    await mkdir(path.dirname(target), { recursive: true })
    const relation = path.relative(await realpath(this.root), await realpath(path.dirname(target)))
    if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`保存先が実行フォルダー外です: ${relative}`)
    const temp = `${target}.${randomUUID()}.tmp`
    const file = await open(temp, 'wx')
    try { await file.writeFile(text, 'utf8'); await file.sync() } finally { await file.close() }
    await publishFile(temp, target)
    return Buffer.byteLength(text)
  }
  async save(dirty: boolean): Promise<SaveReceipt> {
    if (this.saving) throw new Error('保存処理が競合しています')
    if (!this.run) throw new Error('保存対象がありません')
    this.saving = true
    const began = performance.now()
    try {
      const revision = this.revision
      const pending = this.pending.filter(p => p.revision <= revision)
      const snapshot = structuredClone(this.run)
      if (snapshot.life) { snapshot.life.receipts = {}; snapshot.life.world.events = [] }
      const text = JSON.stringify({ ...snapshot, historyRevision: revision })
      const segments = [...(this.manifest?.segments ?? [])]
      let bytesWritten = 0
      if (pending.length) {
        const data = pending.map(p => JSON.stringify(p)).join('\n') + '\n'
        const digest = hash(data)
        const first = pending[0].revision, last = pending.at(-1)!.revision
        const file = `history/${first}-${last}-${digest}.jsonl`
        bytesWritten += await this.write(file, data)
        segments.push({ file, hash: digest, first, last })
      }
      const slot = this.manifest?.slot === 'a' ? 'b' : 'a'
      bytesWritten += await this.write(`snapshot-${slot}.json`, text)
      const manifest: SaveManifest = { version: 2, runId: path.basename(this.root), revision, generation: (this.manifest?.generation ?? 0) + 1, slot, hash: hash(text), dirty, savedAt: new Date().toISOString(), segments }
      bytesWritten += await this.write('manifest.json', JSON.stringify(manifest))
      this.manifest = manifest; this.pending = this.pending.filter(p => p.revision > revision)
      return { manifest, bytesWritten, durationMs: performance.now() - began }
    } finally { this.saving = false }
  }
}
