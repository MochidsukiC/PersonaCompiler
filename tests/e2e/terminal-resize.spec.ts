import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'

test('a failed terminal resize stays visible and does not prevent the next user resize', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/terminal-resize-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '1', PERSONA_DATA_DIR: root } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.webContents.setBackgroundThrottling(false)
      window.show()
    })
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    await app.evaluate(({ ipcMain }) => {
      const sizes: { columns: number; rows: number }[] = []
      ipcMain.removeHandler('persona:terminal-resize')
      ipcMain.handle('persona:terminal-resize', (_event, _id: string, columns: number, rows: number) => {
        sizes.push({ columns, rows })
        if (sizes.length === 1) throw new Error('fixture: terminal resize failed')
      })
      ipcMain.on('test:resize-sizes', (_event, read: (value: typeof sizes) => void) => read(sizes))
    })
    const resize = async (offset: number) => {
      const splitter = await page.getByRole('separator', { name: '端末幅' }).boundingBox()
      if (!splitter) throw new Error('端末の境界が見つかりません')
      await page.mouse.move(splitter.x + 2, splitter.y + 100)
      await page.mouse.down()
      await page.mouse.move(splitter.x + offset, splitter.y + 100)
      await page.mouse.up()
    }
    const sizes = () => app.evaluate(({ ipcMain }) => new Promise<{ columns: number; rows: number }[]>(resolve => ipcMain.emit('test:resize-sizes', null, resolve)))
    await resize(-70)
    await expect(page.getByRole('alert')).toContainText('fixture: terminal resize failed')
    const failedColumns = (await sizes())[0].columns
    await page.getByRole('button', { name: 'エラーを閉じる' }).click()
    await resize(-70)
    await expect.poll(async () => (await sizes()).at(-1)?.columns ?? 0).toBeGreaterThan(failedColumns)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
