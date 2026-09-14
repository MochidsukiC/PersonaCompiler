import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import type { SimulationSnapshot } from '../../src/core/life-contracts'
import { draft, population } from '../backend/fixtures'
import { constructedMap } from '../../src/core/construction'
import { emptyPreparation } from '../../src/core/contracts'
import { savedEconomy } from '../fixtures/economy'

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
    simulation.facilities.push({ id: 'built-workshop', locationId: 'built-workshop', name: '星図工房', type: 'workshop', dimensions: { x: 20, y: 20, z: 3 }, layout: { regions: [{ id: 'desk', name: '製図台', description: '星図を描く', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 1 } } }], homes: [], publicState: '利用できます' }, construction: { builderId: 'npc0', organizationId: 'guild', requestedTurn: 1, connectedLocationId: 'home', description: '星図を共同制作する施設' } })
    simulation.facilities.push({ id: 'built-pending', locationId: 'built-pending', name: '個人の観測所', type: 'observatory', dimensions: { x: 10, y: 10, z: 3 }, layout: null, construction: { builderId: 'npc1', organizationId: null, requestedTurn: 1, connectedLocationId: 'home', description: '建設中の施設' } })
    await app.evaluate(({ BrowserWindow }, fixture) => {
      const snapshot = { ...fixture.original, version: fixture.original.version + 1000, state: { ...fixture.original.state, stage: 'paused', map: fixture.map, simulation: fixture.simulation, agents: fixture.simulation.actors.map(a => ({ id: a.id, name: a.name, role: 'npc', parentId: null, sessionId: a.id, status: 'idle', color: '#9dbafa' })), frame: { ...fixture.original.state.frame, mapRevision: fixture.map.revision } } }
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { original, simulation, map: constructedMap(draft.map, simulation.facilities) })
    await page.getByRole('button', { name: '組織', exact: true }).click()
    const panel = page.getByRole('region', { name: '組織一覧' })
    await expect(panel.getByRole('heading', { name: '星図制作ギルド 研究会' })).toBeVisible()
    await expect(panel.getByText('固定の所在地なし')).toBeVisible()
    await expect(panel.getByText('現在の構成員なし')).toBeVisible()
    await expect(panel.getByText('住宅街', { exact: true })).toBeVisible()
    await expect(panel.getByRole('heading', { name: '星図工房 workshop · 利用可能' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: '個人の観測所 observatory · 建設中' })).toBeVisible()
    await panel.locator('article').filter({ has: page.getByRole('heading', { name: '星図制作ギルド 研究会' }) }).getByRole('button', { name: population.npcs[1].name, exact: true }).click()
    await expect(page.getByRole('button', { name: `${population.npcs[1].name}のタブ`, exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('organizations.png') })
    await page.getByRole('button', { name: 'ワールド', exact: true }).click()
    await page.getByRole('button', { name: '星図工房の内部を見る' }).click()
    await expect(page.getByText('座標の用途 · 1領域')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('constructed-facility.png') })
  } finally { await app.close() }
})

test('switches organization and economy tabs without accumulating connected backend panels', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/organization-navigation-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(root, 'profile')}`], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: path.join(root, 'runs'), PERSONA_CODEX_HOME: path.join(root, 'codex') } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const simulation = savedEconomy().world
    simulation.stage = 'paused'
    const preparation = { ...emptyPreparation(), phase: 'ready' as const, draft, population }
    await app.evaluate(({ BrowserWindow }, fixture) => {
      const snapshot = {
        ...fixture.original, version: fixture.original.version + 1000,
        backend: { ...fixture.original.backend!, authenticated: true, connection: 'connected' as const, preparation: fixture.preparation, simulation: fixture.simulation, persistence: undefined },
        state: { ...fixture.original.state, stage: 'paused' as const, map: fixture.map, simulation: fixture.simulation, agents: fixture.simulation.actors.map(a => ({ id: a.id, name: a.name, role: 'npc' as const, parentId: null, sessionId: a.id, status: 'idle' as const, color: '#9dbafa' })), frame: { ...fixture.original.state.frame, mapRevision: fixture.map.revision, positions: Object.fromEntries(fixture.simulation.actors.map(a => [a.id, a.locationId])) } }
      }
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { original, simulation, preparation, map: draft.map })
    await expect(page.getByTestId('world-map')).toBeVisible()
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const tab of ['組織', '経済', 'ワールド', '出来事', '経済', '組織', 'ワールド']) {
        await page.getByRole('button', { name: tab, exact: true }).click()
        await expect(page.locator('.backend-panel')).toHaveCount(tab === '組織' || tab === '出来事' ? 0 : 1)
        await expect(page.getByRole('region', { name: '組織一覧', exact: true })).toHaveCount(tab === '組織' ? 1 : 0)
        await expect(page.getByRole('region', { name: '経済', exact: true })).toHaveCount(tab === '経済' ? 1 : 0)
        await expect(page.getByTestId('world-map')).toHaveCount(tab === 'ワールド' ? 1 : 0)
        if (tab === '組織') await expect(page.getByText('まだ組織はありません。対応する住民が生活中に設立すると、ここに表示されます。')).toBeVisible()
        if (tab === '経済') await expect(page.getByRole('heading', { name: '経済・アイテム' })).toBeInViewport()
        if (tab === 'ワールド') await expect(page.getByTestId('world-map')).toBeInViewport()
      }
    }
    expect(errors).toEqual([])
  } finally { await app.close() }
})
