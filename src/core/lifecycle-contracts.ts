import { z } from 'zod'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
export const identitySchema = z.object({
  id, name: z.string().min(1), age: z.number().int().nonnegative(), sex: z.string().min(1),
  temperament: z.string().min(1), physicalAttributes: z.string(), occupation: z.string().nullable(),
  householdId: id, locationId: id,
  family: z.array(z.object({ npcId: id, relation: z.enum(['parent', 'child', 'sibling', 'spouse']) })),
  birthModelId: z.string().min(1), modelSelectionReason: z.string().min(1)
}).strict()
export const residentSchema = identitySchema.extend({
  sexCategory: z.enum(['male', 'female', 'other']), generation: z.number().int().nonnegative(),
  bornTurn: z.number().int().nonnegative(), diedTurn: z.number().int().nonnegative().nullable(), deathCause: z.enum(['old_age', 'health']).optional()
})
export const birthSchema = z.object({
  id, parents: z.tuple([id, id]), homeParentId: id, dueDay: z.number().int().positive(),
  status: z.enum(['scheduled', 'requested', 'complete', 'cancelled']), reason: z.string().nullable(), childId: id.nullable()
})
export const homeRequestSchema = z.object({
  id, sponsorId: id, members: z.array(id).min(1), accepted: z.array(id), description: z.string(),
  status: z.enum(['consent', 'building', 'complete', 'cancelled']), householdId: id, reason: z.string().nullable()
})
export const lifecycleSchema = z.object({
  version: z.literal(1), seed: z.string(), processedDay: z.number().int().nonnegative(),
  residents: z.array(residentSchema), births: z.array(birthSchema), homes: z.array(homeRequestSchema),
  proposals: z.array(z.object({ actorId: id, partnerId: id, children: z.number().int().min(0).max(4), homeParentId: id })),
  endReason: z.enum(['turn_limit', 'generation_zero_extinction', 'population_extinction']).nullable()
})
const point = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), z: z.number().int().nonnegative() }).strict()
export const lifecycleToolSchemas = {
  marry: z.object({ partnerId: id, children: z.number().int().min(0).max(4), homeParentId: id, withdraw: z.boolean() }).strict(),
  createHome: z.object({ members: z.array(id).min(1), description: z.string().min(1).max(10000) }).strict(),
  consentHome: z.object({ requestId: id, accept: z.boolean() }).strict(),
  completeHome: z.object({ requestId: id, name: z.string().min(1), description: z.string(), dimensions: z.object({ x: z.number().int().positive(), y: z.number().int().positive(), z: z.number().int().positive() }).strict(), bounds: z.object({ min: point, max: point }).strict() }).strict()
}
export function lifecycleTools(role: 'npc' | 'facility') {
  const descriptions = {
    marry: '結婚と追加希望人数を申し込む。相手も同じchildrenとhomeParentIdを指定すると成立。homeParentIdは子が所属する世帯の親。withdraw=trueは未成立の申込撤回。初期既婚者も追加出生を予約できる。男女18〜49歳の両親だけが出生可能。既存実子・予約込み生涯最大4人。',
    createHome: '18歳以上が新居を申請する。membersは入居するNPC IDの一覧。自分が住まない未成年の代理申請も可能。成人の同居人はconsentHomeで同意が必要。家の設計と必要な住宅街拡張は施設が行う。',
    consentHome: '自分が入居候補の住宅申請へ同意・拒否する。requestIdはgetSituationのhomeRequestsを参照。他人の同意は代行できない。',
    completeHome: '住宅街だけが受け付けた新居申請を完成させる。既存の家と領域を維持し、新居のboundsと必要なdimensions拡張を指定する。全軸で既存サイズ以上、既存の家と非重複。'
  }
  const names: (keyof typeof lifecycleToolSchemas)[] = role === 'npc' ? ['marry', 'createHome', 'consentHome'] : ['completeHome']
  return names.map(name => ({ type: 'function' as const, name, description: descriptions[name], inputSchema: z.toJSONSchema(lifecycleToolSchemas[name]) }))
}
export type Resident = z.infer<typeof residentSchema>
export type Lifecycle = z.infer<typeof lifecycleSchema>
export type Birth = z.infer<typeof birthSchema>
