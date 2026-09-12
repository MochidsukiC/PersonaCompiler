import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { DemoEngine } from '../../src/main/engine'

const engines: DemoEngine[] = []
afterEach(async () => { await Promise.all(engines.splice(0).map(engine => engine.close())) })

async function setup() {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/engine-'))
  const engine = new DemoEngine(root, () => undefined, 60000)
  engines.push(engine)
  await engine.initialize()
  return engine
}

describe('Demonstration lifecycle', () => {
  it('prepares disk data, spawns residents, moves them and observes at day end', async () => {
    const engine = await setup()
    await engine.prepare({ description: '私の町', images: [] })
    expect(await engine.workspace.read('inputs/description.md')).toBe('私の町')
    await engine.step()
    expect(engine.workspace.snapshot().state.map?.locations).toHaveLength(6)
    await engine.step()
    let state = await engine.workspace.readState()
    expect(state.agents).toHaveLength(6)
    expect(state.frame.positions.hana).toBe(state.frame.positions.yuto)
    expect(state.relationships).toBeNull()
    await engine.workspace.write('agents/hana/memory.md', '# 自分で編集した記憶\n')
    await engine.step(); await engine.step(); await engine.step()
    state = await engine.workspace.readState()
    expect(state.frame.phase).toBe('night')
    expect(state.relationships?.relations).toHaveLength(3)
    expect(state.relationships?.relations[0]).toMatchObject({ source: 'hana', target: 'yuto' })
    expect(await engine.workspace.read('agents/hana/memory.md')).toContain('自分で編集した記憶')
    expect(await engine.workspace.read('observations/day-1.json')).toContain('observedTurn')
    expect(engine.workspace.snapshot().staleRelations).toHaveLength(0)
    await engine.step()
    state = await engine.workspace.readState()
    expect(state.agents).toHaveLength(8)
    expect(state.frame.positions.sora).toBeNull()
    expect(engine.workspace.snapshot().staleRelations).not.toHaveLength(0)
  })

  it('pauses, interrupts separately from closing a view, and creates a fresh run without deleting old files', async () => {
    const engine = await setup()
    await engine.prepare({ description: '保存する入力', images: [] })
    await engine.step(); await engine.step()
    await engine.pause()
    const paused = await engine.workspace.readState()
    await engine.step()
    expect((await engine.workspace.readState()).frame.turn).toBe(paused.frame.turn)
    await engine.resume()
    await engine.interrupt('hana')
    const before = await engine.sessions.snapshot('hana')
    await engine.step()
    expect((await engine.sessions.snapshot('hana')).sequence).toBe(before.sequence)
    await engine.terminalInput('hana', '続けて\r')
    await engine.step()
    expect((await engine.sessions.snapshot('hana')).sequence).toBeGreaterThan(before.sequence)
    const oldRoot = engine.workspace.root
    await engine.newRun()
    expect(engine.workspace.root).not.toBe(oldRoot)
    expect(await readFile(path.join(oldRoot, 'inputs/description.md'), 'utf8')).toBe('保存する入力')
    expect(engine.workspace.snapshot().state.stage).toBe('draft')
    expect(engine.sessions.has('hana')).toBe(false)
    expect((await engine.sessions.snapshot('parent')).data).toContain('準備ができました')
  })

  it('rejects invalid image content without starting a run', async () => {
    const engine = await setup()
    await expect(engine.prepare({ description: '町', images: [{ name: 'bad.png', bytes: new Uint8Array([1, 2, 3]) }] })).rejects.toThrow('画像を指定')
    expect((await engine.workspace.readState()).stage).toBe('draft')
  })
})
