import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { models, settings, round, draft, population } from '../backend/fixtures'
import { emptyPreparation, type BackendSnapshot, type BackendCommand } from '../../src/core/contracts'
import type { WorkspaceSnapshot } from '../../src/shared/contracts'

test('ended parent terminal can resume while preparation is busy', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/resume-ui-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: root } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const backend: BackendSnapshot = { connection: 'connected', authMode: 'chatgpt', authenticated: true, login: null, models, settings, preparation: { ...emptyPreparation(), phase: 'interview', busy: true }, error: null }
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot: WorkspaceSnapshot = { ...fixture.original, backend: fixture.backend }
      snapshot.state.agents = [{ id: 'parent', sessionId: 'parent', name: 'オーケストレーター', parentId: null, role: 'parent', status: 'ended', color: '#b0c0f4' }]
      const commands: BackendCommand[] = []
      const publish = () => { snapshot.version++; BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot }) }
      for (const channel of ['snapshot', 'backend-status', 'backend-command', 'terminal-snapshot', 'terminal-resize']) ipcMain.removeHandler(`persona:${channel}`)
      ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.handle('persona:backend-status', () => ({ ...snapshot.backend!, commands }))
      ipcMain.handle('persona:terminal-snapshot', () => ({ sessionId: 'parent', sequence: 7, columns: 100, rows: 30, data: 'Saved conversation\r\n' }))
      ipcMain.handle('persona:terminal-resize', () => undefined)
      ipcMain.handle('persona:backend-command', (_event, command: BackendCommand) => {
        commands.push(command)
        if (command.type !== 'terminalReconnect' || command.sessionId !== 'parent') throw new Error('Unexpected reconnect command')
        snapshot.state.agents[0].status = 'running'
        publish(); return snapshot.backend
      })
      publish()
    }, { original, backend })
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    await expect(page.getByText('端末終了・会話は保存済み', { exact: false })).toBeVisible()
    const reconnect = page.getByRole('button', { name: '再接続', exact: true })
    await expect(reconnect).toBeEnabled()
    await reconnect.click()
    await expect(reconnect).toBeDisabled()
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    const captured = await page.evaluate(() => window.persona.backendStatus()) as BackendSnapshot & { commands: BackendCommand[] }
    expect(captured.commands).toEqual([{ type: 'terminalReconnect', sessionId: 'parent' }])
    expect(captured.preparation.busy).toBe(true)
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally { await app.close() }
})

test('real backend authentication screen, isolated App Server and Electron native PTY', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/backend-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: path.join(root, 'runs'), PERSONA_CODEX_HOME: path.join(root, 'codex') } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'ChatGPTで接続', exact: true }).click()
    await expect(page.getByRole('button', { name: 'ChatGPTにログイン', exact: true })).toBeVisible({ timeout: 20000 })
    const backend = await page.evaluate(() => window.persona.backendStatus())
    expect(backend.authenticated).toBe(false)
    expect(backend.models.length).toBeGreaterThan(0)
    expect(backend.preparation.sessions).toEqual([])
    expect((await page.evaluate(() => window.persona.snapshot())).state.frame.turn).toBe(0)
    await page.screenshot({ path: path.join(root, 'authentication.png') })
    const output = await app.evaluate(async (_electron, modulePath) => {
      const pty = process.mainModule!.require(modulePath) as typeof import('node-pty')
      return new Promise<string>((resolve, reject) => {
        const processPty = pty.spawn('C:\\Windows\\System32\\cmd.exe', ['/d', '/c', 'echo PERSONA_PTY_OK'], { cols: 100, rows: 30 })
        let output = ''
        const timer = setTimeout(() => reject(new Error('Electron native PTY timed out')), 10000)
        processPty.onData(data => { output += data })
        processPty.onExit(() => { clearTimeout(timer); resolve(output) })
      })
    }, path.resolve('node_modules/node-pty/lib/index.js'))
    expect(output).toContain('PERSONA_PTY_OK')
  } finally { await app.close() }
})

