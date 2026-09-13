import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

test('verifies package bytes through the real IPC and displays external changes and missing files', async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/package-inspection-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: '1', PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root } = await page.evaluate(() => window.persona.snapshot())
    const directory = path.join(root, 'compilation/test/npcs/npc0')
    await mkdir(directory, { recursive: true })
    const hash = (text: string) => createHash('sha256').update(text).digest('hex')
    const manifest = { version: 1, npcId: 'npc0', sourceRevision: 4, modelId: 'fixture', inputHash: hash('input'), promptHash: hash('prompt'), files: { 'character.json': hash('{"name":"葵"}'), 'system_prompt.md': hash('この町の住民です。') } }
    await writeFile(path.join(directory, 'character.json'), '{"name":"葵"}')
    await writeFile(path.join(directory, 'system_prompt.md'), 'この町の住民です。')
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
    await page.locator('button.file-row[title="compilation/test/npcs/npc0/manifest.json"]').click()
    const inspection = page.getByRole('article', { name: 'NPCパッケージの整合性' })
    await expect(inspection.getByRole('status')).toHaveText('全2ファイルが一致しました。')
    await writeFile(path.join(directory, 'character.json'), '{"name":"蓮"}')
    await inspection.getByRole('button', { name: 'もう一度照合' }).click()
    await expect(inspection.getByRole('status')).toHaveText('1ファイルに差異があります。')
    await expect(inspection.getByText('内容が変更されています', { exact: false })).toBeVisible()
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, files: { ...manifest.files, 'missing.json': hash('missing') } }))
    await expect(inspection.getByRole('status')).toHaveText('2ファイルに差異があります。')
    await expect(inspection.getByText('ファイルが見つかりません', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('package-inspection.png') })
    await writeFile(path.join(directory, 'manifest.json'), '{invalid')
    await expect(inspection.getByRole('alert')).toBeVisible()
    await expect(inspection.getByRole('status')).toHaveText('照合できませんでした。')
    expect(errors).toEqual([])
  } finally { await app.close() }
})
