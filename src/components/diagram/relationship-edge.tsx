import { BaseEdge, EdgeText, getSmoothStepPath } from "@xyflow/react"
import type { Edge, EdgeProps } from "@xyflow/react"
import { cardinalities } from "@/lib/diagram/model"
import type { Relationship } from "@/lib/diagram/model"

export type RelationshipFlowEdge = Edge<
  { relationship: Relationship },
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

export function RelationshipEdge(props: EdgeProps<RelationshipFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath(props)
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
        x={props.sourceX + 22}
        y={props.sourceY - 13}
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
        x={props.targetX - 22}
        y={props.targetY - 13}
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
          x={labelX}
          y={labelY - 12}
          label={relationship.label}
          labelStyle={edgeLabelStyle}
          labelBgStyle={labelBgStyle}
          labelBgPadding={props.selected ? selectedLabelBgPadding : undefined}
        />
      )}
    </>
  )
}
