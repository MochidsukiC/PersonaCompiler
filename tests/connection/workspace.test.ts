import { expect, it } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { CodexRuntime } from '../../src/backend/runtime'
import { PtyTerminals } from '../../src/backend/terminals'
import { RpcClient, type RpcNotification } from '../../src/backend/rpc'
import type { SessionBinding } from '../../src/core/contracts'

it('keeps physical workspace permissions and parent automatic review through remote CLI resume', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/permissions-'))
  const physical = path.join(root, 'physical')
  const alias = path.join(root, 'redirected')
  await mkdir(physical)
  await symlink(physical, alias, 'junction')
  const requests: string[] = []
  const patch = '*** Begin Patch\n*** Add File: result.json\n+{"verified":true}\n*** End Patch'
  const provider = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return }
    let body = ''
    req.on('data', data => { body += data })
    req.on('end', () => {
      requests.push(body)
      const request = JSON.parse(body)
      const reviewing = request.model === 'codex-auto-review'
      // This local provider emulates review only for this test's exact file patch.
      // No live account or model is used by the fixture.
      const reviewText = JSON.stringify(request.input)
      const expectedAction = JSON.stringify({ cwd: physical, files: [path.join(physical, 'result.json')], patch, tool: 'apply_patch' }, null, 2)
      const allow = reviewing && reviewText.includes(JSON.stringify(expectedAction).slice(1, -1))
      const text = reviewing ? JSON.stringify({ outcome: allow ? 'allow' : 'deny', risk_level: 'low', user_authorization: 'high', rationale: 'Local fixture: only the exact temporary result.json patch is permitted.' }) : 'PERMISSION_PROBE_DONE'
      const item = requests.length === 1
        ? { id: 'ctc_permissions', type: 'custom_tool_call', call_id: 'call_permissions', name: 'exec', input: `text(await tools.apply_patch(${JSON.stringify(patch)}));` }
        : { id: `msg_${requests.length}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text, annotations: [] }] }
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
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
  const config = path.join(root, 'fixture.toml')
  await writeFile(config, `model_provider = "fixture"\n[model_providers.fixture]\nname = "Local protocol fixture"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`)
  const runtime = new CodexRuntime(path.join(root, 'codex'), config)
  const events: RpcNotification[] = []
  const errors: string[] = []
  runtime.onNotification(event => events.push(event))
  const terminals = new PtyTerminals(runtime, () => undefined, message => errors.push(message))
  const inspector = new RpcClient(() => undefined, error => errors.push(error.message))
  const binding: SessionBinding = { agentId: 'parent', sessionId: 'parent', role: 'parent', cwd: alias, modelId: 'gpt-5.6-luna', effort: 'low', threadId: null, creation: 'requested', seedPersisted: false }
  try {
    await runtime.connect('chatgpt')
    await inspector.connect(runtime.endpoint, runtime.token)
    binding.threadId = await runtime.create(binding, 'Use the coding tools to save result.json in the working directory.')
    await runtime.seed(binding, 'Waiting for input.')
    binding.seedPersisted = true
    await runtime.resume(binding)
    await terminals.attach(binding)
    await delay(1200)
    const restored = await inspector.request<{ cwd: string; approvalPolicy: string; approvalsReviewer: string; sandbox: { type: string } }>('thread/resume', { threadId: binding.threadId })
    expect(restored.cwd).toBe(await realpath(physical))
    expect(restored.approvalPolicy).toBe('on-request')
    expect(restored.approvalsReviewer).toBe('auto_review')
    expect(restored.sandbox.type).toBe('workspaceWrite')
    const turn = await runtime.startTurn(binding, 'Write result.json now.')
    for (let i = 0; i < 200 && !events.some(e => e.method === 'turn/completed' && JSON.stringify(e.params).includes(turn)); i++) await delay(100)
    expect(events.some(e => e.method === 'turn/completed' && JSON.stringify(e.params).includes(turn))).toBe(true)
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(requests.some(body => JSON.parse(body).model === 'codex-auto-review')).toBe(true)
    expect(events.filter(e => e.method === 'guardianWarning')).toEqual([expect.objectContaining({ params: expect.objectContaining({ message: expect.stringContaining('Automatic approval review approved') }) })])
    expect(JSON.parse(await readFile(path.join(physical, 'result.json'), 'utf8'))).toEqual({ verified: true })
    expect(errors).toEqual([])
  } finally {
    await writeFile(path.join(root, 'diagnostics.json'), JSON.stringify({ events, requests, errors }, null, 2))
    inspector.close()
    await terminals.dispose(); await runtime.close()
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()))
  }
})
