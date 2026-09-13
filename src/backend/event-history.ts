import path from 'node:path'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { z } from 'zod'
import { lifeEventSchema, type SimulationSnapshot } from '../core/life-contracts'
import { eventMatcher, type EventHistoryPage, type EventHistoryQuery } from '../core/event-search'
import { digest, type Workspace } from '../main/workspace'
import { manifestSchema } from './persistence-store'

const entrySchema = z.object({ revision: z.number().int().positive(), records: z.array(z.object({ kind: z.string(), value: z.unknown().optional() })) })

export async function readEventHistory(workspace: Workspace, simulation: SimulationSnapshot, query: EventHistoryQuery): Promise<EventHistoryPage> {
  if (query.runId !== path.basename(workspace.root)) throw new Error('出来事の検索対象ワールドが切り替わりました')
  const manifest = manifestSchema.parse(JSON.parse(await workspace.read('persistence/manifest.json')))
  if (manifest.runId !== query.runId) throw new Error('出来事の保存manifestのrunIdが一致しません')
  const revision = query.revision ?? manifest.revision
  if (revision > manifest.revision) throw new Error('指定された出来事の保存revisionは存在しません')
  let previous = 0
  for (const segment of manifest.segments) {
    if (segment.first <= previous || segment.last < segment.first || segment.last > manifest.revision) throw new Error(`出来事の履歴範囲が不正です: ${segment.file}`)
    previous = segment.last
  }
  const page: EventHistoryPage = { runId: query.runId, revision, savedAt: manifest.savedAt, offset: query.offset, total: 0, events: [] }
  const matches = eventMatcher(simulation, query.filter)
  let previousSequence = Infinity
  for (const segment of manifest.segments.toReversed()) {
    if (segment.first > revision) continue
    const text = await workspace.read(`persistence/${segment.file}`)
    if (digest(text) !== segment.hash) throw new Error(`出来事の履歴hashが一致しません: ${segment.file}`)
    const lines = text.trimEnd().split('\n')
    let previousRevision = segment.last + 1
    for (let index = lines.length - 1; index >= 0; index--) {
      const entry = entrySchema.parse(JSON.parse(lines[index]))
      if (entry.revision >= previousRevision || entry.revision < segment.first || (index === 0 && entry.revision !== segment.first) || (index === lines.length - 1 && entry.revision !== segment.last)) throw new Error(`出来事の履歴連番が不正です: ${segment.file}/${entry.revision}`)
      previousRevision = entry.revision
      if (entry.revision > revision) continue
      for (const record of entry.records.toReversed()) {
        if (record.kind !== 'event') continue
        const event = lifeEventSchema.parse(record.value)
        if (event.sequence >= previousSequence) throw new Error(`出来事の連番が重複または逆転しています: ${event.sequence}`)
        previousSequence = event.sequence
        if (!matches(event)) continue
        if (page.total >= query.offset && page.events.length < 100) page.events.push(event)
        page.total++
      }
    }
    await yieldToEventLoop()
  }
  return page
}
