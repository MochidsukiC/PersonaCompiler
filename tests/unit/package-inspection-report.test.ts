import { expect, it } from 'vitest'
import type { CharacterPackageInspection } from '../../src/core/compiler-contracts'
import { packageInspectionMarkdown } from '../../src/core/package-inspection-report'

const fixture = (): CharacterPackageInspection => ({ runId: 'world', npcId: 'npc', sourceRevision: 3, modelId: 'fixture', checkedAt: '2026-09-14T00:00:00.000Z',
  manifestPath: 'compilation/example/npcs/npc/manifest.json', manifestHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), promptHash: 'c'.repeat(64), files: [
    { path: 'dialogue/ja.json', status: 'match', expectedHash: 'd'.repeat(64), actualHash: 'd'.repeat(64), bytes: 24 },
    { path: 'scripts/npc.lua', status: 'changed', expectedHash: 'e'.repeat(64), actualHash: 'f'.repeat(64), bytes: 1024 },
    { path: 'nested/asset.bin', status: 'missing', expectedHash: '0'.repeat(64), actualHash: null, bytes: null }
  ] })

it('exports the checked manifest, exact file results and timestamp without depending on file formats', () => {
  const input = fixture(), original = structuredClone(input)
  const report = packageInspectionMarkdown(input)
  expect(report).toContain('全3ファイル · 一致 1件 · 内容変更 1件 · 欠損 1件')
  expect(report).toContain(input.checkedAt)
  expect(report).toContain('コピー時の再照合は行いません')
  expect(report).toContain('元資料との照合')
  const blocks = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(1)
  expect(JSON.parse(blocks[0][1])).toEqual({ format: 'persona-package-inspection/v1', ...input })
  expect(input).toEqual(original)
})

it('quotes file and identity text while preserving exact values in the JSON report', () => {
  const input = fixture(), hostile = '<script>alert(1)</script>\n```\n# forged\n[link](https://example.com)'
  input.files[0].path = hostile
  input.npcId = hostile
  const report = packageInspectionMarkdown(input), blocks = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(1)
  expect(JSON.parse(blocks[0][1]).files[0].path).toBe(hostile)
  const prose = report.replace(/```json\n[\s\S]*?\n```/g, '')
  expect(prose).not.toContain('<script>')
  expect(prose).not.toContain('\n# forged')
  expect(prose).toContain('> \\# forged')
})
