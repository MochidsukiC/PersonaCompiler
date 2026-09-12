import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export async function publishFile(temporary: string, target: string): Promise<void> {
  const deadline = performance.now() + 1000
  for (;;) {
    try { await rename(temporary, target); return }
    catch (error) {
      const windowsLock = process.platform === 'win32' && error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES')
      if (!windowsLock || performance.now() >= deadline) throw error
      // MoveFileEx cannot replace a target while a Windows reader denies delete-sharing.
      // Keep the existing file intact; publish the same prepared file once that lock clears.
      await delay(25)
    }
  }
}
