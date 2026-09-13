import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Workspace, digest } from '../../src/main/workspace'
import { demoMap, initialState, residents } from '../../src/main/fixtures'

const stores: Workspace[] = []
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())) })

async function setup(memory = false) {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/workspace-'))
  const store = new Workspace(root, initialState('test'), () => undefined, memory)
  stores.push(store)
  await store.initialize()
  return store
}

describe('Disk workspace', () => {
  it('keeps memory commits off disk, never reloads own persistence, and versions only changed files', async () => {
    const store = await setup(true)
    const read = vi.spyOn(store, 'readState'), tree = vi.spyOn(store, 'tree'), write = vi.spyOn(store, 'write')
    await store.commit({ ...store.snapshot().state, stage: 'paused' })
    expect(read).not.toHaveBeenCalled(); expect(tree).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
    await expect(readFile(path.join(store.root, 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await store.write('notes/one.md', 'one'); await store.write('notes/two.md', 'two')
    await vi.waitFor(() => expect(store.snapshot().files.find(file => file.name === 'notes')?.children).toHaveLength(2))
    const one = store.snapshot().fileVersions!['notes/one.md']
    await store.write('notes/two.md', 'changed')
    await vi.waitFor(() => expect(store.snapshot().fileVersions!['notes/two.md']).toBeGreaterThan(1))
    expect(store.snapshot().fileVersions!['notes/one.md']).toBe(one)
    await store.write('persistence/snapshot-a.json', '{}')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(store.snapshot().files.some(file => file.name === 'persistence')).toBe(true)
    expect(store.snapshot().state.stage).toBe('paused')
    await rename(path.join(store.root, 'notes/one.md'), path.join(store.root, 'notes/renamed.md'))
    await vi.waitFor(() => expect(store.snapshot().files.find(file => file.name === 'notes')!.children!.map(file => file.name)).toEqual(['renamed.md', 'two.md']))
    expect(tree).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
  })
  it('detects external writes and atomic editor saves without writing the cache back', async () => {
    const store = await setup()
    await store.write('agents/hana/memory.md', '# Original')
    await vi.waitFor(() => expect(store.snapshot().files.some(f => f.name === 'agents')).toBe(true))
    const before = store.snapshot().version
    const temp = path.join(store.root, 'agents/hana/editor.tmp')
    await writeFile(temp, '# Edited outside\n外部編集', 'utf8')
    await rename(temp, path.join(store.root, 'agents/hana/memory.md'))
    await vi.waitFor(() => expect(store.snapshot().version).toBeGreaterThan(before))
    expect((await store.preview('agents/hana/memory.md')).content).toBe('# Edited outside\n外部編集')
    await store.refresh()
    expect(await readFile(path.join(store.root, 'agents/hana/memory.md'), 'utf8')).toContain('外部編集')
  })

  it('publishes map and positions together and identifies invalid or mismatched state', async () => {
    const store = await setup()
    const initial = await store.readState()
    await store.commit({ ...initial, map: demoMap, frame: { ...initial.frame, revision: 1, mapRevision: 1 } })
    const valid = await store.readState()
    await writeFile(path.join(store.root, 'state.json'), '{broken json')
    await store.refresh()
    expect(store.snapshot().error).toContain('state.json')
    expect(store.snapshot().state.map?.revision).toBe(1)
    await expect(store.commit({ ...valid, frame: { ...valid.frame, mapRevision: 2 } })).rejects.toThrow('一致しません')
    await store.write('state.json', JSON.stringify(valid))
    await store.refresh()
    expect(store.snapshot().error).toBeNull()
    await expect(store.commit({ ...valid, frame: { ...valid.frame, positions: { ghost: 'park' } } })).rejects.toThrow('Agent IDが不明')
  })

  it('marks only observations whose evidence has changed as stale', async () => {
    const store = await setup()
    await store.write('agents/hana/memory.md', '初めて会った。')
    const initial = await store.readState()
    await store.commit({ ...initial, agents: [...initial.agents, ...residents.slice(0, 2)], relationships: {
      observedAt: new Date().toISOString(), observedTurn: 4, day: 1,
      relations: [{ id: 'r', source: 'hana', target: 'yuto', label: '顔なじみ', description: '花から見た悠斗', evidence: [{ path: 'agents/hana/memory.md', hash: digest('初めて会った。') }] }]
    } })
    expect(store.snapshot().staleRelations).toEqual([])
    await store.write('agents/hana/memory.md', 'また会いたい。')
    await store.refresh()
    expect(store.snapshot().staleRelations).toEqual(['r'])
    const state = await store.readState()
    expect(state.relationships?.relations[0].label).toBe('顔なじみ')
    await rename(path.join(store.root, 'agents/hana/memory.md'), path.join(store.root, 'agents/hana/renamed.md'))
    await store.refresh()
    expect(store.snapshot().staleRelations).toEqual(['r'])
  })

  it('rejects paths outside the workspace', async () => {
    const store = await setup()
    for (const illegal of ['../outside.md', 'C:\\Windows\\win.ini', 'agents/../../outside.md', 'state.json:stream']) {
      await expect(store.resolve(illegal)).rejects.toThrow('相対パス')
    }
  })

  it('rejects external directory links before creating missing descendants and keeps the write queue usable', async () => {
    const store = await setup(true)
    const outside = await mkdtemp(path.resolve('.local/tests/workspace-outside-'))
    await writeFile(path.join(outside, 'sentinel.txt'), 'unchanged')
    await mkdir(path.join(store.root, 'artifacts'))
    await symlink(outside, path.join(store.root, 'artifacts/linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(store.write('artifacts/linked/new/nested/review.json', '{}')).rejects.toThrow('プロジェクト外へ保存できません')
    expect(await readdir(outside)).toEqual(['sentinel.txt'])
    expect(await readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
    await expect(store.write('artifacts/linked/sentinel.txt', 'overwritten')).rejects.toThrow('プロジェクト外へ保存できません')
    expect(await readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
    await store.write('artifacts/local/nested/review.json', 'local')
    expect(await store.read('artifacts/local/nested/review.json')).toBe('local')
  })

  it('creates nested outputs through an existing directory link contained in the workspace', async () => {
    const store = await setup(true)
    await mkdir(path.join(store.root, 'shared'))
    await symlink(path.join(store.root, 'shared'), path.join(store.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await store.write('linked/new/nested/review.json', 'inside')
    expect(await store.read('shared/new/nested/review.json')).toBe('inside')
  })

  it('serializes local reads and replacement writes, and appends without rewriting external edits', async () => {
    const store = await setup()
    await store.write('memory.md', '# Memory\n')
    const operations: Promise<unknown>[] = []
    for (let i = 0; i < 120; i += 1) {
      operations.push(store.preview('memory.md'), store.write('memory.md', `version ${i}\n`), store.read('memory.md'))
    }
    await Promise.all(operations)
    await writeFile(path.join(store.root, 'memory.md'), '外部の編集\n')
    await store.append('memory.md', 'エージェントの追記\n')
    expect(await store.read('memory.md')).toBe('外部の編集\nエージェントの追記\n')
    expect(store.snapshot().error).toBeNull()
  })
})
