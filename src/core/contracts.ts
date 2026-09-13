import { z } from 'zod'
import { devCommandSchema } from './dev-contracts'
import type { Compilation } from './compiler-contracts'
import { mapSchema } from '../shared/contracts'
import { dimensionsSchema, type SimulationSnapshot } from './life-contracts'

export const identifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
export const effortSchema = z.string().min(1)
export const modelSchema = z.object({
  id: z.string(), model: z.string(), displayName: z.string(), description: z.string(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: effortSchema, description: z.string() })).min(1),
  defaultReasoningEffort: effortSchema, inputModalities: z.array(z.string()), isDefault: z.boolean()
})
export type ModelInfo = z.infer<typeof modelSchema>
const fixedModelSchema = z.object({ modelId: z.string().min(1), effort: effortSchema })
export const npcModelPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fixed'), modelId: z.string().min(1) }), z.object({ mode: z.literal('auto') })
])
export const npcEffortPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fixed'), effort: effortSchema }), z.object({ mode: z.literal('auto') })
])
export const agentModelSettingsSchema = z.object({
  parent: fixedModelSchema,
  npc: z.object({ model: npcModelPolicySchema, effort: npcEffortPolicySchema }),
  facility: fixedModelSchema
})
export type AgentModelSettings = z.infer<typeof agentModelSettingsSchema>
export type NpcModelPolicy = z.infer<typeof npcModelPolicySchema>
export type NpcEffortPolicy = z.infer<typeof npcEffortPolicySchema>

export const questionRoundSchema = z.object({
  id: identifierSchema,
  questions: z.array(z.object({
    id: identifierSchema, question: z.string().min(1), reason: z.string().min(1),
    options: z.array(z.object({ id: identifierSchema, label: z.string().min(1), description: z.string() })).min(2).max(5),
    recommendedOptionId: identifierSchema
  })).min(3).max(8)
}).superRefine((round, ctx) => {
  if (new Set(round.questions.map(q => q.id)).size !== round.questions.length) ctx.addIssue({ code: 'custom', message: '質問IDが重複しています' })
  for (const q of round.questions) {
    if (new Set(q.options.map(o => o.id)).size !== q.options.length || !q.options.some(o => o.id === q.recommendedOptionId)) ctx.addIssue({ code: 'custom', message: `質問 ${q.id} の選択肢が不正です` })
  }
})
export const questionAnswersSchema = z.object({
  roundId: identifierSchema,
  answers: z.array(z.object({ questionId: identifierSchema, optionId: identifierSchema.nullable(), text: z.string().max(10000) }))
})
export type QuestionRound = z.infer<typeof questionRoundSchema>
export type QuestionAnswers = z.infer<typeof questionAnswersSchema>

export const specificationSchema = z.object({
  town: z.object({ name: z.string().min(1), setting: z.string().min(1), facilities: z.array(z.object({
    id: identifierSchema, name: z.string().min(1), type: z.string().min(1), description: z.string().min(1), locationId: identifierSchema,
    dimensions: dimensionsSchema.optional()
  })).min(1) }),
  population: z.object({
    count: z.number().int().positive(),
    ageDistribution: z.array(z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative(), ratio: z.number().min(0).max(1) })).min(1),
    sexRatio: z.array(z.object({ sex: z.string().min(1), ratio: z.number().min(0).max(1) })).min(1)
  }),
  simulation: z.object({ maxTurns: z.number().int().positive(), turnsPerDay: z.literal(4), endCondition: z.enum(['turn_limit', 'generation_zero_extinction', 'generation_zero_extinction_with_turn_limit']) })
}).superRefine((spec, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  const ages = spec.population.ageDistribution
  if (ages.some((a, i) => a.max < a.min || ages.slice(0, i).some(b => a.min <= b.max && b.min <= a.max))) issue('年齢帯が逆転または重複しています')
  for (const rows of [ages, spec.population.sexRatio]) if (Math.abs(rows.reduce((n, row) => n + row.ratio, 0) - 1) > 0.000001) issue('人口比率の合計は1にしてください')
  if (new Set(spec.population.sexRatio.map(s => s.sex)).size !== spec.population.sexRatio.length) issue('性別区分が重複しています')
  if (new Set(spec.town.facilities.map(f => f.id)).size !== spec.town.facilities.length) issue('施設IDが重複しています')
})
export type Specification = z.infer<typeof specificationSchema>
export const specificationDraftSchema = z.object({ specification: specificationSchema, map: mapSchema })
export type SpecificationDraft = z.infer<typeof specificationDraftSchema> & { revision: number }
export const preparationArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('questions'), round: questionRoundSchema }).strict(),
  z.object({ kind: z.literal('draft'), draft: specificationDraftSchema }).strict()
])

