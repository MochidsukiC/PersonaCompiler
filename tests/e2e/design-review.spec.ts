import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { emptyPreparation, type BackendCommand, type BackendSnapshot } from '../../src/core/contracts'
import { draft, models, population, settings } from '../backend/fixtures'

for (const action of ['continue', 'correct'] as const) test(`design difference choice: ${action}`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/design-review-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(root, 'profile')}`], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: path.join(root, 'runs'), PERSONA_CODEX_HOME: path.join(root, 'codex') } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const backend: BackendSnapshot = { connection: 'connected', authenticated: false, authMode: 'chatgpt', models, settings, login: null, error: null, preparation: {
      ...emptyPreparation(), phase: 'generating', paused: true, draft, lock: { revision: 1, hash: 'fixture', approvedAt: '2026-09-14T00:00:00Z' }, designReview: {
        id: 'design-fixture', sourceHash: 'fixture', specificationHash: 'fixture', population, decision: 'pending', decidedAt: null, instruction: '',
        issues: [{ code: 'population.ageDistribution', message: '年齢分布が承認済みの人口配分と一致しません', details: [{ label: '0〜17歳', expected: 2, actual: 1 }, { label: '18〜90歳', expected: 3, actual: 4 }] }]
      }
    } }
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot = { ...fixture.original, version: fixture.original.version + 1000, backend: fixture.backend }
      const commands: BackendCommand[] = []
      const publish = () => { snapshot.version++; BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot }) }
      for (const channel of ['backend-command', 'backend-status']) ipcMain.removeHandler(`persona:${channel}`)
      ipcMain.handle('persona:backend-status', () => ({ ...snapshot.backend, commands }))
      ipcMain.handle('persona:backend-command', (_event, command: BackendCommand) => {
        commands.push(command)
        if (command.type !== 'resolveDesign') throw new Error('Unexpected fixture command')
        snapshot.backend.preparation.designReview!.decision = command.action === 'continue' ? 'accepted' : 'correctionRequested'
        snapshot.backend.preparation.paused = false
        publish(); return snapshot.backend
      })
      ipcMain.on('fixture:allow-design', () => { snapshot.backend.authenticated = true; publish() })
      publish()
    }, { original, backend })
    const panel = page.getByRole('region', { name: '設計との差異' })
    await expect(panel.getByRole('row', { name: '0〜17歳 2人 1人' })).toBeVisible()
    await expect(panel.getByRole('button', { name: '気にせず続行' })).toBeDisabled()
    await expect(panel.getByRole('button', { name: '訂正を指示' })).toBeDisabled()
    await expect(page.getByText('表示データは最新ではありません。', { exact: false })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存済みの状態から再開' })).toHaveCount(0)
    await app.evaluate(({ ipcMain }) => ipcMain.emit('fixture:allow-design'))
    if (action === 'correct') await panel.getByLabel('訂正指示への追記').fill('年齢配分だけを訂正してください')
    await page.screenshot({ path: test.info().outputPath(`design-${action}.png`) })
    await panel.getByRole('button', { name: action === 'continue' ? '気にせず続行' : '訂正を指示', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText(action === 'continue' ? 'この差異を許容して続行しました。' : '親Agentに訂正を指示しました。')
    const received = await page.evaluate(() => window.persona.backendStatus()) as BackendSnapshot & { commands: BackendCommand[] }
    expect(received.commands).toEqual([{ type: 'resolveDesign', reviewId: 'design-fixture', action, message: action === 'continue' ? '' : '年齢配分だけを訂正してください' }])
  } finally { await app.close() }
})
