import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { CharacterReview } from '../../src/core/character-review'

for (const mode of ['demo', 'codex'] as const) test(`${mode}: copies the complete loaded review despite filters and an older generated Markdown file`, async () => {
  await mkdir('.local/e2e', { recursive: true })
  const base = await mkdtemp(path.resolve('.local/e2e/review-full-report-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, PERSONA_TEST: mode === 'demo' ? '1' : '0', PERSONA_ENGINE: mode, PERSONA_DATA_DIR: base } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const { root, state } = await page.evaluate(() => window.persona.snapshot())
    const review: CharacterReview = { version: 1, npcId: 'sample', name: '全体レポートの合成資料', sourceRevision: 1, modelId: 'fixture', memoryCount: 0, relationshipCount: 0,
      sections: [{ title: '分岐', claims: [{ text: '意見を聞く', evidence: ['script:Route-B/phase-2'] }] }, { title: '分岐', claims: [] }],
      sources: [{ id: 'script:Route-B/phase-2', title: '台本', text: '青い扉で相談した' }, { id: 'unused:translation', title: '未引用の翻訳資料', text: '全体に残す資料' }],
      runtimeGuidance: '組み込み時の指針', systemPrompt: '生成時のPrompt' }
    const relative = 'compilation/test/npcs/sample/review.json'
    const directory = path.dirname(path.join(root, relative))
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'review.md'), '生成時に保存したレポート')
    const save = () => writeFile(path.join(root, relative), JSON.stringify(review, null, 2))
    const hash = () => createHash('sha256').update(JSON.stringify(review, null, 2)).digest('hex')
    await save()
    await page.locator(`button.file-row[title="${relative}"]`).click()
    const article = page.getByRole('article', { name: 'NPC制作レビュー' })
    const copy = article.getByRole('button', { name: '制作レビュー全体をコピー', exact: true })
    const success = article.getByText('制作レビュー全体と元資料の参照情報をコピーしました。', { exact: true })
    const copyData = async () => {
      await copy.click()
      await expect(success).toBeVisible()
      const text = await app.evaluate(({ clipboard }) => clipboard.readText())
      const blocks = [...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
      expect(blocks).toHaveLength(1)
      return { text, data: JSON.parse(blocks[0][1]) }
    }
    await article.getByLabel('制作レビューを検索').fill('該当なし')
    await expect(article.locator('.review-claim')).toHaveCount(0)
    const original = await copyData()
    expect(original.data).toMatchObject({ format: 'persona-review-full/v1', runId: state.runId, source: { path: relative, hash: hash() }, review })
    expect(Number.isNaN(Date.parse(original.data.capturedAt))).toBe(false)
    review.sourceRevision = 2
    review.sections[0].claims[0].text = '編集後は待ち合わせを提案する'
    review.sources[0].text = '編集後の根拠資料'
    review.systemPrompt = '編集後のRuntime Prompt'
    await save()
    await expect(article).toContainText('世界revision 2')
    await expect(success).toHaveCount(0)
    await article.getByLabel('制作レビューを検索').fill('該当なし')
    const updated = await copyData()
    expect(updated.data.review).toEqual(review)
    expect(updated.data.source.hash).toBe(hash())
    expect(updated.data.source.hash).not.toBe(original.data.source.hash)
    expect(updated.data.capturedAt).not.toBe(original.data.capturedAt)
    expect(await readFile(path.join(directory, 'review.md'), 'utf8')).toBe('生成時に保存したレポート')
    await writeFile(test.info().outputPath('full-review-report.md'), updated.text)
    await copy.scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('full-review-report.png') })
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('fixture: full report clipboard unavailable') } }))
    await copy.click()
    await expect(article.getByRole('alert')).toContainText('fixture: full report clipboard unavailable')
    await expect(success).toHaveCount(0)
    await page.evaluate(() => Reflect.deleteProperty(navigator.clipboard, 'writeText'))
    expect((await copyData()).data.review).toEqual(review)
    await expect(article.getByRole('alert')).toHaveCount(0)
    await writeFile(path.join(root, relative), '{broken')
    await expect(page.getByRole('alert')).toContainText('制作レビューのJSONを読み取れません')
    await expect(copy).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})
