import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { publishFile } from '../../src/main/atomic-write'

async function lockFile(target: string) {
  const script = '$file = [System.IO.File]::Open($env:PC_TEST_LOCK, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite); [Console]::Out.WriteLine("locked"); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null; $file.Dispose()'
  const process = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...globalThis.process.env, PC_TEST_LOCK: target }, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(process, 'exit')
  await new Promise<void>((resolve, reject) => {
    process.once('error', reject)
    process.stderr.once('data', data => reject(new Error(String(data))))
    process.stdout.once('data', data => String(data).includes('locked') ? resolve() : reject(new Error(`ロック取得に失敗: ${String(data)}`)))
  })
  let released: Promise<void> | null = null
  return () => {
    if (!released) { process.stdin.end('\n'); released = exited.then(() => undefined) }
    return released
  }
}

describe.runIf(process.platform === 'win32')('Windows file-sharing semantics', () => {
  it('publishes atomically after a real reader releases its deny-delete lock', async () => {
    await mkdir('.local/tests', { recursive: true })
    const directory = await mkdtemp(path.resolve('.local/tests/lock-'))
    const target = path.join(directory, 'state.json')
    const temporary = path.join(directory, 'state.tmp')
    await writeFile(target, 'old')
    await writeFile(temporary, 'new')
    const unlock = await lockFile(target)
    try {
      await expect(rename(temporary, target)).rejects.toHaveProperty('code', 'EPERM')
      const publishing = publishFile(temporary, target)
      expect(await readFile(target, 'utf8')).toBe('old')
      await delay(100)
      await unlock()
      await publishing
      expect(await readFile(target, 'utf8')).toBe('new')
    } finally { await unlock() }
  })

  it('reports a persistent lock and preserves the old file instead of overwriting it', async () => {
    await mkdir('.local/tests', { recursive: true })
    const directory = await mkdtemp(path.resolve('.local/tests/locked-'))
    const target = path.join(directory, 'state.json')
    const temporary = path.join(directory, 'state.tmp')
    await writeFile(target, 'old')
    await writeFile(temporary, 'new')
    const unlock = await lockFile(target)
    try {
      await expect(publishFile(temporary, target)).rejects.toHaveProperty('code', 'EPERM')
      expect(await readFile(target, 'utf8')).toBe('old')
      expect(await readFile(temporary, 'utf8')).toBe('new')
    } finally { await unlock() }
  })
})
