import { expect, it } from 'vitest'
import type { CharacterPackageInspection } from '../../src/core/compiler-contracts'
import { compareCharacterPackages, packageComparisonMarkdown, packageComparisonSummary } from '../../src/core/package-comparison'

type File = CharacterPackageInspection['files'][number]
const file = (path: string, actualHash: string | null, expectedHash = actualHash ?? 'missing'): File => ({ path, actualHash, expectedHash, status: actualHash === null ? 'missing' : actualHash === expectedHash ? 'match' : 'changed', bytes: actualHash === null ? null : 10 })
const inspection = (files: File[], id = 'baseline'): CharacterPackageInspection => ({ runId: 'world', npcId: 'npc', sourceRevision: 3, modelId: 'fixture', checkedAt: '2026-09-14T00:00:00.000Z', manifestPath: `compilation/${id}/npcs/npc/manifest.json`, manifestHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), promptHash: 'c'.repeat(64), files })

it('compares arbitrary registered file paths by actual bytes, independent of format or matching manifest hashes', () => {
  const before = inspection([file('memories.json', 'a'), file('nested/sprite.bin', 'b'), file('old.lua', 'c'), file('missing.txt', null)])
  const after = inspection([file('memories.json', 'd'), file('nested/sprite.bin', 'b', 'e'), file('new.lua', 'c'), file('missing.txt', null)], 'current')
  const original = structuredClone({ before, after })
  const comparison = compareCharacterPackages(before, after)
  expect(comparison.files.map(f => [f.path, f.kind])).toEqual([['memories.json', 'changed'], ['missing.txt', 'unavailable'], ['nested/sprite.bin', 'same'], ['new.lua', 'added'], ['old.lua', 'removed']])
  expect(comparison.files.find(f => f.path === 'nested/sprite.bin')?.after?.status).toBe('changed')
  expect(packageComparisonSummary(comparison)).toBe('追加 1件 · 削除 1件 · 内容変更 1件 · 内容一致 1件 · 比較不能（欠損） 1件')
  expect({ before, after }).toEqual(original)
})

it('keeps missing registered files incomparable instead of inferring additions, deletions or agreement', () => {
  const before = inspection([file('a', null), file('b', 'b'), file('c', null), file('d', null)])
  const after = inspection([file('a', 'a'), file('b', null), file('c', null), file('e', null)])
  expect(compareCharacterPackages(before, after).files.map(f => f.kind)).toEqual(Array(5).fill('unavailable'))
})

it('compares case-sensitive manifest names and prototype-like names without merging entries', () => {
  const before = inspection([file('__proto__', 'a'), file('A.json', 'b'), file('a.json', 'c')])
  const after = inspection([file('a.json', 'b'), file('__proto__', 'a'), file('A.json', 'b')])
  expect(compareCharacterPackages(before, after).files.map(f => [f.path, f.kind])).toEqual([['A.json', 'same'], ['__proto__', 'same'], ['a.json', 'changed']])
})

it('rejects comparisons across worlds or NPCs', () => {
  const before = inspection([file('a', 'a')])
  for (const after of [{ ...before, runId: 'other' }, { ...before, npcId: 'other' }]) {
    expect(() => compareCharacterPackages(before, after)).toThrow('ワールドまたはNPCが一致しません')
    expect(() => packageComparisonMarkdown(before, after, 'now')).toThrow('ワールドまたはNPCが一致しません')
  }
})

it('exports exact inspection records and escaped prose with comparison scope and timestamps', () => {
  const hostile = '<script>test</script>\n```\n# forged\n[link](https://example.com)'
  const before = inspection([file(hostile, 'a')]), after = inspection([file(hostile, 'b')], 'current')
  const capturedAt = '2026-09-14T01:02:03.000Z'
  const report = packageComparisonMarkdown(before, after, capturedAt)
  const blocks = [...report.matchAll(/```json\n([\s\S]*?)\n```/g)]
  expect(blocks).toHaveLength(1)
  expect(JSON.parse(blocks[0][1])).toEqual({ format: 'persona-package-comparison/v1', capturedAt, before, after, comparison: compareCharacterPackages(before, after) })
  const prose = report.replace(/```json\n[\s\S]*?\n```/g, '')
  expect(prose).not.toContain('<script>')
  expect(prose).not.toContain('\n# forged')
  expect(prose).toContain('> \\# forged')
  expect(prose).toContain('未登録ファイルは対象外')
  expect(prose).toContain('コピー時の再照合')
  expect(prose).toContain(before.checkedAt)
  expect(prose).toContain(capturedAt)
})
