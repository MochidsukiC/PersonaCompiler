import { isDeepStrictEqual } from 'node:util'
import type { LifeCheckpoint } from '../core/life-harness'
import type { LifeChange, LoadedMemoryRun, PersistenceChange, PersistencePort, PersistencePortFactory, PersistenceRequest, PersistenceResponse, PersistenceStatus, SavedBackend, SaveReceipt } from '../core/persistence'

type Change = PersistenceChange extends infer T ? T extends PersistenceChange ? Omit<T, 'revision'> : never : never
function size(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value)
  if (value === null || typeof value !== 'object') return 8
  return Object.entries(value).reduce((sum, [key, item]) => sum + Buffer.byteLength(key) + size(item), 0)
}
export class PersistenceCoordinator {
  private port: PersistencePort | null = null
  private id = 0
  private requests = new Map<number, { resolve(value: PersistenceResponse['result']): void; reject(error: Error): void }>()
  private changes: { change: PersistenceChange; bytes: number; recordedAt: string }[] = []
  private metadata: SavedBackend | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private flight: Promise<void> | null = null
  private dirty = false
  private savedDirty = false
  private externalAllowed = false
  private portReady = false
  private closed = false
  readonly status: PersistenceStatus = { state: 'saved', revision: 0, savedRevision: 0, savedAt: null, unsavedSince: null, unsavedBytes: 0, error: null, readOnlyReason: null, bytesWritten: 0, saveDurationMs: 0 }
  constructor(private readonly root: string, private readonly factory: PersistencePortFactory, private readonly changed: () => void) {}
  private report(error: unknown): void {
    this.status.error = error instanceof Error ? error.message : String(error)
    this.status.state = 'error'; this.changed()
  }
  private request(message: Omit<Extract<PersistenceRequest, { kind: 'open' }>, 'id'> | Omit<Extract<PersistenceRequest, { kind: 'save' }>, 'id'> | Omit<Extract<PersistenceRequest, { kind: 'change' }>, 'id'>): Promise<PersistenceResponse['result']> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject })
      try {
        if (!this.port) throw new Error('保存Workerが停止しています')
        this.port.postMessage({ ...message, id } as PersistenceRequest)
      } catch (error) { this.requests.delete(id); reject(error) }
    })
  }
  private async openPort(): Promise<LoadedMemoryRun | null> {
    const port = this.factory(); this.port = port; this.portReady = false
    const stopped = (error: Error) => {
      if (this.port !== port) return
      this.port = null; this.portReady = false
      for (const waiter of this.requests.values()) waiter.reject(error)
      this.requests.clear()
      if (!this.closed) this.report(error)
    }
    port.on('message', message => {
      if (this.port !== port) return
      const waiter = this.requests.get(message.id)
      if (!waiter) return
      this.requests.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error))
      else waiter.resolve(message.result)
    })
    port.on('error', stopped)
    port.on('exit', code => stopped(new Error(`保存Workerが終了しました: code=${code}`)))
    try {
      const loaded = await this.request({ kind: 'open', root: this.root }) as LoadedMemoryRun | null
      return loaded
    } catch (error) { this.port = null; await port.terminate(); throw error }
  }
  async initialize(): Promise<LoadedMemoryRun | null> {
    const loaded = await this.openPort()
    this.portReady = true
    if (loaded) {
      this.metadata = structuredClone(loaded.run.metadata)
      this.status.revision = loaded.manifest.revision
      this.accept({ manifest: loaded.manifest, bytesWritten: 0, durationMs: 0 })
      this.dirty = loaded.manifest.dirty
      if (this.dirty) {
        this.status.state = 'readOnly'
        this.status.readOnlyReason = '前回の正常終了を確認できません。最後の確定保存を閲覧専用で開いています。推論・配信は再送しません。'
      }
    }
    this.timer = setInterval(() => {
      if (!this.status.readOnlyReason && this.status.revision > this.status.savedRevision) void this.flush().catch(() => { /* flush reports the error and retains changes. */ })
    }, 30_000)
    this.timer.unref()
    return loaded
  }
  private send(change: PersistenceChange, replay = false): void {
    if (!this.port || (!this.portReady && !replay)) return
    const sender = this.port
    void this.request({ kind: 'change', change }).catch(error => {
      if (this.closed || this.port !== sender) return
      this.report(error)
      const port = this.port; this.port = null; this.portReady = false
      for (const waiter of this.requests.values()) waiter.reject(new Error('保存Workerの状態を再構築する必要があります'))
      this.requests.clear()
      void port.terminate().catch(error => this.report(error))
    })
  }
  private record(value: Change): void {
    if (this.status.readOnlyReason || this.closed) throw new Error('この保存状態は変更できません')
    const change = { ...value, revision: ++this.status.revision } as PersistenceChange
    const bytes = size(change)
    const recordedAt = new Date().toISOString()
    this.changes.push({ change, bytes, recordedAt }); this.status.unsavedBytes += bytes
    this.status.unsavedSince ??= recordedAt
    if (this.status.state !== 'saving' && this.status.state !== 'error') this.status.state = 'pending'
    this.send(change); this.changed()
  }
  setMetadata(value: SavedBackend): void {
    if (isDeepStrictEqual(this.metadata, value)) return
    this.metadata = structuredClone(value)
    this.record({ kind: 'metadata', value: this.metadata })
  }
  initializeLife(value: LifeCheckpoint): void { this.record({ kind: 'initializeLife', value: structuredClone(value) }) }
  life(value: LifeChange): void { this.record({ kind: 'life', value }) }
  private accept(receipt: SaveReceipt): void {
    const manifest = receipt.manifest
    if (manifest.revision < this.status.savedRevision || manifest.revision > this.status.revision) throw new Error('保存ACKのrevisionが不正です')
    this.status.savedRevision = manifest.revision; this.status.savedAt = manifest.savedAt; this.savedDirty = manifest.dirty
    this.changes = this.changes.filter(item => item.change.revision > manifest.revision)
    this.status.unsavedBytes = this.changes.reduce((sum, item) => sum + item.bytes, 0)
    this.status.unsavedSince = this.changes[0]?.recordedAt ?? null
    this.status.bytesWritten += receipt.bytesWritten; this.status.saveDurationMs = receipt.durationMs
  }
  async markDirty(): Promise<void> {
    if (this.status.readOnlyReason) throw new Error(this.status.readOnlyReason)
    if (this.externalAllowed) return
    this.dirty = true
    await this.flush(false, true)
    this.externalAllowed = true
  }
  async flush(clean = false, force = false): Promise<void> {
    if (this.status.readOnlyReason) throw new Error(this.status.readOnlyReason)
    if (clean) this.externalAllowed = false
    const targetDirty = clean ? false : this.dirty
    const target = this.status.revision
    while (this.flight) { await this.flight; if (!force && this.status.savedRevision >= target && this.savedDirty === targetDirty) return }
    if (!force && this.status.savedAt && this.status.savedRevision >= target && this.savedDirty === targetDirty) return
    const save = async () => {
      this.status.state = 'saving'; this.changed()
      try {
        if (!this.port) {
          const loaded = await this.openPort()
          if (loaded) this.accept({ manifest: loaded.manifest, bytesWritten: 0, durationMs: 0 })
          else if (this.status.savedRevision) throw new Error('保存済みmanifestが見つかりません')
          for (const { change } of this.changes) this.send(change, true)
          this.portReady = true
        }
        const receipt = await this.request({ kind: 'save', dirty: targetDirty }) as SaveReceipt
        this.accept(receipt); this.status.error = null
        if (clean) this.dirty = false
        this.status.state = this.changes.length ? 'pending' : 'saved'; this.changed()
      } catch (error) { this.report(error); throw error }
    }
    this.flight = save()
    try { await this.flight } finally { this.flight = null }
  }
  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    const port = this.port; this.port = null
    await port?.terminate()
  }
}
