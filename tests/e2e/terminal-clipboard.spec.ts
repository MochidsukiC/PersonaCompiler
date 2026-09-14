import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'

for (const bracketed of [true, false]) test(`pastes copied harness text once without sending image shortcuts (bracketed=${bracketed})`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/terminal-clipboard-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '1', PERSONA_DATA_DIR: root } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    const parent = (await page.evaluate(() => window.persona.snapshot())).state.agents.find(a => a.role === 'parent')!
    await app.evaluate(({ ipcMain, BrowserWindow }, bracketed) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.webContents.setBackgroundThrottling(false); window.show()
      const inputs: { id: string; data: string }[] = []
      ipcMain.removeHandler('persona:terminal-input')
      ipcMain.handle('persona:terminal-input', (_event, id: string, data: string) => { inputs.push({ id, data }) })
      ipcMain.removeHandler('persona:terminal-snapshot')
      ipcMain.handle('persona:terminal-snapshot', (_event, sessionId: string) => ({ sessionId, sequence: 0, columns: 100, rows: 30, data: `CLIPBOARD FIXTURE\r\n\x1b[?2004${bracketed ? 'h' : 'l'}` }))
      ipcMain.on('test:clipboard-inputs', (_event, read: (value: typeof inputs) => void) => read(inputs))
    }, bracketed)
    await page.getByRole('button', { name: `${parent.name}のタブを閉じる`, exact: true }).click()
    await page.getByRole('button', { name: `${parent.name}の端末を開く`, exact: true }).click()
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    const inputs = () => app.evaluate(({ ipcMain }) => new Promise<{ id: string; data: string }[]>(resolve => ipcMain.emit('test:clipboard-inputs', null, resolve)))
    const source = page.getByLabel('地域の説明')
    const text = 'パンの登録ができません。\nカレーを申請してください。'
    await source.fill(text)
    await source.press('Control+a')
    await source.press('Control+c')
    await expect.poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(text)
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.press('Control+v')
    const pasted = text.replace(/\n/g, '\r')
    await expect.poll(inputs).toEqual([{ id: 'parent', data: bracketed ? `\x1b[200~${pasted}\x1b[201~` : pasted }])
    await page.locator('.xterm-screen').click({ position: { x: 35, y: 10 }, clickCount: 3 })
    await page.keyboard.press('Control+c')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('CLIPBOARD FIXTURE')
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.press('Control+v')
    await expect.poll(async () => (await inputs()).length).toBe(2)
    expect((await inputs())[1].data).toContain('CLIPBOARD FIXTURE')
    expect((await inputs()).every(input => !input.data.includes('\x16'))).toBe(true)
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    expect(await app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(true)
    await page.keyboard.press('Control+v')
    await expect.poll(async () => (await inputs()).slice(2)).toEqual([{ id: 'parent', data: '\x16' }])
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.alloc(16, 255), { width: 2, height: 2 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }), 'text/plain': '画像に付随する文字' })])
    })
    await page.keyboard.press('Control+v')
    await expect.poll(async () => (await inputs()).slice(3)).toEqual([{ id: 'parent', data: '\x16' }])
    await app.evaluate(({ clipboard }) => clipboard.clear())
    await page.keyboard.press('Control+v')
    await expect(page.getByRole('alert')).toContainText('クリップボードに貼り付け可能な文字または画像がありません')
    expect(await inputs()).toHaveLength(4)
    await page.getByRole('button', { name: 'エラーを閉じる' }).click()
    await page.locator('.xterm-helper-textarea').focus()
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'read', { value: async () => { throw new DOMException('fixture: clipboard read denied', 'NotAllowedError') } })
    })
    await page.keyboard.press('Control+v')
    await expect(page.getByRole('alert')).toContainText('fixture: clipboard read denied')
    expect(await inputs()).toHaveLength(4)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
