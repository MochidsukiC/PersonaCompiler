import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import { rendererPlugins } from '../../electron.vite.config'

let application: ElectronApplication
let page: Page
const browserErrors: string[] = []

test.beforeAll(async () => {
  await mkdir('.local/e2e', { recursive: true })
  const directory = await mkdtemp(path.resolve('.local/e2e/run-'))
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  application = await electron.launch({ args: [path.resolve('.')], env: { ...environment, PERSONA_TEST: '1', PERSONA_DATA_DIR: directory } })
  page = await application.firstWindow()
  // Hidden test windows need foreground frame delivery for ResizeObserver and xterm.
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)
    BrowserWindow.getAllWindows()[0].show()
  })
  page.on('pageerror', error => browserErrors.push(`${error.message}\n${error.stack}`))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
})

test.afterAll(async () => { if (application) await application.close() })
test.afterEach(async () => {
  const info = test.info()
  if (page && info.status !== info.expectedStatus) {
    await info.attach('renderer-errors', { body: JSON.stringify({ errors: browserErrors, url: page.url(), body: await page.locator('body').innerText() }, null, 2), contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('failure.png') })
  }
})

test('disk-backed demo, map selection, persistent terminal tabs, file watching and relationship evidence', async () => {
  await expect(page.getByRole('heading', { name: '世界の、はじまり。' })).toBeVisible()
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
  await page.screenshot({ path: test.info().outputPath('01-preparation.png') })
  const terminalScreen = page.locator('.xterm-screen')
  await terminalScreen.click({ position: { x: 35, y: 10 }, clickCount: 3 })
  await page.keyboard.press('Control+c')
  await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText())).toContain('PERSONA COMPILER')
  expect((await page.evaluate(() => window.persona.snapshot())).state.agents.find(a => a.id === 'parent')?.status).not.toBe('interrupted')
  expect((await page.evaluate(() => window.persona.terminalSnapshot('parent'))).data).not.toContain('^C')
  await terminalScreen.click({ position: { x: 35, y: 100 } })
  await page.getByLabel('地域の説明').fill('ユーザーが渡した町の説明。公園と図書室があります。')
  await page.locator('input[type="file"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') })
  await page.getByRole('button', { name: 'デモを開始', exact: true }).click()
  await expect(page.getByTestId('world-map')).toBeVisible()
  await expect(page.getByRole('button', { name: '地図から小野 花の端末を開く', exact: true })).toBeVisible()
  const firstRun = await page.evaluate(() => window.persona.snapshot())
  expect(await readFile(path.join(firstRun.root, 'inputs/description.md'), 'utf8')).toContain('ユーザーが渡した')
  expect((await readFile(path.join(firstRun.root, 'inputs/images/1-reference.png'))).length).toBeGreaterThan(8)

  await page.getByRole('button', { name: '地図から小野 花の端末を開く', exact: true }).click()
  await expect(page.getByRole('region', { name: '小野 花の端末', exact: true })).toBeVisible()
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: '地図から小野 花の端末を開く', exact: true }).click()
  await expect(page.getByRole('button', { name: '小野 花のタブ', exact: true })).toHaveCount(1)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.insertText('こんにちは、町のみなさん')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await page.evaluate(() => window.persona.terminalSnapshot('hana'))).data).toContain('入力を受信: こんにちは、町のみなさん')
  const beforeClose = await page.evaluate(() => window.persona.terminalSnapshot('hana'))
  await page.getByRole('button', { name: '小野 花のタブを閉じる', exact: true }).click()
  await expect(page.getByRole('button', { name: '小野 花のタブ', exact: true })).toHaveCount(0)
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.persona.snapshot())
    if (state.error) throw new Error(state.error)
    return (await page.evaluate(() => window.persona.terminalSnapshot('hana'))).sequence
  }).toBeGreaterThan(beforeClose.sequence)
  await page.getByRole('button', { name: '小野 花の端末を開く', exact: true }).click()
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
  await page.getByTitle('agents/hana/memory.md', { exact: true }).click()
  await expect(page.getByTestId('file-content')).toContainText('小野 花の記憶')
  await writeFile(path.join(firstRun.root, 'agents/hana/memory.md'), '\n実行中の外部追記。\n', { flag: 'a' })
  await expect(page.getByTestId('file-content')).toContainText('実行中の外部追記。')
  await page.getByRole('button', { name: 'ワールド', exact: true }).click()

  await expect.poll(async () => (await page.evaluate(() => window.persona.snapshot())).state.frame.turn).toBeGreaterThanOrEqual(5)
  await page.getByRole('button', { name: '一時停止', exact: true }).click()
  await expect(page.getByRole('button', { name: '再開', exact: true })).toBeVisible()
  const paused = await page.evaluate(() => window.persona.snapshot())
  expect(paused.state.agents).toHaveLength(8)
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await page.getByRole('button', { name: '小野 花のタブを閉じる', exact: true }).click()
    await page.getByRole('button', { name: '小野 花の端末を開く', exact: true }).click()
  }
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
  const memory = path.join(paused.root, 'agents/hana/memory.md')
  const splitter = page.getByRole('separator', { name: '端末幅' })
  const start = await splitter.boundingBox()
  if (!start) throw new Error('端末の境界が見つかりません')
  const widthBefore = await page.locator('.terminal-panel').evaluate(element => element.getBoundingClientRect().width)
  await page.mouse.move(start.x + 2, start.y + 100)
  await page.mouse.down(); await page.mouse.move(start.x - 50, start.y + 100, { steps: 6 }); await page.mouse.up()
  await expect.poll(() => page.locator('.terminal-panel').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(widthBefore + 40)
  await page.screenshot({ path: test.info().outputPath('02-world-and-terminal.png') })
  if (!paused.state.map) throw new Error('地図が生成されていません')
  const editedState = { ...paused.state, map: { ...paused.state.map, revision: 2, locations: [...paused.state.map.locations, { id: 'school', name: '新しい学校', kind: 'school', areaId: 'commons', position: { x: 515, y: 100 } }] }, frame: { ...paused.state.frame, revision: paused.state.frame.revision + 1, mapRevision: 2 } }
  await writeFile(path.join(paused.root, 'state.json'), JSON.stringify(editedState))
  await expect(page.getByText('新しい学校', { exact: true })).toBeVisible()
  await expect(page.getByText('地図 v2', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '関係図', exact: true }).click()
  await expect(page.getByTestId('relationship-graph')).toBeVisible()
  await page.getByRole('button', { name: /小野 花 → 森 悠斗/ }).click()
  await expect(page.getByTestId('relation-detail')).toContainText('花は悠斗との会話に安心感')
  await page.getByRole('button', { name: 'agents/hana/memory.md', exact: true }).click()
  await expect(page.getByTestId('file-content')).toContainText('小野 花の記憶')
  const updated = `${await readFile(memory, 'utf8')}\n外部エディターで追記した固有の記憶。\n`
  const temporary = path.join(paused.root, 'agents/hana/external.tmp')
  await writeFile(temporary, updated)
  await rename(temporary, memory)
  await expect(page.getByTestId('file-content')).toContainText('外部エディターで追記した固有の記憶。')
  await page.getByRole('button', { name: '関係図', exact: true }).click()
  await page.getByRole('button', { name: /小野 花 → 森 悠斗/ }).click()
  await expect(page.getByTestId('relation-detail')).toContainText('観測後に根拠ファイルが変更')
  await page.screenshot({ path: test.info().outputPath('03-relationship-evidence.png') })
  const observed = await page.evaluate(() => window.persona.snapshot())
  expect(observed.state.frame.turn).toBe(paused.state.frame.turn)
  expect(observed.staleRelations).toContain('hana-yuto')

  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.press('Control+c')
  await expect(page.getByRole('region', { name: '小野 花の端末', exact: true })).toContainText('中断中')
  await page.keyboard.insertText('再開')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await page.evaluate(() => window.persona.snapshot())).state.agents.find(a => a.id === 'hana')?.status).toBe('running')
  await page.getByRole('button', { name: '処理に割り込む', exact: true }).click()
  await expect(page.getByRole('region', { name: '小野 花の端末', exact: true })).toContainText('中断中')
  expect((await page.evaluate(() => window.persona.snapshot())).state.agents.find(a => a.id === 'hana')?.status).toBe('interrupted')
  await mkdir(path.join(paused.root, '..draft'))
  await writeFile(path.join(paused.root, '..draft/review.md'), '外部編集した制作メモ')
  await page.locator('button.file-row[title="..draft/review.md"]').click()
  await expect(page.getByTestId('file-content')).toHaveText('外部編集した制作メモ')
  await writeFile(path.join(paused.root, '..draft/review.md'), '制作メモを更新')
  await expect(page.getByTestId('file-content')).toHaveText('制作メモを更新')
  const validState = await readFile(path.join(paused.root, 'state.json'), 'utf8')
  await writeFile(path.join(paused.root, 'state.json'), '{invalid JSON')
  await expect(page.getByRole('alert')).toContainText('state.json')
  await expect(page.getByRole('alert')).toContainText('最新ではありません')
  await writeFile(path.join(paused.root, 'state.json'), validState)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '新しい実行', exact: true }).click()
  await expect(page.getByRole('heading', { name: '世界の、はじまり。' })).toBeVisible()
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
  expect((await page.evaluate(() => window.persona.snapshot())).root).not.toBe(paused.root)
  expect(await readFile(memory, 'utf8')).toContain('外部エディターで追記した固有の記憶。')
  expect(browserErrors).toEqual([])
})

test('development renderer starts with Vite and the isolated preload', async () => {
  const server = await createServer({ root: path.resolve('src/renderer'), configFile: false, plugins: rendererPlugins, server: { host: 'localhost', port: 0 } })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('開発サーバーのポートを取得できません')
    await application.evaluate(async ({ BrowserWindow }, url) => { await BrowserWindow.getAllWindows()[0].loadURL(url) }, `http://localhost:${address.port}`)
    await expect(page.getByRole('heading', { name: '世界の、はじまり。' })).toBeVisible()
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    expect(browserErrors).toEqual([])
  } finally { await server.close() }
})
