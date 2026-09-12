import type { MapDocument } from '../../shared/contracts'
import type { SimulationSnapshot } from '../../core/life-contracts'

export const SPEECH_DURATION = 10_000
type LifeEvent = SimulationSnapshot['events'][number]
export type SpeechBubble = LifeEvent & { expiresAt: number }
export interface SpeechState { runId: string; sequence: number; bubbles: SpeechBubble[] }

export function updateSpeech(previous: SpeechState | null, runId: string, events: LifeEvent[], now: number): SpeechState {
  const sequence = events.at(-1)?.sequence ?? 0
  // Opening an existing run establishes a cursor without replaying its history.
  if (!previous || previous.runId !== runId || sequence < previous.sequence) return { runId, sequence, bubbles: [] }
  const bubbles = new Map(previous.bubbles.filter(b => b.expiresAt > now).map(b => [b.actorId, b]))
  for (const event of events) {
    if (event.sequence > previous.sequence && event.kind === 'speech') bubbles.set(event.actorId, { ...event, expiresAt: now + SPEECH_DURATION })
  }
  return { runId, sequence, bubbles: [...bubbles.values()] }
}

export const FACILITY_WIDTH = 224
export function facilityHeight(count: number): number { return 148 + Math.ceil(count / 4) * 46 }

// A display layout only: disk coordinates and simulation positions remain authoritative.
export function worldLayout(map: MapDocument, counts: Record<string, number>) {
  const positions: Record<string, { x: number; y: number }> = {}
  const areas: { id: string; name: string; color: string; position: { x: number; y: number }; width: number; height: number }[] = []
  const groups = [...map.areas.map(area => ({ ...area, locations: map.locations.filter(l => l.areaId === area.id) }))]
  const ungrouped = map.locations.filter(l => !map.areas.some(a => a.id === l.areaId))
  if (ungrouped.length) groups.push({ id: '__ungrouped', name: 'その他の地点', color: '#94ad99', position: { x: 0, y: Infinity }, width: 0, height: 0, locations: ungrouped })
  groups.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  let top = 0
  for (const group of groups) {
    const locations = [...group.locations].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id))
    const columns = Math.min(3, Math.max(1, locations.length))
    let rowTop = top + 64
    for (let start = 0; start < locations.length; start += columns) {
      const row = locations.slice(start, start + columns)
      row.forEach((location, column) => { positions[location.id] = { x: 48 + column * (FACILITY_WIDTH + 252), y: rowTop } })
      rowTop += Math.max(...row.map(l => facilityHeight(counts[l.id] ?? 0))) + 120
    }
    const height = Math.max(128, rowTop - top - 72)
    areas.push({ id: group.id, name: group.name, color: group.color, position: { x: 0, y: top }, width: columns * (FACILITY_WIDTH + 252) + 48, height })
    top += height + 88
  }
  return { positions, areas }
}
