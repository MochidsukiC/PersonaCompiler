import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { emptyPreparation } from '../../src/core/contracts'
import type { EventHistoryQuery } from '../../src/core/event-search'

test('searches saved events, pages at a fixed revision, reports errors and ignores late results after returning live', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/event-history-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: '1', PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const original = await page.evaluate(() => window.persona.snapshot())
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot = fixture.original
      const event = (sequence: number) => ({ sequence, turn: 0, kind: 'speech' as const, actorId: 'npc0', text: sequence === 1 ? '最初の日に交わした約束' : `会話${sequence}`, recipients: [], locationId: 'home', position: null })
      snapshot.state.simulation = { version: 1, revision: 5, stage: 'paused', phase: 'between', turn: 12, day: 3, time: 'night', step: false, error: null, facilities: [], actors: [{ id: 'npc0', name: '葵', householdId: 'family', locationId: 'home', position: null, activity: 'ended', nextFacilityId: null, wakeAt: null, compact: 'none' }], events: [event(240)] }
      snapshot.backend = { connection: 'disconnected', authenticated: false, authMode: 'chatgpt', models: [], settings: null, login: null, preparation: fixture.preparation, error: null, persistence: { state: 'readOnly', revision: 3, savedRevision: 3, savedAt: '2026-09-14T00:00:00Z', unsavedSince: null, unsavedBytes: 0, error: null, readOnlyReason: 'fixture: 閲覧専用', bytesWritten: 0, saveDurationMs: 0 } }
      const queries: EventHistoryQuery[] = []
      let release: (() => void) | undefined
      ipcMain.on('fixture:release-history', () => release?.())
      ipcMain.removeHandler('persona:snapshot'); ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.removeHandler('persona:event-history')
      ipcMain.handle('persona:event-history', async (_event, query: EventHistoryQuery) => {
        queries.push(query)
        if (query.filter.query === '破損') throw new Error('出来事の履歴hashが一致しません: fixture')
        if (query.filter.query === '待機') await new Promise<void>(resolve => { release = resolve })
        const matching = query.filter.query === '約束' ? [event(1)] : Array.from({ length: 240 }, (_, index) => event(240 - index))
        return { runId: query.runId, revision: query.revision ?? 3, savedAt: '2026-09-14T00:00:00Z', offset: query.offset, total: matching.length, events: matching.slice(query.offset, query.offset + 100) }
      })
      ipcMain.removeHandler('persona:backend-status'); ipcMain.handle('persona:backend-status', () => ({ queries }))
      snapshot.version++; BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { original, preparation: emptyPreparation() })
    await page.getByRole('button', { name: '出来事', exact: true }).click()
    const timeline = page.getByRole('region', { name: '出来事の検索' })
    await expect(timeline.getByRole('status')).toHaveText('1 / 1件 · 新しい順')
    await timeline.getByRole('button', { name: '保存済み履歴を検索' }).click()
    await expect(timeline.getByRole('status')).toHaveText('1–100 / 240件 · 保存済み · 新しい順')
    await timeline.getByRole('button', { name: '次の100件' }).click()
    await expect(timeline.getByRole('status')).toHaveText('101–200 / 240件 · 保存済み · 新しい順')
    const recorded = await page.evaluate(() => window.persona.backendStatus()) as unknown as { queries: EventHistoryQuery[] }
    expect(recorded.queries.map(q => [q.offset, q.revision])).toEqual([[0, null], [100, 3]])
    await timeline.getByLabel('出来事を検索').fill('約束')
    await expect(timeline.getByRole('button', { name: '次の100件' })).toBeDisabled()
    await timeline.getByRole('button', { name: '保存済み履歴を検索' }).click()
    await expect(timeline.getByText('最初の日に交わした約束', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('saved-event-search.png') })
    await timeline.getByLabel('出来事を検索').fill('破損')
    await timeline.getByRole('button', { name: '保存済み履歴を検索' }).click()
    await expect(timeline.getByRole('alert')).toContainText('履歴hash')
    await expect(timeline.getByRole('article')).toHaveCount(0)
    await timeline.getByLabel('出来事を検索').fill('待機')
    await timeline.getByRole('button', { name: '保存済み履歴を検索' }).click()
    await expect(timeline.getByRole('status')).toHaveText('保存済み履歴を検索中…')
    await timeline.getByRole('button', { name: '直近の出来事に戻る' }).click()
    await timeline.getByRole('button', { name: '絞り込みを解除' }).click()
    await app.evaluate(({ ipcMain }) => ipcMain.emit('fixture:release-history'))
    await expect(timeline.getByRole('status')).toHaveText('1 / 1件 · 新しい順')
    await expect(timeline.getByRole('article')).toHaveCount(1)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
