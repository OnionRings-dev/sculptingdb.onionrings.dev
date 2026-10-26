import type { DiagramSnapshot } from "@/db/schema"
import type { LayoutGeometry } from "./layout"

export type DiagramBounds = {
  x: number
  y: number
  width: number
  height: number
}

// Match the canvas's 240px cards, 12px padding and 16px attribute rows with 8px gaps.
// These are estimates: the MCP server has no browser measurements or viewport.
export function estimateGeometry(
  snapshot: DiagramSnapshot
): Array<LayoutGeometry> {
  return snapshot.entities.map((entity) => {
    const attributes = snapshot.attributes
      .filter((attribute) => attribute.entityId === entity.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    const primary = Math.max(
      0,
      attributes.findIndex((attribute) => attribute.isPrimaryKey)
    )
    return {
      id: entity.id,
      width: 240,
      height: attributes.length ? 61 + attributes.length * 24 : 44,
      anchorY: attributes.length ? 65 + primary * 24 : 22,
    }
  })
}

export function spatialLayout(snapshot: DiagramSnapshot) {
  const sizes = new Map(
    estimateGeometry(snapshot).map((node) => [node.id, node])
  )
  const nodes = snapshot.entities.map((entity) => ({
    ...sizes.get(entity.id)!,
    id: entity.id,
    name: entity.name,
    x: entity.positionX,
    y: entity.positionY,
  }))
  let overlapCount = 0
  const overlaps: Array<{ firstEntityId: string; secondEntityId: string }> = []
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j]
      if (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      ) {
        overlapCount++
        if (overlaps.length < 100)
          overlaps.push({ firstEntityId: a.id, secondEntityId: b.id })
      }
    }
  const x = nodes.length ? Math.min(...nodes.map((node) => node.x)) : 0
  const y = nodes.length ? Math.min(...nodes.map((node) => node.y)) : 0
  const bounds = {
    x,
    y,
    width: nodes.length
      ? Math.max(...nodes.map((node) => node.x + node.width)) - x
      : 640,
    height: nodes.length
      ? Math.max(...nodes.map((node) => node.y + node.height)) - y
      : 480,
  }
  return {
    geometrySource: "estimated" as const,
    coordinateSystem:
      "Canvas units: x increases rightwards, y downwards. Positions are saved values; card dimensions are estimated.",
    nodes,
    bounds,
    overlapCount,
    overlaps,
    overlapsTruncated: overlapCount > overlaps.length,
    relationshipCount: snapshot.relationships.length,
  }
}
