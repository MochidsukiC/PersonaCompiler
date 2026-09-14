import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { emptyPreparation } from '../../src/core/contracts'
import { NpcMemoryStore } from '../../src/core/memory-store'
import { draft } from '../backend/fixtures'

test('shows NPC memory details and directed historical relationship evidence in a read-only world', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/memory-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: root } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const memory = new NpcMemoryStore('e2e-memory', ['npc0', 'npc1'])
    memory.commit(memory.source('npc0', 'heard-book', 1, '楓が本を貸してくれた。', 'received'))
    const content = { text: '楓の本を借りた', meaning: '私を信頼してくれてうれしい', cues: { people: ['npc1'], places: [], topics: ['読書'] }, importance: 0.8, sourceIds: ['heard-book'] }
    const candidate = memory.remember('npc0', 1, content); memory.commit(candidate.mutation)
    memory.commit(memory.prepare('npc0', owner => { owner.consolidation = 'running' }))
    memory.commit(memory.consolidate('npc0', 4, { memories: [{ ...content, id: null, kind: 'episodic', candidateIds: [candidate.candidate.id], mergeIds: [] }], forgetIds: [], relations: [{ target: 'npc1', label: '本を貸してくれた人', description: '信頼されていると感じる', memoryIds: [candidate.candidate.id] }] }, ['npc0', 'npc1']))
    const record = memory.owner('npc0').records[0], detail = memory.detail('npc0', record.id, 1)
    const future = memory.remind('npc0', 4, { action: 'create', ...content, text: '本を返す', trigger: { afterTurn: 5, facilityId: 'residential', personId: 'npc1' } }, ['npc1'], ['residential']); memory.commit(future.mutation)
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot = fixture.original, preparation = fixture.preparation
      preparation.sessions = ['npc0', 'npc1'].map(id => ({ agentId: id, sessionId: id, role: 'npc', modelId: 'gpt-5.6-luna', effort: 'low', cwd: '', threadId: id, creation: 'initialized', seedPersisted: true, memoryVersion: 1 }))
      snapshot.backend = { connection: 'disconnected', authenticated: false, authMode: 'chatgpt', login: null, error: null, models: [], settings: null, preparation, persistence: { state: 'readOnly', revision: 10, savedRevision: 10, savedAt: null, unsavedSince: null, unsavedBytes: 0, error: null, readOnlyReason: '前回の正常終了を確認できません', bytesWritten: 0, saveDurationMs: 0 } }
      snapshot.state.stage = 'paused'; snapshot.state.map = fixture.map; snapshot.state.frame.mapRevision = 1
      snapshot.state.agents = ['葵', '楓'].map((name, i) => ({ id: `npc${i}`, name, sessionId: `npc${i}`, parentId: null, role: 'npc', status: 'idle', color: '#b5cea3' }))
      snapshot.state.relationships = { observedAt: new Date().toISOString(), observedTurn: 4, day: 1, relations: [
        { id: 'a-b', source: 'npc0', target: 'npc1', label: '本を貸してくれた人', description: '信頼されていると感じる', observedTurn: 4, evidence: [{ ownerId: 'npc0', memoryId: fixture.detail.record.id, revision: 1 }] },
        { id: 'b-a', source: 'npc1', target: 'npc0', label: '返却を待つ相手', description: '本を大事にしてほしい', observedTurn: 8, evidence: [] }
      ] }
      for (const channel of ['snapshot', 'memory-inspection', 'memory-detail']) ipcMain.removeHandler(`persona:${channel}`)
      ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.handle('persona:memory-inspection', (_event, id) => { if (id !== 'npc0') throw new Error('fixture: wrong owner'); return fixture.inspection })
      ipcMain.handle('persona:memory-detail', (_event, ownerId, id, revision) => { if (ownerId !== 'npc0' || id !== fixture.detail.record.id || revision !== 1) throw new Error('fixture: wrong revision'); return fixture.detail })
      snapshot.version++
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { original, preparation: emptyPreparation(), map: draft.map, inspection: memory.inspect('npc0'), detail })
    await page.getByRole('button', { name: '葵の端末を開く', exact: true }).click()
    await page.getByRole('button', { name: '記憶・未来の意図', exact: true }).click()
    const panel = page.getByTestId('memory-panel')
    await expect(panel.getByText('保持 2/100', { exact: true })).toBeVisible()
    await expect(panel.getByText('条件: turn 5以降 residential npc1 · pending', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: /^経験 · 読書/ }).click()
    await expect(panel.getByText('私を信頼してくれてうれしい', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '関係図', exact: true }).click()
    await page.locator('.relation-shortcuts button').filter({ hasText: '葵 → 楓' }).click()
    const relation = page.getByTestId('relation-detail')
    await expect(relation).toContainText('本人が turn 4 に更新')
    await relation.locator('.evidence').click()
    await expect(relation.getByText('楓が本を貸してくれた。', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('memory-relationship.png') })
    const updateRelation = async (revision: number, label: string) => {
      const snapshot = await page.evaluate(() => window.persona.snapshot())
      await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
        const current = fixture.snapshot.state.relationships!.relations[0]
        current.label = fixture.label
        current.observedTurn = fixture.revision + 4
        current.evidence = [{ ownerId: 'npc0', memoryId: fixture.memoryId, revision: fixture.revision }]
        fixture.snapshot.version++
        ipcMain.removeHandler('persona:snapshot')
        ipcMain.handle('persona:snapshot', () => fixture.snapshot)
        BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot: fixture.snapshot })
      }, { snapshot, revision, label, memoryId: record.id })
      await expect(relation.locator('.relation-label')).toHaveText(label)
    }
    await updateRelation(1, '同じ記憶を参照した説明の更新')
    await expect(relation.getByTestId('memory-detail')).toContainText('楓の本を借りた')
    await updateRelation(2, '更新された記憶で見た相手')
    await expect(relation.getByTestId('memory-detail')).toHaveCount(0)
    await app.evaluate(({ ipcMain }, fixture) => {
      ipcMain.removeHandler('persona:memory-detail')
      ipcMain.handle('persona:memory-detail', (_event, ownerId, id, revision) => {
        if (ownerId !== 'npc0' || id !== fixture.record.id) throw new Error('fixture: wrong memory reference')
        if (revision === 2) return new Promise(resolve => { ipcMain.once('fixture:release-memory', () => resolve({ ...fixture, record: { ...fixture.record, revision: 2, text: '遅れて届いた古い根拠' } })) })
        if (revision === 3) return { ...fixture, record: { ...fixture.record, revision: 3, text: '現在の関係が参照する記憶' } }
        throw new Error(`fixture: unexpected revision ${revision}`)
      })
    }, detail)
    await relation.locator('.evidence').click()
    await expect(relation.getByText('記憶を読み込み中…', { exact: true })).toBeVisible()
    await expect.poll(() => app.evaluate(({ ipcMain }) => ipcMain.listenerCount('fixture:release-memory'))).toBe(1)
    await updateRelation(3, 'さらに更新された関係')
    await expect(relation.getByText('記憶を読み込み中…', { exact: true })).toHaveCount(0)
    expect(await app.evaluate(({ ipcMain }) => ipcMain.emit('fixture:release-memory'))).toBe(true)
    await relation.locator('.evidence').click()
    await expect(relation.getByTestId('memory-detail')).toContainText('現在の関係が参照する記憶')
    await expect(relation).not.toContainText('遅れて届いた古い根拠')
    await expect(relation).not.toContainText('楓の本を借りた')
    await page.screenshot({ path: test.info().outputPath('memory-relationship-updated.png') })
    expect(errors).toEqual([])
  } finally { await app.close() }
})
