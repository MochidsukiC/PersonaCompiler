import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { log } from 'node:console'
import process from 'node:process'
import { compareCharacterReviews } from '../src/core/review-comparison.ts'

const cases = [
  { name: 'unique-settings-long-source', count: 300, bytes: 65536, duplicates: false },
  { name: 'duplicate-settings-changed-source', count: 120, bytes: 16384, duplicates: true }
]
const results = []
for (const sample of cases) {
  const before = { version: 1, npcId: 'fixture', name: '合成の比較資料', sourceRevision: 1, modelId: 'fixture', memoryCount: 0, relationshipCount: 0,
    sections: [{ title: '任意の設定', claims: Array.from({ length: sample.count }, (_, index) => ({ text: sample.duplicates ? '同じ設定' : `設定 ${index}`, evidence: ['script:Route-B/phase-2'] })) }],
    sources: [{ id: 'script:Route-B/phase-2', title: '合成資料', text: 'a'.repeat(sample.bytes) }], runtimeGuidance: '', systemPrompt: '' }
  const after = { ...before, sources: [{ ...before.sources[0], text: 'b'.repeat(sample.bytes) }] }
  const elapsed = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now()
    const result = compareCharacterReviews(before, after)
    elapsed.push(performance.now() - started)
    assert.equal(result.unchanged, 0)
    assert.equal(result.changes.length, sample.count)
    assert.ok(result.changes.every(change => change.kind === 'evidence' && change.before[0].text === before.sources[0].text && change.after[0].text === after.sources[0].text))
  }
  results.push({ ...sample, milliseconds: elapsed.map(value => Number(value.toFixed(3))) })
}
log(JSON.stringify({ node: process.version, capturedAt: new Date().toISOString(), results }, null, 2))
