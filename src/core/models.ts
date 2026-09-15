import { agentModelSettingsSchema, type AgentModelSettings, type ModelInfo, type NpcEffortPolicy } from './contracts'
import type { SimulationTier } from './direction-settings'

export const AUTO_MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'] as const
export const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

export function requireModel(models: ModelInfo[], id: string): ModelInfo {
  const model = models.find(m => m.model === id)
  if (!model) throw new Error(`モデルが利用できません: ${id}`)
  return model
}
export function autoModels(models: ModelInfo[]): ModelInfo[] {
  return AUTO_MODELS.flatMap(id => models.filter(m => m.model === id))
}
export function supportedEfforts(model: ModelInfo): string[] {
  return model.supportedReasoningEfforts.map(e => e.reasoningEffort)
}
export function requestedEffortForTier(tier: SimulationTier): string {
  if (tier === 0) return 'minimal'
  if (tier === 1) return 'low'
  if (tier === 2) return 'medium'
  return 'high'
}
export function resolveEffort(model: ModelInfo, policy: NpcEffortPolicy, tier: SimulationTier): { requested: string; effective: string } {
  const requested = policy.mode === 'auto' ? requestedEffortForTier(tier) : policy.effort
  const supported = supportedEfforts(model)
  if (supported.includes(requested)) return { requested, effective: requested }
  if (policy.mode === 'fixed') throw new Error(`モデル ${model.model} はeffort ${requested} に対応していません`)
  const target = EFFORT_ORDER.findIndex(e => e === requested)
  const ordered = EFFORT_ORDER.filter(e => supported.includes(e))
  if (!ordered.length) throw new Error(`Auto effortの対応順序が不明です: ${model.model} / ${supported.join(', ')}`)
  const effective = ordered.reduce((best, value) => Math.abs(EFFORT_ORDER.indexOf(value) - target) < Math.abs(EFFORT_ORDER.indexOf(best) - target) ? value : best)
  return { requested, effective }
}
export function defaultSettings(models: ModelInfo[]): AgentModelSettings {
  const model = models.find(m => m.isDefault)
  if (!model) throw new Error('接続先に既定モデルがありません。モデル設定を指定してください')
  return { parent: { modelId: model.model, effort: model.defaultReasoningEffort }, facility: { modelId: model.model, effort: model.defaultReasoningEffort }, npc: { model: { mode: 'fixed', modelId: model.model }, effort: { mode: 'fixed', effort: model.defaultReasoningEffort } } }
}
export function validateSettings(input: AgentModelSettings, models: ModelInfo[]): AgentModelSettings {
  const settings = agentModelSettingsSchema.parse(input)
  for (const role of [settings.parent, settings.facility]) resolveEffort(requireModel(models, role.modelId), { mode: 'fixed', effort: role.effort }, 3)
  const candidates = settings.npc.model.mode === 'auto' ? autoModels(models) : [requireModel(models, settings.npc.model.modelId)]
  if (!candidates.length) throw new Error('NPC Autoで利用可能なモデルがありません')
  for (const model of candidates) for (const tier of [0, 1, 2, 3] as const) resolveEffort(model, settings.npc.effort, tier)
  return settings
}
