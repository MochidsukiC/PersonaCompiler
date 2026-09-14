import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { draft, population } from '../backend/fixtures'
import type { WorkspaceSnapshot } from '../../src/shared/contracts'

async function launch(existing?: string) {
  await mkdir('.local/e2e', { recursive: true })
  const root = existing ?? await mkdtemp(path.resolve('.local/e2e/persistence-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: path.join(root, 'runs'), PERSONA_CODEX_HOME: path.join(root, 'codex') } })
  return { app, page: await app.firstWindow(), root }
}
test('real worker saves, cancels exit on disk failure, retries, and restores a clean run', async () => {
  const { app, page, root } = await launch()
  let diskState: 'original' | 'backedUp' | 'obstructed' = 'original'
  let run = ''
  const failures: { stage: string; error: unknown }[] = []
  const restoreDisk = async () => {
    if (diskState === 'obstructed') { await rename(path.join(run, 'persistence'), path.join(run, 'obstruction.txt')); diskState = 'backedUp' }
    if (diskState === 'backedUp') { await rename(path.join(run, 'saved-persistence'), path.join(run, 'persistence')); diskState = 'original' }
  }
  try {
    await expect(page.getByTestId('persistence-status')).toContainText('保存済み')
    const snapshot = await page.evaluate(() => window.persona.snapshot())
    run = snapshot.root
    await page.evaluate(() => window.persona.saveNow())
    await expect(page.getByTestId('persistence-status')).toContainText('保存済み')
    await rename(path.join(run, 'persistence'), path.join(run, 'saved-persistence')); diskState = 'backedUp'
    await writeFile(path.join(run, 'persistence'), 'fixture directory obstruction'); diskState = 'obstructed'
    await app.evaluate(({ dialog, BrowserWindow }) => {
      const fixture = globalThis as unknown as { exitChoices: string[] }
      fixture.exitChoices = []
      dialog.showMessageBox = (async (options: Electron.MessageBoxOptions) => { fixture.exitChoices = options.buttons!; return { response: 1, checkboxChecked: false } }) as typeof dialog.showMessageBox
      BrowserWindow.getAllWindows()[0].close()
    })
    await expect(page.getByTestId('persistence-status')).toContainText('保存エラー')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    const choices = await app.evaluate(() => (globalThis as unknown as { exitChoices: string[] }).exitChoices)
    expect(choices).toEqual(['再試行', '終了を取り消す', '保存せず終了'])
    await test.step('restore the obstructed persistence directory', restoreDisk)
    await page.getByRole('button', { name: '今すぐ保存' }).click()
    await expect(page.getByTestId('persistence-status')).toContainText('保存済み')
    await page.screenshot({ path: path.join(root, 'saved-after-retry.png') })
  } catch (error) { failures.push({ stage: 'test', error }) }
  finally {
    try { await restoreDisk() } catch (error) { failures.push({ stage: 'restore', error }) }
    try {
      if (failures.length) await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as typeof dialog.showMessageBox
      })
      await app.close()
    } catch (error) { failures.push({ stage: 'close', error }) }
  }
  if (failures.length) throw new AggregateError(failures.map(item => item.error), failures.map(({ stage, error }) => `${stage}: ${error instanceof Error ? error.stack : String(error)}`).join('\n'), { cause: failures[0].error })
  expect(JSON.parse(await readFile(path.join(run, 'persistence/manifest.json'), 'utf8')).dirty).toBe(false)
  const restored = await launch(root)
  try {
    await expect(restored.page.getByTestId('persistence-status')).toContainText('保存済み')
    const snapshot = await restored.page.evaluate(() => window.persona.snapshot())
    expect(snapshot.root).toBe(run)
    expect(snapshot.state.frame.turn).toBe(0)
    expect(snapshot.backend!.persistence!.readOnlyReason).toBeNull()
  } finally { await restored.app.close() }
})

