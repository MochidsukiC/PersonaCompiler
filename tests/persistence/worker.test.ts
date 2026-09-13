import { expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { PersistenceCoordinator } from '../../src/backend/persistence-coordinator'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { LifeHarness, type LifeServices } from '../../src/core/life-harness'
import { emptyPreparation } from '../../src/core/contracts'
import { draft, population, settings } from '../backend/fixtures'

function fixture() {
  const spec = structuredClone(draft.specification), people = structuredClone(population)
  people.npcs = Array.from({ length: 20 }, (_, index) => ({ ...population.npcs[index % 5], id: `npc${index}`, householdId: `house${index}` }))
  spec.population.count = 20
  spec.town.facilities[2].dimensions = { x: 100, y: 30, z: 3 }
  for (let index = 3; index < 8; index++) spec.town.facilities.push({ ...spec.town.facilities[0], id: `facility${index}`, locationId: `location${index}` })
  const service = services()
  const state = new LifeHarness(spec, people, service).checkpoint()
  state.world.stage = 'ready'; state.world.phase = 'between'
  for (const actor of state.world.actors) { actor.position = { x: 0, y: 0, z: 0 }; actor.activity = 'ended' }
  for (const facility of state.world.facilities) facility.layout = { regions: [], publicState: 'ready', homes: facility.type === 'residential' ? people.npcs.map((npc, index) => ({ id: `home${index}`, householdId: npc.householdId, name: npc.householdId, description: 'home', bounds: { min: { x: index * 3, y: 0, z: 0 }, max: { x: index * 3 + 1, y: 1, z: 1 } } })) : [] }
  state.jobs = Array.from({ length: 1024 }, (_, index) => ({ id: `completed${index}`, agentId: `npc${index % 20}`, text: 'x'.repeat(8192), kind: 'activity', status: 'done', turnId: `historical${index}`, completed: true }))
  return { spec, people, state }
}
function services(): LifeServices & { harness?: LifeHarness } {
  const value: LifeServices & { harness?: LifeHarness } = {
    async start(agentId, _text, clientId) { value.harness!.notify(agentId, 'turn/started', { turn: { id: clientId } }); return clientId },
    async steer() {}, async compact() {}, async history() { return [] }, async terminalInput() {},
    async interrupt(agentId, turnId) { value.harness!.notify(agentId, 'turn/completed', { turn: { id: turnId, status: 'interrupted' } }) },
    async save() {}, changed() {}, failed(error) { throw error }
  }
  return value
}
async function runActions(harness: LifeHarness, count: number) {
  const times: number[] = []
  const activeTurns = harness.checkpoint().active
  for (let index = 0; index < count; index++) {
    const began = performance.now()
    const id = `npc${index % 20}`, turnId = activeTurns[id].turnId!
    const speech = index % 5 === 0
    const result = await harness.tool(id, { turnId, callId: `action${index}`, tool: speech ? 'sendMessage' : 'moveWithinFacility', arguments: speech ? { text: `会話${index}`, volume: 'low' } : { position: { x: index % 2, y: 0, z: 0 } } })
    expect(result.success, result.contentItems[0].text).toBe(true)
    times.push(performance.now() - began)
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  return times
}
it('keeps tools and snapshots live during a ten second native worker stall and reduces logical writes by at least 90%', async () => {
  await mkdir('.local/tests', { recursive: true }); await mkdir('.local/diagnostics', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/native-worker-'))
  const file = (await readdir('out/main')).find(name => /^persistence-worker-.*\.js$/.test(name))
  if (!file) throw new Error('先にnpm run buildを実行してください')
  const marker = new SharedArrayBuffer(4)
  const entry = pathToFileURL(path.resolve('out/main', file)).href
  const source = `const { parentPort, workerData } = require('node:worker_threads');
    let ready = false, saves = 0; const queued = [];
    parentPort.on('message', message => {
      if (!ready) { queued.push(message); return; }
      if (message.kind === 'save' && ++saves === 2) { Atomics.store(new Int32Array(workerData.marker), 0, 1); Atomics.wait(new Int32Array(workerData.marker), 0, 1, 10000); }
    });
    import(workerData.entry).then(() => { ready = true; for (const message of queued) parentPort.emit('message', message); });`
  const coordinator = new PersistenceCoordinator(root, () => new Worker(source, { eval: true, workerData: { entry, marker } }), () => undefined)
  const { spec, people, state } = fixture()
  let legacy: LifeHarness | undefined, memory: LifeHarness | undefined
  let legacyBytes = 0, legacySaveMs = 0
  const legacyServices = services()
  legacyServices.save = async value => {
    const began = performance.now(), canonical = JSON.stringify(value)
    legacyBytes += Buffer.byteLength(JSON.stringify({ hash: createHash('sha256').update(canonical).digest('hex'), checkpoint: value }, null, 2))
    legacySaveMs += performance.now() - began
  }
  const stalls: number[] = []; let lastTick = performance.now()
  const timer = setInterval(() => { const now = performance.now(); stalls.push(now - lastTick); lastTick = now }, 5)
  try {
    legacy = new LifeHarness(spec, people, legacyServices, state); legacyServices.harness = legacy
    await legacy.start(true)
    await legacy.drain()
    const legacyActive = Object.values(legacy.checkpoint().active)
    expect(legacyActive).toHaveLength(20); expect(legacyActive.every(turn => turn.turnId)).toBe(true)
    const legacyTimes = await runActions(legacy, 40)
    await legacy.pause(); await legacy.drain()
    const legacyStall = Math.max(...stalls); stalls.length = 0; lastTick = performance.now()
    await coordinator.initialize()
    coordinator.setMetadata({ version: 1, lifeVersion: 1, authMode: null, settings, preparation: emptyPreparation(), artifactHash: null })
    await coordinator.markDirty()
    coordinator.initializeLife(state)
    const memoryServices = services()
    memoryServices.memory = { initialize: checkpoint => coordinator.initializeLife(checkpoint), changed: change => coordinator.life(change) }
    memoryServices.save = async () => { throw new Error('legacy save on memory path') }
    memory = new LifeHarness(spec, people, memoryServices, state); memoryServices.harness = memory
    await memory.start(true)
    await memory.drain()
    const memoryActive = Object.values(memory.checkpoint().active)
    expect(memoryActive).toHaveLength(20); expect(memoryActive.every(turn => turn.turnId)).toBe(true)
    const flush = coordinator.flush()
    await vi.waitFor(() => expect(Atomics.load(new Int32Array(marker), 0)).toBe(1))
    const began = performance.now(), memoryTimes = await runActions(memory, 40)
    expect(performance.now() - began).toBeLessThan(2000)
    expect(coordinator.status.state).toBe('saving')
    expect(memory.snapshot().events.length).toBe(40)
    const unsavedBytes = coordinator.status.unsavedBytes
    expect(unsavedBytes).toBeGreaterThan(8_000_000)
    await flush; await coordinator.flush()
    const restored = await new PersistenceStore(root).load()
    expect(restored!.run.life!.world.actors).toEqual(memory.snapshot().actors)
    expect(restored!.run.life!.world.events).toEqual(memory.snapshot().events)
    expect(restored!.run.life!.completedJobKinds?.completed0).toBe('activity')
    const reduction = 1 - coordinator.status.bytesWritten / legacyBytes
    expect(reduction).toBeGreaterThanOrEqual(0.9)
    const metrics = (times: number[]) => ({ maxMs: Math.max(...times), meanMs: times.reduce((a, b) => a + b, 0) / times.length })
    const report = { fixture: { npcs: 20, facilities: 8, historyBytes: Buffer.byteLength(JSON.stringify(state.jobs)), actions: 40 }, legacy: { logicalWriteBytes: legacyBytes, tool: metrics(legacyTimes), mainMaxIntervalMs: legacyStall, serializationMs: legacySaveMs }, memory: { logicalWriteBytes: coordinator.status.bytesWritten, tool: metrics(memoryTimes), mainMaxIntervalMs: Math.max(...stalls), lastSaveMs: coordinator.status.saveDurationMs, unsavedBytesDuringStall: unsavedBytes }, reductionPercent: reduction * 100, workerStallMs: 10000, accounting: 'Legacy checkpoint writer payloads counted without physical writes; memory includes actual manifest/checkpoint/history writes including initial history. Codex internal I/O and PTY excluded; fixture model calls only.' }
    await writeFile('.local/diagnostics/in-memory-benchmark.json', JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  } finally { clearInterval(timer); await legacy?.close(); await memory?.close(); await coordinator.close() }
})

it.each(['history', 'snapshot', 'manifest'])('survives actual worker termination immediately after publishing %s', async stage => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/worker-crash-'))
  const store = new PersistenceStore(root)
  const { state } = fixture(); state.jobs = []
  store.apply({ revision: 1, kind: 'metadata', value: { version: 1, lifeVersion: 1, authMode: null, settings, preparation: emptyPreparation(), artifactHash: null } })
  store.apply({ revision: 2, kind: 'initializeLife', value: state })
  await store.save(true)
  const file = (await readdir('out/main')).find(name => /^persistence-worker-.*\.js$/.test(name))
  if (!file) throw new Error('先にnpm run buildを実行してください')
  const entry = pathToFileURL(path.resolve('out/main', file)).href
  const source = `const { parentPort, workerData } = require('node:worker_threads');
    const fs = require('node:fs/promises'); const original = fs.rename;
    fs.rename = async (from, to) => { const result = await original(from, to);
      const normalized = String(to).replaceAll('\\\\', '/');
      const match = workerData.stage === 'history' ? normalized.includes('/history/') : workerData.stage === 'snapshot' ? normalized.includes('/snapshot-') && normalized.endsWith('.json') : normalized.endsWith('/manifest.json');
      if (match) process.exit(99); return result; };
    require('node:module').syncBuiltinESMExports();
    let ready = false; const queued = [];
    parentPort.on('message', message => { if (!ready) queued.push(message); });
    import(workerData.entry).then(() => { ready = true; for (const message of queued) parentPort.emit('message', message); });`
  const worker = new Worker(source, { eval: true, workerData: { stage, entry } })
  let id = 0
  const requests = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const request = (message: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => { const key = ++id; requests.set(key, { resolve, reject }); worker.postMessage({ ...message, id: key }) })
  worker.on('message', response => { const waiter = requests.get(response.id)!; requests.delete(response.id); if (response.error) waiter.reject(new Error(response.error)); else waiter.resolve(response.result) })
  worker.on('error', error => { for (const waiter of requests.values()) waiter.reject(error); requests.clear() })
  worker.on('exit', code => { for (const waiter of requests.values()) waiter.reject(new Error(`worker exited ${code}`)); requests.clear() })
  try {
    await request({ kind: 'open', root })
    await request({ kind: 'change', change: { revision: 3, kind: 'life', value: { patches: [{ path: ['world', 'turn'], value: 42 }], history: [{ kind: 'event', value: { sequence: 1, turn: 42, kind: 'move', actorId: 'npc0', text: 'committed move', recipients: [], locationId: 'home', position: { x: 1, y: 0, z: 0 } } }] } } })
    await expect(request({ kind: 'save', dirty: true })).rejects.toThrow('worker exited 99')
    const restored = await new PersistenceStore(root).load()
    expect(restored!.manifest.revision).toBe(stage === 'manifest' ? 3 : 2)
    expect(restored!.run.life!.world.turn).toBe(stage === 'manifest' ? 42 : 0)
    expect(restored!.run.life!.world.events).toHaveLength(stage === 'manifest' ? 1 : 0)
    expect(restored!.manifest.dirty).toBe(true)
  } finally { await worker.terminate() }
})
