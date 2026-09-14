import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import type { SimulationSnapshot } from '../../src/core/life-contracts'
import { draft, population } from '../backend/fixtures'

test('shows scheduled, cancelled and immediate world events with actual recipients', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/world-events-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(root, 'profile')}`], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: path.join(root, 'runs'), PERSONA_CODEX_HOME: path.join(root, 'codex') } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const simulation: SimulationSnapshot = {
      version: 1, revision: 1, stage: 'paused', phase: 'activity', turn: 1, day: 1, time: 'morning', step: true, error: null,
      facilities: draft.specification.town.facilities.map(f => ({ ...f, dimensions: f.dimensions!, layout: null })),
      actors: population.npcs.map(n => ({ id: n.id, name: n.name, householdId: n.householdId, locationId: n.locationId, position: null, activity: 'ended', nextFacilityId: null, wakeAt: null, compact: 'none' })),
      worldEvents: [
        { id: 'festival', title: '星祭り', type: '祭事', description: '星空の下で祭りが始まる', target: { scope: 'location', locationId: 'home' }, createdTurn: 1, scheduledFor: { day: 2, time: 'night' }, status: 'scheduled', eventSequence: null },
        { id: 'cancelled', title: '遠征', type: '探索', description: '遠征を予定', target: { scope: 'actors', actorIds: ['npc0'] }, createdTurn: 1, scheduledFor: { day: 3, time: 'morning' }, status: 'cancelled', eventSequence: null },
        { id: 'sudden', title: '流星', type: '天候', description: '<script>星が流れる</script>', target: { scope: 'world' }, createdTurn: 1, scheduledFor: null, status: 'occurred', eventSequence: 1 }
      ],
      events: [{ sequence: 1, turn: 1, kind: 'world', actorId: 'parent', text: '流星（天候）\n空を見上げると星が流れた', recipients: ['npc0'], locationId: null, position: null, worldEventId: 'sudden' }]
    }
    await app.evaluate(({ BrowserWindow }, fixture) => {
      const snapshot = { ...fixture.original, version: fixture.original.version + 1000, state: { ...fixture.original.state, stage: 'paused', map: fixture.map, simulation: fixture.simulation, agents: fixture.simulation.actors.map(a => ({ id: a.id, name: a.name, role: 'npc', parentId: null, sessionId: a.id, status: 'idle', color: '#9dbafa' })) } }
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { original, simulation, map: draft.map })
    await page.getByRole('button', { name: '出来事', exact: true }).click()
    const plans = page.getByRole('region', { name: '親セッションの世界イベント' })
    await expect(plans.getByText('予約中', { exact: true })).toBeVisible()
    await expect(plans.getByText('2日目・夜', { exact: true })).toBeVisible()
    await expect(plans.getByText('取消済み', { exact: true })).toBeVisible()
    await expect(plans.getByText('発生済み', { exact: true })).toBeVisible()
    await expect(plans.getByText('<script>星が流れる</script>', { exact: true })).toBeVisible()
    await page.getByLabel('出来事の種類').selectOption('world')
    const record = page.locator('.event-list .event-world')
    await expect(record).toHaveCount(1)
    await expect(record.getByText('イベント通知 · 受信対象 1人')).toBeVisible()
    await expect(record.getByRole('button', { name: population.npcs[0].name, exact: true })).toBeVisible()
    await page.getByRole('region', { name: '出来事の検索' }).screenshot({ path: '.local/polish-20260914/world-events-ui.png' })
  } finally { await app.close() }
})
