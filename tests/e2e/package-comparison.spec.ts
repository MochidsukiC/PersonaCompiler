import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: compares actual package files, preserves missing evidence and rechecks both sides without inference`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/package-comparison-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root, state } = await page.evaluate(() => window.persona.snapshot())
    const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
    const binary = Buffer.from([0, 255, 1, 128])
    const manifests: Record<string, { version: number; npcId: string; sourceRevision: number; modelId: string; inputHash: string; promptHash: string; files: Record<string, string> }> = {}
    for (const id of ['baseline', 'current', 'other']) {
      const npcId = id === 'other' ? 'npc1' : 'npc0'
      const directory = path.join(root, `compilation/${id}/npcs/${npcId}`)
      await mkdir(path.join(directory, 'nested'), { recursive: true })
      const files = { 'memories.json': JSON.stringify([{ text: id === 'baseline' ? '本を借りた' : '本を返した' }]), 'nested/asset.bin': binary, [id === 'baseline' ? 'old.txt' : 'new.txt']: 'same renamed bytes' }
      for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content)
      await writeFile(path.join(directory, 'unregistered.txt'), 'outside comparison scope')
      manifests[id] = { version: 1, npcId, sourceRevision: id === 'baseline' ? 1 : 2, modelId: 'synthetic-no-model', inputHash: hash('input'), promptHash: hash('prompt'), files: { ...Object.fromEntries(Object.entries(files).map(([name, content]) => [name, hash(content)])), 'gone.bin': hash('missing') } }
      await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifests[id]))
    }
    await page.locator('button.file-row[title="compilation/current/npcs/npc0/manifest.json"]').click()
    const inspection = page.getByRole('article', { name: 'NPCパッケージの整合性' })
    await expect(inspection.getByRole('status')).toHaveText('1ファイルに差異があります。')
    await inspection.locator('summary').filter({ hasText: '別のパッケージとファイルを比較' }).click()
    const comparison = page.getByRole('region', { name: 'パッケージのファイル比較' })
    const select = comparison.getByRole('combobox', { name: 'ファイル比較の基準' })
    await expect(select.locator('option')).toHaveCount(2)
    const copy = comparison.getByRole('button', { name: 'ファイル比較レポートをコピー' })
    await expect(copy).toHaveCount(0)
    await select.selectOption('compilation/baseline/npcs/npc0/manifest.json')
    await expect(comparison.getByRole('status')).toHaveText('追加 1件 · 削除 1件 · 内容変更 1件 · 内容一致 1件 · 比較不能（欠損） 1件')
    await expect(comparison.locator('li')).toHaveCount(5)
    await expect(comparison.locator('.package-diff-changed')).toContainText('memories.json')
    await expect(comparison.locator('.package-diff-unavailable')).toContainText('gone.bin')
    await expect(comparison.locator('.package-diff-same')).toContainText('nested/asset.bin')
    const readReport = async () => {
      await copy.click()
      await expect(comparison.getByText('ファイル比較と両側の照合記録をコピーしました。')).toBeVisible()
      const text = await app.evaluate(({ clipboard }) => clipboard.readText())
      const blocks = [...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
      expect(blocks).toHaveLength(1)
      return { text, data: JSON.parse(blocks[0][1]) }
    }
    const original = await readReport()
    expect(original.data.before).toMatchObject({ runId: state.runId, npcId: 'npc0', manifestHash: hash(JSON.stringify(manifests.baseline)) })
    expect(original.data.after.manifestHash).toBe(hash(JSON.stringify(manifests.current)))
    expect(original.data.comparison.files.map((file: { path: string }) => file.path)).not.toContain('unregistered.txt')
    for (const id of ['baseline', 'current']) await writeFile(path.join(root, `compilation/${id}/npcs/npc0/memories.json`), '[{"text":"shared external edit"}]')
    await comparison.getByRole('button', { name: '両側を再照合して比較' }).click()
    await expect(comparison.getByRole('status')).toHaveText('追加 1件 · 削除 1件 · 内容変更 0件 · 内容一致 2件 · 比較不能（欠損） 1件')
    const row = comparison.locator('li').filter({ has: page.locator('strong', { hasText: /^memories\.json$/ }) })
    await row.locator('summary').click()
    await expect(row.getByText('manifestから内容変更', { exact: false })).toHaveCount(2)
    const refreshed = await readReport()
    const memory = refreshed.data.comparison.files.find((file: { path: string }) => file.path === 'memories.json')
    expect(memory).toMatchObject({ kind: 'same', before: { status: 'changed', actualHash: hash('[{"text":"shared external edit"}]') }, after: { status: 'changed', actualHash: hash('[{"text":"shared external edit"}]') } })
    expect(refreshed.data.before.checkedAt).not.toBe(original.data.before.checkedAt)
    expect(refreshed.data.after.checkedAt).not.toBe(original.data.after.checkedAt)
    const layout = await inspection.evaluate(element => {
      const bounds = element.getBoundingClientRect(), footer = document.querySelector('.preview-footer')!.getBoundingClientRect()
      const previous = element.scrollTop
      element.scrollTop = element.scrollHeight
      const scrolled = element.scrollTop
      element.scrollTop = previous
      return { bottom: bounds.bottom, footerTop: footer.top, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrolled }
    })
    expect(layout.scrolled).toBeGreaterThan(0)
    expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight)
    expect(layout.bottom).toBeLessThanOrEqual(layout.footerTop + 1)
    await expect(page.locator('.file-preview-heading')).toBeInViewport()
    await expect(page.locator('.preview-footer')).toBeInViewport()
    await expect(page.locator('.world-footer')).toBeInViewport()
    await writeFile(test.info().outputPath('package-comparison-report.md'), refreshed.text)
    await page.screenshot({ path: test.info().outputPath('package-comparison.png') })
    const baselinePath = path.join(root, 'compilation/baseline/npcs/npc0/manifest.json')
    await writeFile(baselinePath, JSON.stringify({ ...manifests.baseline, npcId: 'npc1' }))
    await comparison.getByRole('button', { name: '両側を再照合して比較' }).click()
    await expect(comparison.getByRole('alert')).toContainText('NPC IDと保存先が一致しません')
    await expect(comparison.locator('li')).toHaveCount(0)
    await expect(copy).toHaveCount(0)
    await writeFile(baselinePath, JSON.stringify(manifests.baseline))
    await comparison.getByRole('button', { name: '両側を再照合して比較' }).click()
    await expect(comparison.getByRole('status')).toContainText('内容一致 2件')
    await select.selectOption('')
    await expect(comparison.getByRole('status')).toHaveCount(0)
    await expect(copy).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
