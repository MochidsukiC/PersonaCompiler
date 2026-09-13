import { z } from 'zod'

export const conversationTurnSchema = z.object({
  id: z.string(), status: z.string(),
  startedAt: z.number().nullable().optional(),
  error: z.object({ message: z.string() }).nullable().optional(),
  items: z.array(z.object({ id: z.string(), type: z.string() }).passthrough())
})
export type ConversationTurn = z.infer<typeof conversationTurnSchema>
export type ConversationItem = ConversationTurn['items'][number]

const volumes = { low: '小声', medium: '普通の声', high: '大声' }
const sentMessageSchema = z.object({
  type: z.literal('dynamicToolCall'), tool: z.literal('sendMessage'), status: z.literal('completed'), success: z.literal(true),
  arguments: z.object({ text: z.string().min(1), volume: z.enum(['low', 'medium', 'high']) })
})
export function sentMessageDisplay(item: ConversationItem): { label: string; text: string } | null {
  const parsed = sentMessageSchema.safeParse(item)
  if (!parsed.success) return null
  return { label: `発言 · ${volumes[parsed.data.arguments.volume]}`, text: parsed.data.arguments.text }
}

const receivedMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heardSpeech'), eventId: z.number().int(), turn: z.number().int(), speaker: z.object({ id: z.string(), name: z.string(), position: z.object({ x: z.number(), y: z.number(), z: z.number() }) }), volume: z.enum(['low', 'medium', 'high']), text: z.string() }),
  z.object({ kind: z.literal('facilityResponse'), facilityId: z.string(), text: z.string() })
])

const positionSchema = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() })
const activitySchema = z.enum(['entering', 'active', 'ended', 'sleeping'])
const situationSchema = z.object({
  turn: z.number().int().nonnegative(), day: z.number().int().positive(), time: z.enum(['morning', 'noon', 'evening', 'night']),
  phase: z.enum(['facilities', 'positions', 'entry', 'activity', 'between', 'complete']),
  self: z.object({ id: z.string(), position: positionSchema.nullable(), activity: activitySchema, nextFacilityId: z.string().nullable() }),
  facility: z.object({ name: z.string(), dimensions: positionSchema, layout: z.object({ publicState: z.string() }).nullable() }),
  currentRegions: z.array(z.object({ name: z.string() })).optional(), home: z.object({ name: z.string() }).optional(),
  npcs: z.array(z.object({ id: z.string(), name: z.string(), position: positionSchema.nullable(), activity: activitySchema })),
  destinations: z.array(z.object({ id: z.string(), name: z.string() }))
})
const situationInstructions = new Set([
  '現在の状況から自分の行動を選んでください。発話・移動・施設利用はToolで行い、活動終了はendTurnまたはsleepで通知してください。推論の文章だけでは活動終了になりません。',
  '入場位置の設定を再開します。setInitialPositionで選び、応答を終了してください。',
  '新しいターンの入場位置をsetInitialPositionで選び、応答を終了してください。生活開始は全員の入場位置確定後です。',
  'turn=0の初期位置をsetInitialPositionで選び、応答を終了してください。生活はまだ開始しません。'
])
const activityLabels = { entering: '入場位置を選択中', active: '活動中', ended: '活動終了', sleeping: '睡眠中' }
function positionText(position: z.infer<typeof positionSchema> | null): string {
  return position ? `(${position.x}, ${position.y}, ${position.z})` : '位置未設定'
}
function situationDisplay(value: unknown): { label: string; text: string } | null {
  const parsed = situationSchema.safeParse(value)
  if (!parsed.success) return null
  const situation = parsed.data
  const times = { morning: '朝', noon: '昼', evening: '夕', night: '夜' }
  const lines = [
    `現在地：${situation.facility.name} ${positionText(situation.self.position)}`,
    `状態：${activityLabels[situation.self.activity]}`
  ]
  if (situation.currentRegions?.length) lines.push(`周囲：${situation.currentRegions.map(r => r.name).join('、')}`)
  const dimensions = situation.facility.dimensions
  lines.push(`施設の広さ：${dimensions.x} × ${dimensions.y} × ${dimensions.z}`)
  if (situation.facility.layout?.publicState) lines.push(situation.facility.layout.publicState)
  if (situation.home) lines.push(`自宅：${situation.home.name}`)
  const neighbors = situation.npcs.filter(npc => npc.id !== situation.self.id)
  lines.push(neighbors.length ? `同じ施設にいる人：\n${neighbors.map(npc => `${npc.name} ${positionText(npc.position)} · ${activityLabels[npc.activity]}`).join('\n')}` : '同じ施設にいる人：なし')
  if (situation.self.nextFacilityId) {
    const destination = situation.destinations.find(d => d.id === situation.self.nextFacilityId)
    lines.push(`次ターンの移動先：${destination ? destination.name : situation.self.nextFacilityId}`)
  }
  lines.push(`移動できる施設：${situation.destinations.map(d => d.name).join('、')}`)
  return { label: `状況通知 · ${situation.day}日目・${times[situation.time]} · ターン ${situation.turn}`, text: lines.join('\n') }
}

export function receivedMessageDisplay(text: string): { label: string; text: string } | null {
  const newline = text.indexOf('\n')
  const situation = newline !== -1 && situationInstructions.has(text.slice(0, newline).trim())
  let value: unknown
  try { value = JSON.parse(situation ? text.slice(newline + 1) : text) } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
  if (situation) return situationDisplay(value)
  const parsed = receivedMessageSchema.safeParse(value)
  if (!parsed.success) return null
  const message = parsed.data
  if (message.kind === 'facilityResponse') return { label: `施設からの回答 · ${message.facilityId}`, text: message.text }
  return { label: `${message.speaker.name} · ${volumes[message.volume]} · ターン ${message.turn}`, text: message.text }
}
