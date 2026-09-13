import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { emptyPreparation } from '../../src/core/contracts'
import { initializeLifecycle } from '../../src/core/lifecycle'
import { draft, population } from '../backend/fixtures'
import type { CharacterReview } from '../../src/core/character-review'

test('shows ages, deceased residents, home progress and automatically generated packages', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/lifecycle-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: '1', PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const original = await page.evaluate(() => window.persona.snapshot())
    const lifecycle = initializeLifecycle(population, 'fixture')
    lifecycle.residents[0].diedTurn = 4; lifecycle.residents[0].age = 80
    lifecycle.endReason = 'turn_limit'
    lifecycle.homes.push({ id: 'new-home', sponsorId: 'npc2', members: ['npc1'], accepted: ['npc1'], description: '子どものための家', status: 'complete', householdId: 'new-household', reason: null })
    const review: CharacterReview = { version: 1, npcId: 'npc1', name: '住民1', sourceRevision: 10, modelId: 'fixture', memoryCount: 1, relationshipCount: 1,
      sections: [{ title: '人格', claims: [{ text: '借りた本を大切にする。', evidence: ['event:42'] }] }, { title: '話し方', claims: [{ text: '<img src=x onerror=alert(1)>丁寧に話す。', evidence: ['event:42'] }] }],
      sources: [{ id: 'event:42', title: '出来事 · turn 4 · speech', text: '借りた本を返すと約束しました。' }], runtimeGuidance: '資料に沿って応答する', systemPrompt: 'あなたは町の住民です。' }
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot = fixture.original
      snapshot.state = { ...snapshot.state, stage: 'ended', map: fixture.map, agents: fixture.lifecycle.residents.map(n => ({ id: n.id, name: n.name, role: 'npc', parentId: null, sessionId: n.id, status: 'ended', color: '#9dbafa' })), frame: { ...snapshot.state.frame, mapRevision: 1, turn: 4 }, simulation: { version: 1, revision: 10, stage: 'ended', phase: 'complete', turn: 4, day: 1, time: 'night', step: false, error: null, lifecycle: fixture.lifecycle, events: [], facilities: [], actors: fixture.lifecycle.residents.map(n => ({ id: n.id, name: n.name, householdId: n.householdId, locationId: n.locationId, position: null, activity: n.diedTurn === null ? 'ended' : 'dead', nextFacilityId: null, wakeAt: null, compact: 'none' })) } }
      snapshot.backend = { connection: 'connected', authenticated: true, authMode: 'chatgpt', models: [], settings: null, login: null, error: null, preparation: { ...fixture.preparation, phase: 'ready' }, compilation: { id: 'compiled', sourceRevision: 10, promptHash: 'fixture', modelId: 'fixture', status: 'completed', tasks: [{ npcId: 'npc1', name: '住民1', status: 'completed', input: 'input.json', inputHash: 'fixture', output: 'compilation/compiled/npcs/npc1', error: null }] } }
      const reviewPath = 'compilation/compiled/npcs/npc1/review.json'
      snapshot.backend.compilation!.tasks[0].review = reviewPath
      snapshot.fileVersions = { [reviewPath]: 1 }
      let reviewText = JSON.stringify(fixture.review)
      for (const channel of ['snapshot', 'preview', 'conversation']) ipcMain.removeHandler(`persona:${channel}`)
      ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.handle('persona:preview', (_event, relative) => ({ path: relative, content: relative === reviewPath ? reviewText : '生成済みの人物パッケージ', hash: String(snapshot.fileVersions![reviewPath]), kind: 'text' }))
      ipcMain.on('fixture:invalid-review', () => { reviewText = '{invalid'; snapshot.fileVersions![reviewPath]++; snapshot.version++; BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot }) })
      ipcMain.handle('persona:conversation', () => ({ cursor: 'fixture', reset: true, turns: [{ id: 'old-turn', status: 'completed', items: [{ id: 'message', type: 'agentMessage', text: 'この町で暮らしました。' }] }] }))
      snapshot.version++
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { original, preparation: emptyPreparation(), map: draft.map, lifecycle, review })
    const panel = page.getByRole('region', { name: '住民と世代交代' })
    await expect(panel.getByText('生存 4人 · 初期世代 4人')).toBeVisible()
    await expect(page.getByTestId('end-reason')).toHaveText('指定ターンに到達')
    await panel.getByText('住民台帳・家族・世帯', { exact: true }).click()
    await expect(panel.getByText('住民1 · 17歳 · 第0世代', { exact: true })).toBeVisible()
    await panel.getByText('故人の履歴 · 1人', { exact: true }).click()
    await panel.getByRole('button', { name: '住民0 · 80歳 · 第0世代 · turn 4' }).click()
    await expect(page.getByRole('button', { name: '再接続', exact: true })).toBeDisabled()
    await expect(page.getByText('この町で暮らしました。', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: '生成を開始', exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Runtime Prompt', exact: true }).click()
    await expect(page.getByTestId('file-content')).toHaveText('生成済みの人物パッケージ')
    await page.getByRole('button', { name: 'ワールド', exact: true }).click()
    await panel.getByRole('button', { name: '制作レビュー', exact: true }).click()
    const report = page.getByRole('article', { name: 'NPC制作レビュー' })
    await expect(report.getByRole('heading', { name: '住民1', exact: true })).toBeVisible()
    await expect(report.getByText('根拠付き設定 2件')).toBeVisible()
    await expect(report.locator('img')).toHaveCount(0)
    await report.getByLabel('制作レビューを検索').fill('人格')
    await expect(report.getByRole('status')).toHaveText('1 / 2件の設定')
    await report.getByRole('button', { name: '根拠 1', exact: true }).click()
    await expect(report.getByRole('region', { name: '設定の根拠' })).toContainText('借りた本を返すと約束しました。')
    await report.getByLabel('制作レビューを検索').fill('一致しない検索')
    await expect(report.getByText('検索条件に一致する設定はありません。')).toBeVisible()
    await report.getByLabel('制作レビューを検索').fill('')
    await page.screenshot({ path: test.info().outputPath('compiled-lifecycle.png') })
    await app.evaluate(({ ipcMain }) => ipcMain.emit('fixture:invalid-review'))
    await expect(page.getByRole('alert')).toContainText('制作レビューのJSONを読み取れません')
    expect(errors).toEqual([])
  } finally { await app.close() }
})
