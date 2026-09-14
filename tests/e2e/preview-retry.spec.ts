import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: retries failed previews without duplicate healthy reads or late cross-file results`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/preview-retry-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root } = await page.evaluate(() => window.persona.snapshot())
    await writeFile(path.join(root, 'notes.md'), '元の本文')
    await writeFile(path.join(root, 'other.md'), '別の資料')
    const notes = page.locator('button.file-row[title="notes.md"]')
    await expect(notes).toBeVisible()
    await expect(page.locator('button.file-row[title="other.md"]')).toBeVisible()
    await app.evaluate(({ ipcMain }) => {
      const fixture = globalThis as unknown as { previewRetry: { count: number; mode: 'fail' | 'read' | 'hold'; content: string } }
      fixture.previewRetry = { count: 0, mode: 'fail', content: '元の本文' }
      ipcMain.removeHandler('persona:preview')
      ipcMain.handle('persona:preview', async (_event, file: string) => {
        fixture.previewRetry.count++
        if (file === 'notes.md' && fixture.previewRetry.mode === 'fail') throw new Error('fixture: EBUSY notes.md')
        const content = file === 'notes.md' ? fixture.previewRetry.content : '別の資料'
        if (file === 'notes.md' && fixture.previewRetry.mode === 'hold') await new Promise<void>(resolve => ipcMain.once('fixture:release-preview', () => resolve()))
        return { path: file, kind: 'text', hash: content, content }
      })
    })
    const configure = (mode: 'fail' | 'read' | 'hold', content: string) => app.evaluate((_electron, value) => {
      Object.assign((globalThis as unknown as { previewRetry: { mode: string; content: string } }).previewRetry, value)
    }, { mode, content })
    const count = () => app.evaluate(() => (globalThis as unknown as { previewRetry: { count: number } }).previewRetry.count)
    await notes.click()
    await expect(page.locator('.preview-error')).toContainText('fixture: EBUSY notes.md')
    expect(await count()).toBe(1)
    await configure('read', '元の本文')
    await notes.click()
    await expect(page.getByTestId('file-content')).toHaveText('元の本文')
    await expect(page.locator('.preview-error')).toHaveCount(0)
    expect(await count()).toBe(2)
    await notes.click()
    await expect(page.getByTestId('file-content')).toHaveText('元の本文')
    expect(await count()).toBe(2)

    await configure('fail', '更新後の本文')
    await writeFile(path.join(root, 'notes.md'), '更新後の本文')
    await expect(page.locator('.preview-error')).toContainText('前回の内容を表示しています。')
    await expect(page.getByTestId('file-content')).toHaveText('元の本文')
    await page.screenshot({ path: test.info().outputPath('preview-error.png') })
    await configure('hold', '遅れて返る本文')
    await page.getByRole('button', { name: 'プレビューを再読み込み' }).click()
    await expect(page.getByText('読み込み中…', { exact: true })).toBeVisible()
    await expect.poll(count).toBe(4)
    await page.locator('button.file-row[title="other.md"]').click()
    await expect(page.getByTestId('file-content')).toHaveText('別の資料')
    await app.evaluate(({ ipcMain }) => ipcMain.emit('fixture:release-preview'))
    await configure('read', '更新後の本文')
    await expect(page.getByTestId('file-content')).toHaveText('別の資料')
    await expect(page.locator('.preview-error')).toHaveCount(0)
    await notes.click()
    await expect(page.getByTestId('file-content')).toHaveText('更新後の本文')
    expect(await count()).toBe(6)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
