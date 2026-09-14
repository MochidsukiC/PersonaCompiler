import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import type { SimulationSnapshot } from '../../src/core/life-contracts'
import { draft, population } from '../backend/fixtures'

test('shows organizations, optional locations and member conversations', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/organizations-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(root, 'profile')}`], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: path.join(root, 'runs'), PERSONA_CODEX_HOME: path.join(root, 'codex') } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const simulation: SimulationSnapshot = {
      version: 1, revision: 1, stage: 'paused', phase: 'activity', turn: 1, day: 1, time: 'morning', step: true, error: null, events: [],
      facilities: draft.specification.town.facilities.map(f => ({ ...f, dimensions: f.dimensions!, layout: null })),
      actors: population.npcs.map(n => ({ id: n.id, name: n.name, householdId: n.householdId, locationId: n.locationId, position: null, activity: 'ended', nextFacilityId: null, wakeAt: null, compact: 'none' })),
      organizations: [{ id: 'guild', name: '星図制作ギルド', type: '研究会', purpose: '住民で星図を作る', founderId: 'npc0', foundedTurn: 1, members: ['npc0', 'npc1'], locationId: null }, { id: 'company', name: '共同工房', type: '会社', purpose: '道具を共同制作する', founderId: 'npc2', foundedTurn: 1, members: [], locationId: 'home' }]
    }
    await app.evaluate(({ BrowserWindow }, fixture) => {
      const snapshot = { ...fixture.original, version: fixture.original.version + 1000, state: { ...fixture.original.state, stage: 'paused', map: fixture.map, simulation: fixture.simulation, agents: fixture.simulation.actors.map(a => ({ id: a.id, name: a.name, role: 'npc', parentId: null, sessionId: a.id, status: 'idle', color: '#9dbafa' })), frame: { ...fixture.original.state.frame, mapRevision: fixture.map.revision } } }
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { original, simulation, map: draft.map })
    await page.getByRole('button', { name: '組織', exact: true }).click()
    const panel = page.getByRole('region', { name: '組織一覧' })
    await expect(panel.getByRole('heading', { name: '星図制作ギルド 研究会' })).toBeVisible()
    await expect(panel.getByText('固定の所在地なし')).toBeVisible()
    await expect(panel.getByText('現在の構成員なし')).toBeVisible()
    await expect(panel.getByText('住宅街', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: population.npcs[1].name, exact: true }).click()
    await expect(page.getByRole('button', { name: `${population.npcs[1].name}のタブ`, exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('organizations.png') })
  } finally { await app.close() }
})
