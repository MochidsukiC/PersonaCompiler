import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PersistenceStore } from '../../src/backend/persistence-store'
import { emptyPreparation } from '../../src/core/contracts'
import { addCompany, applyEconomyTool } from '../../src/core/economy'
import { chicken, personal, savedEconomy, seed } from '../fixtures/economy'
import { draft, population, settings } from '../backend/fixtures'

test('observes saved assets, vital states, company accounts and item provenance without model access', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/economy-')), runId = crypto.randomUUID(), root = path.join(base, 'runs', runId)
  await mkdir(root, { recursive: true })
  const saved = savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal()] }], holdings: [{ npcId: 'npc0', itemId: 'chicken', quantity: 2 }] })
  const offered = applyEconomyTool(saved.world, 'npc0', 'offerItem', { holdingId: saved.world.economy!.holdings[0].id, quantity: 1, unitPrice: 0, targetId: 'npc1' }).result as { offer: { id: string } }
  const gift = applyEconomyTool(saved.world, 'npc1', 'buyItem', { offerId: offered.offer.id, quantity: 1, owner: personal('npc1'), storage: { kind: 'carried', actorId: 'npc1' } })
  saved.economyArchive!.push(...gift.records)
  saved.world.economy!.vitals.npc1 = { hp: 60, hunger: 30, san: 0, heirId: 'npc2', lastWorkTurn: null }
  saved.world.organizations = [{ id: 'farm', name: '町の農場', type: '会社', purpose: '生産と出荷', founderId: 'npc0', foundedTurn: 1, locationId: 'office', members: ['npc0', 'npc1'] }]
  addCompany(saved.world.economy!, 'farm', 'npc0')
  saved.world.economy!.accounts['organization:farm'] = { balance: 400, sales: 200, exports: 250, purchases: 200, wages: 50 }
  const p = emptyPreparation()
  p.phase = 'ready'; p.draft = draft; p.population = population
  p.sessions = population.npcs.map(n => ({ agentId: n.id, sessionId: n.id, role: 'npc', threadId: `thread-${n.id}`, cwd: path.join(root, 'agents', n.id), modelId: n.birthModelId, effort: 'medium', creation: 'initialized', seedPersisted: true, economyVersion: 1, lifecycleVersion: 1, lifeToolsVersion: 1, persistenceVersion: 2 }))
  const store = new PersistenceStore(root)
  store.apply({ kind: 'metadata', revision: 1, value: { version: 1, lifeVersion: 1, lifecycleVersion: 1, economyVersion: 1, economySeed: seed, authMode: null, settings, preparation: p, artifactHash: null } })
  store.apply({ kind: 'initializeLife', revision: 2, value: saved })
  await store.save(true)
  await writeFile(path.join(base, 'runs', 'active-run.json'), JSON.stringify({ runId }))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(base, 'profile')}`], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: path.join(base, 'runs'), PERSONA_CODEX_HOME: path.join(base, 'codex') } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '経済', exact: true }).click()
    const panel = page.getByRole('region', { name: '経済', exact: true })
    await expect(panel.getByRole('heading', { name: 'ファミチキ', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '最新100件を読む・更新' }).click()
    await expect(panel.getByText('ファミチキ ×1を贈り物として受け取りました', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: /住民1/ }).click()
    await page.getByRole('button', { name: '持ち物・状態', exact: true }).click()
    const person = page.getByRole('region', { name: '持ち物・状態', exact: true })
    await expect(person.getByText('60 / 100', { exact: true })).toBeVisible()
    await expect(person.getByText('0 / 100', { exact: true })).toBeVisible()
    await expect(person.getByText('相続先: 住民2', { exact: true })).toBeVisible()
    await person.getByRole('button', { name: '所持品の来歴を読む・更新' }).click()
    await expect(person.getByText('ファミチキ ×1を贈り物として受け取りました', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('economy-inventory.png') })
    await page.getByRole('button', { name: '組織', exact: true }).click()
    await expect(page.getByText('経営者: 住民0', { exact: true })).toBeVisible()
    await expect(page.getByText('400 円', { exact: true })).toBeVisible()
    await expect(page.getByText('差引収支', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('economy-company.png') })
    expect(await page.evaluate(() => window.persona.backendStatus().then(s => s.persistence?.state))).toBe('readOnly')
  } finally { await app.close() }
})
