import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { characterManifestSchema, type CharacterPackageInspection } from '../core/compiler-contracts'
import { digest, type Workspace } from '../main/workspace'

export async function inspectCharacterPackage(workspace: Workspace, manifestPath: string): Promise<CharacterPackageInspection> {
  if (!/^compilation\/[^/]+\/npcs\/[^/]+\/manifest\.json$/.test(manifestPath)) throw new Error('NPCパッケージのmanifestを指定してください')
  const directory = path.posix.dirname(manifestPath)
  const packageRoot = await workspace.resolve(directory)
  const manifestBytes = await readFile(await workspace.resolve(manifestPath))
  const manifest = characterManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  if (manifest.npcId !== path.posix.basename(directory)) throw new Error('パッケージのNPC IDと保存先が一致しません')
  const files: CharacterPackageInspection['files'] = []
  for (const [name, expectedHash] of Object.entries(manifest.files)) {
    try {
      const resolved = await workspace.resolve(`${directory}/${name}`)
      const relation = path.relative(packageRoot, resolved)
      if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error(`パッケージ外の成果物は照合できません: ${name}`)
      const hash = createHash('sha256')
      let bytes = 0
      for await (const chunk of createReadStream(resolved)) {
        hash.update(chunk)
        bytes += chunk.byteLength
      }
      const actualHash = hash.digest('hex')
      files.push({ path: name, status: actualHash === expectedHash ? 'match' : 'changed', expectedHash, actualHash, bytes })
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      files.push({ path: name, status: 'missing', expectedHash, actualHash: null, bytes: null })
    }
  }
  return { runId: workspace.snapshot().state.runId, manifestPath, manifestHash: digest(manifestBytes), inputHash: manifest.inputHash, promptHash: manifest.promptHash,
    npcId: manifest.npcId, sourceRevision: manifest.sourceRevision, modelId: manifest.modelId, checkedAt: new Date().toISOString(), files }
}
