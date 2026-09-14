import { expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { FSWatcher, watch } from 'chokidar'
import { NodeFsHandler } from 'chokidar/handler.js'
import { Workspace } from '../../src/main/workspace'
import { initialState } from '../../src/main/fixtures'
import type { FileEntry } from '../../src/shared/contracts'

const files = (entries: FileEntry[]): string[] => entries.flatMap(entry => entry.kind === 'file' ? [entry.path] : files(entry.children ?? [])).sort()

it('closes a removed file watcher even when its initial add is still waiting for stable writes', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/directory-pending-add-'))
  const target = path.join(root, 'assets')
  const watcher = watch(root, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 30 } })
  const events: string[] = []
  watcher.on('all', event => events.push(event))
  try {
    await new Promise<void>(resolve => watcher.once('ready', resolve))
    await writeFile(target, 'temporary file')
    await vi.waitFor(() => expect(watcher._pendingWrites.has(target)).toBe(true))
    watcher._remove(root, 'assets')
    expect(watcher._pendingWrites.has(target)).toBe(false)
    expect(watcher._closers.has(target)).toBe(false)
    expect(watcher.getWatched()[target]).toBeUndefined()
    expect(events).toEqual([])
  } finally { await watcher.close() }
})

it('releases the scan throttle and settles when a directory becomes a file before enumeration', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/directory-read-error-'))
  const target = path.join(root, 'assets')
  await mkdir(target)
  const metadata = await stat(target)
  await rename(target, path.join(root, 'saved-assets'))
  await writeFile(target, 'obstruction')
  const watcher = new FSWatcher({ ignoreInitial: true })
  const handler = new NodeFsHandler(watcher)
  const errors: unknown[] = []
  const handleError = watcher._handleError.bind(watcher)
  vi.spyOn(watcher, '_handleError').mockImplementation(error => { errors.push(error); return handleError(error) })
  let settled = false
  try {
    const scan = handler._handleDir(target, metadata, false, 0, undefined, watcher._getWatchHelpers(target), target).then(() => { settled = true })
    await vi.waitFor(() => expect(errors).toEqual([expect.objectContaining({ code: 'ENOTDIR' })]))
    expect(watcher._throttled.get('readdir')?.has(target)).toBe(false)
    await vi.waitFor(() => expect(settled).toBe(true))
    await scan
  } finally { await watcher.close(); vi.restoreAllMocks() }
})

it('restores children when atomic replacement coalesces their reappearance into changes', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/directory-child-change-'))
  const directory = path.join(root, 'assets'), child = path.join(directory, 'content.txt')
  await mkdir(directory)
  await writeFile(child, 'original content')
  const store = new Workspace(root, initialState('directory-child-change'), () => undefined, true)
  try {
    await store.initialize()
    const watcher = (store as unknown as { watcher: FSWatcher }).watcher
    const childEvents: string[] = []
    watcher.on('all', (event, file) => { if (file === child) childEvents.push(event) })
    await watcher._emit('unlink', child)
    await watcher._emit('unlinkDir', directory)
    await watcher._emit('addDir', directory, await stat(directory))
    await watcher._emit('add', child, await stat(child))
    await vi.waitFor(() => expect(childEvents).toContain('change'))
    await vi.waitFor(() => expect(files(store.snapshot().files)).toEqual(['assets/content.txt']))
    expect(store.snapshot().error).toBeNull()
  } finally { await store.close() }
})

it('reconciles an added directory moved before its metadata can be read', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/directory-stale-add-'))
  const store = new Workspace(root, initialState('directory-stale-add'), () => undefined, true)
  try {
    await store.initialize()
    const resolve = store.resolve.bind(store)
    let moved = false
    vi.spyOn(store, 'resolve').mockImplementation(async relative => {
      const resolved = await resolve(relative)
      if (relative === 'assets' && !moved) { moved = true; await rename(resolved, path.join(root, 'moved-assets')) }
      return resolved
    })
    await mkdir(path.join(root, 'assets'))
    await vi.waitFor(() => expect(moved).toBe(true))
    await writeFile(path.join(root, 'moved-assets/content.txt'), 'moved content')
    await vi.waitFor(() => expect(files(store.snapshot().files)).toEqual(['moved-assets/content.txt']))
    expect(store.snapshot().error).toBeNull()
  } finally { await store.close(); vi.restoreAllMocks() }
})

