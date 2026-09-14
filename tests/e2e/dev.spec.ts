import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'

test('edits DEV prompts, branches before world generation and restores historical prompts without model inference', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/e2e/dev-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...env, PERSONA_TEST: '0', PERSONA_ENGINE: 'codex', PERSONA_DATA_DIR: root, PERSONA_CODEX_HOME: path.join(root, 'codex') } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'DEV', exact: true }).click()
    await page.getByRole('button', { name: 'DEVを有効にする' }).click()
    await expect(page.getByRole('button', { name: 'DEV ON', exact: true })).toBeVisible()
    await expect(page.getByLabel('DEVチェックポイント').locator('option')).toHaveCount(2)
    const original = await page.evaluate(() => window.persona.snapshot())
    const point = (await page.evaluate(() => window.persona.devPanel())).checkpoints[0]
    await page.getByLabel('DEV編集対象').selectOption('parent')
    await page.getByLabel('DEVプロンプト', { exact: true }).fill('DEV_E2E_EDITED_PARENT')
    await page.getByRole('button', { name: '保存して適用' }).click()
    await expect(page.getByRole('region', { name: 'DEV研究モード' }).getByRole('status')).toContainText('保存し、既存Conversationへ適用')
    await page.getByLabel('DEVチェックポイント').selectOption(`${point.runId}:${point.id}`)
    await page.getByRole('button', { name: 'この地点から実験分岐を作る' }).click()
    await expect.poll(async () => (await page.evaluate(() => window.persona.snapshot())).state.runId).not.toBe(original.state.runId)
    await expect.poll(async () => (await page.evaluate(() => window.persona.backendStatus())).dev?.busy).toBe(false)
    await page.getByLabel('DEV編集対象').selectOption('parent')
    await expect(page.getByLabel('DEVプロンプト', { exact: true })).toHaveValue('DEV_E2E_EDITED_PARENT')
    await page.reload()
    await page.getByRole('button', { name: 'DEV ON', exact: true }).click()
    await page.getByLabel('DEV編集対象').selectOption('parent')
    await expect(page.getByLabel('DEVプロンプト', { exact: true })).toHaveValue('DEV_E2E_EDITED_PARENT')
    await page.getByLabel('DEVチェックポイント').selectOption(`${point.runId}:${point.id}`)
    await page.getByLabel('DEV復元プロンプト').selectOption('checkpoint')
    await page.getByRole('button', { name: 'この地点から実験分岐を作る' }).click()
    await expect.poll(async () => (await page.evaluate(() => window.persona.devPanel())).state?.revision).toBe(0)
    await expect.poll(async () => (await page.evaluate(() => window.persona.backendStatus())).dev?.busy).toBe(false)
    expect((await page.evaluate(() => window.persona.backendStatus())).preparation.sessions).toEqual([])
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.screenshot({ path: path.join(root, 'dev-panel.png') })
  } finally { await app.close() }
})
