import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CharacterReview } from '../../src/core/character-review'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: keeps repeated section headings consistent with filtered claims and copied reports`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/review-duplicate-sections-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root } = await page.evaluate(() => window.persona.snapshot())
    const review: CharacterReview = { version: 1, npcId: 'sample', name: '同じ見出しを持つ合成資料', sourceRevision: 1, modelId: 'fixture', memoryCount: 0, relationshipCount: 0,
      sections: [
        { title: '判断', claims: [{ text: '観察して待つ', evidence: ['route:A'] }] },
        { title: '判断', claims: [{ text: '分岐で相談する', evidence: ['route:B'] }] },
        { title: '台詞', claims: [{ text: '補助の返答を使う', evidence: ['dialogue:C'] }] }
      ],
      sources: [{ id: 'route:A', title: '経路A', text: '観察の資料' }, { id: 'route:B', title: '経路B', text: '分岐の資料' }, { id: 'dialogue:C', title: '会話C', text: '補助の資料' }],
      runtimeGuidance: '', systemPrompt: '合成資料' }
    const relative = 'compilation/test/npcs/sample/review.json'
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), JSON.stringify(review))
    await page.locator(`button.file-row[title="${relative}"]`).click()
    const article = page.getByRole('article', { name: 'NPC制作レビュー' })
    const query = article.getByLabel('制作レビューを検索')
    const scope = article.getByLabel('制作レビューの検索対象')
    const claims = article.locator('.review-claim')
    await expect(claims.locator('p')).toHaveText(review.sections.map(section => section.claims[0].text))
    for (const [text, indices] of [['補助', [2]], ['判断', [0, 1]], ['分岐', [1]], ['観察', [0]], ['該当なし', []], ['', [0, 1, 2]]] as const) {
      await query.fill(text)
      const expected = indices.map(index => review.sections[index].claims[0].text)
      await expect(article.getByRole('status')).toHaveText(`${expected.length} / 3件の設定`)
      await expect(claims.locator('p')).toHaveText(expected)
      await article.getByRole('button', { name: '設定の検索レポートをコピー' }).click()
      await expect(article.getByText('設定の検索結果と根拠をコピーしました。', { exact: true })).toBeVisible()
      const markdown = await app.evaluate(({ clipboard }) => clipboard.readText())
      const blocks = [...markdown.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
      expect(blocks).toHaveLength(1)
      const data = JSON.parse(blocks[0][1])
      expect(data.matchedClaims).toBe(expected.length)
      expect(data.sections.flatMap((section: CharacterReview['sections'][number]) => section.claims.map(claim => claim.text))).toEqual(expected)
    }
    await scope.selectOption('evidence')
    await query.fill('会話C')
    await expect(claims.locator('p')).toHaveText(['補助の返答を使う'])
    await claims.getByRole('button', { name: '根拠 3 · 検索一致', exact: true }).click()
    await expect(article.getByRole('region', { name: '設定の根拠' })).toContainText('dialogue:C')
    await page.screenshot({ path: test.info().outputPath('duplicate-sections.png') })
    expect(errors).toEqual([])
  } finally { await app.close() }
})
