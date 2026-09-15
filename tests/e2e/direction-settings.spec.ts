import { expect, test, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { defaultDirectionSettings } from '../../src/core/direction-settings'
import { defaultQuestSettings } from '../../src/core/quest-settings'
import { emptyPreparation, type BackendCommand, type BackendSnapshot } from '../../src/core/contracts'
import type { WorkspaceSnapshot } from '../../src/shared/contracts'
import { draft, models, population, settings as modelSettings } from '../backend/fixtures'

test('direction settings UI preserves legacy snapshots and saves world, region and NPC overrides with CAS', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/direction-settings-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: root } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const legacyBackend: BackendSnapshot = {
      connection: 'connected', authMode: 'chatgpt', authenticated: true, login: null,
      models, settings: modelSettings, preparation: emptyPreparation(), error: null
    }
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot: WorkspaceSnapshot = { ...fixture.original, backend: fixture.backend }
      const state = globalThis as unknown as { directionUiFixture: { snapshot: WorkspaceSnapshot; commands: BackendCommand[] } }
      state.directionUiFixture = { snapshot, commands: [] }
      const publish = () => {
        snapshot.version++
        BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
      }
      for (const channel of ['snapshot', 'backend-status', 'backend-command']) ipcMain.removeHandler(`persona:${channel}`)
      ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.handle('persona:backend-status', () => ({ ...snapshot.backend!, commands: state.directionUiFixture.commands }))
      ipcMain.handle('persona:backend-command', (_event, command: BackendCommand) => {
        state.directionUiFixture.commands.push(command)
        if (command.type !== 'directionSettings') throw new Error('Unexpected backend command')
        const current = snapshot.backend!.directionSettings!
        if (command.expectedRevision !== current.revision) throw new Error(`会話演出設定が更新されています（expected ${command.expectedRevision}, current ${current.revision}）`)
        snapshot.backend!.directionSettings = { ...command.settings, revision: current.revision + 1 }
        publish()
        return snapshot.backend
      })
      publish()
    }, { original, backend: legacyBackend })

    await page.getByText('会話演出設定', { exact: true }).click()
    await expect(page.getByText('未設定（従来動作）です。', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: '会話演出設定を保存' })).toHaveCount(0)

    await app.evaluate(({ BrowserWindow }, fixture) => {
      const state = globalThis as unknown as { directionUiFixture: { snapshot: WorkspaceSnapshot } }
      const snapshot = state.directionUiFixture.snapshot
      snapshot.backend!.directionSettings = { ...fixture.settings, revision: 4 }
      snapshot.backend!.questSettings = fixture.quests
      snapshot.backend!.preparation = { ...snapshot.backend!.preparation, phase: 'ready', population: fixture.population }
      snapshot.state.map = fixture.map
      snapshot.state.frame.mapRevision = fixture.map.revision
      snapshot.state.stage = 'paused'
      snapshot.state.agents = fixture.population.npcs.map(npc => ({ id: npc.id, sessionId: npc.id, role: 'npc' as const, parentId: null, name: npc.name, status: 'idle' as const, color: '#b0c0f4' }))
      snapshot.state.frame.positions = Object.fromEntries(fixture.population.npcs.map(npc => [npc.id, npc.locationId]))
      snapshot.version++
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { settings: defaultDirectionSettings(), quests: defaultQuestSettings(), population, map: draft.map })

    await expect(page.getByText('会話演出設定 · revision 4', { exact: true })).toBeVisible()
    await page.getByLabel('ワールド Tier').selectOption('1')
    await page.getByText('地域別 override', { exact: false }).click()
    await page.getByLabel('地域 町 profile').selectOption('comedy')
    await page.getByText('NPC個別 override', { exact: false }).click()
    await page.getByLabel('NPC 住民0 intensity').selectOption('3')
    await expect(page.getByText('Tier 1 · コメディ · 強度 3 · 自由', { exact: true })).toBeVisible()
    await page.getByTestId('direction-settings').screenshot({ path: path.join(root, 'direction-settings.png') })
    await page.getByRole('button', { name: '会話演出設定を保存' }).click()
    await expect(page.getByText('会話演出設定 · revision 5', { exact: true })).toBeVisible()

    await page.getByText('クエスト・台詞directive · revision 0', { exact: true }).click()
    await page.getByRole('button', { name: '追加', exact: true }).click()
    await page.getByLabel('クエスト名称').fill('なくした鍵を探して')
    await expect(page.getByLabel('クエスト段階')).toBeDisabled()
    await expect(page.getByLabel('クエスト段階')).toHaveValue('受注前')
    await page.getByLabel('受注前 発話方式').selectOption('fixed')
    await page.getByLabel('受注前 固定台詞').fill('鍵は古い噴水のそばで落としたと思うの。見つけたら持ってきてくれる？')
    if (process.env.PERSONA_SCREENSHOT_DIR) await page.getByTestId('quest-editor').screenshot({ path: path.join(process.env.PERSONA_SCREENSHOT_DIR, 'quest-editor.png') })

    const captured = await page.evaluate(() => window.persona.backendStatus()) as BackendSnapshot & { commands: BackendCommand[] }
    expect(captured.commands).toEqual([{
      type: 'directionSettings', expectedRevision: 4,
      settings: {
        version: 1,
        world: { tier: 1, directionProfile: 'classic', expressionIntensity: 0, dialogueMode: 'free' },
        regions: { town: { directionProfile: 'comedy' } },
        npcs: { npc0: { expressionIntensity: 3 } }
      }
    }])

    await page.getByLabel('ワールド dialogue mode').selectOption('semi_fixed')
    await app.evaluate(() => {
      const state = globalThis as unknown as { directionUiFixture: { snapshot: WorkspaceSnapshot } }
      state.directionUiFixture.snapshot.backend!.directionSettings!.revision++
    })
    await page.getByRole('button', { name: '会話演出設定を保存' }).click()
    await expect(page.getByRole('alert')).toContainText('会話演出設定が更新されています')

    await app.evaluate(({ BrowserWindow }) => {
      const state = globalThis as unknown as { directionUiFixture: { snapshot: WorkspaceSnapshot } }
      const snapshot = state.directionUiFixture.snapshot
      snapshot.backend!.persistence = {
        state: 'readOnly', revision: 1, savedRevision: 1, savedAt: null, unsavedSince: null,
        unsavedBytes: 0, error: null, readOnlyReason: '別のプロセスで開かれています', bytesWritten: 0, saveDurationMs: 0
      }
      snapshot.version++
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    })
    await expect(page.getByTestId('direction-settings').getByText('読み取り専用のため変更できません。', { exact: true })).toBeVisible()
    await expect(page.getByLabel('ワールド Tier')).toBeDisabled()
  } finally {
    await app.close()
  }
})
