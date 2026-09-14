import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: verifies and copies package integrity, then refreshes external changes and missing files`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/package-inspection-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root, state } = await page.evaluate(() => window.persona.snapshot())
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
    const copyReport = inspection.getByRole('button', { name: '照合レポートをコピー' })
    const copiedData = async () => {
      await copyReport.click()
      await expect(inspection.getByText('照合結果とファイルの参照情報をコピーしました。')).toBeVisible()
      const text = await app.evaluate(({ clipboard }) => clipboard.readText())
      const blocks = [...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
      expect(blocks).toHaveLength(1)
      return { text, value: JSON.parse(blocks[0][1]) }
    }
    const originalReport = await copiedData()
    expect(originalReport.value).toMatchObject({ format: 'persona-package-inspection/v1', runId: state.runId, manifestPath: 'compilation/test/npcs/npc0/manifest.json', manifestHash: hash(JSON.stringify(manifest)), inputHash: manifest.inputHash, promptHash: manifest.promptHash })
    expect(originalReport.value.files.map((file: { status: string }) => file.status)).toEqual(['match', 'match'])
    await writeFile(path.join(directory, 'character.json'), '{"name":"蓮"}')
    await inspection.getByRole('button', { name: 'もう一度照合' }).click()
    await expect(inspection.getByRole('status')).toHaveText('1ファイルに差異があります。')
    await expect(inspection.getByText('内容が変更されています', { exact: false })).toBeVisible()
    const changedManifest = { ...manifest, files: { ...manifest.files, 'missing.json': hash('missing') } }
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(changedManifest))
    await expect(inspection.getByRole('status')).toHaveText('2ファイルに差異があります。')
    await expect(inspection.getByText('ファイルが見つかりません', { exact: true })).toBeVisible()
    const refreshedReport = await copiedData()
    expect(refreshedReport.value.manifestHash).toBe(hash(JSON.stringify(changedManifest)))
    expect(refreshedReport.value.manifestHash).not.toBe(originalReport.value.manifestHash)
    expect(refreshedReport.value.checkedAt).not.toBe(originalReport.value.checkedAt)
    expect(refreshedReport.value.files.map((file: { status: string }) => file.status)).toEqual(['changed', 'match', 'missing'])
    expect(refreshedReport.value.files[0].actualHash).toBe(hash('{"name":"蓮"}'))
    expect(refreshedReport.value.files[2]).toMatchObject({ path: 'missing.json', actualHash: null, bytes: null })
    await writeFile(test.info().outputPath('package-inspection-report.md'), refreshedReport.text)
    await page.screenshot({ path: test.info().outputPath('package-inspection.png') })
    await writeFile(path.join(directory, 'manifest.json'), '{invalid')
    await expect(inspection.getByRole('alert')).toBeVisible()
    await expect(inspection.getByRole('status')).toHaveText('照合できませんでした。')
    await expect(copyReport).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
