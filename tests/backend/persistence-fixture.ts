import { EventEmitter } from 'node:events'
import { PersistenceStore } from '../../src/backend/persistence-store'
import type { PersistencePort, PersistenceRequest, PersistenceResponse } from '../../src/core/persistence'

export class FixturePersistencePort extends EventEmitter implements PersistencePort {
  store!: PersistenceStore
  stopped = false
  saveGate: Promise<void> | null = null
  saves = 0
  failSave = false
  loseAck = false
  postMessage(input: PersistenceRequest): void {
    const message = structuredClone(input)
    const respond = (response: PersistenceResponse) => { if (!this.stopped) this.emit('message', structuredClone(response)) }
    const run = async (): Promise<PersistenceResponse['result']> => {
      if (message.kind === 'open') { this.store = new PersistenceStore(message.root); return this.store.load() }
      if (message.kind === 'change') { this.store.apply(message.change); return null }
      this.saves++
      await this.saveGate
      if (this.failSave) throw new Error('ENOSPC: fixture disk full')
      const receipt = await this.store.save(message.dirty)
      if (this.loseAck) { await this.terminate(); return null }
      return receipt
    }
    void run().then(result => respond({ id: message.id, result }), error => respond({ id: message.id, error: String(error) }))
  }
  async terminate(): Promise<number> { this.stopped = true; this.emit('exit', 1); return 1 }
}
