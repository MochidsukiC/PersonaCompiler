import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { CodexRuntime, type RuntimeToolCall } from '../../src/backend/runtime'
import { worldEventTools, worldEventToolSchemas } from '../../src/core/world-event-contracts'
import type { SessionBinding } from '../../src/core/contracts'

it('exposes parent event tools through the real App Server with a local Responses provider', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/world-event-tools-'))
  const calls: RuntimeToolCall[] = [], completed: string[] = [], advertised: string[] = []
  const provider = http.createServer((request, response) => {
    let body = ''
    request.on('data', data => { body += data })
    request.on('end', () => {
      const payload = JSON.parse(body)
      advertised.push(JSON.stringify(payload.input.filter((item: { type: string }) => item.type === 'additional_tools')))
      const last = payload.input.at(-1)
      const fixture = last?.role === 'user' && JSON.stringify(last).includes('EVENT_FIXTURE')
      const item = fixture
        ? { id: crypto.randomUUID(), type: 'function_call', call_id: crypto.randomUUID(), name: 'scheduleWorldEvent', arguments: JSON.stringify({ title: '星祭り', type: 'festival', description: '星空の下で市場が開く', target: { scope: 'location', locationId: 'square' }, at: { day: 2, time: 'night' } }) }
        : { id: crypto.randomUUID(), type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '予約しました', annotations: [] }] }
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
  await writeFile(config, `model_provider="fixture"\n[model_providers.fixture]\nname="World event fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  runtime.onNotification(event => { if (event.method === 'turn/completed') completed.push(JSON.stringify(event.params)) })
  runtime.setToolHandler(async call => { calls.push(call); worldEventToolSchemas.scheduleWorldEvent.parse(call.arguments); return { success: true, contentItems: [{ type: 'inputText', text: '{"status":"scheduled"}' }] } })
  try {
    await runtime.connect('chatgpt')
    const binding: SessionBinding = { agentId: 'parent', sessionId: 'parent', role: 'parent', modelId: 'gpt-5.6-luna', effort: 'low', cwd: root, threadId: null, creation: 'requested', seedPersisted: false, worldEventToolsVersion: 1 }
    binding.threadId = await runtime.create(binding, '指定されたToolを使ってください。', { tools: worldEventTools(), disableEnvironment: false })
    await runtime.seed(binding, '開始を待ってください。')
    const turn = await runtime.startTurn(binding, 'EVENT_FIXTURE')
    await expect.poll(() => completed.some(t => t.includes(turn)), { timeout: 20000 }).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ threadId: binding.threadId, tool: 'scheduleWorldEvent', arguments: { at: { day: 2, time: 'night' }, target: { scope: 'location', locationId: 'square' } } })
    for (const name of ['getWorldEvents', 'triggerWorldEvent', 'scheduleWorldEvent', 'cancelWorldEvent', 'exec_command', 'apply_patch']) expect(advertised.join('\n')).toContain(name)
  } finally { await runtime.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())) }
}, 60000)
