import { expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Workspace, digest } from '../../src/main/workspace'
import type { RunState } from '../../src/shared/contracts'
import { emptyPreparation } from '../../src/core/contracts'
import { DevStore } from '../../src/backend/dev-store'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { LifeHarness } from '../../src/core/life-harness'
import { draft, population } from './fixtures'

async function workspace() {
  await mkdir('.local/tests', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/tests/dev-store-')), root = path.join(base, randomUUID())
  await mkdir(root)
  const state: RunState = { runId: path.basename(root), stage: 'draft', agents: [], map: null, relationships: null, frame: { turn: 0, revision: 0, day: 1, phase: 'morning', mapRevision: null, positions: {} } }
  return new Workspace(root, state, () => undefined, true)
}
it('pins persistence generations and history independently of alternating snapshot slots', async () => {
  const source = await workspace(), target = await workspace(), persistence = new PersistenceStore(source.root)
  persistence.apply({ revision: 1, kind: 'metadata', value: { version: 1, lifeVersion: 1, authMode: null, settings: null, preparation: emptyPreparation(), artifactHash: null } })
  const life = new LifeHarness(draft.specification, population, { start: async () => 'turn', steer: async () => undefined, compact: async () => undefined, interrupt: async () => undefined, history: async () => [], terminalInput: async () => undefined, save: async () => undefined, changed: () => undefined, failed: error => { throw error } }).checkpoint()
  persistence.apply({ revision: 2, kind: 'initializeLife', value: life })
  persistence.apply({ revision: 3, kind: 'life', value: { patches: [], history: [{ kind: 'event', value: { sequence: 1, turn: 0, actorId: 'npc0', kind: 'move', text: 'PAST', recipients: [], locationId: 'home', position: null } }] } })
  await persistence.save(true); await source.write('artifact.txt', 'OLD_ARTIFACT')
  const store = new DevStore(source), info = await store.capture('before world', 0, 0, {})
  await source.write('artifact.txt', 'FUTURE_ARTIFACT')
  for (let revision = 4; revision < 7; revision++) {
    persistence.apply({ revision, kind: 'life', value: { patches: [{ path: ['world', 'turn'], value: revision }], history: [] } })
    await persistence.save(true)
  }
  const point = await store.read(info.id), restored = await store.restore(point, target)
  await DevStore.publish(target, restored.manifest, restored.run, false)
  const loaded = await new PersistenceStore(target.root).load()
  expect(loaded?.run.life?.world.turn).toBe(0)
  expect(loaded?.run.life?.world.events.map(e => e.text)).toEqual(['PAST'])
  expect(await target.read('artifact.txt')).toBe('OLD_ARTIFACT')
  expect(await source.read('artifact.txt')).toBe('FUTURE_ARTIFACT')
})
it('rejects corrupt blobs, modified checkpoint metadata and paths outside the branch', async () => {
  const source = await workspace(), target = await workspace(), persistence = new PersistenceStore(source.root)
  persistence.apply({ revision: 1, kind: 'metadata', value: { version: 1, authMode: null, settings: null, preparation: emptyPreparation(), artifactHash: null } })
  await persistence.save(false); await source.write('artifact.txt', 'ORIGINAL')
  const store = new DevStore(source), info = await store.capture('point', 0, 0, {}), point = await store.read(info.id)
  const file = point.files.find(f => f.path === 'artifact.txt')!
  await expect(store.restore({ ...point, files: [{ ...file, path: '../escape.txt' }] }, target)).rejects.toThrow('相対パス')
  await source.write(`dev/blobs/${file.hash}`, 'CORRUPT')
  await expect(store.restore(point, target)).rejects.toThrow('hash不一致')
  const envelope = JSON.parse(await source.read(`dev/checkpoints/${info.id}.json`))
  envelope.value.info.label = 'modified'
  await source.write(`dev/checkpoints/${info.id}.json`, JSON.stringify(envelope))
  await expect(store.read(info.id)).rejects.toThrow('整合性')
  expect(digest(await readFile(path.join(source.root, 'artifact.txt')))).toBe(file.hash)
})
