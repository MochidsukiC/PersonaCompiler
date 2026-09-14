import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { appendFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { CodexRuntime, type RuntimeToolCall } from '../../src/backend/runtime'
import { PtyTerminals } from '../../src/backend/terminals'
import type { RpcNotification } from '../../src/backend/rpc'
import type { SessionBinding } from '../../src/core/contracts'

it('routes dynamic tools with a real remote TUI, steers inference and compacts the same conversation', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/life-tools-'))
  const stages = path.join(root, 'stages.jsonl')
  const mark = (phase: string) => appendFileSync(stages, `${JSON.stringify({ time: new Date().toISOString(), pid: process.pid, phase })}\n`)
  const stage = async <T>(phase: string, run: () => Promise<T>): Promise<T> => {
    mark(`${phase}/begin`)
    const result = await run()
    mark(`${phase}/end`)
    return result
  }
  mark('fixture/created')
  console.info(`Life tool fixture stages: ${stages}`)
  const requests: { url: string; body: string }[] = []
  let held: http.ServerResponse | null = null
  const finish = (res: http.ServerResponse, item: Record<string, unknown>) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const event of [
      { type: 'response.created', response: { id: `resp_${requests.length}`, object: 'response', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `resp_${requests.length}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } }
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    res.end()
  }
  const message = () => ({ id: `msg_${requests.length}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'LIFE_PROBE_DONE', annotations: [] }] })
  const provider = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return }
    let body = ''
    req.on('data', data => { body += data })
    req.on('end', () => {
      requests.push({ url: req.url!, body })
      if (req.url?.endsWith('/compact')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'compact_fixture', object: 'response.compaction', created_at: 1, output: [{ type: 'compaction', encrypted_content: 'fixture_compaction' }], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } }))
        return
      }
      const input = JSON.parse(body).input as { type: string; role?: string; content?: unknown }[]
      const last = input.at(-1)
      if (JSON.stringify(last).includes('Generate a concise, single-line task title')) { finish(res, message()); return }
      if (last?.role === 'user' && JSON.stringify(last).includes('HOLD_LIFE_PROBE')) { held = res; return }
      if (last?.role === 'user' && /CALL_LIFE_TOOL|端末の生活Tool/.test(JSON.stringify(last))) {
        finish(res, { type: 'function_call', name: 'getSituation', arguments: '{}', call_id: `call_${requests.length}`, id: `fc_${requests.length}` })
      } else finish(res, message())
    })
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
  const config = path.join(root, 'fixture.toml')
  await writeFile(config, `model_provider = "fixture"\n[model_providers.fixture]\nname = "Local life protocol fixture"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  const events: RpcNotification[] = []
  const calls: RuntimeToolCall[] = []
  const errors: string[] = []
  runtime.onNotification(e => events.push(e))
  runtime.setToolHandler(async call => {
    calls.push(call)
    return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ position: { x: 1, y: 2, z: 0 }, marker: 'LIFE_TOOL_RESULT' }) }] }
  })
  const terminals = new PtyTerminals(runtime, () => undefined, error => errors.push(error))
  const binding: SessionBinding = { agentId: 'npc', sessionId: 'npc', role: 'npc', cwd: root, modelId: 'gpt-5.6-luna', effort: 'low', threadId: null, creation: 'requested', seedPersisted: false, lifeToolsVersion: 1 }
  const wait = async (predicate: () => boolean | Promise<boolean>, label: string) => {
    for (let i = 0; i < 150; i++) { if (await predicate()) return; await delay(100) }
    throw new Error(`Timed out: ${label}; ${JSON.stringify({ calls, errors, events: events.filter(e => e.method === 'runtime/error') })}`)
  }
  const completed = (id: string) => events.some(e => e.method === 'turn/completed' && JSON.stringify(e.params).includes(id))
  try {
    await stage('initial-connect', () => runtime.connect('chatgpt'))
    binding.threadId = await runtime.create(binding, 'Use getSituation when asked. Keep this conversation.', { tools: [{ type: 'function', name: 'getSituation', description: 'Read the local situation.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], disableEnvironment: true })
    await runtime.seed(binding, 'Initial life state.')
    binding.seedPersisted = true
    const first = await runtime.startTurn(binding, 'CALL_LIFE_TOOL')
    await wait(() => completed(first), 'backend tool completion')
    const conversation = await runtime.conversation(binding.threadId)
    const firstItems = conversation.find(turn => turn.id === first)!.items
    expect(firstItems.map(item => item.type)).toEqual(['userMessage', 'dynamicToolCall', 'agentMessage'])
    expect(firstItems[1]).toMatchObject({ tool: 'getSituation', arguments: {}, success: true, contentItems: [{ type: 'inputText', text: expect.stringContaining('LIFE_TOOL_RESULT') }] })
    const rejected = await runtime.steer(binding.threadId, first, '完了済み推論への入力').then(() => null, error => ({ message: error.message, code: error.code }))
    expect(rejected).not.toBeNull()
    events.push({ method: 'probe/steerRejected', params: rejected })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ threadId: binding.threadId, tool: 'getSituation' })
    expect(requests.some(r => r.body.includes('LIFE_TOOL_RESULT'))).toBe(true)
    await stage('initial-terminal-attach', () => terminals.attach(binding))
    await wait(async () => (await terminals.snapshot('npc')).data.includes('LIFE_PROBE_DONE'), 'TUI history loaded')
    await terminals.input('npc', '端末の生活Tool')
    await delay(300)
    await terminals.input('npc', '\r')
    await wait(() => calls.length === 2, 'TUI tool dispatch')
    await wait(() => events.filter(e => e.method === 'turn/completed').length === 2, 'TUI tool completion')
    const active = await runtime.startTurn(binding, 'HOLD_LIFE_PROBE')
    await wait(() => held !== null, 'held inference')
    await runtime.steer(binding.threadId, active, '誘導メッセージ')
    finish(held!, message()); held = null
    await wait(() => completed(active), 'steered completion')
    await runtime.interrupt(binding.threadId, active)
    expect(requests.some(r => r.body.includes('誘導メッセージ'))).toBe(true)
    await stage('compact-request', () => runtime.compact(binding.threadId!))
    await wait(() => events.some(e => e.method === 'item/completed' && JSON.stringify(e.params).includes('contextCompaction')), 'native compact')
    await wait(() => events.filter(e => e.method === 'turn/completed').length >= 4, 'compact completion')
    mark('compact-completed')
    await stage('initial-terminals-dispose', () => terminals.dispose())
    await stage('reconnect', () => runtime.connect('chatgpt'))
    await stage('resume', () => runtime.resume(binding))
    expect((await runtime.conversation(binding.threadId)).find(turn => turn.id === first)?.items).toEqual(firstItems)
    await stage('resumed-terminal-attach', () => terminals.attach(binding))
    const resumed = await stage('resumed-turn-start', () => runtime.startTurn(binding, 'CALL_LIFE_TOOL'))
    await stage('resumed-turn-completion', () => wait(() => completed(resumed), 'resumed tools'))
    mark('final-assertions/begin')
    expect(calls).toHaveLength(3)
    expect(calls.every(call => call.threadId === binding.threadId)).toBe(true)
    for (const request of requests) {
      const input = JSON.parse(request.body).input as { type: string }[]
      const tools = JSON.stringify(input.filter(item => item.type === 'additional_tools'))
      expect(tools).not.toContain('### `exec_command`')
      expect(tools).not.toContain('### `apply_patch`')
    }
    expect(errors).toEqual([])
    expect(events.filter(e => e.method === 'runtime/error')).toEqual([])
    mark('final-assertions/end')
  } finally {
    await stage('probe-save', () => writeFile(path.join(root, 'probe.json'), JSON.stringify({ requests, events, calls, errors }, null, 2)))
    if (terminals.has('npc')) await stage('terminal-save', async () => writeFile(path.join(root, 'terminal.json'), JSON.stringify(await terminals.snapshot('npc'))))
    await stage('final-terminals-dispose', () => terminals.dispose())
    await stage('runtime-close', () => runtime.close())
    provider.closeAllConnections()
    await stage('provider-close', () => new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve())))
    mark('fixture/cleanup-completed')
  }
})
