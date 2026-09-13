import { expect, it } from 'vitest'
import { lifeTransaction, plainLifeValue } from '../../src/core/life-transaction'

it('copies only changed branches and leaves the original state and history intact', () => {
  const original = { world: { actors: [{ id: 'a', age: 1 }, { id: 'b', age: 2 }] }, jobs: [{ text: 'history' }] }
  const tx = lifeTransaction(original)
  tx.draft.world.actors[0].age++
  tx.draft.world.actors[0].age++
  expect(original.world.actors[0].age).toBe(1)
  expect(tx.value.world.actors[0].age).toBe(3)
  expect(tx.value.jobs).toBe(original.jobs)
  expect(tx.value.world.actors[1]).toBe(original.world.actors[1])
  expect(tx.changed).toEqual(new Set(['world']))
  expect(plainLifeValue(tx.draft)).toEqual(tx.value)
})

it('supports array shifts, appended objects, object deletion and serialization without changing the source', () => {
  const original = { jobs: [{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }], active: { a: true } }
  const tx = lifeTransaction(original)
  tx.draft.jobs.splice(0, 1)
  tx.draft.jobs.push({ id: 'c', status: 'queued' })
  tx.draft.jobs[0].status = 'done'
  Reflect.deleteProperty(tx.draft.active, 'a')
  expect(JSON.parse(JSON.stringify(tx.draft))).toEqual({ jobs: [{ id: 'b', status: 'done' }, { id: 'c', status: 'queued' }], active: {} })
  expect(original).toEqual({ jobs: [{ id: 'a', status: 'queued' }, { id: 'b', status: 'queued' }], active: { a: true } })
})

it('keeps read-only transactions shared and detaches assigned data', () => {
  const original = { world: { turn: 1 }, jobs: ['a'] }
  const tx = lifeTransaction(original)
  expect(tx.draft.jobs.map(String)).toEqual(['a'])
  expect(tx.value.world).toBe(original.world)
  expect(tx.changed.size).toBe(0)
  const replacement = { turn: 2 }
  tx.draft.world = replacement
  tx.draft.world.turn = 3
  expect(replacement.turn).toBe(2)
  expect(original.world.turn).toBe(1)
})
