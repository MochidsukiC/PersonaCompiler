import { z } from 'zod'
import type { BackendCommand, BackendSnapshot } from '../core/contracts'
import { simulationSchema } from '../core/life-contracts'
import type { ConversationPage } from './conversation'
import type { MemoryDetail, MemoryInspection } from '../core/memory-contracts'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })
export const agentSchema = z.object({
  id: z.string().min(1), name: z.string(), parentId: z.string().nullable(),
  role: z.enum(['parent', 'npc', 'observer', 'facility']), sessionId: z.string(),
  status: z.enum(['idle', 'running', 'interrupted', 'ended']), color: z.string()
})
export const mapSchema = z.object({
  revision: z.number().int().positive(), name: z.string(),
  bounds: z.object({ width: z.number().positive(), height: z.number().positive() }),
  areas: z.array(z.object({ id: z.string(), name: z.string(), position: point, width: z.number().positive(), height: z.number().positive(), color: z.string() })),
  locations: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string().min(1), position: point, areaId: z.string() })),
  connections: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() }))
})
export const frameSchema = z.object({
  revision: z.number().int().nonnegative(), turn: z.number().int().nonnegative(), day: z.number().int().positive(),
  phase: z.enum(['morning', 'noon', 'evening', 'night']), mapRevision: z.number().int().nullable(),
  positions: z.record(z.string(), z.string().nullable())
})
export const relationshipSchema = z.object({
  observedAt: z.string(), observedTurn: z.number().int(), day: z.number().int(),
  relations: z.array(z.object({
    id: z.string(), source: z.string(), target: z.string(), label: z.string(), description: z.string(),
    observedTurn: z.number().int().nonnegative().optional(),
    evidence: z.array(z.union([z.object({ path: z.string(), hash: z.string() }), z.object({ memoryId: z.string(), revision: z.number().int().positive(), ownerId: z.string() })]))
  }))
})
export const stateSchema = z.object({
  runId: z.string(), stage: z.enum(['draft', 'preparing', 'ready', 'running', 'paused', 'ended', 'error']),
  agents: z.array(agentSchema), map: mapSchema.nullable(), frame: frameSchema,
  relationships: relationshipSchema.nullable(), simulation: simulationSchema.optional()
}).superRefine((state, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  const agents = new Set(state.agents.map(a => a.id))
  if (agents.size !== state.agents.length) issue('Agent IDが重複しています')
  if (new Set(state.agents.map(a => a.sessionId)).size !== state.agents.length) issue('Session IDが重複しています')
  if (state.frame.mapRevision !== (state.map ? state.map.revision : null)) issue('地図と所在地の版が一致しません')
  const locations = new Set(state.map?.locations.map(l => l.id))
  if (state.map && locations.size !== state.map.locations.length) issue('地点IDが重複しています')
  for (const [agent, location] of Object.entries(state.frame.positions)) {
    if (!agents.has(agent)) issue(`所在地のAgent IDが不明です: ${agent}`)
    if (location !== null && !locations.has(location)) issue(`地点IDが不明です: ${location}`)
  }
  for (const connection of state.map?.connections ?? []) {
    if (!locations.has(connection.from) || !locations.has(connection.to)) issue(`道の接続先が不明です: ${connection.id}`)
  }
  for (const relation of state.relationships?.relations ?? []) {
    if (!agents.has(relation.source) || !agents.has(relation.target)) issue(`関係のAgent IDが不明です: ${relation.id}`)
  }
})

export type AgentDescriptor = z.infer<typeof agentSchema>
export type MapDocument = z.infer<typeof mapSchema>
export type WorldFrame = z.infer<typeof frameSchema>
export type RelationshipSnapshot = z.infer<typeof relationshipSchema>
export type RunState = z.infer<typeof stateSchema>
export interface TerminalSnapshot { sessionId: string; sequence: number; columns: number; rows: number; data: string }
export interface TerminalChunk { sessionId: string; sequence: number; data: string }
export interface FileEntry { name: string; path: string; kind: 'directory' | 'file'; children?: FileEntry[] }
export interface FilePreview { path: string; content: string; hash: string; kind: 'text' | 'image'; }
export interface WorkspaceSnapshot { root: string; state: RunState; files: FileEntry[]; staleRelations: string[]; error: string | null; version: number; backend?: BackendSnapshot; fileVersions?: Record<string, number> }
export const inputSchema = z.object({ description: z.string().min(1).max(50000), images: z.array(z.object({ name: z.string().min(1), bytes: z.instanceof(Uint8Array).refine(v => v.byteLength <= 20 * 1024 * 1024, '画像は20MB以下にしてください') })).max(10) })
export type PreparationInput = z.infer<typeof inputSchema>
export type ImageInput = PreparationInput['images'][number]
export type AppEvent = { type: 'workspace'; snapshot: WorkspaceSnapshot } | { type: 'terminal'; chunk: TerminalChunk } | { type: 'error'; message: string }

export interface DesktopApi {
  devPanel(): Promise<import('../core/dev-contracts').DevPanelState>
  memoryInspection(agentId: string): Promise<MemoryInspection>
  memoryDetail(agentId: string, memoryId: string, revision: number): Promise<MemoryDetail>
  backendStatus(): Promise<BackendSnapshot>
  backendCommand(command: BackendCommand): Promise<BackendSnapshot>
  snapshot(): Promise<WorkspaceSnapshot>
  prepare(input: PreparationInput): Promise<void>
  startSimulation(step?: boolean): Promise<void>
  pause(): Promise<void>
  saveNow(): Promise<void>
  resume(): Promise<void>
  newRun(): Promise<void>
  preview(path: string): Promise<FilePreview>
  openExternal(path: string): Promise<void>
  reveal(path: string): Promise<void>
  terminalSnapshot(sessionId: string): Promise<TerminalSnapshot>
  conversation(sessionId: string, cursor?: string): Promise<ConversationPage>
  terminalInput(sessionId: string, data: string): Promise<void>
  terminalResize(sessionId: string, columns: number, rows: number): Promise<void>
  terminalInterrupt(sessionId: string): Promise<void>
  onEvent(listener: (event: AppEvent) => void): () => void
}

declare global { interface Window { persona: DesktopApi } }
