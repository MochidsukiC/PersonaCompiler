import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { Workspace, digest } from '../main/workspace'
import { devCheckpointInfoSchema, type DevCheckpointInfo } from '../core/dev-contracts'
import { manifestSchema } from './persistence-store'
import type { SavedMemoryRun, SaveManifest } from '../core/persistence'

const fileSchema = z.object({ path: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/) })
const checkpointSchema = z.object({
  info: devCheckpointInfoSchema, runId: z.uuid(), files: z.array(fileSchema),
  conversations: z.record(z.string(), z.object({ threadId: z.string(), lastTurnId: z.string().nullable() }))
})
export type DevCheckpoint = z.infer<typeof checkpointSchema>

export class DevStore {
  constructor(private readonly workspace: Workspace) {}
  async list(): Promise<DevCheckpointInfo[]> {
    let entries: string[]
    try { entries = await readdir(path.join(this.workspace.root, 'dev/checkpoints')) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error }
    const result: DevCheckpointInfo[] = []
    for (const name of entries.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) result.push((await this.read(name.slice(0, -5))).info)
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  async read(id: string): Promise<DevCheckpoint> {
    z.uuid().parse(id)
    const envelope = z.object({ hash: z.string(), value: checkpointSchema }).parse(JSON.parse(await this.workspace.read(`dev/checkpoints/${id}.json`)))
    if (digest(JSON.stringify(envelope.value)) !== envelope.hash || envelope.value.info.id !== id || envelope.value.runId !== path.basename(this.workspace.root)) throw new Error(`DEVチェックポイントの整合性エラー: ${id}`)
    return envelope.value
  }
  async capture(label: string, turn: number, promptRevision: number, conversations: DevCheckpoint['conversations']): Promise<DevCheckpointInfo> {
    const manifest = manifestSchema.parse(JSON.parse(await this.workspace.read('persistence/manifest.json')))
    const files: DevCheckpoint['files'] = []
    const add = async (relative: string) => {
      const bytes = await readFile(await this.workspace.resolve(relative)), hash = digest(bytes)
      const blob = `dev/blobs/${hash}`
      try {
        const existing = await readFile(await this.workspace.resolve(blob))
        if (digest(existing) !== hash) throw new Error(`DEV blobのhash不一致: ${hash}`)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        await this.workspace.write(blob, bytes)
      }
      files.push({ path: relative, hash })
    }
    const walk = async (directory = '') => {
      for (const entry of await readdir(directory ? await this.workspace.resolve(directory) : this.workspace.root, { withFileTypes: true })) {
        if (entry.name.endsWith('.tmp') || (!directory && ['dev', 'persistence'].includes(entry.name))) continue
        const relative = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isSymbolicLink()) throw new Error(`DEV保存ではリンクを参照できません: ${relative}`)
        if (entry.isDirectory()) await walk(relative)
        else if (entry.isFile()) await add(relative)
      }
    }
    await walk()
    for (const relative of ['persistence/manifest.json', `persistence/snapshot-${manifest.slot}.json`, ...manifest.segments.map(s => `persistence/${s.file}`)]) await add(relative)
    const info = { id: randomUUID(), label, turn, promptRevision, createdAt: new Date().toISOString() }
    const value = checkpointSchema.parse({ info, runId: manifest.runId, files, conversations })
    await this.workspace.write(`dev/checkpoints/${info.id}.json`, JSON.stringify({ hash: digest(JSON.stringify(value)), value }))
    return info
  }
  async restore(checkpoint: DevCheckpoint, target: Workspace): Promise<{ manifest: SaveManifest; run: SavedMemoryRun }> {
    for (const file of checkpoint.files) {
      const bytes = await readFile(await this.workspace.resolve(`dev/blobs/${file.hash}`))
      if (digest(bytes) !== file.hash) throw new Error(`DEV復元ファイルのhash不一致: ${file.path}`)
      if (file.path === 'dev' || file.path.startsWith('dev/')) throw new Error('DEV内部状態を成果物から復元できません')
      await target.write(file.path, bytes)
    }
    const manifest = manifestSchema.parse(JSON.parse(await target.read('persistence/manifest.json')))
    const text = await target.read(`persistence/snapshot-${manifest.slot}.json`)
    if (digest(text) !== manifest.hash) throw new Error('DEV復元snapshotのhash不一致')
    return { manifest, run: JSON.parse(text) as SavedMemoryRun }
  }
  static async publish(target: Workspace, manifest: SaveManifest, run: SavedMemoryRun, dirty: boolean): Promise<void> {
    const text = JSON.stringify({ ...run, historyRevision: manifest.revision })
    await target.write(`persistence/snapshot-${manifest.slot}.json`, text)
    await target.write('persistence/manifest.json', JSON.stringify({ ...manifest, runId: path.basename(target.root), hash: digest(text), dirty }))
  }
}
