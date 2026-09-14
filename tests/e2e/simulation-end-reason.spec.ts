import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { emptyPreparation, type BackendSnapshot } from '../../src/core/contracts'
import type { SimulationSnapshot } from '../../src/core/life-contracts'
import type { Lifecycle } from '../../src/core/lifecycle-contracts'
import { initializeLifecycle } from '../../src/core/lifecycle'
import { draft, population, models, settings } from '../backend/fixtures'

test('shows the saved simulation end reason consistently without inferring one for legacy data', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/simulation-end-reason-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const simulation: SimulationSnapshot = { version: 1, revision: 1, stage: 'ended', phase: 'complete', turn: 12, day: 3, time: 'night', step: false, error: null, events: [], facilities: [], actors: [], lifecycle: initializeLifecycle(population, 'fixture') }
    const backend: BackendSnapshot = { connection: 'connected', authMode: 'chatgpt', authenticated: true, login: null, models, settings, preparation: { ...emptyPreparation(), phase: 'ready' }, error: null, simulation }
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot = { ...fixture.original, backend: fixture.backend, state: { ...fixture.original.state, stage: 'ended' as const, map: fixture.map, simulation: fixture.simulation } }
      const publish = () => { snapshot.version++; BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot }) }
      ipcMain.removeHandler('persona:snapshot'); ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.on('fixture:end-reason', (_event, reason: Lifecycle['endReason'] | 'legacy') => {
        snapshot.state.simulation = { ...fixture.simulation, revision: snapshot.state.simulation.revision + 1 }
        if (reason === 'legacy') delete snapshot.state.simulation.lifecycle
        else snapshot.state.simulation.lifecycle = { ...fixture.simulation.lifecycle!, endReason: reason,
          residents: fixture.simulation.lifecycle!.residents.map(resident => ({ ...resident, generation: reason === 'generation_zero_extinction' ? 1 : 0, diedTurn: reason === 'population_extinction' ? 12 : null })) }
        snapshot.backend.simulation = snapshot.state.simulation
        publish()
      })
      publish()
    }, { original, backend, simulation, map: draft.map })
    const heading = page.locator('.backend-panel.life-summary .backend-heading strong')
    for (const [reason, label] of [
      ['population_extinction', '全住民死亡'], ['generation_zero_extinction', '初期世代の全員死亡'],
      ['turn_limit', '指定ターンに到達'], [null, 'シミュレーションが終了しました'], ['legacy', 'シミュレーションが終了しました']
    ] as const) {
      await app.evaluate(({ ipcMain }, value) => ipcMain.emit('fixture:end-reason', {}, value), reason)
      await expect(heading).toHaveText(label)
      await expect(heading).toBeVisible()
      if (reason && reason !== 'legacy') await expect(page.getByTestId('end-reason')).toHaveText(label)
      else await expect(page.getByTestId('end-reason')).toHaveCount(0)
      if (reason === 'population_extinction') await page.screenshot({ path: test.info().outputPath('simulation-end-reason.png') })
    }
    expect(errors).toEqual([])
  } finally { await app.close() }
})
