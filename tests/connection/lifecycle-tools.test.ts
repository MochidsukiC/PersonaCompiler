import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { CodexRuntime, type RuntimeToolCall } from '../../src/backend/runtime'
import { lifeTools } from '../../src/core/life-contracts'
import { lifecycleToolSchemas } from '../../src/core/lifecycle-contracts'
import type { SessionBinding } from '../../src/core/contracts'

it('exposes marriage and home tools through the real App Server with a local Responses provider', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/lifecycle-tools-'))
  const calls: RuntimeToolCall[] = [], completed: string[] = []
  const provider = http.createServer((request, response) => {
    let body = ''
    request.on('data', data => { body += data })
    request.on('end', () => {
      const input = JSON.parse(body).input as { role?: string; type: string; content?: unknown }[]
      const last = input.at(-1)
      const marriage = last?.role === 'user' && JSON.stringify(last).includes('MARRY_FIXTURE')
      const item = marriage
        ? { id: crypto.randomUUID(), type: 'function_call', call_id: crypto.randomUUID(), name: 'marry', arguments: JSON.stringify({ partnerId: 'partner', children: 2, homeParentId: 'npc', withdraw: false }) }
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
  await writeFile(config, `model_provider="fixture"\n[model_providers.fixture]\nname="Lifecycle fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  runtime.onNotification(event => { if (event.method === 'turn/completed') completed.push(JSON.stringify(event.params)) })
  runtime.setToolHandler(async call => { calls.push(call); lifecycleToolSchemas.marry.parse(call.arguments); return { success: true, contentItems: [{ type: 'inputText', text: '{"status":"proposed"}' }] } })
  try {
    await runtime.connect('chatgpt')
    const binding: SessionBinding = { agentId: 'npc', sessionId: 'npc', role: 'npc', modelId: 'gpt-5.6-luna', effort: 'low', cwd: root, threadId: null, creation: 'requested', seedPersisted: false, lifeToolsVersion: 1, lifecycleVersion: 1 }
    const tools = lifeTools('npc', false, true)
    expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(['marry', 'createHome', 'consentHome']))
    expect(lifeTools('facility', false, true).map(t => t.name)).toContain('completeHome')
    binding.threadId = await runtime.create(binding, '指定されたToolを使ってください。', { tools, disableEnvironment: true })
    await runtime.seed(binding, '開始を待ってください。')
    const turn = await runtime.startTurn(binding, 'MARRY_FIXTURE')
    await expect.poll(() => completed.some(t => t.includes(turn)), { timeout: 20000 }).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ threadId: binding.threadId, tool: 'marry', arguments: { partnerId: 'partner', children: 2, homeParentId: 'npc', withdraw: false } })
  } finally { await runtime.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())) }
}, 60000)
