import { z } from 'zod'
import { memoryProgressSchema, memoryTools } from './memory-contracts'
import { lifecycleSchema, lifecycleTools } from './lifecycle-contracts'

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,88}$/)
export const voxelSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), z: z.number().int().nonnegative() }).strict()
export const dimensionsSchema = z.object({ x: z.number().int().positive(), y: z.number().int().positive(), z: z.number().int().positive() }).strict()
export const volumeSchema = z.object({ min: voxelSchema, max: voxelSchema }).strict()
const regionSchema = z.object({ id, name: z.string().min(1), description: z.string(), bounds: volumeSchema }).strict()
export const homeSchema = regionSchema.extend({ householdId: id })
export const facilityLayoutSchema = z.object({ regions: z.array(regionSchema), homes: z.array(homeSchema), publicState: z.string() }).strict()
export const lifeFacilitySchema = z.object({ id, locationId: id, name: z.string(), type: z.string(), dimensions: dimensionsSchema, layout: facilityLayoutSchema.nullable() })
export const lifeActorSchema = z.object({
  id, name: z.string(), householdId: id, locationId: id, position: voxelSchema.nullable(),
  activity: z.enum(['entering', 'active', 'ended', 'sleeping', 'dead']), nextFacilityId: id.nullable(), wakeAt: z.number().int().nullable(),
  compact: z.enum(['none', 'pending', 'running', 'complete'])
})
export const voiceSchema = z.enum(['low', 'medium', 'high'])
export const organizationSchema = z.object({
  id, name: z.string().trim().min(1).max(160), type: z.string().trim().min(1).max(80), purpose: z.string().trim().min(1).max(4000),
  founderId: id, foundedTurn: z.number().int().nonnegative(), locationId: id.nullable(), members: z.array(id)
}).strict()
export const lifeEventSchema = z.object({
  sequence: z.number().int(), turn: z.number().int(), kind: z.enum(['move', 'travel', 'speech', 'facility', 'sleep', 'wake', 'end', 'entry', 'death', 'birth', 'marriage', 'home', 'organization']),
  actorId: id, text: z.string(), recipients: z.array(id), volume: voiceSchema.optional(), locationId: id, position: voxelSchema.nullable()
})
export const simulationSchema = z.object({
  organizations: z.array(organizationSchema).optional(),
  lifecycle: lifecycleSchema.optional(),
  memoryProgress: z.record(z.string(), memoryProgressSchema).optional(),
  version: z.literal(1), revision: z.number().int().nonnegative(),
  stage: z.enum(['initializing', 'ready', 'running', 'paused', 'ended', 'error']),
  phase: z.enum(['facilities', 'positions', 'entry', 'activity', 'between', 'complete']),
  turn: z.number().int().nonnegative(), day: z.number().int().positive(), time: z.enum(['morning', 'noon', 'evening', 'night']),
  step: z.boolean(), facilities: z.array(lifeFacilitySchema), actors: z.array(lifeActorSchema), events: z.array(lifeEventSchema), error: z.string().nullable()
})
export type Voxel = z.infer<typeof voxelSchema>
export type Volume = z.infer<typeof volumeSchema>
export type FacilityLayout = z.infer<typeof facilityLayoutSchema>
export type LifeFacility = z.infer<typeof lifeFacilitySchema>
export type LifeActor = z.infer<typeof lifeActorSchema>
export type Voice = z.infer<typeof voiceSchema>
export type SimulationSnapshot = z.infer<typeof simulationSchema>

export const lifeToolSchemas = {
  getSituation: z.object({}).strict(),
  createOrganization: organizationSchema.pick({ name: true, type: true, purpose: true, locationId: true }),
  joinOrganization: z.object({ organizationId: id }).strict(),
  leaveOrganization: z.object({ organizationId: id }).strict(),
  initializeFacility: facilityLayoutSchema,
  setInitialPosition: z.object({ position: voxelSchema }).strict(),
  moveWithinFacility: z.object({ position: voxelSchema }).strict(),
  moveToFacility: z.object({ facilityId: id }).strict(),
  sendMessage: z.object({ text: z.string().min(1).max(50000), volume: voiceSchema }).strict(),
  useFacility: z.object({ request: z.string().min(1).max(50000) }).strict(),
  completeFacilityUse: z.object({ requestId: z.string(), text: z.string().min(1).max(50000), publicState: z.string() }).strict(),
  endTurn: z.object({}).strict(),
  sleep: z.object({}).strict()
}
export type LifeToolName = keyof typeof lifeToolSchemas
export const lifeToolDescriptions: Record<LifeToolName, string> = {
  getSituation: '現在時刻、自分の位置、施設の座標の意味、同施設内の全NPCの座標・公開状態を取得する。',
  createOrganization: '会社・ギルド・研究会などの組織を自分の意思で設立する。種別と目的は自由。所在地を持たない組織はlocationId=null。設立者だけが最初の構成員となり、他人を代理で加入させない。',
  joinOrganization: '公開された組織に自分自身が参加する。組織一覧と構成員はgetSituation.organizationsで確認できる。',
  leaveOrganization: '組織から自分自身が脱退する。設立者も脱退でき、設立の記録は残る。',
  initializeFacility: '初期化時だけ使用する。承認された施設内の意味付き領域と住宅街の世帯別の家を確定する。boundsのmin/maxは両端を含む整数座標。',
  setInitialPosition: '初期化時または別施設へ入場したターン開始時に、自分の初期座標を選ぶ。',
  moveWithinFacility: '同じ施設内の指定した整数座標へ即時移動する。回数制限なし。家の出入りもこのToolを使う。',
  moveToFacility: '移動先施設を予約し、現在の活動を終了する。他NPCには移動先にいるものとして表示され、入場位置は次ターン開始時に確定する。各世界ターンで1回だけ指定できる。',
  sendMessage: '同施設内へ発話する。lowは直線距離1、mediumは5、highは同じ家の中全体、屋外なら同施設の屋外全体。声量によらず家の内外・別の家の間では声は届かない。睡眠中には届かない。',
  useFacility: '現在いる施設へ利用内容を送る。回答は後から同じConversationへ届く。',
  completeFacilityUse: '施設利用への回答と施設の最新の公開状態を返す。requestIdはHarnessから受け取った利用要求のID。',
  endTurn: '現在地でこの世界ターンの活動を終了する。新着発話・施設回答・ユーザー入力への反応は次ターンまで停止する。',
  sleep: '現在の時間帯の活動を終了して眠る。同じConversationでCompactした後、次の世界ターン開始時に起床する。'
}
export function lifeTools(role: 'npc' | 'facility', memoryEnabled = false, lifecycleEnabled = false) {
  const names: LifeToolName[] = role === 'npc'
    ? ['getSituation', 'createOrganization', 'joinOrganization', 'leaveOrganization', 'setInitialPosition', 'moveWithinFacility', 'moveToFacility', 'sendMessage', 'useFacility', 'endTurn', 'sleep']
    : ['initializeFacility', 'completeFacilityUse']
  return [...names.map(name => ({ type: 'function' as const, name, description: lifeToolDescriptions[name], inputSchema: z.toJSONSchema(lifeToolSchemas[name]) })), ...(role === 'npc' && memoryEnabled ? memoryTools() : []), ...(lifecycleEnabled ? lifecycleTools(role) : [])]
}
