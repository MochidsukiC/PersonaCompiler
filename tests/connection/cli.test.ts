import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { CodexRuntime } from '../../src/backend/runtime'
import { PtyTerminals } from '../../src/backend/terminals'
import type { RpcNotification } from '../../src/backend/rpc'
import type { SessionBinding } from '../../src/core/contracts'

it('shares a real remote Codex TUI and backend thread using a local Responses fixture', async () => {
  const messagePorts = () => process.getActiveResourcesInfo().filter(resource => resource === 'MessagePort').length
  const initialPorts = messagePorts()
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/connection-'))
  const requests: string[] = []
  const provider = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return }
    let body = ''
    req.on('data', data => { body += data })
    req.on('end', () => {
      requests.push(body)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const request = JSON.parse(body) as { input: { type: string; role?: string; content?: { text?: string }[] }[] }
      const lastUser = request.input.findLast(item => item.type === 'message' && item.role === 'user')
      if (lastUser?.content?.some(part => part.text === 'HOLD_FOR_INTERRUPT')) { res.write(': waiting\n\n'); return }
      const item = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'PROBE_READY', annotations: [] }] }
      for (const event of [
        { type: 'response.created', response: { id: `resp_${requests.length}`, object: 'response', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
        { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'PROBE_READY' },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: `resp_${requests.length}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } }
      ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      res.end()
    })
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
  const config = path.join(root, 'fixture.toml')
  await writeFile(config, `model_provider = "fixture"\n[model_providers.fixture]\nname = "Local protocol fixture"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  const events: RpcNotification[] = []
  const errors: string[] = []
  runtime.onNotification(e => events.push(e))
  const terminals = new PtyTerminals(runtime, () => undefined, message => errors.push(message))
  const binding: SessionBinding = { agentId: 'parent', sessionId: 'parent', role: 'parent', cwd: root, modelId: 'gpt-5.6-luna', effort: 'low', threadId: null, creation: 'requested', seedPersisted: false }
  const wait = async (predicate: () => boolean | Promise<boolean>, label: string) => {
    for (let i = 0; i < 150; i++) { if (await predicate()) return; await delay(100) }
    throw new Error(`Timed out: ${label}; ${JSON.stringify({ errors, events: events.filter(e => e.method === 'runtime/error') })}`)
  }
  try {
    await runtime.connect('chatgpt')
    expect(await runtime.account()).toEqual({ authenticated: false, mode: null })
    expect((await runtime.models()).length).toBeGreaterThan(0)
    binding.threadId = await runtime.create(binding, 'Protocol test. Do not use tools.')
    await runtime.seed(binding, 'Ready for protocol verification.')
    binding.seedPersisted = true
    await terminals.attach(binding)
    await wait(async () => (await terminals.snapshot('parent')).data.includes('Codex'), 'TUI attach')
    await delay(1000)
    const turn = await runtime.startTurn(binding, 'BACKEND_INPUT')
    await wait(() => events.some(e => e.method === 'turn/completed' && JSON.stringify(e.params).includes(turn)), 'backend completion')
    await wait(async () => (await terminals.snapshot('parent')).data.includes('PROBE_READY'), 'backend output in real TUI')
    await terminals.resize('parent', 120, 35)
    expect(await terminals.snapshot('parent')).toMatchObject({ columns: 120, rows: 35 })
    await terminals.input('parent', '端末からの入力\r')
    await wait(() => requests.some(body => body.includes('端末からの入力')), 'Japanese terminal input')
    await wait(() => events.filter(e => e.method === 'turn/completed').length >= 2, 'TUI completion')
    const electron = createRequire(import.meta.url)('electron') as string
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
    await promisify(execFile)(electron, [path.resolve('tests/fixtures/clipboard-image.mjs')], { env, windowsHide: true, timeout: 10000 })
    const imageRequestIndex = requests.length
    await terminals.input('parent', '\x16')
    await wait(async () => (await terminals.snapshot('parent')).data.includes('[Image #1]'), 'image attachment in real TUI')
    expect(requests).toHaveLength(imageRequestIndex)
    await terminals.input('parent', '画像の入力を確認してください')
    await delay(300)
    await terminals.input('parent', '\r')
    await wait(() => requests.length > imageRequestIndex, 'image request from real TUI')
    const imageRequest = JSON.parse(requests[imageRequestIndex]) as { input: { type: string; role?: string; content?: { type: string; image_url?: string }[] }[] }
    const imageInput = imageRequest.input.findLast(item => item.role === 'user')!.content!.find(part => part.type === 'input_image')
    expect(imageInput?.image_url).toMatch(/^data:image\/png;base64,/)
    await wait(() => events.filter(e => e.method === 'turn/completed').length >= 3, 'image turn completion')
    const before = await terminals.snapshot('parent')
    await terminals.attach(binding)
    expect((await terminals.snapshot('parent')).sequence).toBeGreaterThanOrEqual(before.sequence)
    await runtime.resume(binding)
    expect((await runtime.turn(binding.threadId, turn))?.status).toBe('completed')
    // Separate typing from Enter so the TUI does not treat the burst as pasted multiline input.
    await terminals.input('parent', 'HOLD_FOR_INTERRUPT')
    await delay(300)
    await terminals.input('parent', '\r')
    await wait(() => requests.some(body => body.includes('HOLD_FOR_INTERRUPT')), 'interruptible request')
    await terminals.input('parent', '\x03')
    await wait(() => events.some(e => e.method === 'turn/completed' && JSON.stringify(e.params).includes('interrupted')), 'Ctrl+C interruption')
    expect(errors).toEqual([])
    expect(requests.slice(0, 2).every(body => JSON.parse(body).reasoning.effort === 'low')).toBe(true)
    const sequence = (await terminals.snapshot('parent')).sequence
    await terminals.input('parent', '/exit')
    await delay(300)
    await terminals.input('parent', '\r')
    await wait(() => !terminals.isRunning('parent'), 'CLI exit')
    await runtime.resume(binding)
    await terminals.attach(binding)
    expect(terminals.isRunning('parent')).toBe(true)
    await wait(async () => (await terminals.snapshot('parent')).sequence > sequence, 'resumed TUI output')
    expect((await terminals.snapshot('parent')).data).toContain('PROBE_READY')
    expect((await runtime.turn(binding.threadId, turn))?.status).toBe('completed')
    expect(errors).toEqual([])
    await terminals.dispose()
    await runtime.connect('chatgpt')
    await runtime.resume(binding, 'PROTOCOL_REVISED_PARENT_PROMPT. Keep the same conversation and do not use tools.')
    await terminals.attach(binding)
    const updated = await runtime.startTurn(binding, 'AFTER_PROMPT_UPDATE')
    await wait(() => events.some(e => e.method === 'turn/completed' && JSON.stringify(e.params).includes(updated)), 'updated prompt completion')
    expect(requests.some(body => body.includes('AFTER_PROMPT_UPDATE') && body.includes('PROTOCOL_REVISED_PARENT_PROMPT'))).toBe(true)
    expect((await runtime.turn(binding.threadId, turn))?.status).toBe('completed')
    expect(errors).toEqual([])
  } finally {
    if (terminals.has('parent')) await writeFile(path.join(root, 'screen.json'), JSON.stringify({ screen: (await terminals.snapshot('parent')).data, events, requests }, null, 2))
    await terminals.dispose()
    await runtime.close()
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
    await expect.poll(messagePorts, { timeout: 5000 }).toBe(initialPorts)
  }
})
