import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { CodexRuntime } from '../../src/backend/runtime'
import type { SessionBinding } from '../../src/core/contracts'

it('forks a seeded Conversation and rewinds through a completed turn before future Compact, preserving tools and applying prompts', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/dev-rewind-'))
  const requests: { url: string; body: string }[] = []
  const provider = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return }
    let body = ''
    req.on('data', data => { body += data })
    req.on('end', () => {
      requests.push({ url: req.url!, body })
      if (req.url?.endsWith('/compact')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'compact_fixture', object: 'response.compaction', created_at: 1, output: [{ type: 'compaction', encrypted_content: 'FUTURE_COMPACT' }], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } })); return
      }
      const input = JSON.parse(body).input as { type: string; role?: string; content?: unknown }[]
      const last = input.at(-1)
      const item = last?.role === 'user' && JSON.stringify(last).includes('CALL_DEV_TOOL')
        ? { type: 'function_call', name: 'getSituation', arguments: '{}', call_id: `call_${requests.length}`, id: `fc_${requests.length}` }
        : { id: `msg_${requests.length}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'DEV_DONE', annotations: [] }] }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const event of [
        { type: 'response.created', response: { id: `resp_${requests.length}`, object: 'response', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: `resp_${requests.length}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } }
      ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      res.end()
    })
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')
  const config = path.join(root, 'fixture.toml')
  await writeFile(config, `model_provider = "fixture"\n[model_providers.fixture]\nname = "Local DEV fixture"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  const completed = new Set<string>(), calls: string[] = []
  runtime.onNotification(e => { if (e.method === 'turn/completed') completed.add((e.params as { turn: { id: string } }).turn.id) })
  runtime.setToolHandler(async call => { calls.push(call.threadId); return { success: true, contentItems: [{ type: 'inputText', text: 'DEV_TOOL_RESULT' }] } })
  const binding: SessionBinding = { agentId: 'npc', sessionId: 'npc', role: 'npc', cwd: root, modelId: 'gpt-5.6-luna', effort: 'low', threadId: null, creation: 'initialized', seedPersisted: true, lifeToolsVersion: 1, persistenceVersion: 2 }
  const wait = async (predicate: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 150; i++) { if (await predicate()) return; await delay(100) }
    throw new Error('DEV protocol timed out')
  }
  const turn = async (target: SessionBinding, text: string) => { const id = await runtime.startTurn(target, text); await wait(() => completed.has(id)); return id }
  try {
    await runtime.connect('chatgpt')
    binding.threadId = await runtime.create(binding, 'DEV_ORIGINAL', { tools: [{ type: 'function', name: 'getSituation', description: 'Read situation', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], disableEnvironment: true })
    await runtime.seed(binding, 'DEV_INITIAL_SEED')
    const anchor = await runtime.fork(binding, null)
    const first = await turn(binding, 'DEV_PAST')
    await turn(binding, 'DEV_FUTURE')
    await runtime.compact(binding.threadId)
    await wait(async () => (await runtime.history(binding.threadId!)).some(t => t.compact && t.status === 'completed'))
    const cwd = path.join(root, 'branch'); await mkdir(cwd)
    const branch = { ...binding, cwd, threadId: await runtime.fork({ ...binding, cwd }, first, 'DEV_LATEST') }
    expect((await runtime.history(branch.threadId)).map(t => t.id)).toEqual([first])
    await runtime.resume(branch, 'DEV_LATEST')
    await turn(branch, 'CALL_DEV_TOOL')
    expect(calls).toContain(branch.threadId)
    const request = requests.findLast(r => r.body.includes('CALL_DEV_TOOL'))!.body
    expect(request).toContain('DEV_LATEST')
    expect(request).toContain('DEV_PAST')
    expect(request).not.toContain('DEV_FUTURE')
    expect(request).not.toContain('FUTURE_COMPACT')
    expect((await runtime.history(binding.threadId)).length).toBeGreaterThan(1)
    const early = { ...binding, cwd, threadId: await runtime.fork({ ...binding, cwd, threadId: anchor }, null, 'DEV_EARLY') }
    await turn(early, 'EARLY_PROBE')
    const earlyRequest = requests.findLast(r => r.body.includes('EARLY_PROBE'))!.body
    expect(earlyRequest).toContain('DEV_INITIAL_SEED')
    expect(earlyRequest).not.toContain('DEV_PAST')
    expect(earlyRequest).not.toContain('DEV_FUTURE')
  } finally {
    await runtime.close(); provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
  }
})
