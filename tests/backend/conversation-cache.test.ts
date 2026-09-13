import { expect, it, vi } from 'vitest'
import { ConversationCache } from '../../src/backend/conversation-cache'
import { mergeConversation, type ConversationTurn } from '../../src/shared/conversation'

it('skips unchanged history reads and sends only changed turns while preserving renderer references', async () => {
  const first = { id: 'one', status: 'completed', items: [] }
  let history: ConversationTurn[] = [first, { id: 'two', status: 'inProgress', items: [] }]
  const fetch = vi.fn(async () => history)
  const cache = new ConversationCache(fetch)
  const page = await cache.read('npc')
  const idle = await cache.read('npc', page.cursor)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(mergeConversation(page.turns, idle)).toBe(page.turns)
  history = [first, { id: 'two', status: 'completed', items: [{ id: 'speech', type: 'agentMessage', text: 'hello' }] }]
  cache.invalidate('npc')
  const update = await cache.read('npc', page.cursor)
  expect(update.reset).toBe(false)
  expect(update.turns.map(t => t.id)).toEqual(['two'])
  const merged = mergeConversation(page.turns, update)
  expect(merged).toEqual(history)
  expect(merged[0]).toBe(first)
  expect((await cache.read('npc', 'unknown')).reset).toBe(true)
  history = [history[1]]; cache.invalidate('npc')
  expect(mergeConversation(merged, await cache.read('npc', update.cursor))).toEqual(history)
})

it('shares concurrent reads, refreshes notifications arriving during a read, and exposes failures', async () => {
  let resolve!: (turns: ConversationTurn[]) => void
  const fetch = vi.fn(() => new Promise<ConversationTurn[]>(done => { resolve = done }))
  const cache = new ConversationCache(fetch)
  const a = cache.read('npc'), b = cache.read('npc')
  cache.invalidate('npc'); resolve([])
  expect(await a).toEqual(await b)
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockRejectedValueOnce(new Error('history unavailable'))
  await expect(cache.read('npc')).rejects.toThrow('history unavailable')
  fetch.mockResolvedValueOnce([{ id: 'new', status: 'completed', items: [] }])
  expect((await cache.read('npc')).turns[0].id).toBe('new')
  cache.clear()
  fetch.mockResolvedValueOnce([])
  expect((await cache.read('npc')).reset).toBe(true)
})
