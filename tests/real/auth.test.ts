import { expect, it } from 'vitest'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { CodexRuntime } from '../../src/backend/runtime'

it('reports the dedicated application authentication status without reading credentials into test output', async () => {
  const home = process.env.PERSONA_REAL_CODEX_HOME
  if (!home || !path.isAbsolute(home)) throw new Error('PERSONA_REAL_CODEX_HOMEにアプリ専用Codex領域の絶対パスが必要です')
  const runtime = new CodexRuntime(home)
  const accounts = []
  try {
    for (const mode of ['chatgpt', 'apiKey'] as const) {
      await runtime.connect(mode)
      accounts.push({ requestedMode: mode, ...await runtime.account() })
    }
    await mkdir('.local/real', { recursive: true })
    await writeFile('.local/real/auth-status.json', JSON.stringify(accounts, null, 2))
    expect(accounts).toHaveLength(2)
  } finally { await runtime.close() }
})
