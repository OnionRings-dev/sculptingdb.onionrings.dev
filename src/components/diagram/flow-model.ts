import type { DiagramSnapshot } from "@/db/schema"
import type { EntityFlowNode } from "./entity-node"
import type { RelationshipFlowEdge } from "./relationship-edge"

export function flowNodes(snapshot: DiagramSnapshot): Array<EntityFlowNode> {
  return snapshot.entities.map((entity) => ({
    id: entity.id,
    type: "entity",
    position: { x: entity.positionX, y: entity.positionY },
    ariaLabel: `${entity.name} entity`,
    data: {
      entity,
      attributes: snapshot.attributes.filter(
        ({ entityId }) => entityId === entity.id
      ),
    },
  }))
}

export function flowEdges(
  snapshot: DiagramSnapshot
): Array<RelationshipFlowEdge> {
  return snapshot.relationships.map((relationship) => ({
    id: relationship.id,
    type: "relationship",
    source: relationship.sourceEntityId,
    target: relationship.targetEntityId,
    ariaLabel: relationship.label || "Relationship",
    data: { relationship },
  }))
}
