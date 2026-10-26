import { memo } from "react"
import {
  BaseEdge,
  EdgeText,
  getBezierPath,
  useInternalNode,
} from "@xyflow/react"
import type { Edge, EdgeProps } from "@xyflow/react"
import { relationshipPath } from "@/lib/diagram/relationship-path"
import { cardinalities } from "@/lib/diagram/model"
import type { Relationship } from "@/lib/diagram/model"

export type RelationshipFlowEdge = Edge<
  { relationship: Relationship; lane?: number },
  "relationship"
>
const labelStyle = { fill: "var(--muted-foreground)", fontSize: 11 }
const labelBgStyle = { fill: "var(--background)" }
const selectedLabelStyle = {
  ...labelStyle,
  fill: "var(--diagram-edge-selected)",
  fontWeight: 600,
}
const selectedLabelBgPadding: [number, number] = [12, 5]

export const RelationshipEdge = memo(function RelationshipEdgeView(
  props: EdgeProps<RelationshipFlowEdge>
) {
  const source = useInternalNode(props.source)
  const target = useInternalNode(props.target)
  const [fallbackPath, labelX, labelY] = getBezierPath(props)
  const cable =
    source?.measured.width && target?.measured.width
      ? relationshipPath(
          {
            x: source.internals.positionAbsolute.x,
            y: props.sourceY,
            width: source.measured.width,
          },
          {
            x: target.internals.positionAbsolute.x,
            y: props.targetY,
            width: target.measured.width,
          },
          props.data?.lane,
          props.source === props.target
        )
      : {
          path: fallbackPath,
          label: { x: labelX, y: labelY - 12 },
          sourceLabel: { x: props.sourceX + 22, y: props.sourceY - 13 },
          targetLabel: { x: props.targetX - 22, y: props.targetY - 13 },
        }
  const { path } = cable
  const relationship = props.data?.relationship
  if (!relationship) return null
  const edgeLabelStyle = props.selected ? selectedLabelStyle : labelStyle
  return (
    <>
      {props.selected && (
        <path
          d={path}
          className="diagram-edge-selection-halo"
          aria-hidden="true"
        />
      )}
      <BaseEdge
        id={props.id}
        path={path}
        interactionWidth={24}
        style={props.style}
      />
      <EdgeText
        x={cable.sourceLabel.x}
        y={cable.sourceLabel.y}
        label={
          cardinalities.find(
            ({ value }) => value === relationship.sourceCardinality
          )?.label
        }
        labelStyle={edgeLabelStyle}
        labelBgStyle={labelBgStyle}
        labelBgPadding={props.selected ? selectedLabelBgPadding : undefined}
      />
      <EdgeText
        x={cable.targetLabel.x}
        y={cable.targetLabel.y}
        label={
          cardinalities.find(
            ({ value }) => value === relationship.targetCardinality
          )?.label
        }
        labelStyle={edgeLabelStyle}
        labelBgStyle={labelBgStyle}
        labelBgPadding={props.selected ? selectedLabelBgPadding : undefined}
      />
      {relationship.label && (
        <EdgeText
          x={cable.label.x}
          y={cable.label.y}
          label={relationship.label}
          labelStyle={edgeLabelStyle}
          labelBgStyle={labelBgStyle}
          labelBgPadding={props.selected ? selectedLabelBgPadding : undefined}
        />
      )}
    </>
  )
})
