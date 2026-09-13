import { expect, it } from 'vitest'
import { emptyEventFilter, filterEvents } from '../../src/renderer/src/event-timeline'
import type { SimulationSnapshot } from '../../src/core/life-contracts'

const simulation: SimulationSnapshot = {
  version: 1, revision: 4, stage: 'paused', phase: 'between', turn: 2, day: 1, time: 'noon', step: false, error: null,
  actors: ['葵', '楓', '蓮'].map((name, index) => ({ id: `npc${index}`, name, householdId: 'home', locationId: 'library', position: null, activity: 'ended', nextFacilityId: null, wakeAt: null, compact: 'none' })),
  facilities: [{ id: 'books', locationId: 'library', name: '町の図書室', type: 'library', dimensions: { x: 3, y: 3, z: 3 }, layout: null }],
  events: [
    { sequence: 1, turn: 0, kind: 'entry', actorId: 'npc0', text: '初期化', recipients: [], locationId: 'library', position: null },
    { sequence: 2, turn: 1, kind: 'speech', actorId: 'npc0', text: '本を返す約束', recipients: ['npc1', 'npc2'], locationId: 'library', position: null },
    { sequence: 3, turn: 2, kind: 'speech', actorId: 'npc0', text: '誰かいますか', recipients: [], locationId: 'library', position: null },
    { sequence: 4, turn: 2, kind: 'end', actorId: 'npc1', text: '活動終了', recipients: [], locationId: 'library', position: null }
  ]
}

it('filters by participants, kind, exact turn and text without changing recorded order', () => {
  expect(filterEvents(simulation, emptyEventFilter).map(e => e.sequence)).toEqual([4, 3, 2, 1])
  expect(filterEvents(simulation, { ...emptyEventFilter, actorId: 'npc1' }).map(e => e.sequence)).toEqual([4, 2])
  expect(filterEvents(simulation, { actorId: 'npc2', kind: 'speech', turn: '1', query: '約束' }).map(e => e.sequence)).toEqual([2])
  expect(filterEvents(simulation, { ...emptyEventFilter, turn: '0' }).map(e => e.sequence)).toEqual([1])
  expect(filterEvents(simulation, { ...emptyEventFilter, query: ' 図書室 ' })).toHaveLength(4)
  expect(filterEvents(simulation, { ...emptyEventFilter, query: '楓' }).map(e => e.sequence)).toEqual([4, 2])
  expect(simulation.events.map(e => e.sequence)).toEqual([1, 2, 3, 4])
})

it('distinguishes speech without recipients from other untargeted actions and empty matches', () => {
  expect(filterEvents(simulation, { ...emptyEventFilter, kind: 'unheard' }).map(e => e.sequence)).toEqual([3])
  expect(filterEvents(simulation, { ...emptyEventFilter, query: '存在しない出来事' })).toEqual([])
  expect(filterEvents({ ...simulation, events: [] }, emptyEventFilter)).toEqual([])
})
