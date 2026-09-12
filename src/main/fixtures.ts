import type { AgentDescriptor, MapDocument, RunState } from '../shared/contracts'

export const parent: AgentDescriptor = { id: 'parent', name: 'オーケストレーター', role: 'parent', parentId: null, sessionId: 'parent', status: 'idle', color: '#b0c0f4' }
export const observer: AgentDescriptor = { id: 'observer', name: '観測エージェント', role: 'observer', parentId: 'parent', sessionId: 'observer', status: 'running', color: '#d2a9dc' }
export const residents: AgentDescriptor[] = [
  { id: 'hana', name: '小野 花', color: '#efbb80' },
  { id: 'yuto', name: '森 悠斗', color: '#9dbafa' },
  { id: 'mei', name: '佐伯 芽衣', color: '#d4a5d4' },
  { id: 'ren', name: '青木 蓮', color: '#8bcdb0' },
  { id: 'sora', name: '白石 空', color: '#e79b9e' },
  { id: 'aki', name: '三浦 秋', color: '#d4cf96' }
].map(person => ({ ...person, role: 'npc', parentId: 'parent', sessionId: person.id, status: 'running' }))

export const demoMap: MapDocument = {
  revision: 1, name: '木漏れ日の町', bounds: { width: 1050, height: 780 },
  areas: [
    { id: 'residential', name: 'RESIDENTIAL / 住宅街', position: { x: 40, y: 45 }, width: 430, height: 280, color: '#98acc1' },
    { id: 'commons', name: 'COMMONS / 緑の広場', position: { x: 505, y: 60 }, width: 490, height: 340, color: '#80b7a0' },
    { id: 'town', name: 'TOWN CENTER / 町の中心', position: { x: 95, y: 440 }, width: 830, height: 290, color: '#cab393' }
  ],
  locations: [
    { id: 'home-west', name: '西の住宅', kind: 'home', areaId: 'residential', position: { x: 85, y: 130 } },
    { id: 'home-east', name: '東の住宅', kind: 'home', areaId: 'residential', position: { x: 300, y: 130 } },
    { id: 'park', name: '木漏れ日公園', kind: 'park', areaId: 'commons', position: { x: 665, y: 180 } },
    { id: 'cafe', name: '喫茶 こもれび', kind: 'cafe', areaId: 'town', position: { x: 160, y: 510 } },
    { id: 'library', name: '町の図書室', kind: 'library', areaId: 'town', position: { x: 450, y: 535 } },
    { id: 'workshop', name: '小さな工房', kind: 'workshop', areaId: 'town', position: { x: 735, y: 510 } }
  ],
  connections: [
    { id: 'street-1', from: 'home-west', to: 'home-east' },
    { id: 'street-2', from: 'home-east', to: 'park' },
    { id: 'street-3', from: 'home-west', to: 'cafe' },
    { id: 'street-4', from: 'cafe', to: 'library' },
    { id: 'street-5', from: 'library', to: 'workshop' },
    { id: 'street-6', from: 'park', to: 'workshop' }
  ]
}

export const descriptions = [
  '公園で悠斗と顔を合わせ、昨日の続きを少し話した。',
  '喫茶店で一緒に過ごした。相手の話をゆっくり聞けた。',
  '図書室で本を探した。芽衣が棚の場所を教えてくれた。',
  '今日の出来事を振り返り、明日また会えたらと考えた。'
]

export function initialState(runId: string): RunState {
  return { runId, stage: 'draft', agents: [parent], map: null, relationships: null,
    frame: { revision: 0, turn: 0, day: 1, phase: 'morning', mapRevision: null, positions: {} } }
}