it('continues reporting permission errors while processing additions', async () => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/directory-add-error-'))
  const store = new Workspace(root, initialState('directory-add-error'), () => undefined, true)
  try {
    await store.initialize()
    vi.spyOn(store, 'resolve').mockRejectedValue(Object.assign(new Error('EACCES: fixture metadata access denied'), { code: 'EACCES' }))
    await mkdir(path.join(root, 'assets'))
    await vi.waitFor(() => expect(store.snapshot().error).toBe('EACCES: fixture metadata access denied'))
  } finally { await store.close(); vi.restoreAllMocks() }
})

it('delivers a pending file removal before the replacement directory is added', async () => {
  vi.useFakeTimers()
  const watcher = new FSWatcher({ atomic: 100 })
  const events: string[] = []
  watcher.on('all', event => events.push(event))
  try {
    await watcher._emit('unlink', 'assets')
    await watcher._emit('addDir', 'assets')
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toEqual(['unlink', 'addDir'])
  } finally { await watcher.close(); vi.useRealTimers() }
})

it.each([false, true])('keeps watching a restored directory and its future contents (observe intermediate=%s)', async observed => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/directory-replacement-'))
  await mkdir(path.join(root, 'assets'))
  await writeFile(path.join(root, 'assets/dialogue.txt'), 'dialogue')
  await writeFile(path.join(root, 'assets/texture.bin'), Buffer.from([0, 255]))
  const store = new Workspace(root, initialState('directory-replacement'), () => undefined, true)
  try {
    await store.initialize()
    await rename(path.join(root, 'assets'), path.join(root, 'saved-assets'))
    await writeFile(path.join(root, 'assets'), 'obstruction')
    if (observed) await vi.waitFor(() => expect(files(store.snapshot().files)).toEqual(['assets', 'saved-assets/dialogue.txt', 'saved-assets/texture.bin']))
    await rename(path.join(root, 'assets'), path.join(root, 'obstruction.txt'))
    await rename(path.join(root, 'saved-assets'), path.join(root, 'assets'))
    await vi.waitFor(() => expect(files(store.snapshot().files)).toEqual(['assets/dialogue.txt', 'assets/texture.bin', 'obstruction.txt']))
    await mkdir(path.join(root, 'assets/later'))
    await writeFile(path.join(root, 'assets/later/config.json'), '{}')
    await writeFile(path.join(root, 'assets/later/unpublished.tmp'), 'partial')
    await vi.waitFor(() => expect(files(store.snapshot().files)).toEqual(['assets/dialogue.txt', 'assets/later/config.json', 'assets/texture.bin', 'obstruction.txt']))
    const revision = store.snapshot().fileVersions!['assets/dialogue.txt']
    await writeFile(path.join(root, 'assets/dialogue.txt'), 'updated dialogue')
    await vi.waitFor(() => expect(store.snapshot().fileVersions!['assets/dialogue.txt']).toBeGreaterThan(revision))
    expect(files(store.snapshot().files)).not.toContain('assets/later/unpublished.tmp')
    expect(store.snapshot().error).toBeNull()
  } finally { await store.close() }
})

it.each(['add', 'change'])('preserves watch depth when a pending %s becomes a directory', async pendingEvent => {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/directory-depth-'))
  await mkdir(path.join(root, 'outer'))
  const target = path.join(root, 'outer/assets')
  const events: string[] = []
  const watcher = watch(root, { ignoreInitial: true, depth: 1, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 } })
  watcher.on('all', (event, file) => events.push(`${event}:${path.relative(root, file).split(path.sep).join('/')}`))
  try {
    await new Promise<void>(resolve => watcher.once('ready', resolve))
    if (pendingEvent === 'change') {
      await writeFile(target, 'initial file')
      await vi.waitFor(() => expect(events).toContain('add:outer/assets'))
    }
    const emit = FSWatcher.prototype._emit
    let replaced = false
    vi.spyOn(FSWatcher.prototype, '_emit').mockImplementation(function (this: FSWatcher, ...args) {
      if (args[0] === pendingEvent && args[1] === target && !replaced) {
        replaced = true
        renameSync(target, path.join(root, 'outer/previous.txt'))
        mkdirSync(target)
        writeFileSync(path.join(target, 'outside-depth.txt'), 'not watched')
      }
      return emit.apply(this, args)
    })
    await writeFile(target, 'temporary file')
    await vi.waitFor(() => expect(events).toContain('addDir:outer/assets'))
    await writeFile(path.join(root, 'outer/ready.txt'), 'within depth')
    await vi.waitFor(() => expect(events).toContain('add:outer/ready.txt'))
    expect(replaced).toBe(true)
    expect(events).not.toContain('add:outer/assets/outside-depth.txt')
    expect(watcher.getWatched()[target]).toEqual([])
  } finally { await watcher.close(); vi.restoreAllMocks() }
})
