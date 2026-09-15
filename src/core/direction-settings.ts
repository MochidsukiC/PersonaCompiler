import { z } from 'zod'

const scopeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)

export const simulationTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
export const directionProfileSchema = z.enum(['classic', 'life_sim', 'dark_restrained', 'comedy'])
export const expressionIntensitySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
export const dialogueModeSchema = z.enum(['fixed', 'semi_fixed', 'free'])

export const resolvedDialogueSettingsSchema = z.object({
  tier: simulationTierSchema,
  directionProfile: directionProfileSchema,
  expressionIntensity: expressionIntensitySchema,
  dialogueMode: dialogueModeSchema
}).strict()

export const dialogueSettingsOverrideSchema = resolvedDialogueSettingsSchema.partial().strict()

export const directionSettingsSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  world: resolvedDialogueSettingsSchema,
  regions: z.record(scopeId, dialogueSettingsOverrideSchema),
  npcs: z.record(scopeId, dialogueSettingsOverrideSchema)
}).strict()

export const dialogueRequestOverridesSchema = z.object({
  quest: dialogueSettingsOverrideSchema.optional(),
  utterance: dialogueSettingsOverrideSchema.optional()
}).strict()

export type SimulationTier = z.infer<typeof simulationTierSchema>
export type DirectionProfile = z.infer<typeof directionProfileSchema>
export type ExpressionIntensity = z.infer<typeof expressionIntensitySchema>
export type DialogueMode = z.infer<typeof dialogueModeSchema>
export type ResolvedDialogueSettings = z.infer<typeof resolvedDialogueSettingsSchema>
export type DialogueSettingsOverride = z.infer<typeof dialogueSettingsOverrideSchema>
export type DirectionSettings = z.infer<typeof directionSettingsSchema>
export type DialogueRequestOverrides = z.infer<typeof dialogueRequestOverridesSchema>

/**
 * These values reproduce the pre-settings runtime: a full NPC model, free dialogue,
 * and no additional character-expression pass. `classic` is inert at intensity 0.
 */
export const COMPATIBLE_DIALOGUE_SETTINGS: Readonly<ResolvedDialogueSettings> = Object.freeze({
  tier: 3,
  directionProfile: 'classic',
  expressionIntensity: 0,
  dialogueMode: 'free'
})

export function defaultDirectionSettings(): DirectionSettings {
  return { version: 1, revision: 0, world: { ...COMPATIBLE_DIALOGUE_SETTINGS }, regions: {}, npcs: {} }
}

export interface DialogueResolutionLayers {
  world?: DialogueSettingsOverride
  region?: DialogueSettingsOverride
  npc?: DialogueSettingsOverride
  quest?: DialogueSettingsOverride
  utterance?: DialogueSettingsOverride
}

/** Field-wise precedence: compatibility < world < region < NPC < quest < utterance. */
export function resolveDialogueSettings(layers: DialogueResolutionLayers): ResolvedDialogueSettings {
  return resolvedDialogueSettingsSchema.parse({
    ...COMPATIBLE_DIALOGUE_SETTINGS,
    ...layers.world,
    ...layers.region,
    ...layers.npc,
    ...layers.quest,
    ...layers.utterance
  })
}

export function resolveNpcDialogueSettings(settings: DirectionSettings, npcId: string, regionId?: string | null): ResolvedDialogueSettings {
  const value = directionSettingsSchema.parse(settings)
  return resolveDialogueSettings({
    world: value.world,
    region: regionId ? value.regions[regionId] : undefined,
    npc: value.npcs[npcId]
  })
}

export function resolveDialogueRequest(base: ResolvedDialogueSettings, overrides?: DialogueRequestOverrides): ResolvedDialogueSettings {
  const value = overrides ? dialogueRequestOverridesSchema.parse(overrides) : undefined
  return resolveDialogueSettings({ world: base, quest: value?.quest, utterance: value?.utterance })
}

export function directionPromptBlock(settings?: ResolvedDialogueSettings): string {
  if (!settings) return ''
  const value = resolvedDialogueSettingsSchema.parse(settings)
  return `<harness_direction_policy>\n${JSON.stringify(value)}\n</harness_direction_policy>\n` +
    'この方針はHarnessが固定した非公開の演出・会話方針です。世界の事実、可聴範囲、相手の意思、年齢、家の境界より優先しません。' +
    'tier・directionProfile・expressionIntensity・dialogueModeなどの内部名や値を台詞へ出さず、fixedは指定文を変えず、semi_fixedは必須内容を維持し、freeでも観測していない事実を追加しないでください。'
}
