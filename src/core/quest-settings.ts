import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
export const questStageSchema = z.enum(['before_acceptance', 'in_progress', 'objective_complete', 'reward_received'])
export const questTriggerSchema = z.enum(['player_interact', 'stage_enter', 'player_proximity', 'npc_arrival', 'explicit'])
export const questKindSchema = z.enum(['main', 'emergency', 'active_side', 'side', 'daily'])
const requiredFactSchema = z.union([
  z.string().min(1).max(500).transform(value => ({ id: value, value, allowParaphrase: false, evidenceTerms: [value] })),
  z.object({ id, value: z.string().min(1).max(500), allowParaphrase: z.boolean().default(true), evidenceTerms: z.array(z.string().min(1).max(200)).max(20).default([]) }).strict().transform(fact => ({ ...fact, evidenceTerms: fact.evidenceTerms.length ? fact.evidenceTerms : [fact.value] }))
])
export const questDirectiveSchema = z.object({
  id, enabled: z.boolean(), mode: z.enum(['fixed', 'semi_fixed', 'free']),
  fixedText: z.string().max(50000).default(''), content: z.string().max(5000).default(''),
  fallbackText: z.string().max(50000).default('申し訳ありません。今は詳しくお話しできません。').transform(value => value.trim() || '申し訳ありません。今は詳しくお話しできません。'),
  trigger: questTriggerSchema.default('player_interact'),
  requiredFacts: z.array(requiredFactSchema).max(20).default([]),
  forbiddenFacts: z.array(z.string().min(1).max(500)).max(20).default([]),
  allowedActs: z.array(z.string().min(1).max(100)).max(20).default([]),
  priority: z.number().int().min(-1000).max(1000).default(0), once: z.boolean().default(false),
  locationLock: z.object({ enabled: z.boolean(), locationId: id.nullable(), maxWaitTurns: z.number().int().min(1).max(100).default(4) }).strict().default({ enabled: false, locationId: null, maxWaitTurns: 4 })
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'fixed' && !value.fixedText.trim()) ctx.addIssue({ code: 'custom', message: '固定directiveには固定台詞が必要です' })
  if (value.locationLock.enabled && !value.locationLock.locationId) ctx.addIssue({ code: 'custom', message: '場所固定を有効にする場合は場所を指定してください' })
})
export const questDefinitionSchema = z.object({
  id, name: z.string().min(1).max(200), targetNpcId: id, stage: questStageSchema, kind: questKindSchema.default('side'),
  directives: z.record(questStageSchema, questDirectiveSchema)
}).strict()
export const questCompletionEventSchema = z.object({ questId: id, directiveId: id, activationEventId: id.default('legacy'), stage: questStageSchema, turn: z.number().int().nonnegative(), speechEventId: z.number().int().positive(), text: z.string().max(50000).default(''), deliveryMode: z.enum(['fixed', 'semi_fixed', 'free']).default('free'), fallbackUsed: z.boolean().default(false) }).strict()
export const questOperationResultSchema = z.object({ eventId: id, questId: id, status: z.enum(['duplicate', 'already_active', 'stage_changed', 'ignored', 'pending_location', 'spoken', 'queued', 'expired', 'completion_consumed']), directiveId: id.optional(), locationId: id.optional(), deadlineTurn: z.number().int().nonnegative().optional(), speechEventId: z.number().int().positive().optional(), completionEvent: questCompletionEventSchema.optional() }).strict()
const questSettingsBaseSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), quests: z.array(questDefinitionSchema).max(100), processedGameEventIds: z.array(id).max(10000).default([]), completionEvents: z.array(questCompletionEventSchema).max(1000).default([]) }).strict()
const validateQuestSettings = (settings: Pick<z.infer<typeof questSettingsBaseSchema>, 'quests'>, ctx: z.RefinementCtx) => {
  const questIds = new Set<string>(), directiveIds = new Set<string>()
  for (const [questIndex, quest] of settings.quests.entries()) {
    if (questIds.has(quest.id)) ctx.addIssue({ code: 'custom', path: ['quests', questIndex, 'id'], message: `クエストIDが重複しています: ${quest.id}` })
    questIds.add(quest.id)
    for (const [stage, directive] of Object.entries(quest.directives)) {
      if (directiveIds.has(directive.id)) ctx.addIssue({ code: 'custom', path: ['quests', questIndex, 'directives', stage, 'id'], message: `directive IDが重複しています: ${directive.id}` })
      directiveIds.add(directive.id)
      const factIds = new Set<string>()
      for (const fact of directive.requiredFacts) { if (factIds.has(fact.id)) ctx.addIssue({ code: 'custom', path: ['quests', questIndex, 'directives', stage, 'requiredFacts'], message: `Fact IDが重複しています: ${fact.id}` }); factIds.add(fact.id) }
    }
  }
}
export const questSettingsSchema = questSettingsBaseSchema.superRefine(validateQuestSettings)
export const questSettingsInputSchema = z.object({ version: z.literal(1), quests: z.array(questDefinitionSchema).max(100) }).strict().superRefine(validateQuestSettings)
export type QuestStage = z.infer<typeof questStageSchema>
export type QuestTrigger = z.infer<typeof questTriggerSchema>
export type QuestDirective = z.infer<typeof questDirectiveSchema>
export type QuestDefinition = z.infer<typeof questDefinitionSchema>
export type QuestSettings = z.infer<typeof questSettingsSchema>
export type QuestOperationResult = z.infer<typeof questOperationResultSchema>

export const QUEST_STAGES: QuestStage[] = ['before_acceptance', 'in_progress', 'objective_complete', 'reward_received']
export function defaultQuestSettings(): QuestSettings { return { version: 1, revision: 0, quests: [], processedGameEventIds: [], completionEvents: [] } }
const KIND_PRIORITY = { main: 5000, emergency: 4000, active_side: 3000, side: 2000, daily: 1000 } as const
export function activeQuestDirective(settings: QuestSettings | undefined, actorId: string, trigger?: QuestTrigger): { questId: string; questName: string; stage: QuestStage; directive: QuestDirective } | undefined {
  const candidates = (settings?.quests ?? []).filter(quest => quest.targetNpcId === actorId).map(quest => ({ questId: quest.id, questName: quest.name, stage: quest.stage, directive: quest.directives[quest.stage], score: KIND_PRIORITY[quest.kind] + quest.directives[quest.stage].priority })).filter(row => row.directive.enabled && (!trigger || row.directive.trigger === trigger)).sort((a, b) => b.score - a.score)
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) throw new Error(`同一NPCのクエストdirective優先度が競合しています: ${candidates[0].questId}, ${candidates[1].questId}`)
  const selected = candidates[0]
  return selected && { questId: selected.questId, questName: selected.questName, stage: selected.stage, directive: selected.directive }
}
