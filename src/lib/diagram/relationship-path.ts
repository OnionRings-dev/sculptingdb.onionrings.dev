type Point = { x: number; y: number }
export type CableAnchor = Point & { width: number }
type Link = { id: string; sourceEntityId: string; targetEntityId: string }

// Group reciprocal relationships too. Stable IDs keep their lanes unchanged
// when selection, history previews or server updates reorder the edge array.
export function relationshipLanes(relationships: Array<Link>) {
  const groups = new Map<string, Array<Link>>()
  for (const relationship of relationships) {
    const key = JSON.stringify(
      [relationship.sourceEntityId, relationship.targetEntityId].sort()
    )
    const group = groups.get(key) ?? []
    group.push(relationship)
    groups.set(key, group)
  }
  const lanes = new Map<string, number>()
  for (const group of groups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id))
    group.forEach((relationship, index) => {
      const middle =
        relationship.sourceEntityId === relationship.targetEntityId
          ? 0
          : (group.length - 1) / 2
      lanes.set(relationship.id, (index - middle) * 48)
    })
  }
  return lanes
}

function pointOnCurve(points: [Point, Point, Point, Point], t: number): Point {
  const [a, b, c, d] = points
  const u = 1 - t
  return {
    x:
      u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
    y:
      u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y,
  }
}

function cardinalityPoint(
  points: [Point, Point, Point, Point],
  fromSource: boolean,
  offset: number
) {
  let previous = fromSource ? points[0] : points[3]
  let distance = 0
  // Measure along the curve rather than assuming left-to-right connections.
  // Cap at a quarter so labels on short cables don't swap endpoints.
  for (let step = 1; step <= 24; step++) {
    const t = step / 96
    const point = pointOnCurve(points, fromSource ? t : 1 - t)
    distance += Math.hypot(point.x - previous.x, point.y - previous.y)
    if (distance >= 32) return { x: point.x, y: point.y + offset }
    previous = point
  }
  return { x: previous.x, y: previous.y + offset }
}

export function relationshipPath(
  source: CableAnchor,
  target: CableAnchor,
  lane = 0,
  self = false
) {
  let start: Point
  let end: Point
  let first: Point
  let second: Point
  if (self) {
    const reach = 100 + lane
    start = end = { x: source.x + source.width, y: source.y }
    first = { x: start.x + reach, y: start.y - reach }
    second = { x: end.x + reach, y: end.y + reach }
  } else {
    const forward = source.x + source.width <= target.x
    const backward = target.x + target.width <= source.x
    start = { x: backward ? source.x : source.x + source.width, y: source.y }
    end = { x: forward ? target.x : target.x + target.width, y: target.y }
    if (!forward && !backward) {
      // Vertically stacked cards connect around their outside, not through their bodies.
      const outside =
        Math.max(start.x, end.x) +
        Math.max(64, Math.min(300, Math.abs(end.y - start.y) * 0.35)) +
        Math.abs(lane)
      first = { x: outside, y: start.y + lane }
      second = { x: outside, y: end.y + lane }
    } else {
      const direction = forward ? 1 : -1
      const reach = Math.min(
        Math.abs(end.x - start.x) / 2,
        Math.max(
          24,
          Math.min(
            240,
            Math.abs(end.x - start.x) * 0.45 + Math.abs(end.y - start.y) * 0.12
          )
        )
      )
      first = { x: start.x + direction * reach, y: start.y + lane }
      second = { x: end.x - direction * reach, y: end.y + lane }
    }
  }
  const points: [Point, Point, Point, Point] = [start, first, second, end]
  const label = pointOnCurve(points, 0.5)
  const offset = lane > 0 && !self ? 13 : -13
  return {
    bounds: {
      x: Math.min(...points.map((point) => point.x)),
      y: Math.min(...points.map((point) => point.y)),
      width:
        Math.max(...points.map((point) => point.x)) -
        Math.min(...points.map((point) => point.x)),
      height:
        Math.max(...points.map((point) => point.y)) -
        Math.min(...points.map((point) => point.y)),
    },
    path: `M ${start.x},${start.y} C ${first.x},${first.y} ${second.x},${second.y} ${end.x},${end.y}`,
    label: { x: label.x, y: label.y - 12 },
    sourceLabel: cardinalityPoint(points, true, self ? -10 : offset),
    targetLabel: cardinalityPoint(points, false, self ? 16 : offset),
  }
}
