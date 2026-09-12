import { describe, expect, it } from 'vitest'
import { FACILITY_WIDTH, SPEECH_DURATION, facilityHeight, updateSpeech, worldLayout } from '../../src/renderer/src/world-presentation'
import type { SimulationSnapshot } from '../../src/core/life-contracts'
import { draft } from '../backend/fixtures'

type Event = SimulationSnapshot['events'][number]
const event = (sequence: number, actorId = 'npc0', kind: Event['kind'] = 'speech'): Event => ({ sequence, actorId, kind, turn: 1, text: `発言${sequence}`, locationId: 'home', position: null, recipients: [] })

describe('transient NPC speech', () => {
  it('ignores history and non-speech, replaces only the speaking NPC, and does not extend repeated events', () => {
    const initial = updateSpeech(null, 'run', [event(1)], 0)
    expect(initial.bubbles).toEqual([])
    const events = [event(1), event(2), event(3, 'npc1'), event(4, 'npc0', 'move')]
    const live = updateSpeech(initial, 'run', events, 100)
    expect(live.bubbles.map(b => b.sequence)).toEqual([2, 3])
    const repeat = updateSpeech(live, 'run', events, 1000)
    expect(repeat.bubbles).toEqual(live.bubbles)
    const next = updateSpeech(repeat, 'run', [...events, event(5)], 2000)
    expect(next.bubbles.map(b => b.sequence)).toEqual([5, 3])
    const expired = updateSpeech(next, 'run', [...events, event(5)], 100 + SPEECH_DURATION)
    expect(expired.bubbles.map(b => b.sequence)).toEqual([5])
  })
  it('clears on a new run or reset event stream', () => {
    const initial = updateSpeech(null, 'run', [], 0)
    const live = updateSpeech(initial, 'run', [event(1)], 100)
    expect(updateSpeech(live, 'other', [event(1)], 200).bubbles).toEqual([])
    expect(updateSpeech(live, 'run', [], 200).bubbles).toEqual([])
  })
})

describe('spacious world layout', () => {
  it('separates coincident facilities and many residents without changing source coordinates', () => {
    const map = structuredClone(draft.map)
    map.locations = Array.from({ length: 8 }, (_, i) => ({ ...map.locations[0], id: `place${i}`, position: { x: 10, y: 10 } }))
    const before = structuredClone(map)
    const counts = Object.fromEntries(map.locations.map(l => [l.id, 30]))
    const layout = worldLayout(map, counts)
    for (let i = 0; i < map.locations.length; i++) {
      const a = layout.positions[map.locations[i].id]
      expect(a.y + facilityHeight(30)).toBeLessThan(layout.areas[0].height)
      for (let j = i + 1; j < map.locations.length; j++) {
        const b = layout.positions[map.locations[j].id]
        expect(Math.abs(a.x - b.x) >= FACILITY_WIDTH + 100 || Math.abs(a.y - b.y) >= facilityHeight(30) + 100).toBe(true)
      }
    }
    expect(map).toEqual(before)
  })
})
