import type { SimulationSnapshot } from '../../core/life-contracts'

type LifeEvent = SimulationSnapshot['events'][number]
export const eventLabels: Record<LifeEvent['kind'], string> = { move: '施設内移動', travel: '施設間移動', speech: '発話', facility: '施設利用', sleep: '睡眠', wake: '起床', end: '活動終了', entry: '入場', death: '死亡', birth: '出生', marriage: '結婚', home: '新居' }
export interface EventFilter { actorId: string; kind: LifeEvent['kind'] | 'all' | 'unheard'; turn: string; query: string }
export const emptyEventFilter: EventFilter = { actorId: '', kind: 'all', turn: '', query: '' }

export function filterEvents(simulation: SimulationSnapshot, filter: EventFilter): LifeEvent[] {
  const query = filter.query.trim().toLocaleLowerCase()
  const names = new Map(simulation.actors.map(a => [a.id, a.name]))
  const facilities = new Map(simulation.facilities.map(f => [f.locationId, f.name]))
  return simulation.events.filter(event => {
    if (filter.actorId && event.actorId !== filter.actorId && !event.recipients.includes(filter.actorId)) return false
    if (filter.kind === 'unheard' ? event.kind !== 'speech' || event.recipients.length !== 0 : filter.kind !== 'all' && event.kind !== filter.kind) return false
    if (filter.turn.trim() !== '' && event.turn !== Number(filter.turn)) return false
    return !query || [event.text, event.actorId, names.get(event.actorId), eventLabels[event.kind], facilities.get(event.locationId), ...event.recipients.flatMap(id => [id, names.get(id)])].join(' ').toLocaleLowerCase().includes(query)
  }).toReversed()
}
