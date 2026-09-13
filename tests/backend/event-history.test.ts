import { expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readEventHistory } from '../../src/backend/event-history'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { Workspace } from '../../src/main/workspace'
import { LifeHarness } from '../../src/core/life-harness'
import { emptyPreparation } from '../../src/core/contracts'
import { emptyEventFilter, eventHistoryQuerySchema, type EventHistoryQuery } from '../../src/core/event-search'
import type { SimulationSnapshot } from '../../src/core/life-contracts'
import { draft, population } from './fixtures'

const event = (sequence: number): SimulationSnapshot['events'][number] => ({ sequence, turn: sequence === 1 ? 0 : 4, kind: 'speech', actorId: 'npc0', text: sequence === 1 ? '最初の日に交わした約束' : `会話${sequence}`, recipients: sequence % 2 ? ['npc1'] : [], locationId: 'home', position: null })
async function setup() {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/event-history-'))
  const harness = new LifeHarness(draft.specification, population, { async start() { return '' }, async steer() {}, async compact() {}, async interrupt() {}, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed() {} })
  const checkpoint = harness.checkpoint()
  checkpoint.world.events = Array.from({ length: 120 }, (_, index) => event(index + 1))
  const store = new PersistenceStore(root)
  store.apply({ revision: 1, kind: 'metadata', value: { version: 1, lifeVersion: 1, authMode: null, settings: null, preparation: emptyPreparation(), artifactHash: null } })
  store.apply({ revision: 2, kind: 'initializeLife', value: checkpoint }); await store.save(true)
  store.apply({ revision: 3, kind: 'life', value: { patches: [], history: Array.from({ length: 120 }, (_, index) => ({ kind: 'event', value: event(index + 121) })) } }); await store.save(true)
  const workspace = new Workspace(root, { runId: path.basename(root), stage: 'paused', agents: [], map: null, frame: { revision: 0, turn: 4, day: 1, phase: 'night', mapRevision: null, positions: {} }, relationships: null }, () => undefined, true)
  const query: EventHistoryQuery = { runId: path.basename(root), filter: emptyEventFilter, revision: null, offset: 0 }
  return { root, workspace, store, simulation: checkpoint.world, query }
}

it('reads beyond the recent window and keeps pagination stable while new saves arrive', async () => {
  const { root, workspace, store, simulation, query } = await setup()
  const first = await readEventHistory(workspace, simulation, query)
  expect(first.total).toBe(240)
  expect(first.events.map(e => e.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => 240 - index))
  store.apply({ revision: 4, kind: 'life', value: { patches: [], history: [{ kind: 'event', value: event(241) }] } }); await store.save(true)
  const second = await readEventHistory(workspace, simulation, { ...query, revision: first.revision, offset: 100 })
  const third = await readEventHistory(workspace, simulation, { ...query, revision: first.revision, offset: 200 })
  expect(second.total).toBe(240)
  expect([...first.events, ...second.events, ...third.events].map(e => e.sequence)).toEqual(Array.from({ length: 240 }, (_, index) => 240 - index))
  const before = await readFile(path.join(root, 'persistence/manifest.json'), 'utf8')
  const updated = await readEventHistory(workspace, simulation, query)
  expect(updated.total).toBe(241)
  expect(updated.events[0].sequence).toBe(241)
  expect(await readFile(path.join(root, 'persistence/manifest.json'), 'utf8')).toBe(before)
})

it('combines recipient, turn zero and text filters across every saved segment', async () => {
  const { workspace, simulation, query } = await setup()
  const ancient = await readEventHistory(workspace, simulation, { ...query, filter: { actorId: 'npc1', kind: 'speech', turn: '0', query: '約束' } })
  expect(ancient.events.map(e => e.sequence)).toEqual([1])
  const unheard = await readEventHistory(workspace, simulation, { ...query, filter: { ...emptyEventFilter, kind: 'unheard' } })
  expect(unheard.total).toBe(120)
  expect(unheard.events.every(e => e.recipients.length === 0)).toBe(true)
  const missing = await readEventHistory(workspace, simulation, { ...query, filter: { ...emptyEventFilter, query: '該当しない' } })
  expect(missing).toMatchObject({ total: 0, events: [] })
})

it('rejects changed worlds, invalid queries and corrupt committed history', async () => {
  const { root, workspace, simulation, query } = await setup()
  await expect(readEventHistory(workspace, simulation, { ...query, runId: 'other-run' })).rejects.toThrow('切り替わりました')
  await expect(readEventHistory(workspace, simulation, { ...query, revision: 999 })).rejects.toThrow('存在しません')
  expect(() => eventHistoryQuerySchema.parse({ ...query, offset: -1 })).toThrow()
  expect(() => eventHistoryQuerySchema.parse({ ...query, filter: { ...emptyEventFilter, turn: '-1' } })).toThrow()
  expect(() => eventHistoryQuerySchema.parse({ ...query, path: '../other-run' })).toThrow()
  const manifest = JSON.parse(await readFile(path.join(root, 'persistence/manifest.json'), 'utf8'))
  await writeFile(path.join(root, 'persistence', manifest.segments[0].file), 'changed')
  await expect(readEventHistory(workspace, simulation, query)).rejects.toThrow('履歴hash')
})
