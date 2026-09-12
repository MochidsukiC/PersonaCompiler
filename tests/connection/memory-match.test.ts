import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { CodexRuntime } from '../../src/backend/runtime'
import { matchMemories } from '../../src/backend/memory-matcher'

it('selects memory IDs in isolated ephemeral conversations without blocking another NPC lookup', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/memory-match-'))
  const requests: Record<string, unknown>[] = []
  let hold!: http.ServerResponse
  const respond = (res: http.ServerResponse, text: string) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const item = { id: crypto.randomUUID(), type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text, annotations: [] }] }
    for (const event of [
      { type: 'response.created', response: { id: crypto.randomUUID(), object: 'response', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item }, { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: crypto.randomUUID(), object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } }
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    res.end()
  }
  const provider = http.createServer((req, res) => {
    let text = ''; req.on('data', data => { text += data }); req.on('end', () => {
      const body = JSON.parse(text) as Record<string, unknown>; requests.push(body)
      if (JSON.stringify(body.input).includes('HOLD_MEMORY')) { hold = res; return }
      respond(res, '{"ids":["b-only"]}')
    })
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const port = (provider.address() as { port: number }).port
  const config = path.join(root, 'fixture.toml')
  await writeFile(config, `model_provider="fixture"\n[model_providers.fixture]\nname="Memory fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  const firstAbort = new AbortController()
  let first: Promise<unknown> | undefined
  try {
    await runtime.connect('chatgpt')
    const common = { modelId: 'gpt-5.6-luna', effort: 'low', cwd: root }
    first = matchMemories(runtime.endpoint, runtime.token, { ...common, agentId: 'a', cue: 'HOLD_MEMORY', memories: [{ id: 'a-only', text: '秘密の記憶A', people: [], places: [], topics: [] }] }, firstAbort.signal, async () => undefined).then(value => ({ value }), error => ({ error }))
    await expect.poll(() => !!hold).toBe(true)
    const second = await matchMemories(runtime.endpoint, runtime.token, { ...common, agentId: 'b', cue: 'Bについて', memories: [{ id: 'b-only', text: '記憶B', people: [], places: [], topics: [] }] }, new AbortController().signal, async () => undefined)
    expect(second).toEqual(['b-only'])
    const secondRequest = requests.find(r => JSON.stringify(r.input).includes('b-only'))!
    expect(JSON.stringify(secondRequest.input)).not.toContain('a-only')
    expect(secondRequest.model).toBe(common.modelId)
    expect(secondRequest.reasoning).toMatchObject({ effort: 'low' })
    firstAbort.abort()
    expect(await first).toHaveProperty('error')
  } finally {
    firstAbort.abort(); await first; await runtime.close()
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()))
  }
})
