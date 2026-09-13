import { expect, it } from 'vitest'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { LifeHarness, type LifeServices } from '../../src/core/life-harness'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { emptyPreparation } from '../../src/core/contracts'
import type { LifeChange } from '../../src/core/persistence'
import { draft, population } from './fixtures'

const services = (): LifeServices => ({ async start() { throw new Error('Unexpected inference') }, async steer() {}, async compact() {}, async interrupt() {}, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed(error) { throw error } })
function queuedWorld() {
  const checkpoint = new LifeHarness(draft.specification, population, services()).checkpoint()
  checkpoint.world.stage = 'paused'
  checkpoint.active.npc0 = { turnId: 'turn-0', kind: 'normal', compactSeen: false }
  checkpoint.jobs = Array.from({ length: 1000 }, (_, i) => ({ id: `queued-${i}`, agentId: 'npc0', text: '配信待ちの会話'.repeat(60), kind: 'message' as const, status: 'running' as const, turnId: i === 0 ? 'turn-0' : `turn-${i}`, completed: false }))
  return checkpoint
}

it('allows event-loop callbacks to run while a large burst of life requests is still being processed', async () => {
  const harness = new LifeHarness(draft.specification, population, { ...services(), memory: { initialize() {}, changed() {} } }, queuedWorld())
  let completed = 0, observed = -1
  const timer = setTimeout(() => { observed = completed }, 0)
  try {
    const results = await Promise.all(Array.from({ length: 120 }, (_, i) => harness.tool('npc0', { turnId: 'turn-0', callId: `read-${i}`, tool: 'getSituation', arguments: {} }).then(value => { completed++; return value })))
    expect(results.every(r => r.success)).toBe(true)
    expect(observed).toBeGreaterThanOrEqual(0)
    expect(observed).toBeLessThan(120)
  } finally { clearTimeout(timer); await harness.close(false) }
})

it('persists job updates and removals without repeatedly sending the entire backlog', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/job-patches-'))
  const store = new PersistenceStore(root), checkpoint = queuedWorld(), changes: LifeChange[] = []
  let revision = 0
  store.apply({ revision: ++revision, kind: 'metadata', value: { version: 1, authMode: null, settings: null, preparation: emptyPreparation(), artifactHash: null } })
  store.apply({ revision: ++revision, kind: 'initializeLife', value: structuredClone(checkpoint) })
  const harness = new LifeHarness(draft.specification, population, { ...services(), memory: { initialize() {}, changed(change) { changes.push(change); store.apply({ revision: ++revision, kind: 'life', value: structuredClone(change) }) } } }, checkpoint)
  try {
    harness.notify('npc0', 'turn/completed', { turn: { id: 'turn-0', status: 'interrupted' } })
    await harness.drain()
    expect(harness.checkpoint().jobs).toHaveLength(999)
    harness.notify('npc0', 'turn/completed', { turn: { id: 'turn-500', status: 'interrupted' } })
    await harness.drain()
    expect(harness.checkpoint().jobs).toHaveLength(998)
    expect(changes.flatMap(c => c.patches).some(p => p.path.length === 1 && p.path[0] === 'jobs')).toBe(false)
    await store.save(false)
    const loaded = await new PersistenceStore(root).load()
    expect(loaded!.run.life!.jobs).toEqual(harness.checkpoint().jobs)
    expect(loaded!.run.life!.active).toEqual(harness.checkpoint().active)
  } finally { await harness.close(false) }
})
