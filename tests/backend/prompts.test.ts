import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { BootstrapPrompts } from '../../src/core/prompts'
import { population, draft } from './fixtures'
import { lifeTools } from '../../src/core/life-contracts'
import { FAMILY_RELATION_GUIDANCE } from '../../src/core/contracts'

describe('Parent prompt integration', () => {
  it('explains organization and construction tools only to compatible conversations', () => {
    const prompts = new BootstrapPrompts()
    expect(prompts.npc(population.npcs[0], draft.specification)).not.toContain('createOrganization')
    expect(prompts.npc(population.npcs[0], draft.specification, false, false, true)).toContain('createOrganization')
    expect(prompts.npc(population.npcs[0], draft.specification, false, false, true)).not.toContain('buildFacility')
    expect(prompts.npc(population.npcs[0], draft.specification, false, false, true, true)).toContain('buildFacility')
    expect(lifeTools('facility').map(t => t.name)).not.toContain('buildFacility')
    expect(prompts.facility(draft.specification.town.facilities[0], draft.specification)).toContain('通知された現在turn')
  })
  it('enables memory prompts and tools only for new versioned NPC conversations', () => {
    const prompts = new BootstrapPrompts()
    expect(prompts.npc(population.npcs[0], draft.specification)).not.toContain('consolidateMemory')
    expect(prompts.npc(population.npcs[0], draft.specification, true)).toContain('consolidateMemory')
    expect(lifeTools('npc').map(t => t.name)).not.toContain('remember')
    expect(lifeTools('facility', true).map(t => t.name)).not.toContain('remember')
    expect(lifeTools('npc', true).map(t => t.name)).toEqual(expect.arrayContaining(['remember', 'recall', 'remindMe', 'consolidateMemory']))
  })
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
    expect(prompt).toContain(FAMILY_RELATION_GUIDANCE)
    const [preparation, population] = prompt.split('準備成果物JSON Schema:\n')[1].split('人口成果物JSON Schema（Harnessが人口生成を指示した場合のみ）:\n')
    expect(JSON.parse(preparation).oneOf.map((schema: { properties: { kind: { const: string } } }) => schema.properties.kind.const)).toEqual(['questions', 'draft'])
    expect(JSON.parse(population).required).toContain('npcs')
    expect(JSON.parse(population).properties.npcs.items.properties.family.items.properties.relation.description).toBe(FAMILY_RELATION_GUIDANCE)
  })
  it('does not expose the world manager prompt to NPC and facility sessions', () => {
    const prompts = new BootstrapPrompts()
    for (const text of [prompts.npc(population.npcs[0], draft.specification), prompts.facility(draft.specification.town.facilities[0], draft.specification)]) {
      expect(text).not.toContain('世界管理・シミュレーション責任者')
      expect(text).not.toContain('world_state')
      expect(text).toContain('turn=0')
    }
  })
  it('asks NPCs for user-visible character messages separately from speech tools and private reasoning', () => {
    const prompt = new BootstrapPrompts().npc(population.npcs[0], draft.specification)
    expect(prompt).toContain('【心の声】')
    expect(prompt).toContain('【独り言】')
    expect(prompt).toContain('ユーザーだけに表示され、他のNPCへは届きません')
    expect(prompt).toContain('JSONや専用Toolは使いません')
    expect(prompt).toContain('独り言をsendMessageで配信しないでください')
    expect(prompt).toContain('モデルの内部推論や逐次的な思考過程を出力するのではなく')
    expect(prompt).toContain('文章を返すだけでは世界ターンは終了しません')
  })
})
