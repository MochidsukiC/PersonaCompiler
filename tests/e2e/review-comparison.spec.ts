import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CharacterReview } from '../../src/core/character-review'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: compares saved NPC reviews, refreshes changed evidence and rejects mismatched or malformed baselines`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/review-comparison-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root } = await page.evaluate(() => window.persona.snapshot())
    const original: CharacterReview = { version: 1, npcId: 'npc0', name: '葵', sourceRevision: 2, modelId: 'fixture', memoryCount: 1, relationshipCount: 0,
      sections: [{ title: '人格', claims: [{ text: '約束を守る', evidence: ['event:1'] }, { text: '工房で働く', evidence: ['event:1'] }] }],
      sources: [{ id: 'event:1', title: '約束の記録', text: '借りた本を返す' }], runtimeGuidance: '生活経験に従う', systemPrompt: '工房の住民として応答する' }
    const current: CharacterReview = { ...original, sourceRevision: 3, sections: [{ title: '人格', claims: [{ text: '約束を守る', evidence: ['event:1'] }, { text: '宇宙船を修理する', evidence: ['event:1'] }] }], systemPrompt: '宇宙船の船員として応答する' }
    const save = async (id: string, value: unknown, npcId = 'npc0') => {
      const directory = path.join(root, `compilation/${id}/npcs/${npcId}`)
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'review.json'), JSON.stringify(value))
    }
    await save('baseline', original)
    await save('current', current)
    await save('other', { ...original, npcId: 'npc1' }, 'npc1')
    await page.locator('button.file-row[title="compilation/current/npcs/npc0/review.json"]').click()
    await expect(page.getByLabel('制作レビューを検索')).toBeVisible()
    await page.locator('summary').filter({ hasText: '別の出力と比較' }).click()
    const comparison = page.getByRole('region', { name: '制作レビューの比較' })
    const select = comparison.getByRole('combobox', { name: '比較の基準' })
    await expect(select.locator('option')).toHaveCount(2)
    await select.selectOption('compilation/baseline/npcs/npc0/review.json')
    await expect(comparison.getByRole('status')).toHaveText('追加 1件 · 削除 1件 · 根拠変更 0件 · 設定一致 1件')
    await expect(comparison.locator('.review-change-removed')).toContainText('工房で働く')
    await expect(comparison.locator('.review-change-added')).toContainText('宇宙船を修理する')
    await comparison.locator('summary').filter({ hasText: 'Runtime Promptの変更' }).click()
    await expect(comparison.getByText(original.systemPrompt, { exact: true })).toBeVisible()
    await expect(comparison.getByText(current.systemPrompt, { exact: true })).toBeVisible()
    await save('baseline', { ...original, sources: [{ ...original.sources[0], text: '返却の約束を取り消した' }] })
    await expect(comparison.getByRole('status')).toHaveText('追加 1件 · 削除 1件 · 根拠変更 1件 · 設定一致 0件')
    await comparison.locator('.review-change-evidence summary').click()
    await expect(comparison.locator('.review-change-evidence').getByText('返却の約束を取り消した', { exact: true })).toBeVisible()
    await expect(comparison.locator('.review-change-evidence').getByText('借りた本を返す', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('review-comparison.png') })
    await save('baseline', { ...original, npcId: 'npc1' })
    await expect(comparison.getByRole('alert')).toContainText('NPCが一致しません')
    await expect(comparison.locator('.review-change')).toHaveCount(0)
    await writeFile(path.join(root, 'compilation/baseline/npcs/npc0/review.json'), '{broken')
    await expect(comparison.getByRole('alert')).toContainText('比較できません')
    await expect(comparison.getByRole('alert')).not.toContainText('NPCが一致しません')
    await save('baseline', current)
    await comparison.getByRole('button', { name: '基準を再読み込み' }).click()
    await expect(comparison.getByText('比較対象の設定・根拠・指針・メタデータは一致しています。')).toBeVisible()
    await select.selectOption('')
    await expect(comparison.getByRole('status')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
