import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { models, settings, draft, population } from '../backend/fixtures'
import { emptyPreparation, type BackendSnapshot } from '../../src/core/contracts'
import type { SimulationSnapshot } from '../../src/core/life-contracts'
import type { WorkspaceSnapshot } from '../../src/shared/contracts'

test('residential 3D, two-way voice boundaries, terminal selection and world controls', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/life-ui-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: root } })
  try {
    const page = await app.firstWindow()
    await page.clock.install()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const simulation: SimulationSnapshot = {
      version: 1, revision: 1, stage: 'ready', phase: 'between', turn: 0, day: 1, time: 'morning', step: false, error: null, events: [],
      facilities: draft.specification.town.facilities.map(f => ({ ...f, dimensions: f.dimensions!, layout: {
        publicState: '初期化済み', regions: [{ id: 'square', name: '共有広場', description: '外の空間', bounds: { min: { x: 3, y: 0, z: 0 }, max: { x: 3, y: 5, z: 0 } } }],
        homes: f.type === 'residential' ? ['family-a', 'family-b', 'single'].map((householdId, i) => ({ id: `house-${i}`, householdId, name: `住宅${i + 1}`, description: '家族の家', bounds: { min: { x: i * 4, y: 0, z: 0 }, max: { x: i * 4 + 2, y: 2, z: 1 } } })) : []
      } })),
      actors: population.npcs.map((n, i) => ({ id: n.id, name: n.name, householdId: i < 2 ? 'family-a' : i < 4 ? 'family-b' : 'single', locationId: 'home', position: { x: [0, 1, 4, 5, 3][i], y: 0, z: 0 }, activity: 'ended', nextFacilityId: null, wakeAt: null, compact: 'none' }))
    }
    const backend: BackendSnapshot = { connection: 'connected', authMode: 'chatgpt', authenticated: true, login: null, models, settings, preparation: { ...emptyPreparation(), phase: 'ready' }, error: null, simulation }
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot: WorkspaceSnapshot = { ...fixture.original, backend: fixture.backend }
      snapshot.state.stage = 'ready'; snapshot.state.simulation = fixture.simulation; snapshot.state.map = fixture.map
      snapshot.state.frame.mapRevision = fixture.map.revision
      snapshot.state.frame.positions = Object.fromEntries(fixture.simulation.actors.map(a => [a.id, a.locationId]))
      snapshot.state.agents = fixture.simulation.actors.map(a => ({ id: a.id, sessionId: a.id, name: a.name, parentId: null, role: 'npc', status: 'running', color: '#b0c0f4' }))
      const steps: boolean[] = []
      const publish = () => { snapshot.version++; BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot }) }
      ipcMain.on('test:world-update', (_event, update: { speech?: { actorId: string; text: string; recipients?: string[] }[]; dimensions?: boolean; revision?: boolean; move?: boolean }) => {
        const simulation = snapshot.state.simulation!
        for (const speech of update.speech ?? []) {
          const actor = simulation.actors.find(a => a.id === speech.actorId)!
          simulation.events.push({ sequence: simulation.events.length + 1, turn: simulation.turn, kind: 'speech', actorId: actor.id, text: speech.text, recipients: speech.recipients ?? [], locationId: actor.locationId, position: actor.position })
        }
        if (update.dimensions) simulation.facilities.find(f => f.locationId === 'home')!.dimensions.x++
        if (update.move) simulation.actors[0].position!.y++
        if (update.revision) { snapshot.state.map!.revision++; snapshot.state.frame.mapRevision = snapshot.state.map!.revision }
        simulation.revision++; publish()
      })
      for (const channel of ['snapshot', 'backend-status', 'start-simulation', 'terminal-snapshot', 'terminal-resize', 'pause', 'resume']) ipcMain.removeHandler(`persona:${channel}`)
      ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.handle('persona:backend-status', () => ({ ...snapshot.backend!, steps }))
      ipcMain.handle('persona:terminal-snapshot', (_event, id: string) => ({ sessionId: id, sequence: 1, columns: 100, rows: 30, data: `${id} existing conversation\r\n` }))
      ipcMain.handle('persona:terminal-resize', () => undefined)
      ipcMain.handle('persona:start-simulation', (_event, step: boolean) => {
        steps.push(step); snapshot.state.stage = step ? 'paused' : 'running'; snapshot.state.simulation!.stage = snapshot.state.stage
        snapshot.state.frame.turn++; snapshot.state.simulation!.turn = snapshot.state.frame.turn
        publish()
      })
      ipcMain.handle('persona:pause', () => { snapshot.state.stage = 'paused'; snapshot.state.simulation!.stage = 'paused'; publish() })
      ipcMain.handle('persona:resume', () => { snapshot.state.stage = 'running'; snapshot.state.simulation!.stage = 'running'; publish() })
      publish()
    }, { original, backend, simulation, map: draft.map })
    await expect(page.getByText('5人 · 3軒の家', { exact: true })).toBeVisible()
    await page.locator('.react-flow__controls-fitview').click()
    await app.evaluate(({ ipcMain }) => ipcMain.emit('test:world-update', null, { speech: [{ actorId: 'npc0', text: '今日は図書室へ行きましょう。' }, { actorId: 'npc1', text: '私も一緒に行きたいです。' }] }))
    await expect(page.getByTestId('speech-bubble')).toHaveCount(2)
    await expect(page.getByTestId('speech-bubble').first()).toContainText('今日は図書室へ')
    await page.getByTestId('speech-bubble').first().click()
    await expect(page.getByRole('button', { name: '住民0のタブ', exact: true })).toHaveCount(1)
    for (let i = 0; i < 10; i++) await app.evaluate(({ ipcMain }) => ipcMain.emit('test:world-update', null, { revision: true }))
    await expect(page.locator('.react-flow__node-facility')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'homeの内部を見る' })).toBeVisible()
    await expect(page.getByTestId('world-map')).toBeVisible()
    await page.screenshot({ path: path.join(root, 'spacious-world-speech.png') })
    await page.getByRole('button', { name: 'homeの内部を見る' }).click()
    const interior = page.getByTestId('facility-interior')
    const tailAlignment = () => interior.evaluate(element => {
      const layer = element.querySelector('.interior-speech-layer')!.getBoundingClientRect()
      return [...element.querySelectorAll<SVGPolygonElement>('.interior-speech-tail')].filter(tail => tail.style.display !== 'none').map(tail => {
        const marker = [...element.querySelectorAll<HTMLElement>('.interior-character')].find(marker => marker.dataset.actorId === tail.dataset.actorId)!.getBoundingClientRect()
        const tip = tail.points.getItem(1)
        return Math.hypot(tip.x - (marker.x + marker.width / 2 - layer.x), tip.y - (marker.y - layer.y - 3))
      })
    })
    await expect(interior.locator('canvas')).toBeVisible()
    await expect(interior.locator('.interior-character')).toHaveCount(5)
    await expect(interior.getByTestId('speech-bubble')).toHaveCount(2)
    expect(await tailAlignment()).toHaveLength(2)
    expect((await tailAlignment()).every(error => error < 1)).toBe(true)
    const initialDrawing = await interior.locator('canvas').screenshot({ path: path.join(root, 'before-update.png'), animations: 'disabled' })
    for (let i = 0; i < 10; i++) await app.evaluate(({ ipcMain }) => ipcMain.emit('test:world-update', null, {}))
    const updatedDrawing = await interior.locator('canvas').screenshot({ path: path.join(root, 'after-update.png'), animations: 'disabled' })
    const drawingDifference = await app.evaluate(({ nativeImage }, images) => {
      const before = nativeImage.createFromBuffer(Buffer.from(images.before, 'base64'))
      const after = nativeImage.createFromBuffer(Buffer.from(images.after, 'base64'))
      const a = before.toBitmap(), b = after.toBitmap()
      let changedChannels = 0
      // SVG edge rasterization can vary by 1–2 channel values between Chromium composites.
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) changedChannels++
      return { beforeSize: before.getSize(), afterSize: after.getSize(), changedChannels }
    }, { before: initialDrawing.toString('base64'), after: updatedDrawing.toString('base64') })
    expect(drawingDifference.beforeSize).toEqual(drawingDifference.afterSize)
    expect(drawingDifference.changedChannels).toBe(0)
    await expect(interior.getByTestId('speech-bubble').first()).toBeVisible()
    await page.getByRole('button', { name: '住宅1 family-a' }).click()
    await page.getByRole('button', { name: 'キャラクターの住民0を選択' }).click()
    await expect(page.getByRole('button', { name: '住民0のタブ', exact: true })).toHaveCount(1)
    const previousTip = await interior.locator('.interior-speech-tail').first().getAttribute('points')
    await app.evaluate(({ ipcMain }) => ipcMain.emit('test:world-update', null, { move: true }))
    await expect(interior.locator('.interior-speech-tail').first()).not.toHaveAttribute('points', previousTip!)
    expect((await tailAlignment()).every(error => error < 1)).toBe(true)
    await page.screenshot({ path: path.join(root, 'interior-speech.png') })
    const scene = (await interior.locator('canvas').boundingBox())!
    await page.mouse.move(scene.x + scene.width - 60, scene.y + scene.height - 60)
    await page.mouse.down(); await page.mouse.move(scene.x + scene.width - 100, scene.y + scene.height - 80, { steps: 6 }); await page.mouse.up()
    await page.mouse.wheel(0, -100)
    expect(await tailAlignment()).not.toHaveLength(0)
    expect((await tailAlignment()).every(error => error < 1)).toBe(true)
    await page.screenshot({ path: path.join(root, 'interior-speech-rotated.png') })
    await page.clock.fastForward(10_100)
    await expect(page.getByTestId('speech-bubble')).toHaveCount(0)
    await app.evaluate(({ ipcMain }) => ipcMain.emit('test:world-update', null, {}))
    await expect(page.getByTestId('speech-bubble')).toHaveCount(0)
    await app.evaluate(({ ipcMain }) => ipcMain.emit('test:world-update', null, { dimensions: true }))
    await expect(interior.locator('canvas')).toBeVisible()
    await expect(interior.getByText('31 × 30 × 3', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '施設内の住民0を選択' }).click()
    await page.getByLabel('声量プレビュー').selectOption('high')
    await expect(page.getByTestId('voice-recipients')).toHaveText('住民0の声が届く相手: 住民1（同じ家の中のみ）')
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    await page.getByRole('button', { name: '施設内の住民4を選択' }).click()
    await expect(page.getByTestId('voice-recipients')).toHaveText('住民4の声が届く相手: なし')
    await page.getByRole('button', { name: '住宅1 family-a' }).click()
    const canvas = interior.locator('canvas')
    const box = (await canvas.boundingBox())!
    const before = await canvas.screenshot()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 35, { steps: 8 }); await page.mouse.up()
    expect((await canvas.screenshot()).equals(before)).toBe(false)
    await page.mouse.wheel(0, -100)
    await page.getByLabel('表示する高さ上限').fill('0')
    await expect(interior.getByText('高さ上限 z=0', { exact: false })).toBeVisible()
    await page.screenshot({ path: path.join(root, 'residential-3d.png') })
    await page.getByRole('button', { name: '町へ戻る' }).click()
    await expect(page.getByTestId('world-map')).toBeVisible()
    await page.getByRole('button', { name: '1ターン実行', exact: true }).click()
    await expect(page.getByText('Turn 001', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '生活を再開', exact: true }).click()
    await page.getByRole('button', { name: '一時停止', exact: true }).click()
    const result = await page.evaluate(() => window.persona.backendStatus()) as BackendSnapshot & { steps: boolean[] }
    expect(result.steps).toEqual([true, false])
    await page.getByRole('button', { name: '出来事', exact: true }).click()
    const timeline = page.getByRole('region', { name: '出来事の検索' })
    await expect(timeline.getByRole('status')).toHaveText('2 / 2件 · 新しい順')
    await timeline.getByLabel('出来事の住民').selectOption('npc0')
    await expect(timeline.getByRole('article')).toHaveCount(1)
    await timeline.getByLabel('出来事の種類').selectOption('unheard')
    await expect(timeline.getByText('発話 · 受信対象 0人', { exact: true })).toBeVisible()
    await timeline.getByLabel('出来事のターン').fill('0')
    await timeline.getByLabel('出来事を検索').fill('図書室')
    await expect(timeline.getByRole('status')).toHaveText('1 / 2件 · 新しい順')
    await timeline.getByRole('button', { name: '絞り込みを解除' }).click()
    await app.evaluate(({ ipcMain }) => ipcMain.emit('test:world-update', null, { speech: [{ actorId: 'npc2', text: '本を返す約束を覚えています。', recipients: ['npc4'] }] }))
    await expect(timeline.getByRole('status')).toHaveText('3 / 3件 · 新しい順')
    await timeline.getByLabel('出来事の住民').selectOption('npc4')
    await expect(timeline.getByRole('article')).toHaveCount(1)
    await expect(timeline.getByText('発話 · 受信対象 1人', { exact: true })).toBeVisible()
    await timeline.getByRole('button', { name: '住民2', exact: true }).click()
    await expect(page.getByRole('button', { name: '住民2のタブ', exact: true })).toHaveCount(1)
    await timeline.getByLabel('出来事を検索').fill('検索結果なし')
    await expect(timeline.getByText('条件に一致する出来事はありません。')).toBeVisible()
    await timeline.getByRole('button', { name: '絞り込みを解除' }).click()
    await page.screenshot({ path: test.info().outputPath('event-timeline.png') })
    await page.getByRole('button', { name: 'ワールド', exact: true }).click()
    await expect(page.getByTestId('world-map')).toBeVisible()
    expect(errors).toEqual([])
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally { await app.close() }
})
