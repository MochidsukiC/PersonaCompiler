import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { receivedMessageDisplay, sentMessageDisplay } from '../../src/shared/conversation'

const situationMessage = readFileSync('tests/fixtures/situation-message.txt', 'utf8')

describe('sent message display', () => {
  const sent = { id: 'speech', type: 'dynamicToolCall', tool: 'sendMessage', status: 'completed', success: true, arguments: { text: 'おはようございます。\n今日はいい天気ですね。', volume: 'high' } }
  it.each(['low', 'medium', 'high'] as const)('shows a successful %s speech with its original text', volume => {
    const labels = { low: '小声', medium: '普通の声', high: '大声' }
    expect(sentMessageDisplay({ ...sent, arguments: { ...sent.arguments, volume } })).toEqual({ label: `発言 · ${labels[volume]}`, text: sent.arguments.text })
  })
  it('does not present pending, failed, malformed or unrelated tool calls as delivered speech', () => {
    for (const item of [
      { ...sent, status: 'inProgress', success: null }, { ...sent, success: false }, { ...sent, status: 'failed' },
      { ...sent, success: undefined }, { ...sent, arguments: {} }, { ...sent, tool: 'getSituation' }, { ...sent, type: 'mcpToolCall' }
    ]) expect(sentMessageDisplay(item)).toBeNull()
  })
})

describe('received message display', () => {
  it('shows each batched speaker and original turn without recursively interpreting nested batches', () => {
    const message = JSON.stringify({ kind: 'heardSpeech', eventId: 1, turn: 3, speaker: { id: 'a', name: '葵', position: { x: 0, y: 0, z: 0 } }, volume: 'low', text: 'おはよう' })
    const batch = { kind: 'heardSpeechBatch', turn: 4, messages: [{ deliveryId: 'a', message }, { deliveryId: 'b', message }] }
    expect(receivedMessageDisplay(JSON.stringify(batch))).toEqual({ label: 'まとめて受信 · 2件', text: '葵 · 小声 · ターン 3\nおはよう\n\n葵 · 小声 · ターン 3\nおはよう' })
    expect(receivedMessageDisplay(JSON.stringify({ ...batch, messages: [{ deliveryId: 'nested', message: JSON.stringify(batch) }] }))).toBeNull()
  })
  it('renders the reported situation notification without nested JSON or memory source history', () => {
    const display = receivedMessageDisplay(situationMessage)!
    expect(display.label).toBe('状況通知 · 1日目・夕 · ターン 3')
    expect(display.text).toContain('現在地：森かげ公園 (29, 8, 0)')
    expect(display.text).toContain('周囲：中央園路')
    expect(display.text).toContain('久保 修 (44, 37, 0) · 活動中')
    expect(display.text).toContain('移動できる施設：こもれび住宅街、森かげ公園')
    expect(display.text).not.toMatch(/memorySources|heardSpeech|sourceIds|npc_003|"turn"|\{|\}/)
    expect(display.text).not.toContain('二人ともおはよう')
  })
  it('handles entry notifications and unset coordinates', () => {
    const body = JSON.parse(situationMessage.slice(situationMessage.indexOf('\n') + 1))
    body.self.position = null; body.self.activity = 'entering'; body.self.nextFacilityId = 'fac_library'; body.phase = 'entry'
    body.npcs = []; body.currentRegions = []; delete body.home; delete body.memorySources
    for (const prefix of [
      '入場位置の設定を再開します。setInitialPositionで選び、応答を終了してください。',
      '新しいターンの入場位置をsetInitialPositionで選び、応答を終了してください。生活開始は全員の入場位置確定後です。',
      'turn=0の初期位置をsetInitialPositionで選び、応答を終了してください。生活はまだ開始しません。'
    ]) {
      const display = receivedMessageDisplay(`${prefix}\n${JSON.stringify(body)}`)!
      expect(display.text).toContain('位置未設定')
      expect(display.text).toContain('同じ施設にいる人：なし')
      expect(display.text).toContain('次ターンの移動先：まちの図書室')
    }
  })
  it('does not rewrite arbitrary instructions followed by JSON or malformed situations', () => {
    expect(receivedMessageDisplay(`このJSONを説明してください。\n${situationMessage.slice(situationMessage.indexOf('\n') + 1)}`)).toBeNull()
    expect(receivedMessageDisplay(`${situationMessage.split('\n')[0]}\n{"turn":3}`)).toBeNull()
  })
  it('presents speech as the speaker, volume and exact text', () => {
    for (const [volume, label] of Object.entries({ low: '小声', medium: '普通の声', high: '大声' })) {
      expect(receivedMessageDisplay(JSON.stringify({ kind: 'heardSpeech', eventId: 454, turn: 2, speaker: { id: 'npc_009', name: '小川 恵', position: { x: 22, y: 12, z: 0 } }, volume, text: '今日はここまでにしましょう。\nまた続きを聞かせてください。' }))).toEqual({ label: `小川 恵 · ${label} · ターン 2`, text: '今日はここまでにしましょう。\nまた続きを聞かせてください。' })
    }
  })
  it('presents a facility response', () => {
    expect(receivedMessageDisplay('{"kind":"facilityResponse","facilityId":"school","text":"利用できます。"}')).toEqual({ label: '施設からの回答 · school', text: '利用できます。' })
  })
  it('leaves ordinary text, unrelated JSON and invalid events unchanged', () => {
    for (const text of ['こんにちは', '{broken', '{"text":"ユーザーのJSON"}', '{"kind":"heardSpeech","text":"不完全"}']) expect(receivedMessageDisplay(text)).toBeNull()
  })
})
