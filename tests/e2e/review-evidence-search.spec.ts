import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CharacterReview } from '../../src/core/character-review'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: finds settings by cited source text, title and arbitrary ID`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/review-evidence-search-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root } = await page.evaluate(() => window.persona.snapshot())
    const review: CharacterReview = { version: 1, npcId: 'sample', name: '合成の案内役', sourceRevision: 2, modelId: 'fixture', memoryCount: 0, relationshipCount: 0,
      sections: [{ title: '判断', claims: [{ text: '相手の意見を聞く', evidence: ['script:Route-B/phase-2', 'localization:line-7'] }, { text: '静かな場所を好む', evidence: ['localization:line-7'] }] },
        { title: '話し方', claims: [{ text: '理由を説明する', evidence: ['script:Route-B/phase-2'] }] }],
      sources: [{ id: 'script:Route-B/phase-2', title: '分岐の保存資料', text: '青い扉の前で立ち止まり、仲間に相談した。' },
        { id: 'localization:line-7', title: '翻訳版の資料', text: '<img src=x onerror=alert(1)>周囲の様子を確認した。' }],
      runtimeGuidance: '合成資料', systemPrompt: '合成資料' }
    const directory = path.join(root, 'compilation/test/npcs/sample')
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'review.json'), JSON.stringify(review))
    await page.locator('button.file-row[title="compilation/test/npcs/sample/review.json"]').click()
    const article = page.getByRole('article', { name: 'NPC制作レビュー' })
    const scope = article.getByLabel('制作レビューの検索対象')
    const query = article.getByLabel('制作レビューを検索')
    const claims = article.locator('.review-claim')
    await expect(scope).toHaveValue('claims')
    await query.fill('青い扉')
    await expect(claims).toHaveCount(0)
    await scope.selectOption('evidence')
    await expect(claims).toHaveCount(2)
    await expect(article.getByRole('status')).toHaveText('2 / 3件の設定')
    await expect(claims).toContainText(['相手の意見を聞く', '理由を説明する'])
    await expect(claims.first().getByRole('button', { name: '根拠 2', exact: true })).toBeVisible()
    await claims.first().getByRole('button', { name: '根拠 1 · 検索一致', exact: true }).click()
    await expect(article.getByRole('region', { name: '設定の根拠' })).toContainText('青い扉の前で立ち止まり、仲間に相談した。')
    await article.getByRole('button', { name: '根拠を閉じる' }).click()
    await article.getByRole('heading', { name: '合成の案内役', exact: true }).scrollIntoViewIfNeeded()
    await expect(query).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('evidence-search.png') })
    await query.fill('  SCRIPT:route-b/PHASE-2  ')
    await expect(claims).toContainText(['相手の意見を聞く', '理由を説明する'])
    await query.fill('翻訳版')
    await expect(claims).toContainText(['相手の意見を聞く', '静かな場所を好む'])
    await claims.first().getByRole('button', { name: '根拠 2 · 検索一致', exact: true }).click()
    await expect(article.getByRole('region', { name: '設定の根拠' })).toContainText('<img src=x onerror=alert(1)>')
    await expect(article.locator('img')).toHaveCount(0)
    await query.fill('静か')
    await expect(claims).toHaveCount(0)
    await scope.selectOption('all')
    await expect(claims).toContainText(['静かな場所を好む'])
    await expect(claims.getByRole('button', { name: '根拠 2', exact: true })).toBeVisible()
    await query.fill('青い扉')
    await expect(claims).toHaveCount(2)
    await query.fill('存在しない語句')
    await expect(article.getByText('検索条件に一致する設定はありません。')).toBeVisible()
    await query.fill(' ')
    await expect(claims).toHaveCount(3)
    await expect(claims.getByRole('button', { name: /検索一致/ })).toHaveCount(0)
    await scope.selectOption('claims')
    await query.fill('判断')
    await expect(claims).toContainText(['相手の意見を聞く', '静かな場所を好む'])
    expect(errors).toEqual([])
  } finally { await app.close() }
})