export const npcInitializationSchema = z.object({
  id: identifierSchema, name: z.string().min(1), age: z.number().int().nonnegative(), sex: z.string().min(1),
  temperament: z.string().min(1), physicalAttributes: z.string(), occupation: z.string().nullable(),
  householdId: identifierSchema, locationId: identifierSchema,
  family: z.array(z.object({ npcId: identifierSchema, relation: z.enum(['parent', 'child', 'sibling', 'spouse']) })),
  birthModelId: z.string().min(1), modelSelectionReason: z.string().min(1)
}).strict()
export const populationSchema = z.object({ npcs: z.array(npcInitializationSchema).min(1) }).strict()
export type NpcInitialization = z.infer<typeof npcInitializationSchema>
export type Population = z.infer<typeof populationSchema>

export const sessionBindingSchema = z.object({
  agentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,88}$/), sessionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,88}$/), role: z.enum(['parent', 'npc', 'facility']),
  threadId: z.string().nullable(), cwd: z.string(), modelId: z.string(), effort: effortSchema,
  lifecycleVersion: z.literal(1).optional(),
  creation: z.enum(['requested', 'created', 'initialized']), seedPersisted: z.boolean(), lifeToolsVersion: z.literal(1).optional(), persistenceVersion: z.literal(2).optional(), memoryVersion: z.literal(1).optional()
})
export type SessionBinding = z.infer<typeof sessionBindingSchema>
export const preparationProgressSchema = z.object({
  phase: z.enum(['idle', 'interview', 'review', 'locked', 'generating', 'ready']), revision: z.number().int().nonnegative(),
  busy: z.boolean(), paused: z.boolean(), error: z.string().nullable(),
  round: questionRoundSchema.nullable(), answers: z.array(questionAnswersSchema),
  draft: specificationDraftSchema.extend({ revision: z.number().int().positive() }).nullable(),
  lock: z.object({ revision: z.number().int(), hash: z.string(), approvedAt: z.string() }).nullable(),
  population: populationSchema.nullable(), sessions: z.array(sessionBindingSchema),
  operation: z.object({ id: identifierSchema, kind: z.enum(['preparation', 'population']), output: z.string(), turnId: z.string().nullable() }).nullable()
})
export type PreparationProgress = z.infer<typeof preparationProgressSchema>
export interface BackendSnapshot {
  dev?: { busy: boolean; revision: number; checkpoints: number; operation: import('./dev-contracts').DevState['operation'] }
  compilation?: Compilation
  persistence?: import('./persistence').PersistenceStatus
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  authMode: 'chatgpt' | 'apiKey' | null
  authenticated: boolean
  login: { id: string; url: string } | null
  models: ModelInfo[]
  settings: AgentModelSettings | null
  preparation: PreparationProgress
  error: string | null
  simulation?: SimulationSnapshot
}
export const backendCommandSchema = z.discriminatedUnion('type', [
  ...devCommandSchema.options,
  z.object({ type: z.literal('connect'), authMode: z.enum(['chatgpt', 'apiKey']) }),
  z.object({ type: z.literal('loginChatGpt') }),
  z.object({ type: z.literal('loginApiKey'), apiKey: z.string().min(1).max(1000) }),
  z.object({ type: z.literal('cancelLogin') }),
  z.object({ type: z.literal('settings'), settings: agentModelSettingsSchema }),
  z.object({ type: z.literal('answers'), value: questionAnswersSchema }),
  z.object({ type: z.literal('revise'), revision: z.number().int(), message: z.string().min(1).max(50000) }),
  z.object({ type: z.literal('approve'), revision: z.number().int() }),
  z.object({ type: z.literal('retry') }),
  z.object({ type: z.literal('recompile') }),
  z.object({ type: z.literal('startSimulation'), step: z.boolean() }),
  z.object({ type: z.literal('terminalReconnect'), sessionId: z.string().min(1).max(160) })
])
export type BackendCommand = z.infer<typeof backendCommandSchema>

export function emptyPreparation(): PreparationProgress {
  return { phase: 'idle', revision: 0, busy: false, paused: false, error: null, round: null, answers: [], draft: null, lock: null, population: null, sessions: [], operation: null }
}
