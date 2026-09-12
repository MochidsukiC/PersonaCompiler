import { expect, it } from 'vitest'
import { speechTail } from '../../src/renderer/src/speech-tail'

it.each([{ x: 190, y: 300 }, { x: 190, y: 20 }, { x: 30, y: 140 }, { x: 500, y: 140 }])('keeps the speech tip attached to the speaker at $x,$y', tip => {
  const vertices = speechTail({ x: 100, y: 100, width: 210, height: 90 }, tip).split(' ').map(point => point.split(',').map(Number))
  expect(vertices[1]).toEqual([tip.x, tip.y])
  for (const [x, y] of [vertices[0], vertices[2]]) {
    expect(x).toBeGreaterThanOrEqual(100)
    expect(x).toBeLessThanOrEqual(310)
    expect(y).toBeGreaterThanOrEqual(100)
    expect(y).toBeLessThanOrEqual(190)
  }
  const relocated = speechTail({ x: 400, y: 350, width: 210, height: 90 }, tip).split(' ')[1]
  expect(relocated).toBe(`${tip.x},${tip.y}`)
})
