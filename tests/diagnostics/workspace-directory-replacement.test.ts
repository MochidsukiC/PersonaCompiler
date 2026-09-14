import { expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FSWatcher } from 'chokidar'
import { NodeFsHandler } from 'chokidar/handler.js'
import { Workspace } from '../../src/main/workspace'
import { initialState } from '../../src/main/fixtures'
import type { FileEntry } from '../../src/shared/contracts'

const flatten = (entries: FileEntry[]): string[] => entries.flatMap(entry => [`${entry.kind}:${entry.path}`, ...flatten(entry.children ?? [])]).sort()

for (const observed of [false, true]) {
  it(`restores a directory replaced temporarily by a file (observe intermediate=${observed})`, async () => {
    await mkdir('.local/directory-replacement', { recursive: true })
    const output = await mkdtemp(path.resolve('.local/directory-replacement/case-'))
    const root = path.join(output, 'workspace')
    await mkdir(path.join(root, 'assets'), { recursive: true })
    await writeFile(path.join(root, 'assets/dialogue.txt'), 'dialogue')
    await writeFile(path.join(root, 'assets/texture.bin'), Buffer.from([0, 255]))
    const snapshots: unknown[] = [], events: unknown[] = [], attempts: unknown[] = []
    const store = new Workspace(root, initialState('directory-replacement'), snapshot => snapshots.push({ files: flatten(snapshot.files), error: snapshot.error }), true)
    try {
      await store.initialize()
      const emit = FSWatcher.prototype._emit
      vi.spyOn(FSWatcher.prototype, '_emit').mockImplementation(function (this: FSWatcher, ...args) {
        attempts.push({ kind: 'emit', event: args[0], path: path.relative(root, args[1]), directory: args[2]?.isDirectory() })
        return emit.apply(this, args)
      })
      const handleFile = NodeFsHandler.prototype._handleFile
      vi.spyOn(NodeFsHandler.prototype, '_handleFile').mockImplementation(function (this: NodeFsHandler, ...args) {
        attempts.push({ kind: 'handleFile', path: path.relative(root, args[0]), directory: args[1].isDirectory(), initialAdd: args[2] })
        return handleFile.apply(this, args)
      })
      const watcher = (store as unknown as { watcher: FSWatcher }).watcher
      watcher.on('all', (event, file, stats) => events.push({ event, path: path.relative(root, file), directory: stats?.isDirectory(), watched: watcher.getWatched() }))
      await rename(path.join(root, 'assets'), path.join(root, 'saved-assets'))
      await writeFile(path.join(root, 'assets'), 'obstruction')
      if (observed) await vi.waitFor(() => expect(flatten(store.snapshot().files)).toEqual(['directory:saved-assets', 'file:assets', 'file:saved-assets/dialogue.txt', 'file:saved-assets/texture.bin']), { timeout: 5000 })
      await rename(path.join(root, 'assets'), path.join(root, 'obstruction.txt'))
      await rename(path.join(root, 'saved-assets'), path.join(root, 'assets'))
      await vi.waitFor(() => expect(flatten(store.snapshot().files)).toEqual(['directory:assets', 'file:assets/dialogue.txt', 'file:assets/texture.bin', 'file:obstruction.txt']), { timeout: 5000 })
      expect(store.snapshot().error).toBeNull()
    } finally {
      const watched = (store as unknown as { watcher: FSWatcher | null }).watcher?.getWatched()
      try { await store.close() } finally { vi.restoreAllMocks() }
      await writeFile(path.join(output, 'observations.json'), JSON.stringify({ observed, root, snapshots, events, attempts, watched, disk: flatten(await store.tree()) }, null, 2))
      console.log(`Directory replacement records: ${output}`)
    }
  })
}
