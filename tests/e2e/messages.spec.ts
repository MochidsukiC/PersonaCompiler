import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { emptyPreparation } from '../../src/core/contracts'
import type { ConversationTurn } from '../../src/shared/conversation'

test('NPC message history, tool details, view switching, scrolling and explicit load errors', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/messages-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: root } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.getByText('接続とモデル設定', { exact: true })).toBeVisible()
    const original = await page.evaluate(() => window.persona.snapshot())
    const situationMessage = await readFile('tests/fixtures/situation-message.txt', 'utf8')
    const turns: ConversationTurn[] = [{ id: 'turn-1', status: 'completed', startedAt: 1789200000, items: [
      { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '今日はどこへ行きますか？' }] },
      { id: 'speech-1', type: 'userMessage', content: [{ type: 'text', text: JSON.stringify({ kind: 'heardSpeech', eventId: 454, turn: 2, speaker: { id: 'npc_009', name: '小川 恵', position: { x: 22, y: 12, z: 0 } }, volume: 'medium', text: '今日はここまでにしましょう。' }) }] },
      { id: 'reply-1', type: 'userMessage', content: [{ type: 'text', text: JSON.stringify({ kind: 'facilityResponse', facilityId: 'school', text: '図書室を利用できます。' }) }] },
      { id: 'situation-1', type: 'userMessage', content: [{ type: 'text', text: situationMessage }] },
      { id: 'agent-1', type: 'agentMessage', text: '【心の声】図書室で静かに本を読みたいな。', phase: 'commentary' },
      { id: 'tool-1', type: 'dynamicToolCall', tool: 'getSituation', arguments: {}, status: 'completed', success: true, contentItems: [{ type: 'inputText', text: '{"location":"図書室","people":2}' }] },
      { id: 'sent-1', type: 'dynamicToolCall', tool: 'sendMessage', arguments: { text: 'みなさん、おはようございます。\n図書室へ行ってきます。', volume: 'high' }, status: 'completed', success: true, contentItems: [{ type: 'inputText', text: '{"eventId":455,"recipients":[]}' }] },
      { id: 'sent-failed', type: 'dynamicToolCall', tool: 'sendMessage', arguments: { text: '失敗した発言です。', volume: 'low' }, status: 'completed', success: false, contentItems: [{ type: 'inputText', text: '活動していません。' }] },
      { id: 'sent-pending', type: 'dynamicToolCall', tool: 'sendMessage', arguments: { text: '未完了の発言です。', volume: 'medium' }, status: 'inProgress', success: null, contentItems: null },
      { id: 'agent-2', type: 'agentMessage', text: '【独り言】さて、そろそろ出かけよう。', phase: 'final_answer' },
      { id: 'tool-2', type: 'dynamicToolCall', tool: 'moveToFacility', arguments: { facilityId: 'closed' }, status: 'completed', success: false, contentItems: [{ type: 'inputText', text: 'その施設には移動できません。' }] }
    ] }]
    await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
      const snapshot = fixture.original
      snapshot.backend = { connection: 'connected', authenticated: true, authMode: 'chatgpt', login: null, error: null, models: [], settings: null, preparation: fixture.preparation }
      snapshot.state.agents = ['葵', '楓'].map((name, i) => ({ id: `npc${i}`, name, sessionId: `session-${i}`, parentId: null, role: 'npc', status: 'idle', color: '#b5cea3' }))
      let history = fixture.turns
      let failed = false
      ipcMain.on('test:messages', (_event, update: { turns?: typeof history; failed?: boolean }) => {
        if (update.turns) history = update.turns
        if (update.failed !== undefined) failed = update.failed
      })
      for (const channel of ['snapshot', 'conversation', 'terminal-snapshot', 'terminal-resize']) ipcMain.removeHandler(`persona:${channel}`)
      ipcMain.handle('persona:snapshot', () => snapshot)
      ipcMain.handle('persona:conversation', (_event, id: string) => {
        if (failed) throw new Error('fixture: history unavailable')
        return id === 'session-0' ? history : []
      })
      ipcMain.handle('persona:terminal-snapshot', (_event, id: string) => ({ sessionId: id, sequence: 1, columns: 100, rows: 30, data: '既存のCodex会話\r\n' }))
      ipcMain.handle('persona:terminal-resize', () => undefined)
      snapshot.version++
      BrowserWindow.getAllWindows()[0].webContents.send('persona:event', { type: 'workspace', snapshot })
    }, { original, turns, preparation: emptyPreparation() })
    await page.getByRole('button', { name: '葵の端末を開く', exact: true }).click()
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    await page.getByRole('button', { name: 'メッセージ', exact: true }).click()
    const messages = page.getByLabel('葵のメッセージ', { exact: true })
    await expect(messages.getByText('今日はどこへ行きますか？', { exact: true })).toBeVisible()
    await expect(messages.getByText('小川 恵 · 普通の声 · ターン 2', { exact: true })).toBeVisible()
    await expect(messages.getByText('今日はここまでにしましょう。', { exact: true })).toBeVisible()
    await expect(messages.getByText('図書室を利用できます。', { exact: true })).toBeVisible()
    await expect(messages.locator('.message-bubble').filter({ hasText: 'heardSpeech' })).toHaveCount(0)
    await expect(messages.locator('.message-bubble').filter({ hasText: 'facilityResponse' })).toHaveCount(0)
    await expect(messages.getByText('状況通知 · 1日目・夕 · ターン 3', { exact: true })).toBeVisible()
    await expect(messages.locator('.message-bubble').filter({ hasText: '現在地：森かげ公園 (29, 8, 0)' })).toHaveCount(1)
    await expect(messages.locator('.message-bubble').filter({ hasText: 'memorySources' })).toHaveCount(0)
    await expect(messages.locator('.thought-bubble')).toHaveCount(2)
    await expect(messages.getByText('葵 · 心の声 · 途中経過', { exact: true })).toBeVisible()
    await expect(messages.getByText('葵 · 独り言', { exact: true })).toBeVisible()
    await expect(messages.getByText('ユーザーにのみ表示', { exact: true })).toHaveCount(2)
    const sent = messages.locator('.message-row.npc').filter({ hasText: '葵 · 発言 · 大声' })
    await expect(sent.locator('.message-bubble')).toHaveText('みなさん、おはようございます。\n図書室へ行ってきます。')
    await expect(sent.locator('.thought-bubble')).toHaveCount(0)
    await expect(sent.locator('.thought-visibility')).toHaveCount(0)
    await expect(sent.locator('xpath=preceding-sibling::*[1]')).toContainText('sendMessage')
    await expect(messages.locator('.message-bubble').filter({ hasText: '失敗した発言です。' })).toHaveCount(0)
    await expect(messages.locator('.message-bubble').filter({ hasText: '未完了の発言です。' })).toHaveCount(0)
    await expect(page.getByTestId('terminal')).toBeHidden()
    await messages.locator('summary').filter({ hasText: 'getSituation' }).click()
    await expect(messages.getByText('{"location":"図書室","people":2}', { exact: true })).toBeVisible()
    await expect(messages.locator('.message-tool.failed summary')).toHaveCount(2)
    await expect(messages.locator('.message-tool.failed summary').filter({ hasText: 'sendMessage' })).toContainText('失敗')
    await expect(messages.locator('.message-tool.failed summary').filter({ hasText: 'moveToFacility' })).toContainText('失敗')
    await page.screenshot({ path: test.info().outputPath('npc-messages.png') })
    await page.getByRole('button', { name: 'Codex', exact: true }).click()
    await expect(page.getByTestId('terminal')).toBeVisible()
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-ready', 'true')
    await page.getByRole('button', { name: 'メッセージ', exact: true }).click()
    await expect(messages.locator('.message-row')).toHaveCount(7)
    const longHistory = [...turns, ...Array.from({ length: 12 }, (_, i) => ({ id: `turn-${i + 2}`, status: 'completed', items: [{ id: `more-${i}`, type: 'agentMessage', text: `NPCの出力 ${i}\n${'会話の内容です。'.repeat(8)}` }] }))]
    await app.evaluate(({ ipcMain }, turns) => ipcMain.emit('test:messages', null, { turns }), longHistory)
    await expect(messages.locator('.message-row')).toHaveCount(19)
    await messages.locator('.message-scroll').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
    await expect(messages.getByRole('button', { name: '最新へ' })).toBeVisible()
    await page.waitForTimeout(1700)
    expect(await messages.locator('.message-scroll').evaluate(element => element.scrollTop)).toBe(0)
    await messages.getByRole('button', { name: '最新へ' }).click()
    await expect(messages.getByRole('button', { name: '最新へ' })).toBeHidden()
    await app.evaluate(({ ipcMain }) => ipcMain.emit('test:messages', null, { failed: true }))
    await expect(messages.getByRole('alert')).toContainText('fixture: history unavailable')
    await expect(messages.getByRole('alert')).toContainText('最新ではありません')
    await app.evaluate(({ ipcMain }) => ipcMain.emit('test:messages', null, { failed: false }))
    await messages.getByRole('button', { name: '再読み込み' }).click()
    await expect(messages.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: '楓の端末を開く', exact: true }).click()
    await page.getByRole('button', { name: 'メッセージ', exact: true }).click()
    await expect(page.getByText('まだメッセージはありません', { exact: true })).toBeVisible()
    await expect(page.getByText('今日はどこへ行きますか？', { exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
