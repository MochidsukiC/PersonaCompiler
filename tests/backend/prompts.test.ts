import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { BootstrapPrompts } from '../../src/core/prompts'
import { population, draft } from './fixtures'

describe('Parent prompt integration', () => {
  it('includes the supplied system text while selecting the preparation output contract', async () => {
    const document = await readFile('src/core/prompts/parent-system.md', 'utf8')
    const source = /^```text\r?\n([\s\S]*?)^```\s*$/m.exec(document)![1].trim()
    const prompt = new BootstrapPrompts().parent()
    expect(prompt.startsWith(source)).toBe(true)
    expect(prompt).not.toContain('## 推奨する利用方法')
    expect(prompt).toContain('上記第13章の総合シミュレーションJSONは現在のresult.jsonには出力しません')
    expect(prompt).toContain('最初の質問ラウンドを省略しません')
    expect(prompt).toContain('仕様revisionを承認したとHarnessが伝えるまで人口生成は禁止')
    expect(prompt).toContain('初期化完了後もturn=0で待機')
    const [preparation, population] = prompt.split('準備成果物JSON Schema:\n')[1].split('人口成果物JSON Schema（Harnessが人口生成を指示した場合のみ）:\n')
    expect(JSON.parse(preparation).oneOf.map((schema: { properties: { kind: { const: string } } }) => schema.properties.kind.const)).toEqual(['questions', 'draft'])
    expect(JSON.parse(population).required).toContain('npcs')
  })
  it('does not expose the world manager prompt to NPC and facility sessions', () => {
    const prompts = new BootstrapPrompts()
    for (const text of [prompts.npc(population.npcs[0], draft.specification), prompts.facility(draft.specification.town.facilities[0], draft.specification)]) {
      expect(text).not.toContain('世界管理・シミュレーション責任者')
      expect(text).not.toContain('world_state')
      expect(text).toContain('turn=0')
    }
  })
})
