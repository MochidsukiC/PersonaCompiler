import type { DialogueMode, DialogueSettingsOverride as DirectionOverride, DirectionProfile, DirectionSettings, ExpressionIntensity, ResolvedDialogueSettings as DialogueRuntimeSettings, SimulationTier } from '../../core/direction-settings'

export type { DialogueMode, DirectionOverride, DirectionProfile, DirectionSettings, ExpressionIntensity, DialogueRuntimeSettings, SimulationTier }
export interface RegionDirectionOption { id: string; name: string }
export interface NpcDirectionOption { id: string; name: string; regionId: string | null }

export const tierOptions = [0, 1, 2, 3] as const
export const intensityOptions = [0, 1, 2, 3] as const
export const modeOptions = ['fixed', 'semi_fixed', 'free'] as const
export const profileOptions = ['classic', 'life_sim', 'dark_restrained', 'comedy'] as const
export const profileLabels: Record<DirectionProfile, string> = { classic: 'クラシック', life_sim: '生活シミュレーション', dark_restrained: '抑制されたダーク', comedy: 'コメディ' }
export const modeLabels: Record<DialogueMode, string> = { fixed: '固定', semi_fixed: '半固定', free: '自由' }

export function resolveDirectionSettings(settings: DirectionSettings, compatibilityDefaults: DialogueRuntimeSettings, regionId?: string | null, npcId?: string | null): DialogueRuntimeSettings {
  return { ...compatibilityDefaults, ...settings.world, ...(regionId ? settings.regions[regionId] : undefined), ...(npcId ? settings.npcs[npcId] : undefined) }
}
export function updateDirectionOverride<K extends keyof DialogueRuntimeSettings>(override: DirectionOverride, field: K, value: DialogueRuntimeSettings[K] | undefined): DirectionOverride {
  const next = { ...override }
  if (value === undefined) delete next[field]
  else next[field] = value
  return next
}
export function compactDirectionSettings(settings: DirectionSettings): DirectionSettings {
  const nonEmpty = (rows: Record<string, DirectionOverride>) => Object.fromEntries(Object.entries(rows).filter(([, value]) => Object.keys(value).length > 0))
  return { ...settings, regions: nonEmpty(settings.regions), npcs: nonEmpty(settings.npcs) }
}
export function describeDirectionSettings(value: DialogueRuntimeSettings): string {
  return `Tier ${value.tier} · ${profileLabels[value.directionProfile]} · 強度 ${value.expressionIntensity} · ${modeLabels[value.dialogueMode]}`
}
