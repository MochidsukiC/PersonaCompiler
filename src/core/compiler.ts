import { z } from 'zod'
import document from './prompts/character-compiler.md?raw'
import { characterPackageSchema } from './compiler-contracts'
import { residentSchema } from './lifecycle-contracts'
import { memoryRecordSchema, memoryRelationSchema } from './memory-contracts'
import { conversationTurnSchema } from '../shared/conversation'
import { lifeEventSchema } from './life-contracts'

export interface CompilerPromptProvider { compiler(): string }
export class StandardCompilerPrompts implements CompilerPromptProvider { compiler(): string { return document } }
export const compilerInputSchema = z.object({
  identity: residentSchema, memories: z.array(memoryRecordSchema), relations: z.array(memoryRelationSchema),
  conversation: z.array(conversationTurnSchema), events: z.array(lifeEventSchema), evidenceIds: z.array(z.string())
})
export type CompilerInput = z.infer<typeof compilerInputSchema>
export function validateCharacterPackage(input: CompilerInput, value: unknown) {
  const result = characterPackageSchema.parse(value)
  if (result.npcId !== input.identity.id) throw new Error(`CompilerのNPC IDが一致しません: ${result.npcId}`)
  for (const field of ['lifeSummary', 'personality', 'speechTendency', 'appearance', 'goals', 'behavior', 'schedule'] as const) {
    for (const claim of result[field]) for (const ref of claim.evidence) if (!input.evidenceIds.includes(ref)) throw new Error(`Compilerの根拠がありません: ${ref}`)
  }
  for (const id of result.memoryIds) if (!input.memories.some(m => m.id === id && m.ownerId === result.npcId)) throw new Error(`Compilerの記憶参照が不正です: ${id}`)
  for (const id of result.relationshipTargets) if (!input.relations.some(r => r.target === id && r.source === result.npcId)) throw new Error(`Compilerの関係参照が不正です: ${id}`)
  if (new Set(result.memoryIds).size !== result.memoryIds.length || new Set(result.relationshipTargets).size !== result.relationshipTargets.length) throw new Error('Compilerの参照が重複しています')
  return result
}
