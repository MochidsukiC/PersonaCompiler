import { expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { mkdir, mkdtemp, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PersistenceCoordinator } from '../../src/backend/persistence-coordinator'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { applyEconomyTool } from '../../src/core/economy'
import { LifeHarness, type LifeServices } from '../../src/core/life-harness'
import { lifeTransaction } from '../../src/core/life-transaction'
import { emptyPreparation } from '../../src/core/contracts'
import { chicken, personal, savedEconomy, seed } from '../fixtures/economy'
import { draft, population } from '../backend/fixtures'

it('replays unsaved economic changes after native worker termination and restores tool receipts without duplicate payment', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/economy-worker-'))
  const file = (await readdir('out/main')).find(name => /^persistence-worker-.*\.js$/.test(name))
  if (!file) throw new Error('先にnpm run buildを実行してください')
  const workers: Worker[] = []
  const coordinator = new PersistenceCoordinator(root, () => { const worker = new Worker(path.resolve('out/main', file)); workers.push(worker); return worker }, () => undefined)
  try {
    await coordinator.initialize()
    coordinator.setMetadata({ version: 1, lifeVersion: 1, economyVersion: 1, economySeed: seed, authMode: null, settings: null, preparation: emptyPreparation(), artifactHash: null })
    await coordinator.markDirty()
    const initial = savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal()] }] })
    coordinator.initializeLife(initial)
    let world = initial.world
    const args = { itemId: 'chicken', quantity: 2, owner: personal(), storage: { kind: 'carried', actorId: 'npc0' } }
    const acquire = lifeTransaction(world), bought = applyEconomyTool(acquire.draft, 'npc0', 'acquireItem', args)
    world = acquire.value
    const receipt = { fingerprint: JSON.stringify({ name: 'acquireItem', arguments: args }), result: { success: true, contentItems: [{ type: 'inputText' as const, text: JSON.stringify(bought.result) }] } }
    coordinator.life({ patches: [{ path: ['world', 'economy'], value: world.economy }], history: [...bought.records.map(value => ({ kind: 'economy' as const, value })), { kind: 'receipt', key: 'npc0:turn:acquire', value: receipt }] })
    await coordinator.flush()
    await workers[0].terminate()
    const consume = lifeTransaction(world), used = applyEconomyTool(consume.draft, 'npc0', 'useItem', { holdingId: world.economy!.holdings[0].id })
    world = consume.value
    coordinator.life({ patches: [{ path: ['world', 'economy'], value: world.economy }], history: used.records.map(value => ({ kind: 'economy' as const, value })) })
    await coordinator.flush(true)
    expect(workers).toHaveLength(2)
    const saved = (await new PersistenceStore(root).load())!
    expect(saved.manifest.dirty).toBe(false)
    expect(saved.run.life!.world.economy).toEqual(world.economy)
    expect(saved.run.life!.economyArchive!.map(r => r.kind)).toEqual(['acquire', 'use'])
    expect(saved.run.life!.receipts['npc0:turn:acquire']).toEqual(receipt)
    const services: LifeServices = {
      economy: { seed, request: async () => { throw Error('unexpected request') } }, lifecycle: { seed: 'economy-test', birth: async () => { throw Error('unexpected birth') } },
      memory: { initialize() {}, changed() { throw Error('duplicate receipt changed the world') } },
      async start() { return null }, async steer() {}, async compact() {}, async interrupt() {}, async history() { return [] }, async terminalInput() {}, async save() {}, changed() {}, failed(error) { throw error }
    }
    const restored = new LifeHarness(draft.specification, population, services, saved.run.life!)
    expect(await restored.tool('npc0', { turnId: 'turn', callId: 'acquire', tool: 'acquireItem', arguments: args })).toEqual(receipt.result)
    expect(restored.snapshot().economy!.accounts['npc:npc0'].balance).toBe(800)
    expect(restored.snapshot().economy!.holdings[0].quantity).toBe(1)
    await restored.close(false)
  } finally { await coordinator.close() }
}, 30000)
