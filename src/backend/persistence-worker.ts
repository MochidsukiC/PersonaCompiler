import { parentPort } from 'node:worker_threads'
import { PersistenceStore } from './persistence-store'
import type { PersistenceRequest, PersistenceResponse } from '../core/persistence'

if (!parentPort) throw new Error('保存WorkerにはparentPortが必要です')
let store: PersistenceStore | null = null
parentPort.on('message', (message: PersistenceRequest) => {
  const run = async (): Promise<PersistenceResponse['result']> => {
    if (message.kind === 'open') { store = new PersistenceStore(message.root); return store.load() }
    if (!store) throw new Error('保存Workerが初期化されていません')
    if (message.kind === 'change') { store.apply(message.change); return null }
    return store.save(message.dirty)
  }
  void run().then(result => parentPort!.postMessage({ id: message.id, result }), error => parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }))
})