test('preparation UI submits Auto settings, free answers, revisions and exact approval against an IPC fixture', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/preparation-ui-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: root } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const backend: BackendSnapshot = { connection: 'connected', authMode: 'chatgpt', authenticated: true, login: null, models, settings, preparation: emptyPreparation(), error: null }
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot: WorkspaceSnapshot = { ...fixture.original, backend: fixture.backend }
      const commands: BackendCommand[] = []
      const view = snapshot.backend!
      const publish = () => { snapshot.version++; BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot }) }
      ipcMain.removeHandler('persona:backend-command')
      ipcMain.removeHandler('persona:backend-status')
      ipcMain.removeHandler('persona:prepare')
      ipcMain.handle('persona:backend-status', () => ({ ...view, commands }))
      ipcMain.handle('persona:backend-command', (_event, command: BackendCommand) => {
        commands.push(command)
        const p = view.preparation
        if (command.type === 'settings') {
          view.settings = command.settings
          p.sessions = [{ agentId: 'parent', sessionId: 'parent', role: 'parent', threadId: 'fixture-parent', cwd: fixture.original.root, modelId: command.settings.parent.modelId, effort: command.settings.parent.effort, creation: 'initialized', seedPersisted: true }]
        } else if (command.type === 'answers') {
          p.answers = [command.value]; p.round = null; p.draft = fixture.draft; p.revision = 1; p.phase = 'review'
          snapshot.state.map = fixture.draft.map; snapshot.state.frame.mapRevision = 1
        } else if (command.type === 'revise') {
          p.draft = { ...fixture.draft, revision: 2, map: { ...fixture.draft.map, revision: 2 } }; p.revision = 2
          snapshot.state.map = p.draft.map; snapshot.state.frame.mapRevision = 2
        } else if (command.type === 'approve') {
          p.lock = { revision: command.revision, hash: 'fixture-hash', approvedAt: new Date().toISOString() }; p.phase = 'ready'; p.population = fixture.population; snapshot.state.stage = 'ready'
        }
        publish(); return view
      })
      ipcMain.handle('persona:prepare', () => { view.preparation.phase = 'interview'; view.preparation.round = fixture.round; snapshot.state.stage = 'preparing'; publish() })
      publish()
    }, { original, backend, round, draft, population })
    await page.getByLabel('NPCモデル', { exact: true }).selectOption('auto')
    await page.getByLabel('NPC effort', { exact: true }).selectOption('auto')
    await expect(page.getByText('NPC年齢 → 要求effort → 実効effort')).toBeVisible()
    await page.getByRole('button', { name: '設定を保存して親端末を作成' }).click()
    await page.getByLabel('地域の説明').fill('5人、学校、職場のある町')
    await page.getByRole('button', { name: '資料を送信してヒアリングを開始' }).click()
    for (const q of round.questions) await page.getByLabel(`${q.question} 自由記述`, { exact: true }).fill('自由回答で進めます')
    await page.getByRole('button', { name: 'まとめて回答を送信' }).click()
    await expect(page.getByRole('button', { name: 'revision 1を承認' })).toBeVisible()
    await expect(page.getByTestId('world-map')).toBeVisible()
    await page.getByLabel('仕様の修正依頼').fill('学校を移動してください')
    await page.getByRole('button', { name: '親へ修正を依頼' }).click()
    await expect(page.getByRole('button', { name: 'revision 2を承認' })).toBeVisible()
    await page.screenshot({ path: path.join(root, 'review.png') })
    await page.getByRole('button', { name: 'revision 2を承認' }).click()
    await expect(page.getByText('初期ワールドの準備完了', { exact: true })).toBeVisible()
    const captured = await page.evaluate(() => window.persona.backendStatus()) as BackendSnapshot & { commands: BackendCommand[] }
    expect(captured.commands[0]).toMatchObject({ type: 'settings', settings: { npc: { model: { mode: 'auto' }, effort: { mode: 'auto' } } } })
    expect(captured.commands.at(-1)).toEqual({ type: 'approve', revision: 2 })
  } finally { await app.close() }
})
