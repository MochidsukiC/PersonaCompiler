interface Point { x: number; y: number }
interface Rectangle extends Point { width: number; height: number }

export function speechTail(box: Rectangle, tip: Point): string {
  const right = box.x + box.width, bottom = box.y + box.height
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  let first: Point, last: Point
  if (tip.y >= bottom || tip.y <= box.y) {
    const x = clamp(tip.x, box.x + 20, right - 20)
    const y = tip.y >= bottom ? bottom - 1 : box.y + 1
    first = { x: x - 7, y }; last = { x: x + 7, y }
  } else {
    const x = tip.x < box.x + box.width / 2 ? box.x + 1 : right - 1
    const y = clamp(tip.y, box.y + 20, bottom - 20)
    first = { x, y: y - 7 }; last = { x, y: y + 7 }
  }
  return `${first.x},${first.y} ${tip.x},${tip.y} ${last.x},${last.y}`
}
