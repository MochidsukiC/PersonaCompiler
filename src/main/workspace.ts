import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { stateSchema, type FileEntry, type FilePreview, type RunState, type WorkspaceSnapshot } from '../shared/contracts'
import { publishFile } from './atomic-write'

export function digest(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex') }
export function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export class Workspace {
  private watcher: FSWatcher | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private refreshQueue: Promise<void> = Promise.resolve()
  private fileQueue: Promise<void> = Promise.resolve()
  private closed = false
  private view: WorkspaceSnapshot

  constructor(readonly root: string, initial: RunState, private readonly publish: (snapshot: WorkspaceSnapshot) => void, private readonly memory = false) {
    this.view = { root, state: initial, files: [], staleRelations: [], error: null, version: 0, ...(memory ? { fileVersions: {} } : {}) }
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    if (!this.memory) await this.write('state.json', JSON.stringify(this.view.state, null, 2))
    this.watcher = watch(this.root, { ignoreInitial: true, followSymlinks: false, ignored: p => p.endsWith('.tmp') || (this.memory && path.relative(this.root, p).split(path.sep)[0] === 'dev'), atomic: true, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 } })
    this.watcher.on('all', (event, target) => {
      if (this.memory) {
        this.refreshQueue = this.refreshQueue.then(() => this.fileChanged(event, target)).catch(error => this.report(messageOf(error)))
        return
      }
      if (this.refreshTimer) clearTimeout(this.refreshTimer)
      this.refreshTimer = setTimeout(() => { void this.refresh() }, 60)
    })
    this.watcher.on('error', error => this.report(`ファイル監視: ${messageOf(error)}`))
    await new Promise<void>(resolve => this.watcher?.once('ready', resolve))
    if (this.memory) { this.view.files = await this.tree(); this.publish(this.view) }
    else await this.refresh()
  }

  private async fileChanged(event: string, target: string): Promise<void> {
    if (this.closed) return
    const relative = path.relative(this.root, target).split(path.sep).join('/')
    if (!relative || relative.startsWith('../')) return
    this.view.fileVersions![relative] = (this.view.fileVersions![relative] ?? 0) + 1
    const parts = relative.split('/')
    let entries = this.view.files
    for (let index = 0; index < parts.length - 1; index++) {
      let directory = entries.find(entry => entry.name === parts[index] && entry.kind === 'directory')
      if (!directory) {
        if (event === 'unlink' || event === 'unlinkDir') { this.view = { ...this.view, version: this.view.version + 1 }; this.publish(this.view); return }
        directory = { name: parts[index], path: parts.slice(0, index + 1).join('/'), kind: 'directory', children: [] }; entries.push(directory)
      }
      entries = directory.children!
    }
    const index = entries.findIndex(entry => entry.path === relative)
    if (event === 'unlink' || event === 'unlinkDir') { if (index !== -1) entries.splice(index, 1) }
    else if (event === 'add' || event === 'addDir') {
      const resolved = await this.resolve(relative)
      const metadata = await stat(resolved)
      const entry: FileEntry = { name: parts.at(-1)!, path: relative, kind: metadata.isDirectory() ? 'directory' : 'file', ...(metadata.isDirectory() ? { children: [] } : {}) }
      if (index === -1) entries.push(entry)
    }
    entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name))
    this.view = { ...this.view, version: this.view.version + 1 }
    this.publish(this.view)
  }

  private relativePath(relative: string): string {
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || part === '.' || part === '') || /[:\0]/.test(relative)) {
      throw new Error(`プロジェクト内の相対パスが必要です: ${relative}`)
    }
    return path.join(this.root, relative)
  }

  async resolve(relative: string): Promise<string> {
    const target = await realpath(this.relativePath(relative))
    const root = await realpath(this.root)
    const relation = path.relative(root, target)
    if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`プロジェクト外のファイルです: ${relative}`)
    return target
  }

  private fileOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.fileQueue.then(operation)
    this.fileQueue = result.then(() => undefined, error => this.report(messageOf(error)))
    return result
  }

  read(relative: string): Promise<string> {
    return this.fileOperation(async () => readFile(await this.resolve(relative), 'utf8'))
  }

  append(relative: string, content: string): Promise<void> {
    return this.fileOperation(async () => appendFile(await this.resolve(relative), content, 'utf8'))
  }

  async write(relative: string, content: string | Uint8Array): Promise<void> {
    await this.fileOperation(async () => {
      const target = this.relativePath(relative)
      await mkdir(path.dirname(target), { recursive: true })
      const parent = await realpath(path.dirname(target))
      const relation = path.relative(await realpath(this.root), parent)
      if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error(`プロジェクト外へ保存できません: ${relative}`)
      const temporary = `${target}.${randomUUID()}.tmp`
      await writeFile(temporary, content, { flag: 'wx' })
      await publishFile(temporary, target)
    })
  }

  async readState(): Promise<RunState> {
    const contents = await this.read('state.json')
    try { return stateSchema.parse(JSON.parse(contents)) }
    catch (error) { throw new Error(`state.json の読み込みに失敗しました: ${messageOf(error)}`, { cause: error }) }
  }

  async commit(state: RunState): Promise<void> {
    const validated = stateSchema.parse(state)
    if (this.memory) { this.view = { ...this.view, state: validated, version: this.view.version + 1 }; this.publish(this.view); return }
    await this.write('state.json', JSON.stringify(validated, null, 2))
    await this.refresh()
  }

  async tree(relative = ''): Promise<FileEntry[]> {
    const directory = relative ? await this.resolve(relative) : this.root
    const entries = await readdir(directory, { withFileTypes: true })
    const result: FileEntry[] = []
    for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (entry.name.endsWith('.tmp') || entry.isSymbolicLink() || (this.memory && !relative && entry.name === 'dev')) continue
      const filePath = relative ? `${relative}/${entry.name}` : entry.name
      result.push(entry.isDirectory()
        ? { name: entry.name, path: filePath, kind: 'directory', children: await this.tree(filePath) }
        : { name: entry.name, path: filePath, kind: 'file' })
    }
    return result
  }

  async preview(relative: string): Promise<FilePreview> {
    return this.fileOperation(async () => {
      const target = await this.resolve(relative)
      const metadata = await stat(target)
      if (!metadata.isFile()) throw new Error(`ファイルではありません: ${relative}`)
      if (metadata.size > 20 * 1024 * 1024) throw new Error(`プレビューの上限20MBを超えています: ${relative}`)
      const data = await readFile(target)
      const ext = path.extname(target).toLowerCase()
      const mime = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp']]).get(ext)
      return { path: relative, hash: digest(data), kind: mime ? 'image' : 'text', content: mime ? `data:${mime};base64,${data.toString('base64')}` : data.toString('utf8') }
    })
  }

  async refresh(): Promise<void> {
    if (this.memory) { this.publish(this.view); return }
    this.refreshQueue = this.refreshQueue.then(async () => {
      if (this.closed) return
      try {
        const [state, files] = await Promise.all([this.readState(), this.tree()])
        const staleRelations: string[] = []
        for (const relation of state.relationships?.relations ?? []) {
          for (const evidence of relation.evidence) {
            if (!('path' in evidence)) continue
            let changed: boolean
            try { changed = digest(await this.read(evidence.path)) !== evidence.hash }
            catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
              changed = true
            }
            if (changed) { staleRelations.push(relation.id); break }
          }
        }
        this.view = { root: this.root, state, files, staleRelations, error: null, version: this.view.version + 1 }
        this.publish(this.view)
      } catch (error) { this.report(messageOf(error)) }
    })
    await this.refreshQueue
  }

  snapshot(): WorkspaceSnapshot { return this.view }

  report(message: string): void {
    this.view = { ...this.view, error: message, version: this.view.version + 1 }
    if (!this.closed) this.publish(this.view)
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    await this.watcher?.close()
    await this.refreshQueue
    await this.fileQueue
  }
}
