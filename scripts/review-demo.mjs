import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import console from 'node:console'
import { fileURLToPath, URL } from 'node:url'
import { characterReviewSchema, characterReviewMarkdown } from '../src/core/character-review.ts'
import { characterManifestSchema } from '../src/core/compiler-contracts.ts'

const check = process.argv.slice(2).includes('--check')
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/review-demo.mjs [--check]')
const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
await mkdir(path.join(project, '.local'), { recursive: true })
const base = await mkdtemp(path.join(project, '.local/review-demo-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'].includes(key)))
const app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(base, 'electron-profile')}`], cwd: project, timeout: 30_000,
  env: { ...env, PERSONA_ENGINE: 'demo', PERSONA_TEST: check ? '1' : '0', PERSONA_DATA_DIR: base } })
let closed = false
const whenClosed = new Promise(resolve => app.once('close', () => { closed = true; resolve() }))
const interrupt = () => {
  process.exitCode = 130
  void app.close().catch(error => { console.error(error); process.exitCode = 1 })
}
process.once('SIGINT', interrupt)
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(30_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const { root } = await page.evaluate(() => globalThis.persona.snapshot())
  const hash = text => createHash('sha256').update(text).digest('hex')
  const baseline = characterReviewSchema.parse({ version: 1, npcId: 'sample', name: '案内役（合成資料・モデル未使用）', sourceRevision: 1,
    modelId: 'synthetic-no-model', memoryCount: 0, relationshipCount: 0,
    sections: [{ title: '人格', claims: [{ text: '合意を大切にする', evidence: ['event:1'] }, { text: '判断を一人で引き受ける', evidence: ['event:1'] }] }],
    sources: [{ id: 'event:1', title: '合成の出来事資料', text: '仲間に説明し、進む方向を自分で決めた。' }],
    runtimeGuidance: '合成デモ。選択理由を説明する。', systemPrompt: '合成デモの案内役。判断の理由を説明してから提案する。' })
  const current = characterReviewSchema.parse({ ...baseline, sourceRevision: 2,
    sections: [{ title: '人格', claims: [{ text: '合意を大切にする', evidence: ['event:1'] }, { text: '判断の前に仲間の意見を聞く', evidence: ['event:1'] }] }],
    sources: [{ id: 'event:1', title: '合成の出来事資料', text: '仲間の意見を聞き、全員で進む方向を決めた。' }],
    runtimeGuidance: '合成デモ。相手の希望を聞いてから選択肢を示す。', systemPrompt: '合成デモの案内役。相手の希望を確認し、理由を添えて複数の選択肢を提案する。' })
  for (const [id, review] of [['baseline', baseline], ['current', current]]) {
    const directory = path.join(root, `compilation/${id}/npcs/sample`)
    await mkdir(directory, { recursive: true })
    const files = {
      'review.json': JSON.stringify(review, null, 2),
      'review.md': characterReviewMarkdown(review),
      'system_prompt.md': review.systemPrompt,
      'sample-input.json': JSON.stringify({ notice: '手書きの合成資料。実際のCompilerInputではありません。', sources: review.sources }, null, 2),
      'sample-instructions.md': '手書きの合成資料。モデルへ送信した生成プロンプトではありません。制作レビューの比較と照合を試すための例です。'
    }
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(directory, name), content)
    const manifest = characterManifestSchema.parse({ version: 1, npcId: review.npcId, sourceRevision: review.sourceRevision, modelId: review.modelId,
      inputHash: hash(files['sample-input.json']), promptHash: hash(files['sample-instructions.md']),
      files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, hash(content)])) })
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  }
  const reviewPath = 'compilation/current/npcs/sample/review.json'
  const manifestPath = 'compilation/current/npcs/sample/manifest.json'
  const openComparison = async () => {
    await page.locator(`button.file-row[title="${reviewPath}"]`).click()
    await expect(page.getByLabel('制作レビューを検索')).toBeVisible()
    await page.locator('summary').filter({ hasText: '別の出力と比較' }).click()
    const comparison = page.getByRole('region', { name: '制作レビューの比較' })
    await comparison.getByRole('combobox', { name: '比較の基準' }).selectOption('compilation/baseline/npcs/sample/review.json')
    await expect(comparison.getByRole('status')).toHaveText('追加 1件 · 削除 1件 · 根拠変更 1件 · 設定一致 0件')
    return comparison
  }
  const comparison = await openComparison()
  console.info(`合成資料・モデル未使用の制作レビューデモ\n保存先: ${root}\n比較画面の根拠・Runtime Promptを開けます。照合はファイル一覧の ${manifestPath} を選択してください。\n終了はウィンドウを閉じます。再実行は別の資料を作成します。`)
  if (check) {
    expect(path.resolve(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(path.join(base, 'electron-profile'))
    expect(path.dirname(root)).toBe(base)
    const copyAndRead = async (region, button, success, format) => {
      await region.getByRole('button', { name: button }).click()
      await expect(region.getByText(success, { exact: true })).toBeVisible()
      const report = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(report).toContain(format)
      const blocks = [...report.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
      expect(blocks).toHaveLength(1)
      await writeFile(path.join(base, `${format.split('/')[0]}.md`), report)
      return JSON.parse(blocks[0][1])
    }
    const reviewReport = await copyAndRead(comparison, '比較レポートをコピー', '比較結果と両側の資料をコピーしました。', 'persona-review-comparison/v1')
    expect(reviewReport.before.review).toEqual(baseline)
    expect(reviewReport.after.review).toEqual(current)
    await page.locator(`button.file-row[title="${manifestPath}"]`).click()
    const inspection = page.getByRole('article', { name: 'NPCパッケージの整合性' })
    await expect(inspection.getByRole('status')).toHaveText('全5ファイルが一致しました。')
    const inspectionReport = await copyAndRead(inspection, '照合レポートをコピー', '照合結果とファイルの参照情報をコピーしました。', 'persona-package-inspection/v1')
    expect(inspectionReport.files).toHaveLength(5)
    expect(inspectionReport.files.every(file => file.status === 'match')).toBe(true)
    await openComparison()
    await page.screenshot({ path: path.join(base, 'review-demo.png') })
    expect(errors).toEqual([])
    console.info('PASS: review comparison, actual clipboard JSON, five-file integrity, renderer errors 0')
  } else {
    await whenClosed
  }
} finally {
  process.removeListener('SIGINT', interrupt)
  if (!closed) await app.close()
}
