import { z } from 'zod'

export const promptKeySchema = z.enum(['parent', 'npc', 'facility', 'compiler', 'memoryMatcher', 'consolidation'])
export type PromptKey = z.infer<typeof promptKeySchema>
export const promptOverridesSchema = z.partialRecord(promptKeySchema, z.string().min(1).max(200000))
export const devStateSchema = z.object({
  hold: z.boolean().optional(),
  pendingTurn: z.object({ kind: z.enum(['preparation', 'population']), text: z.string(), images: z.array(z.string()) }).optional(),
  version: z.literal(1), prompts: promptOverridesSchema, revision: z.number().int().nonnegative(),
  origin: z.object({ runId: z.uuid(), checkpointId: z.uuid() }).nullable(),
  operation: z.object({ kind: z.enum(['checkpoint', 'prompts', 'branch']), status: z.enum(['requested', 'uncertain']), error: z.string().nullable() }).nullable()
})
export type DevState = z.infer<typeof devStateSchema>
export const devCheckpointInfoSchema = z.object({ id: z.uuid(), label: z.string(), turn: z.number().int().nonnegative(), createdAt: z.string(), promptRevision: z.number().int().nonnegative() })
export type DevCheckpointInfo = z.infer<typeof devCheckpointInfoSchema>
export interface DevPanelState { state: DevState | null; checkpoints: (DevCheckpointInfo & { runId: string })[]; defaults: Record<PromptKey, string> }
export const devCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('devEnable') }),
  z.object({ type: z.literal('devPrompts'), prompts: promptOverridesSchema }),
  z.object({ type: z.literal('devBranch'), checkpointId: z.uuid(), runId: z.uuid().optional(), prompts: z.enum(['latest', 'checkpoint']) })
])
