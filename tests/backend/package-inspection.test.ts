import { expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inspectCharacterPackage } from '../../src/backend/package-inspection'
import { Workspace, digest } from '../../src/main/workspace'

async function setup() {
  await mkdir('.local/tests', { recursive: true })
  const root = await mkdtemp(path.resolve('.local/tests/package-inspection-'))
  const workspace = new Workspace(root, { runId: path.basename(root), stage: 'ended', agents: [], map: null, frame: { revision: 0, turn: 4, day: 1, phase: 'night', mapRevision: null, positions: {} }, relationships: null }, () => undefined, true)
  const directory = 'compilation/test/npcs/npc0', manifestPath = `${directory}/manifest.json`
  const binary = Buffer.from([0, 128, 255, 1])
  const manifest = { version: 1, npcId: 'npc0', sourceRevision: 5, modelId: 'fixture', inputHash: digest('input'), promptHash: digest('prompt'), files: { 'character.json': digest('{"name":"葵"}'), 'nested/asset.bin': digest(binary) } }
  await workspace.write(`${directory}/character.json`, '{"name":"葵"}')
  await workspace.write(`${directory}/nested/asset.bin`, binary)
  await workspace.write(manifestPath, JSON.stringify(manifest))
  return { root, workspace, directory, manifestPath, manifest }
}

it('compares every manifest entry as bytes without changing the package or requiring a game-specific format', async () => {
  const { workspace, manifestPath, manifest } = await setup()
  const original = await workspace.read(manifestPath)
  const report = await inspectCharacterPackage(workspace, manifestPath)
  expect(report).toMatchObject({ runId: workspace.snapshot().state.runId, manifestPath, manifestHash: digest(original), inputHash: manifest.inputHash, promptHash: manifest.promptHash, npcId: 'npc0', sourceRevision: 5, modelId: 'fixture' })
  expect(report.files.map(file => [file.path, file.status, file.bytes])).toEqual([['character.json', 'match', Buffer.byteLength('{"name":"葵"}')], ['nested/asset.bin', 'match', 4]])
  expect(await workspace.read(manifestPath)).toBe(original)
})

it('reports changed and missing entries and compares fresh bytes when repeated', async () => {
  const { workspace, directory, manifestPath, manifest } = await setup()
  await workspace.write(`${directory}/character.json`, '{"name":"蓮"}')
  await workspace.write(manifestPath, JSON.stringify({ ...manifest, files: { ...manifest.files, 'missing.json': digest('missing') } }))
  const report = await inspectCharacterPackage(workspace, manifestPath)
  expect(report.files.map(file => file.status)).toEqual(['changed', 'match', 'missing'])
  expect(report.files[2]).toMatchObject({ actualHash: null, bytes: null })
  await workspace.write(`${directory}/character.json`, '{"name":"葵"}')
  expect((await inspectCharacterPackage(workspace, manifestPath)).files[0].status).toBe('match')
})

it('rejects invalid manifests, wrong identities and paths outside the package', async () => {
  const { root, workspace, manifestPath, manifest } = await setup()
  await expect(inspectCharacterPackage(workspace, 'persistence/manifest.json')).rejects.toThrow('NPCパッケージ')
  for (const invalid of [{ ...manifest, files: {} }, { ...manifest, inputHash: 'bad-hash' }, { ...manifest, npcId: 'npc1' }]) {
    await workspace.write(manifestPath, JSON.stringify(invalid))
    await expect(inspectCharacterPackage(workspace, manifestPath)).rejects.toThrow()
  }
  await writeFile(path.join(root, 'outside.txt'), 'outside')
  await workspace.write(manifestPath, JSON.stringify({ ...manifest, files: { '../../../../outside.txt': digest('outside') } }))
  await expect(inspectCharacterPackage(workspace, manifestPath)).rejects.toThrow('相対パス')
  expect(await readFile(path.join(root, 'outside.txt'), 'utf8')).toBe('outside')
  const outside = path.join(root, 'other-package')
  await mkdir(outside); await writeFile(path.join(outside, 'data.json'), 'outside')
  await symlink(outside, path.join(root, path.posix.dirname(manifestPath), 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await workspace.write(manifestPath, JSON.stringify({ ...manifest, files: { 'linked/data.json': digest('outside') } }))
  await expect(inspectCharacterPackage(workspace, manifestPath)).rejects.toThrow('パッケージ外')
})
