import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { PersistenceCoordinator } from '../../src/backend/persistence-coordinator'
import { LifeHarness, type LifeCheckpoint, type LifeServices } from '../../src/core/life-harness'
import { emptyPreparation } from '../../src/core/contracts'
import type { SavedBackend } from '../../src/core/persistence'
import { draft, population } from './fixtures'
import { FixturePersistencePort } from './persistence-fixture'

const coordinators: PersistenceCoordinator[] = []
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const coordinator of coordinators.splice(0)) await coordinator.close() })
const metadata = (): SavedBackend => ({ version: 1, lifeVersion: 1, authMode: null, settings: null, preparation: emptyPreparation(), artifactHash: null })
async function directory() { await mkdir('.local/tests', { recursive: true }); return mkdtemp(path.resolve('.local/tests/persistence-')) }
async function setup(root?: string) {
  const ports: FixturePersistencePort[] = []
  const coordinator = new PersistenceCoordinator(root ?? await directory(), () => { const port = new FixturePersistencePort(); ports.push(port); return port }, () => undefined)
  coordinators.push(coordinator)
  const loaded = await coordinator.initialize()
  return { coordinator, ports, loaded }
}
function checkpoint(): LifeCheckpoint {
  const service: LifeServices = { start: async () => 'turn', steer: async () => undefined, compact: async () => undefined, interrupt: async () => undefined, history: async () => [], terminalInput: async () => undefined, save: async () => undefined, changed: () => undefined, failed: error => { throw error } }
  return new LifeHarness(draft.specification, population, service).checkpoint()
}
it('coalesces simultaneous saves and retains changes arriving while the worker is unavailable', async () => {
  const { coordinator, ports } = await setup()
  coordinator.setMetadata(metadata()); await coordinator.flush()
  let release!: () => void
  ports[0].saveGate = new Promise(resolve => { release = resolve })
  coordinator.initializeLife(checkpoint())
  const first = coordinator.flush()
  coordinator.life({ patches: [{ path: ['world', 'turn'], value: 3 }], history: [] })
  const saves = [coordinator.flush(), coordinator.flush(), coordinator.flush()]
  expect(coordinator.status).toMatchObject({ revision: 3, savedRevision: 1, state: 'saving' })
  expect(coordinator.status.unsavedBytes).toBeGreaterThan(0)
  release(); await Promise.all([first, ...saves])
  expect(coordinator.status).toMatchObject({ revision: 3, savedRevision: 3, unsavedBytes: 0, state: 'saved' })
  expect(ports[0].saves).toBeLessThanOrEqual(3)
})
it('retains unsaved data on ENOSPC and saves it on manual retry without pausing life', async () => {
  const { coordinator, ports } = await setup()
  coordinator.setMetadata(metadata()); await coordinator.markDirty()
  coordinator.initializeLife(checkpoint()); ports[0].failSave = true
  await expect(coordinator.flush()).rejects.toThrow('ENOSPC')
  expect(coordinator.status).toMatchObject({ state: 'error', savedRevision: 1, revision: 2 })
  coordinator.life({ patches: [{ path: ['world', 'turn'], value: 4 }], history: [] })
  ports[0].failSave = false; await coordinator.flush()
  expect(coordinator.status).toMatchObject({ state: 'saved', savedRevision: 3, unsavedBytes: 0 })
})
it('reconstructs a crashed worker and reconciles an ACK lost after manifest commit', async () => {
  const root = await directory()
  const { coordinator, ports } = await setup(root)
  coordinator.setMetadata(metadata()); await coordinator.markDirty()
  coordinator.initializeLife(checkpoint()); ports[0].loseAck = true
  await expect(coordinator.flush()).rejects.toThrow('Worker')
  coordinator.life({ patches: [{ path: ['world', 'turn'], value: 6 }], history: [{ kind: 'receipt', key: 'stable-call', value: { fingerprint: 'input', result: { success: true, contentItems: [{ type: 'inputText', text: 'accepted' }] } } }] })
  await coordinator.flush()
  expect(ports).toHaveLength(2)
  const restored = await new PersistenceStore(root).load()
  expect(restored!.run.life!.world.turn).toBe(6)
  expect(Object.keys(restored!.run.life!.receipts)).toEqual(['stable-call'])
  expect(coordinator.status.savedRevision).toBe(3)
})
it('autosaves on the 30 second cadence only when changed and retries errors at the next cadence', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const { coordinator, ports } = await setup()
  coordinator.setMetadata(metadata()); await coordinator.flush()
  await vi.advanceTimersByTimeAsync(30_000); expect(ports[0].saves).toBe(1)
  coordinator.initializeLife(checkpoint()); ports[0].failSave = true
  await vi.advanceTimersByTimeAsync(29_999); expect(ports[0].saves).toBe(1)
  await vi.advanceTimersByTimeAsync(1); expect(coordinator.status.state).toBe('error')
  ports[0].failSave = false
  await vi.advanceTimersByTimeAsync(30_000)
  await vi.waitFor(() => expect(coordinator.status.state).toBe('saved'))
  expect(coordinator.status.savedRevision).toBe(2)
})
it('keeps dirty across autosaves, rejects mutation after abnormal exit, and permits clean restoration', async () => {
  const root = await directory()
  const { coordinator } = await setup(root)
  coordinator.setMetadata(metadata()); await coordinator.markDirty()
  coordinator.initializeLife(checkpoint()); await coordinator.flush()
  const dirty = await setup(root)
  expect(dirty.loaded!.manifest.dirty).toBe(true)
  expect(dirty.coordinator.status.readOnlyReason).toContain('閲覧専用')
  await expect(dirty.coordinator.markDirty()).rejects.toThrow('閲覧専用')
  await dirty.coordinator.close()
  await coordinator.flush(true)
  const clean = await setup(root)
  expect(clean.loaded!.manifest.dirty).toBe(false)
  expect(clean.coordinator.status.readOnlyReason).toBeNull()
})
it.each(['history', 'snapshot', 'manifest'])('loads only the committed generation after a failure writing %s', async failedStage => {
  const root = await directory(), store = new PersistenceStore(root)
  store.apply({ revision: 1, kind: 'metadata', value: metadata() }); store.apply({ revision: 2, kind: 'initializeLife', value: checkpoint() })
  const baseline = await store.save(true)
  store.apply({ revision: 3, kind: 'life', value: { patches: [{ path: ['world', 'turn'], value: 7 }], history: [{ kind: 'event', value: { sequence: 1, turn: 7, kind: 'move', actorId: 'npc0', text: 'moved', recipients: [], locationId: 'home', position: { x: 1, y: 0, z: 0 } } }] } })
  const writer = store as unknown as { write(relative: string, text: string): Promise<number> }
  const original = writer.write.bind(store)
  const spy = vi.spyOn(writer, 'write').mockImplementation((relative, text) => {
    if (relative.startsWith(failedStage)) throw new Error(`power loss: ${failedStage}`)
    return original(relative, text)
  })
  await expect(store.save(true)).rejects.toThrow('power loss')
  const loaded = await new PersistenceStore(root).load()
  expect(loaded!.manifest).toEqual(baseline.manifest)
  expect(loaded!.run.life!.world.turn).toBe(0)
  spy.mockRestore(); await store.save(true)
  const after = await new PersistenceStore(root).load()
  expect(after!.run.life!.world.turn).toBe(7)
  expect(after!.run.life!.world.events.map(event => event.sequence)).toEqual([1])
  expect(after!.manifest.segments).toHaveLength(1)
  const snapshot = JSON.parse(await readFile(path.join(root, `persistence/snapshot-${after!.manifest.slot}.json`), 'utf8'))
  expect(snapshot.life.world.events).toEqual([])
})
