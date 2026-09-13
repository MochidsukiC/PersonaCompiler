import { expect, it } from 'vitest'
import { eventReportMarkdown, type EventReportInput } from '../../src/core/event-report'
import { emptyEventFilter } from '../../src/core/event-search'

const fixture = (): EventReportInput => ({
  runId: 'world-1', simulation: { revision: 42, actors: [], facilities: [] },
  filter: { ...emptyEventFilter, kind: 'speech', turn: '0', query: '約束' },
  source: { kind: 'saved', revision: 70, savedAt: '2026-09-14T00:00:00Z', offset: 100, total: 240 },
  events: [{ sequence: 140, turn: 0, kind: 'speech', actorId: 'npc0', text: '荷物を届ける約束', recipients: ['npc1'], locationId: 'ship', position: { x: -2, y: 0, z: 1.5 }, volume: 'low' }]
})

it('records the exact saved page, filters, world and raw evidence without inventing game semantics', () => {
  const input = fixture(), report = eventReportMarkdown(input, '2026-09-14T01:00:00Z')
  expect(report).toContain('ワールドID: world-1')
  expect(report).toContain('画面の世界revision: 42')
  expect(report).toContain('保存revision 70')
  expect(report).toContain('このページ: 101–101 / 検索一致 240件')
  expect(report).toContain('ページoffset: 100 · 収録: 1件')
  expect(report).toContain('## #140 · Turn 0 · 発話')
  const blocks = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(2)
  expect(JSON.parse(blocks[0][1])).toEqual(input.filter)
  expect(JSON.parse(blocks[1][1])).toEqual(input.events)
  expect(report).toContain('受信対象は既読・記憶化を保証しません')
})

it('distinguishes recent and empty results from complete saved history', () => {
  const input = fixture()
  const recent = eventReportMarkdown({ ...input, source: { kind: 'recent', available: 200 } }, 'now')
  expect(recent).toContain('検索一致 1件 / 検索対象 200件')
  expect(recent).toContain('未保存分を含む可能性')
  expect(recent).not.toContain('保存revision')
  const empty = eventReportMarkdown({ ...input, source: { kind: 'saved', revision: 70, savedAt: 'now', offset: 0, total: 0 }, events: [] }, 'now')
  expect(empty).toContain('このページ: 0–0 / 検索一致 0件')
  expect(empty).toContain('条件に一致する出来事はありません')
  expect(empty).toContain('```json\n[]\n```')
})

it('quotes model-supplied Markdown and HTML while preserving exact text in the JSON attachment', () => {
  const input = fixture()
  input.events[0].text = '<script>alert(1)</script>\n```\n# forged heading\n[open](https://example.com)'
  input.filter.query = '```\n# another heading'
  const report = eventReportMarkdown(input, 'now')
  const blocks = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(2)
  expect(JSON.parse(blocks[1][1])[0].text).toBe(input.events[0].text)
  const prose = report.replace(/```json\n[\s\S]*?\n```/g, '')
  expect(prose).not.toContain('<script>')
  expect(prose).not.toContain('\n# forged heading')
  expect(prose).toContain('> \\# forged heading')
})
