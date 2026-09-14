import { z } from 'zod'
import document from './prompts/character-compiler.md?raw'
import { characterPackageSchema } from './compiler-contracts'
import { residentSchema } from './lifecycle-contracts'
import { memoryRecordSchema, memoryRelationSchema } from './memory-contracts'
import { conversationTurnSchema } from '../shared/conversation'
import { lifeEventSchema } from './life-contracts'
import { economyRecordSchema, economySchema, holdingSchema, itemDefinitionSchema, vitalSchema } from './economy-contracts'

export interface CompilerPromptProvider { compiler(): string }
export class StandardCompilerPrompts implements CompilerPromptProvider { compiler(): string { return document } }
export const compilerInputSchema = z.object({
  inventory: z.object({ version: z.literal(1), npcId: z.string(), currency: z.string(), vitals: vitalSchema, account: economySchema.shape.accounts.valueType, holdings: z.array(holdingSchema), catalog: z.array(itemDefinitionSchema), acquisitionRights: z.array(itemDefinitionSchema), companies: z.array(z.object({ organizationId: z.string(), account: economySchema.shape.accounts.valueType, holdings: z.array(holdingSchema), acquisitionRights: z.array(itemDefinitionSchema) })), employment: economySchema.shape.employment, provenance: z.array(economyRecordSchema), experiences: z.array(economyRecordSchema) }).optional(),
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
  for (const id of result.relationshipTargets) {
    const relation = input.relations.find(r => r.target === id && r.source === result.npcId)
    if (!relation) throw new Error(`Compilerの関係参照が不正です: ${id}`)
    for (const ref of relation.evidence) {
      if (!result.memoryIds.includes(ref.memoryId) || !input.memories.some(m => m.id === ref.memoryId && m.revision === ref.revision && m.ownerId === result.npcId)) throw new Error(`Compilerの関係の根拠記憶が出力対象にありません: ${id}/${ref.memoryId}/${ref.revision}`)
    }
  }
  if (new Set(result.memoryIds).size !== result.memoryIds.length || new Set(result.relationshipTargets).size !== result.relationshipTargets.length) throw new Error('Compilerの参照が重複しています')
  return result
}
