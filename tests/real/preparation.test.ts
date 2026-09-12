import { expect, it } from 'vitest'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { CodexRuntime } from '../../src/backend/runtime'
import { PtyTerminals } from '../../src/backend/terminals'
import { BackendEngine } from '../../src/backend/engine'
import { requireModel } from '../../src/core/models'
import type { AgentModelSettings } from '../../src/core/contracts'

it('uses the authenticated parent for questions, spatial specification and approved world initialization', async () => {
  const home = process.env.PERSONA_REAL_CODEX_HOME
  const mode = process.env.PERSONA_REAL_AUTH_MODE
  if (!home || !path.isAbsolute(home) || (mode !== 'chatgpt' && mode !== 'apiKey')) throw new Error('実モデルの専用認証領域と認証方式が必要です')
  await mkdir('.local/real', { recursive: true })
  const root = await mkdtemp(path.resolve(`.local/real/preparation-${mode}-`))
  const runtime = new CodexRuntime(home)
  const errors: string[] = []
  const terminals = new PtyTerminals(runtime, () => undefined, error => errors.push(error))
  const engine = new BackendEngine(path.join(root, 'runs'), runtime, terminals, event => { if (event.type === 'error') errors.push(event.message) })
  const wait = async (predicate: () => boolean, label: string) => {
    const until = Date.now() + 120000
    while (Date.now() < until) {
      const view = engine.backendStatus()
      if (view.error || view.preparation.error || errors.length) throw new Error(`${label}: ${JSON.stringify({ view, errors })}`)
      if (predicate()) return
      await delay(250)
    }
    throw new Error(`Timed out ${label}: ${JSON.stringify(engine.backendStatus())}`)
  }
  try {
    await engine.initialize()
    await engine.backendCommand({ type: 'connect', authMode: mode })
    expect(engine.backendStatus().authenticated).toBe(true)
    const available = engine.backendStatus().models
    const model = requireModel(available, 'gpt-5.6-luna')
    const fixed = { modelId: model.model, effort: model.defaultReasoningEffort }
    const settings: AgentModelSettings = { parent: fixed, facility: fixed, npc: { model: { mode: 'fixed', modelId: model.model }, effort: { mode: 'fixed', effort: model.defaultReasoningEffort } } }
    await engine.backendCommand({ type: 'settings', settings })
    await engine.prepare({ description: '受け入れ試験用の小さな町。初期人口は5人で、5歳女性・17歳男性の兄妹の2人世帯、30歳女性・40歳男性の夫婦の2人世帯、60歳女性の単身世帯。60歳女性は30歳女性の母だが別居。住宅街1つ(30×30×3)、学校1つ(20×20×3)、職場1つ(20×20×3)、店舗1つ(15×15×2)を設置。全員の初期所在地は住宅街。男女比は女性60%男性40%、年齢帯0〜17歳40%、18〜90歳60%。最大4ターン、終了条件はターン上限。友人や過去の経験は初期生成しない。町の雰囲気は穏やかな現代の田舎。ほかの未指定項目は親の推奨で決める。', images: [] })
    let rounds = 0
    while (engine.backendStatus().preparation.phase !== 'review') {
      await wait(() => !engine.backendStatus().preparation.busy, 'parent response')
      const p = engine.backendStatus().preparation
      if (p.phase === 'review') break
      if (!p.round) throw new Error('親が質問カードを返していません')
      rounds++
      await engine.backendCommand({ type: 'answers', value: { roundId: p.round.id, answers: p.round.questions.map(q => ({ questionId: q.id, optionId: q.recommendedOptionId, text: '最初の資料の人数・世帯構成・施設サイズを維持して、その他は推奨案で確定してください。追加の未指定事項も親の推奨で決めてください。' })) } })
    }
    const review = engine.backendStatus().preparation.draft!
    expect(rounds).toBeGreaterThan(0)
    expect(review.specification.town.facilities).toHaveLength(4)
    expect(review.specification.town.facilities.every(f => f.dimensions)).toBe(true)
    expect(review.specification.town.facilities.filter(f => f.type === 'residential')).toHaveLength(1)
    expect(engine.backendStatus().preparation.sessions).toHaveLength(1)
    await engine.backendCommand({ type: 'approve', revision: review.revision })
    await wait(() => engine.backendStatus().preparation.phase === 'ready', 'population and facilities')
    const world = engine.snapshot().state
    expect(world).toMatchObject({ stage: 'ready', frame: { turn: 0 } })
    expect(world.agents).toHaveLength(10)
    expect(world.simulation!.actors).toHaveLength(5)
    expect(world.simulation!.facilities.find(f => f.type === 'residential')!.layout!.homes).toHaveLength(3)
    expect(world.simulation!.actors.every(a => a.position !== null)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await writeFile(path.join(root, 'acceptance.json'), JSON.stringify({ snapshot: engine.snapshot(), errors }, null, 2))
    await engine.close()
  }
})
