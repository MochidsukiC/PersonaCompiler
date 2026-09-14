import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NodeFsHandler } from 'chokidar/handler.js'
import { Workspace } from '../../src/main/workspace'
import { initialState } from '../../src/main/fixtures'
import type { FileEntry } from '../../src/shared/contracts'

const stores: Workspace[] = []
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); vi.restoreAllMocks() })
const files = (entries: FileEntry[]): string[] => entries.flatMap(entry => entry.kind === 'file' ? [entry.path] : files(entry.children ?? []))

it.each(['compilation/baseline/npcs/npc0/manifest.json', 'assets/dialogue.txt'])('observes %s created after the first directory scan', async relative => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/watch-startup-'))
  const store = new Workspace(root, initialState('watch-startup'), () => undefined, true)
  stores.push(store)
  await store.initialize()
  const directory = path.dirname(path.join(root, relative))
  const read = NodeFsHandler.prototype._handleRead
  let injected = false
  vi.spyOn(NodeFsHandler.prototype, '_handleRead').mockImplementation(async function (this: NodeFsHandler, ...args) {
    const result = await read.apply(this, args)
    if (path.resolve(args[0]) === directory && !injected) {
      injected = true
      await writeFile(path.join(root, relative), 'created after directory enumeration')
    }
    return result
  })
  await mkdir(directory, { recursive: true })
  await vi.waitFor(() => expect(injected).toBe(true))
  await vi.waitFor(() => expect(files(store.snapshot().files)).toContain(relative))
  expect(store.snapshot().fileVersions![relative]).toBeGreaterThan(0)
  expect(store.snapshot().error).toBeNull()
})

it('releases the directory watcher when closing during its initial scan', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/watch-startup-close-'))
  const store = new Workspace(root, initialState('watch-startup-close'), () => undefined, true)
  stores.push(store)
  await store.initialize()
  const directory = path.join(root, 'new-directory')
  const watch = NodeFsHandler.prototype._watchWithNodeFs
  const closers: ReturnType<typeof vi.fn>[] = []
  vi.spyOn(NodeFsHandler.prototype, '_watchWithNodeFs').mockImplementation(function (this: NodeFsHandler, ...args) {
    const closer = watch.apply(this, args)
    if (path.resolve(args[0]) !== directory || !closer) return closer
    const tracked = vi.fn(closer)
    closers.push(tracked)
    return tracked
  })
  const read = NodeFsHandler.prototype._handleRead
  let scanning = false, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(NodeFsHandler.prototype, '_handleRead').mockImplementation(async function (this: NodeFsHandler, ...args) {
    const result = await read.apply(this, args)
    if (path.resolve(args[0]) === directory) { scanning = true; await gate }
    return result
  })
  try {
    await mkdir(directory)
    await vi.waitFor(() => expect(scanning).toBe(true))
    await store.close()
    await vi.waitFor(() => expect(closers).toHaveLength(1))
    await vi.waitFor(() => expect(closers[0]).toHaveBeenCalledTimes(1))
    release()
  } finally { release() }
})
