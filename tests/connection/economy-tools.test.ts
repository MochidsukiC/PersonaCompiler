import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { CodexRuntime, type RuntimeToolCall } from '../../src/backend/runtime'
import { lifeTools } from '../../src/core/life-contracts'
import { applyEconomyTool } from '../../src/core/economy'
import { lifeTransaction } from '../../src/core/life-transaction'
import { chicken, personal, savedEconomy, seed } from '../fixtures/economy'
import type { SessionBinding } from '../../src/core/contracts'

it('settles an economic tool through the real App Server and keeps its tools after reconnect using a local Responses provider', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/economy-tools-'))
  const calls: RuntimeToolCall[] = [], completed: string[] = []
  const provider = http.createServer((request, response) => {
    let body = ''
    request.on('data', data => { body += data })
    request.on('end', () => {
      const input = JSON.parse(body).input as { role?: string; type: string; content?: unknown }[]
      const last = input.at(-1)
      const purchase = last?.role === 'user' && JSON.stringify(last).includes('ECONOMY_FIXTURE')
      const item = purchase
        ? { id: crypto.randomUUID(), type: 'function_call', call_id: crypto.randomUUID(), name: 'acquireItem', arguments: JSON.stringify({ itemId: 'chicken', quantity: 1, owner: personal(), storage: { kind: 'carried', actorId: 'npc0' } }) }
        : { id: crypto.randomUUID(), type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '完了', annotations: [] }] }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const id = crypto.randomUUID()
      for (const event of [
        { type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } }
      ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      response.end()
    })
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const port = (provider.address() as { port: number }).port, config = path.join(root, 'fixture.toml')
  await writeFile(config, `model_provider="fixture"\n[model_providers.fixture]\nname="Economy fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  runtime.onNotification(event => { if (event.method === 'turn/completed') completed.push(JSON.stringify(event.params)) })
  let world = savedEconomy({ ...seed, catalog: [{ item: chicken, licensees: [personal()] }] }).world
  runtime.setToolHandler(async call => {
    calls.push(call)
    const transaction = lifeTransaction(world)
    const outcome = applyEconomyTool(transaction.draft, 'npc0', call.tool, call.arguments)
    world = transaction.value
    return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(outcome.result) }] }
  })
  try {
    await runtime.connect('chatgpt')
    const binding: SessionBinding = { agentId: 'npc0', sessionId: 'npc0', role: 'npc', modelId: 'gpt-5.6-luna', effort: 'low', cwd: root, threadId: null, creation: 'requested', seedPersisted: false, lifeToolsVersion: 1, lifecycleVersion: 1, economyVersion: 1 }
    const tools = lifeTools('npc', false, true, true)
    expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(['requestItem', 'acquireItem', 'offerEmployment', 'work', 'exportItem', 'designateHeir']))
    expect(lifeTools('npc', false, true).map(t => t.name)).not.toContain('acquireItem')
    binding.threadId = await runtime.create(binding, '指定されたToolを使ってください。', { tools, disableEnvironment: true })
    await runtime.seed(binding, '開始を待ってください。')
    const turn = await runtime.startTurn(binding, 'ECONOMY_FIXTURE')
    await expect.poll(() => completed.some(t => t.includes(turn)), { timeout: 20000 }).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ threadId: binding.threadId, tool: 'acquireItem', arguments: { itemId: 'chicken', quantity: 1, owner: personal(), storage: { kind: 'carried', actorId: 'npc0' } } })
    expect(world.economy!.accounts['npc:npc0'].balance).toBe(900)
    expect(world.economy!.holdings.reduce((n, h) => n + h.quantity, 0)).toBe(1)
    await runtime.resume(binding, '所持品と状態を確認してToolを使ってください。')
    const resumed = await runtime.startTurn(binding, 'ECONOMY_FIXTURE')
    await expect.poll(() => completed.some(t => t.includes(resumed)), { timeout: 20000 }).toBe(true)
    expect(calls).toHaveLength(2)
    expect(world.economy!.accounts['npc:npc0'].balance).toBe(800)
  } finally { await runtime.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())) }
}, 60000)
