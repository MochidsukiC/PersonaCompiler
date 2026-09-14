import type { LifeCheckpoint } from './life-harness'
import type { AgentModelSettings, PreparationProgress } from './contracts'
import type { MemoryArchive } from './memory-contracts'

export interface SavedBackend {
  dev?: import('./dev-contracts').DevState
  version: 1
  lifeVersion?: 1
  memoryVersion?: 1
  economyVersion?: 1
  economySeed?: import('./economy-contracts').EconomySeed
  lifecycleVersion?: 1
  compilation?: import('./compiler-contracts').Compilation
  production?: import('./compiler-contracts').ProductionOperation
  authMode: 'chatgpt' | 'apiKey' | null
  settings: AgentModelSettings | null
  preparation: PreparationProgress
  artifactHash: string | null
}
export interface PersistenceStatus {
  state: 'saved' | 'pending' | 'saving' | 'error' | 'readOnly'
  revision: number
  savedRevision: number
  savedAt: string | null
  unsavedSince: string | null
  unsavedBytes: number
  error: string | null
  readOnlyReason: string | null
  bytesWritten: number
  saveDurationMs: number
}
export interface LifePatch { path: (string | number)[]; value: unknown }
export type LifeHistoryRecord =
  | { kind: 'economy'; value: import('./economy-contracts').EconomyRecord }
  | MemoryArchive
  | { kind: 'job'; value: LifeCheckpoint['jobs'][number] }
  | { kind: 'receipt'; key: string; value: LifeCheckpoint['receipts'][string] }
  | { kind: 'event'; value: LifeCheckpoint['world']['events'][number] }
  | { kind: 'interaction'; value: LifeCheckpoint['interactions'][number] }
export interface LifeChange { patches: LifePatch[]; history: LifeHistoryRecord[] }
export type PersistenceChange = { revision: number } & (
  | { kind: 'metadata'; value: SavedBackend }
  | { kind: 'initializeLife'; value: LifeCheckpoint }
  | { kind: 'life'; value: LifeChange }
)
export interface SavedMemoryRun { metadata: SavedBackend; life: LifeCheckpoint | null }
export interface HistorySegment { file: string; hash: string; first: number; last: number }
export interface SaveManifest {
  version: 2; runId: string; revision: number; generation: number; slot: 'a' | 'b'; hash: string
  dirty: boolean; savedAt: string; segments: HistorySegment[]
}
export interface SaveReceipt { manifest: SaveManifest; bytesWritten: number; durationMs: number }
export interface LoadedMemoryRun { manifest: SaveManifest; run: SavedMemoryRun }
export type PersistenceRequest =
  | { id: number; kind: 'open'; root: string }
  | { id: number; kind: 'change'; change: PersistenceChange }
  | { id: number; kind: 'save'; dirty: boolean }
export type PersistenceResponse = { id: number; result?: LoadedMemoryRun | SaveReceipt | null; error?: string }
export interface PersistencePort {
  postMessage(message: PersistenceRequest): void
  on(event: 'message', listener: (message: PersistenceResponse) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}
export type PersistencePortFactory = () => PersistencePort
