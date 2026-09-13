import { z } from 'zod'

const claim = z.object({ text: z.string().min(1), evidence: z.array(z.string()).min(1) }).strict()
export const characterPackageSchema = z.object({
  npcId: z.string().min(1),
  lifeSummary: z.array(claim), personality: z.array(claim), speechTendency: z.array(claim),
  appearance: z.array(claim), goals: z.array(claim), behavior: z.array(claim),
  schedule: z.array(z.object({ time: z.string(), activity: z.string(), evidence: z.array(z.string()).min(1) }).strict()),
  runtimeGuidance: z.string(), systemPrompt: z.string().min(1),
  memoryIds: z.array(z.string()), relationshipTargets: z.array(z.string())
}).strict()
export const productionOperationSchema = z.object({
  id: z.string(), kind: z.enum(['birth', 'compile']), targetId: z.string(), output: z.string(),
  turnId: z.string().nullable(), status: z.enum(['requested', 'running', 'completed', 'failed', 'uncertain']), error: z.string().nullable()
})
export const compilationSchema = z.object({
  id: z.string(), sourceRevision: z.number().int(), promptHash: z.string(), modelId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'empty']),
  tasks: z.array(z.object({ npcId: z.string(), name: z.string(), status: z.enum(['pending', 'prepared', 'requested', 'completed', 'failed']), input: z.string(), inputHash: z.string().nullable(), output: z.string(), review: z.string().optional(), error: z.string().nullable() }))
})
export type Compilation = z.infer<typeof compilationSchema>
export type ProductionOperation = z.infer<typeof productionOperationSchema>
export type CharacterPackage = z.infer<typeof characterPackageSchema>
