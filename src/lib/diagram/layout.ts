import type { ElkNode } from "elkjs/lib/elk-api"
import type { DiagramSnapshot } from "@/db/schema"

export type LayoutGeometry = {
  id: string
  width: number
  height: number
  anchorY: number
}
export type LayoutOptions = {
  direction?: "RIGHT" | "LEFT" | "DOWN" | "UP"
  nodeSpacing?: number
  layerSpacing?: number
}

export function createLayoutGraph(
  snapshot: DiagramSnapshot,
  geometry: Array<LayoutGeometry>,
  options: LayoutOptions = {}
): ElkNode {
  const measured = new Map(geometry.map((node) => [node.id, node]))
  return {
    id: "diagram",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": options.direction ?? "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.randomSeed": "1",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
      "elk.spacing.nodeNode": String(options.nodeSpacing ?? 80),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(
        options.layerSpacing ?? 160
      ),
      "elk.spacing.componentComponent": "100",
      "elk.spacing.edgeNode": "32",
      "elk.layered.spacing.edgeNodeBetweenLayers": "32",
      "elk.spacing.edgeEdge": "24",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "24",
      "elk.separateConnectedComponents": "true",
    },
    children: [...snapshot.entities]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((entity) => {
        const size = measured.get(entity.id)
        if (
          !size ||
          ![size.width, size.height, size.anchorY].every(Number.isFinite) ||
          size.width <= 0 ||
          size.height <= 0 ||
          size.anchorY < 0 ||
          size.anchorY > size.height
        )
          throw new Error("Entity dimensions are not ready")
        return {
          id: entity.id,
          width: size.width,
          height: size.height,
          layoutOptions: { "elk.portConstraints": "FIXED_POS" },
          ports: [
            {
              id: `${entity.id}:in`,
              x: 0,
              y: size.anchorY,
              width: 0,
              height: 0,
              layoutOptions: { "elk.port.side": "WEST" },
            },
            {
              id: `${entity.id}:out`,
              x: size.width,
              y: size.anchorY,
              width: 0,
              height: 0,
              layoutOptions: { "elk.port.side": "EAST" },
            },
          ],
        }
      }),
    edges: [...snapshot.relationships]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((relationship) => ({
        id: relationship.id,
        sources: [`${relationship.sourceEntityId}:out`],
        targets: [`${relationship.targetEntityId}:in`],
        labels: relationship.label
          ? [
              {
                text: relationship.label,
                width: relationship.label.length * 7 + 24,
                height: 24,
              },
            ]
          : [],
      })),
  }
}

export function layoutPositions(graph: ElkNode, entityIds: Array<string>) {
  const children = new Map(graph.children?.map((node) => [node.id, node]))
  return entityIds.map((id) => {
    const node = children.get(id)
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y))
      throw new Error("Incomplete diagram layout")
    return { id, x: Math.round(node.x!), y: Math.round(node.y!) }
  })
}
