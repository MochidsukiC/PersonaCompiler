import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { z } from 'zod'
import { inputSchema, type AppEvent } from '../shared/contracts'
import { DemoEngine } from './engine'
import { BackendEngine } from '../backend/engine'
import { CodexRuntime } from '../backend/runtime'
import { PtyTerminals } from '../backend/terminals'
import { backendCommandSchema } from '../core/contracts'
import { messageOf } from './workspace'
import createPersistenceWorker from '../backend/persistence-worker?nodeWorker'

const directory = path.dirname(fileURLToPath(import.meta.url))
let window: BrowserWindow | null = null
let engine: DemoEngine | BackendEngine | null = null
let shutdownComplete = false
let shutdownPending = false

function send(event: AppEvent): void {
  if (window && !window.isDestroyed()) window.webContents.send('persona:event', event)
}

function currentEngine(): DemoEngine | BackendEngine {
  if (!engine) throw new Error('アプリの初期化が完了していません')
  return engine
}

function register(channel: string, operation: (...args: unknown[]) => unknown): void {
  ipcMain.handle(`persona:${channel}`, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('許可されていないIPC送信元です')
    }
    return operation(...args)
  })
}

const identifier = z.string().min(1).max(160)
register('memory-inspection', id => {
  const target = currentEngine()
  if (!(target instanceof BackendEngine)) throw new Error('このワールドは記憶機能の対象外です')
  return target.memoryInspection(identifier.parse(id))
})
register('memory-detail', (id, memoryId, revision) => {
  const target = currentEngine()
  if (!(target instanceof BackendEngine)) throw new Error('このワールドは記憶機能の対象外です')
  return target.memoryDetail(identifier.parse(id), identifier.parse(memoryId), z.number().int().positive().parse(revision))
})
register('snapshot', () => { const engine = currentEngine(); return engine instanceof BackendEngine ? engine.snapshot() : engine.workspace.snapshot() })
register('backend-status', () => {
  const engine = currentEngine()
  if (!(engine instanceof BackendEngine)) throw new Error('デモモードでは実Codexに接続しません')
  return engine.backendStatus()
})
register('backend-command', async input => {
  const engine = currentEngine()
  if (!(engine instanceof BackendEngine)) throw new Error('デモモードでは実Codexに接続しません')
  const command = backendCommandSchema.parse(input)
  const result = await engine.backendCommand(command)
  if (command.type === 'loginChatGpt' && result.login) {
    const url = new URL(result.login.url)
    if (url.protocol !== 'https:' || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].includes(url.hostname)) throw new Error('Codexから返されたログインURLの送信先が不正です')
    await shell.openExternal(url.href)
  }
  return result
})
register('prepare', input => currentEngine().prepare(inputSchema.parse(input)))
register('start-simulation', async step => {
  const target = currentEngine()
  if (!(target instanceof BackendEngine)) throw new Error('自律生活は実Codexの新規ワールドで開始してください')
  await target.backendCommand({ type: 'startSimulation', step: z.boolean().parse(step) })
})
register('pause', () => currentEngine().pause())
register('save-now', () => {
  const target = currentEngine()
  if (!(target instanceof BackendEngine)) throw new Error('デモモードは従来の自動保存を使用します')
  return target.saveNow()
})
register('resume', () => currentEngine().resume())
register('new-run', () => currentEngine().newRun())
register('preview', relative => currentEngine().workspace.preview(z.string().parse(relative)))
register('open-external', async relative => {
  const target = await currentEngine().workspace.resolve(z.string().parse(relative))
  if (!['.md', '.txt', '.json', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(target).toLowerCase())) throw new Error('この形式は外部アプリで開けません')
  const error = await shell.openPath(target)
  if (error) throw new Error(`外部アプリで開けませんでした: ${error}`)
})
register('reveal', async relative => {
  const value = z.string().parse(relative)
  if (value === '') {
    const error = await shell.openPath(currentEngine().workspace.root)
    if (error) throw new Error(`フォルダーを開けませんでした: ${error}`)
  } else shell.showItemInFolder(await currentEngine().workspace.resolve(value))
})
register('terminal-snapshot', id => { const target = currentEngine(); const sessionId = identifier.parse(id); return target instanceof BackendEngine ? target.terminalSnapshot(sessionId) : target.sessions.snapshot(sessionId) })
register('conversation', (id, cursor) => {
  const target = currentEngine()
  if (!(target instanceof BackendEngine)) throw new Error('メッセージ履歴は実Codex接続時に利用できます')
  return target.conversation(identifier.parse(id), z.string().max(100).optional().parse(cursor))
})
register('terminal-input', (id, data) => currentEngine().terminalInput(identifier.parse(id), z.string().max(65536).parse(data)))
register('terminal-resize', (id, columns, rows) => currentEngine().sessions.resize(identifier.parse(id), z.number().int().min(2).max(500).parse(columns), z.number().int().min(1).max(200).parse(rows)))
register('terminal-interrupt', id => currentEngine().interrupt(identifier.parse(id)))

app.whenReady().then(async () => {
  const base = process.env.PERSONA_DATA_DIR ?? path.join(app.getPath('userData'), 'runs')
  if (process.env.PERSONA_TEST === '1' || process.env.PERSONA_ENGINE === 'demo') {
    engine = new DemoEngine(base, send, process.env.PERSONA_TEST === '1' ? 300 : 1800)
  } else {
    const runtime = new CodexRuntime(process.env.PERSONA_CODEX_HOME ?? path.join(app.getPath('userData'), 'codex'))
    const terminals = new PtyTerminals(runtime, chunk => send({ type: 'terminal', chunk }), message => send({ type: 'error', message }))
    engine = new BackendEngine(base, runtime, terminals, send, undefined, () => createPersistenceWorker({}))
  }
  await engine.initialize()
  window = new BrowserWindow({
    width: 1560, height: 980, minWidth: 1100, minHeight: 720, title: 'Persona Compiler',
    backgroundColor: '#111716', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(directory, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.once('ready-to-show', () => { if (process.env.PERSONA_TEST !== '1') window?.show() })
  window.on('closed', () => { window = null })
  window.on('close', event => { if (!shutdownComplete) { event.preventDefault(); app.quit() } })
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(path.join(directory, '../renderer/index.html'))
}).catch(error => { console.error('起動に失敗しました:', error); app.exit(1) })

app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (shutdownComplete || !engine) return
  event.preventDefault()
  if (!shutdownPending) void shutdown()
})

async function shutdown(): Promise<void> {
  shutdownPending = true
  try {
    await engine!.close()
    shutdownComplete = true; app.quit()
  } catch (error) {
    const result = await dialog.showMessageBox({ type: 'error', title: '終了前の保存に失敗しました', message: 'アプリを開いたまま未保存データを保持しています。', detail: messageOf(error), buttons: ['再試行', '終了を取り消す', '保存せず終了'], defaultId: 0, cancelId: 1, noLink: true })
    shutdownPending = false
    if (result.response === 0) { await shutdown(); return }
    if (result.response === 1) { if (engine instanceof BackendEngine) engine.cancelClose(); return }
    if (engine instanceof BackendEngine) {
      try { await engine.discardClose() }
      catch (error) { engine.cancelClose(); send({ type: 'error', message: `プロセス停止に失敗したためウィンドウを保持しています: ${messageOf(error)}` }); return }
    }
    shutdownComplete = true; app.quit()
  } finally { shutdownPending = false }
}
