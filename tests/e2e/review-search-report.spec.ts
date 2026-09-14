import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { CharacterReview } from '../../src/core/character-review'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: copies filtered settings with all cited evidence and refreshes source hashes`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/review-search-report-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root, state } = await page.evaluate(() => window.persona.snapshot())
    const review: CharacterReview = { version: 1, npcId: 'sample', name: '検索レポートの合成例', sourceRevision: 2, modelId: 'fixture', memoryCount: 0, relationshipCount: 0,
      sections: [{ title: '判断', claims: [{ text: '意見を聞く', evidence: ['script:Route-B/phase-2', 'translation:line-7'] }, { text: '扉を開ける', evidence: ['other'] }] },
        { title: '話し方', claims: [{ text: '理由を説明する', evidence: ['script:Route-B/phase-2'] }] }],
      sources: [{ id: 'script:Route-B/phase-2', title: '台本の保存資料', text: '青い扉で相談した。' }, { id: 'translation:line-7', title: '翻訳資料', text: '補足の記録' }, { id: 'other', title: '別資料', text: '別の出来事' }],
      runtimeGuidance: '合成指針', systemPrompt: '未収録のPrompt' }
    const relative = 'compilation/test/npcs/sample/review.json'
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    const save = () => writeFile(path.join(root, relative), JSON.stringify(review, null, 2))
    const hash = () => createHash('sha256').update(JSON.stringify(review, null, 2)).digest('hex')
    await save()
    await page.locator(`button.file-row[title="${relative}"]`).click()
    const article = page.getByRole('article', { name: 'NPC制作レビュー' })
    const query = article.getByLabel('制作レビューを検索')
    const scope = article.getByLabel('制作レビューの検索対象')
    const copy = article.getByRole('button', { name: '設定の検索レポートをコピー' })
    const success = article.getByText('設定の検索結果と根拠をコピーしました。', { exact: true })
    const copyData = async () => {
      await copy.click()
      await expect(success).toBeVisible()
      const text = await app.evaluate(({ clipboard }) => clipboard.readText())
      const blocks = [...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
      expect(blocks).toHaveLength(1)
      return { text, data: JSON.parse(blocks[0][1]) }
    }
    await scope.selectOption('evidence')
    await query.fill('青い扉')
    await expect(article.locator('.review-claim')).toHaveCount(2)
    const filtered = await copyData()
    expect(filtered.data).toMatchObject({ runId: state.runId, source: { path: relative, hash: hash(), sourceRevision: 2 }, query: { text: '青い扉', scope: 'evidence' }, totalClaims: 3, matchedClaims: 2 })
    expect(filtered.data.sources).toEqual(review.sources.slice(0, 2))
    expect(filtered.data.sections.flatMap((section: CharacterReview['sections'][number]) => section.claims).map((claim: { text: string }) => claim.text)).toEqual(['意見を聞く', '理由を説明する'])
    expect(filtered.text).not.toContain(review.systemPrompt)
    await writeFile(test.info().outputPath('search-report.md'), filtered.text)
    await copy.scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('search-report.png') })
    await query.fill('該当なし')
    await expect(success).toHaveCount(0)
    expect((await copyData()).data).toMatchObject({ matchedClaims: 0, sections: [], sources: [] })
    await query.fill(' ')
    expect((await copyData()).data).toMatchObject({ matchedClaims: 3, sections: review.sections, sources: review.sources })
    review.sourceRevision = 3
    review.sources[0].text = '青い扉で相談した。更新された根拠。'
    await save()
    await expect(article).toContainText('世界revision 3')
    await expect(success).toHaveCount(0)
    await scope.selectOption('evidence')
    await query.fill('青い扉')
    const refreshed = await copyData()
    expect(refreshed.data.source.hash).toBe(hash())
    expect(refreshed.data.source.hash).not.toBe(filtered.data.source.hash)
    expect(refreshed.data.sources[0].text).toContain('更新された根拠')
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('fixture: clipboard unavailable') } }))
    await copy.click()
    await expect(article.getByRole('alert')).toContainText('fixture: clipboard unavailable')
    await expect(success).toHaveCount(0)
    await page.evaluate(() => Reflect.deleteProperty(navigator.clipboard, 'writeText'))
    await copyData()
    await expect(article.getByRole('alert')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
