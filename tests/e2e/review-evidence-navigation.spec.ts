import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CharacterReview } from '../../src/core/character-review'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: returns to the same evidence from repeated citations in a long review`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/review-evidence-navigation-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root } = await page.evaluate(() => window.persona.snapshot())
    const sourceId = 'script:Route-A/phase-9'
    const review: CharacterReview = { version: 1, npcId: 'sample', name: '資料ナビゲーションの合成例', sourceRevision: 2, modelId: 'fixture', memoryCount: 0, relationshipCount: 0,
      sections: [{ title: '場面ごとの判断', claims: Array.from({ length: 36 }, (_, index) => ({ text: `場面 ${index + 1} の制作設定`, evidence: [sourceId] })) }],
      sources: [{ id: sourceId, title: '共通して参照する分岐資料', text: 'ルートの終点で仲間の言葉を聞き、進む方向を決めた。' }], runtimeGuidance: '', systemPrompt: '' }
    const directory = path.join(root, 'compilation/test/npcs/sample')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'review.json'), JSON.stringify(review))
    await page.locator('button.file-row[title="compilation/test/npcs/sample/review.json"]').click()
    const article = page.getByRole('article', { name: 'NPC制作レビュー' })
    const citations = article.getByRole('button', { name: '根拠 1', exact: true })
    const source = article.getByRole('region', { name: '設定の根拠' })
    const heading = source.getByRole('heading', { name: '共通して参照する分岐資料' })
    await citations.first().click()
    await expect(heading).toBeInViewport()
    await expect(source).toContainText(sourceId)
    await citations.nth(1).scrollIntoViewIfNeeded()
    await expect(heading).not.toBeInViewport()
    await citations.nth(1).click()
    await expect(heading).toBeInViewport()
    await citations.nth(1).scrollIntoViewIfNeeded()
    await expect(heading).not.toBeInViewport()
    await citations.nth(1).click()
    await expect(heading).toBeInViewport()
    await expect(source).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('evidence-navigation.png') })
    await source.getByRole('button', { name: '根拠を閉じる' }).click()
    await expect(source).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
