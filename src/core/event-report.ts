import type { SimulationSnapshot } from './life-contracts'
import { eventLabels, type EventFilter } from './event-search'

export interface EventReportInput {
  runId: string
  simulation: Pick<SimulationSnapshot, 'revision' | 'actors' | 'facilities'>
  filter: EventFilter
  events: SimulationSnapshot['events']
  source: { kind: 'recent'; available: number } | { kind: 'saved'; revision: number; savedAt: string; offset: number; total: number }
}

export function eventReportMarkdown(input: EventReportInput, capturedAt: string): string {
  const escape = (text: string) => text.replace(/[\\`*_{}[\]()<>!#|]/g, '\\$&')
  const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${escape(line)}`).join('\n')
  const names = new Map(input.simulation.actors.map(actor => [actor.id, actor.name]))
  const places = new Map(input.simulation.facilities.map(facility => [facility.locationId, facility.name]))
  const person = (id: string) => names.has(id) ? `${names.get(id)} (${id})` : id
  const lines = ['# 出来事のQAレポート', '', '形式: persona-event-qa/v1', '', quote(`ワールドID: ${input.runId}\n採取時刻: ${capturedAt}\n画面の世界revision: ${input.simulation.revision}`), '']
  if (input.source.kind === 'saved') {
    const source = input.source
    lines.push(`対象: 保存済み履歴 / 保存revision ${source.revision}`, '', quote(`参照manifestの保存時刻: ${source.savedAt}`), '',
      `このページ: ${input.events.length ? source.offset + 1 : 0}–${source.offset + input.events.length} / 検索一致 ${source.total}件`, '',
      `ページoffset: ${source.offset} · 収録: ${input.events.length}件 · 新しい順`, '', 'このレポートは表示中のページだけを収録しています。未保存の出来事は含みません。', '')
  } else lines.push(`対象: 画面に届いた直近の出来事 / 検索一致 ${input.events.length}件 / 検索対象 ${input.source.available}件`, '', '未保存分を含む可能性があります。過去の全履歴は収録していません。新しい順です。', '')
  lines.push('## 検索条件', '', '```json', JSON.stringify(input.filter, null, 2), '```', '',
    '住民の条件は行動者または受信対象に一致します。受信対象は既読・記憶化を保証しません。表示名は採取時の画面の名称です。', '',
    'レポートは観測記録です。問題の原因や不具合の有無、同じ推論結果の再現を保証するものではありません。', '')
  if (!input.events.length) lines.push('条件に一致する出来事はありません。', '')
  for (const event of input.events) {
    lines.push(`## #${event.sequence} · Turn ${event.turn} · ${eventLabels[event.kind]}`, '',
      quote(`行動者: ${person(event.actorId)}\n場所: ${places.get(event.locationId) ?? event.locationId} (${event.locationId})\n位置: ${event.position ? JSON.stringify(event.position) : '未設定'}`), '',
      quote(event.text), '', quote(`受信対象: ${event.recipients.length ? event.recipients.map(person).join(' / ') : '0人'}${event.volume ? `\n声量: ${event.volume}` : ''}`), '')
  }
  lines.push('## 出来事の元データ', '', '```json', JSON.stringify(input.events, null, 2), '```', '')
  return lines.join('\n')
}