test('UI stays interactive during pending saves and reloads previews only for their own file revision', async () => {
  const { app, page, root } = await launch()
  try {
    await expect(page.getByTestId('persistence-status')).toContainText('保存済み')
    const original = await page.evaluate(() => window.persona.snapshot())
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot: WorkspaceSnapshot = fixture.original
      snapshot.state.map = fixture.map; snapshot.state.frame.mapRevision = 1; snapshot.state.stage = 'paused'
      snapshot.state.agents = fixture.people.npcs.map(npc => ({ id: npc.id, sessionId: npc.id, role: 'npc', parentId: null, name: npc.name, color: '#b0c0f4', status: 'idle' }))
      snapshot.state.frame.positions = Object.fromEntries(fixture.people.npcs.map(npc => [npc.id, 'home']))
      snapshot.files = [{ name: 'notes.md', path: 'notes.md', kind: 'file' }]; snapshot.fileVersions = { 'notes.md': 1 }
      snapshot.backend!.preparation.phase = 'ready'; snapshot.backend!.authenticated = true; snapshot.backend!.connection = 'connected'
      const counters = globalThis as unknown as { previewCount: number }
      counters.previewCount = 0
      const publish = () => { snapshot.version++; BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot }) }
      for (const channel of ['snapshot', 'preview', 'save-now', 'terminal-snapshot', 'terminal-resize']) ipcMain.removeHandler(`persona:${channel}`)
      ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.handle('persona:preview', () => { counters.previewCount++; return { path: 'notes.md', kind: 'text', hash: String(snapshot.fileVersions!['notes.md']), content: `本文 ${snapshot.fileVersions!['notes.md']}` } })
      ipcMain.handle('persona:terminal-snapshot', (_event, id: string) => ({ sessionId: id, sequence: 1, columns: 100, rows: 30, data: 'existing terminal' }))
      ipcMain.handle('persona:terminal-resize', () => undefined)
      ipcMain.handle('persona:save-now', () => { snapshot.backend!.persistence!.state = 'saving'; publish(); return new Promise<void>(resolve => ipcMain.once('fixture:release-save', () => { snapshot.backend!.persistence!.state = 'saved'; publish(); resolve() })) })
      ipcMain.on('fixture:frames', (_event, selectedFile: boolean) => {
        for (let i = 0; i < 30; i++) { snapshot.state.frame.revision++; publish() }
        if (selectedFile) { snapshot.fileVersions!['notes.md']++; publish() }
      })
      publish()
    }, { original, map: draft.map, people: population })
    await page.locator('button.file-row[title="notes.md"]').click()
    await expect(page.getByTestId('file-content')).toContainText('本文 1')
    await page.locator('button.file-row[title="notes.md"]').click()
    await expect(page.getByTestId('file-content')).toContainText('本文 1')
    await page.getByRole('button', { name: '今すぐ保存' }).click()
    await expect(page.getByTestId('persistence-status')).toContainText('保存中')
    await app.evaluate(({ ipcMain }) => ipcMain.emit('fixture:frames', null, false))
    await page.getByLabel('エージェントを検索').fill('住民0')
    await page.getByRole('button', { name: '住民0の端末を開く', exact: true }).click()
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    expect(await app.evaluate(() => (globalThis as unknown as { previewCount: number }).previewCount)).toBe(1)
    await app.evaluate(({ ipcMain }) => ipcMain.emit('fixture:frames', null, true))
    await expect(page.getByTestId('file-content')).toContainText('本文 2')
    expect(await app.evaluate(() => (globalThis as unknown as { previewCount: number }).previewCount)).toBe(2)
    await page.getByRole('button', { name: 'ワールド', exact: true }).click()
    await expect(page.getByTestId('world-map')).toBeVisible()
    await expect(page.getByTestId('persistence-status')).toContainText('保存中')
    await app.evaluate(({ ipcMain }) => ipcMain.emit('fixture:release-save'))
    await expect(page.getByTestId('persistence-status')).toContainText('保存済み')
    await page.screenshot({ path: path.join(root, 'interactive-save.png') })
  } finally { await app.close() }
})

test('explicit exit without saving leaves dirty and restores only a read-only world', async () => {
  const { app, page, root } = await launch()
  let run = '', closed = false, blocked = false
  try {
    await expect(page.getByTestId('persistence-status')).toContainText('保存済み')
    await page.getByRole('button', { name: 'ChatGPTで接続', exact: true }).click()
    await expect(page.getByRole('button', { name: 'ChatGPTにログイン', exact: true })).toBeVisible({ timeout: 20000 })
    await page.evaluate(() => window.persona.saveNow())
    run = (await page.evaluate(() => window.persona.snapshot())).root
    await rename(path.join(run, 'persistence'), path.join(run, 'saved-persistence'))
    await writeFile(path.join(run, 'persistence'), 'fixture obstruction'); blocked = true
    const exited = app.waitForEvent('close')
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as typeof dialog.showMessageBox
      setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0)
    })
    await exited; closed = true
  } finally {
    if (blocked) { await rename(path.join(run, 'persistence'), path.join(run, 'obstruction.txt')); await rename(path.join(run, 'saved-persistence'), path.join(run, 'persistence')) }
    if (!closed) await app.close()
  }
  expect(JSON.parse(await readFile(path.join(run, 'persistence/manifest.json'), 'utf8')).dirty).toBe(true)
  const restored = await launch(root)
  try {
    await expect(restored.page.getByTestId('persistence-status')).toContainText('閲覧専用')
    await expect(restored.page.getByRole('button', { name: '今すぐ保存' })).toBeDisabled()
    await expect(restored.page.getByRole('button', { name: 'ChatGPTで接続', exact: true })).toHaveCount(0)
    const reason = await restored.page.evaluate(async () => { try { await window.persona.backendCommand({ type: 'connect', authMode: 'chatgpt' }); return null } catch (error) { return String(error) } })
    expect(reason).toContain('閲覧専用')
  } finally { await restored.app.close() }
})
