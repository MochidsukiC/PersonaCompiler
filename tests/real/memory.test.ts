import { expect, it } from 'vitest'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { CodexRuntime } from '../../src/backend/runtime'
import { requireModel, resolveEffort } from '../../src/core/models'
import type { MemoryMatchProgress } from '../../src/backend/memory-matcher'
import { lifeTools } from '../../src/core/life-contracts'
import { NpcMemoryStore } from '../../src/core/memory-store'
import { MEMORY_CONSOLIDATION_PROMPT } from '../../src/core/memory-contracts'
import { BootstrapPrompts } from '../../src/core/prompts'
import type { SessionBinding } from '../../src/core/contracts'
import { draft, population } from '../backend/fixtures'

it('matches paraphrased subjective memories with the authenticated NPC model and effort', async () => {
  const home = process.env.PERSONA_REAL_CODEX_HOME
  if (!home || !path.isAbsolute(home) || process.env.PERSONA_REAL_AUTH_MODE !== 'chatgpt') throw new Error('実モデル検証用のChatGPT専用領域を指定してください')
  await mkdir('.local/real', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/real/memory-'))
  const runtime = new CodexRuntime(home)
  const operations: MemoryMatchProgress[] = []
  try {
    await runtime.connect('chatgpt')
    expect(await runtime.account()).toMatchObject({ authenticated: true, mode: 'chatgpt' })
    const model = requireModel(await runtime.models(), 'gpt-5.6-luna')
    const effort = resolveEffort(model, { mode: 'auto' }, 5).effective
    const input = { agentId: 'memory-acceptance-npc', cwd: root, modelId: model.model, effort, memories: [
      { id: 'loan', text: '葵が読み終わった小説を一週間だけ貸してくれた。私はその厚意がうれしかった。', people: ['aoi'], places: ['school'], topics: ['読書'] },
      { id: 'garden', text: '住宅街の花壇の種が芽を出した。毎朝水をあげたい。', people: [], places: ['home'], topics: ['園芸'] }
    ] }
    const related = await runtime.matchMemories({ ...input, cue: '借りた書籍を持ち主に返す約束について' }, new AbortController().signal, async p => { operations.push(p) })
    const unrelated = await runtime.matchMemories({ ...input, cue: '宇宙船のエンジン修理の手順について' }, new AbortController().signal, async p => { operations.push(p) })
    const exact = await runtime.matchMemories({ ...input, cue: '葵が読み終わった小説を一週間だけ貸してくれた' }, new AbortController().signal, async p => { operations.push(p) })
    const paraphrase = await runtime.matchMemories({ ...input, cue: '誰かの好意で読み物を借りたこと' }, new AbortController().signal, async p => { operations.push(p) })
    await writeFile(path.join(root, 'acceptance.json'), JSON.stringify({ model: model.model, effort, related, unrelated, exact, paraphrase, operations }, null, 2))
    expect(exact).toEqual(['loan'])
    expect(paraphrase).toEqual(['loan'])
    expect(related).toEqual(['loan'])
    expect(unrelated).toEqual([])
    expect(new Set(operations.map(p => p.threadId)).size).toBe(4)
  } finally { await runtime.close() }
})

it('uses real memory tools and consolidates in the same NPC conversation before native Compact', async () => {
  const home = process.env.PERSONA_REAL_CODEX_HOME
  if (!home || !path.isAbsolute(home) || process.env.PERSONA_REAL_AUTH_MODE !== 'chatgpt') throw new Error('ChatGPT専用領域が必要です')
  await mkdir('.local/real', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/real/memory-tools-'))
  const runtime = new CodexRuntime(home), memory = new NpcMemoryStore('real-memory-tools', ['npc0', 'npc1'])
  memory.commit(memory.source('npc0', 'received:book', 1, '住民1が小説を貸してくれた。「明日の朝に住宅街で返してね」と言われ、私は了承した。', 'received'))
  const calls: { tool: string; success: boolean }[] = []
  let sleeping = false
  try {
    await runtime.connect('chatgpt')
    const model = requireModel(await runtime.models(), 'gpt-5.6-luna')
    const binding: SessionBinding = { agentId: 'npc0', sessionId: 'memory-tools', role: 'npc', modelId: model.model, effort: resolveEffort(model, { mode: 'auto' }, 5).effective, cwd: root, threadId: null, creation: 'requested', seedPersisted: false, lifeToolsVersion: 1, memoryVersion: 1 }
    binding.threadId = await runtime.create(binding, new BootstrapPrompts().npc(population.npcs[0], draft.specification, true), { tools: lifeTools('npc', true), disableEnvironment: true })
    runtime.setToolHandler(async call => {
      expect(call.threadId).toBe(binding.threadId)
      let result: unknown
      try {
        if (call.tool === 'getSituation') result = { turn: 1, phase: 'activity', self: population.npcs[0], memorySources: memory.availableSources('npc0') }
        else if (call.tool === 'remember') { const r = memory.remember('npc0', 1, call.arguments); memory.commit(r.mutation); result = { candidateId: r.candidate.id, accepted: true } }
        else if (call.tool === 'remindMe') { const r = memory.remind('npc0', 1, call.arguments, ['npc1'], ['residential']); memory.commit(r.mutation); result = { memoryId: r.id } }
        else if (call.tool === 'sleep') { sleeping = true; result = { instruction: '現在の推論を終了してください。整理依頼を次に送ります。' } }
        else if (call.tool === 'consolidateMemory') { memory.commit(memory.consolidate('npc0', 1, call.arguments, ['npc0', 'npc1'])); result = { consolidated: true, instruction: '推論を終了してください。' } }
        else throw new Error(`この受け入れシナリオで未対応のTool: ${call.tool}`)
        calls.push({ tool: call.tool, success: true })
        return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] }
      } catch (error) {
        calls.push({ tool: call.tool, success: false })
        return { success: false, contentItems: [{ type: 'inputText', text: String(error) }] }
      }
    })
    const turn = await runtime.startTurn(binding, 'これは生活中turn=1の記憶機能の受け入れ場面です。getSituationにある本を借りた経験について、自分の主観を添えてrememberで記憶候補を一つ作り、明日の朝(turn=5)に住宅街(residential)で住民1(npc1)へ本を返す予定をremindMeに登録してください。その後sleepを使い、この推論を終了します。')
    await expect.poll(async () => (await runtime.history(binding.threadId!)).find(t => t.id === turn)?.status, { timeout: 90000 }).toBe('completed')
    expect(sleeping).toBe(true)
    expect(memory.owner('npc0').candidates).toHaveLength(1)
    expect(memory.owner('npc0').records.some(r => r.reminder)).toBe(true)
    memory.commit(memory.prepare('npc0', o => { o.consolidation = 'running' }))
    const consolidation = await runtime.startTurn(binding, `${MEMORY_CONSOLIDATION_PROMPT}\n本の経験を一件保持し、住民1への現在の主観的な認識をその記憶を根拠に記述してください。既存の予定は保持します。\n${JSON.stringify(memory.owner('npc0'))}`)
    await expect.poll(async () => (await runtime.history(binding.threadId!)).find(t => t.id === consolidation)?.status, { timeout: 90000 }).toBe('completed')
    expect(memory.owner('npc0').consolidation).toBe('complete')
    expect(memory.owner('npc0').relations[0].target).toBe('npc1')
    await runtime.compact(binding.threadId!)
    await expect.poll(async () => (await runtime.history(binding.threadId!)).some(t => t.compact && t.status === 'completed'), { timeout: 90000 }).toBe(true)
    await writeFile(path.join(root, 'acceptance.json'), JSON.stringify({ binding, calls, memory: memory.snapshot() }, null, 2))
    expect(calls.every(c => c.success)).toBe(true)
  } finally { await runtime.close() }
})
