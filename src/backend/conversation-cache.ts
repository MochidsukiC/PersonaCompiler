import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { ConversationPage, ConversationTurn } from '../shared/conversation'

type Entry = { revision: number; loaded: number; cursor: string; previous: string; turns: ConversationTurn[]; changed: ConversationTurn[]; pending?: Promise<void> }

export class ConversationCache {
  private readonly entries = new Map<string, Entry>()
  constructor(private readonly fetch: (threadId: string) => Promise<ConversationTurn[]>) {}
  clear(): void { this.entries.clear() }
  invalidate(threadId: string): void { const entry = this.entries.get(threadId); if (entry) entry.revision++ }
  async read(threadId: string, cursor?: string): Promise<ConversationPage> {
    let entry = this.entries.get(threadId)
    if (!entry) { entry = { revision: 0, loaded: -1, cursor: '', previous: '', turns: [], changed: [] }; this.entries.set(threadId, entry) }
    const current = entry
    if (!current.pending && current.loaded !== current.revision) {
      const revision = current.revision
      current.pending = this.fetch(threadId).then(turns => {
        const previous = new Map(current.turns.map(turn => [turn.id, turn]))
        current.changed = turns.filter(turn => !isDeepStrictEqual(previous.get(turn.id), turn))
        current.turns = turns; current.loaded = revision; current.previous = current.cursor; current.cursor = randomUUID()
      })
    }
    const pending = current.pending
    if (pending) try { await pending } finally { if (current.pending === pending) current.pending = undefined }
    if (cursor === current.cursor) return { cursor, reset: false, turns: [] }
    const reset = !cursor || cursor !== current.previous
    return { cursor: current.cursor, reset, turns: reset ? current.turns : current.changed, order: current.turns.map(turn => turn.id) }
  }
}
