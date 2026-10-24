import { HugeiconsIcon } from "@hugeicons/react"
import { Database02Icon } from "@hugeicons/core-free-icons"
import type { ProjectPreview as Preview } from "@/lib/projects/types"

const nodeWidth = 144
const nodeHeight = 64

export function ProjectPreview({ preview }: { preview: Preview }) {
  const { entities, relationships } = preview
  if (!entities.length)
    return (
      <div
        className="project-preview flex aspect-[4/3] items-center justify-center"
        aria-hidden="true"
      >
        <HugeiconsIcon
          icon={Database02Icon}
          className="size-7 text-muted-foreground/30"
          strokeWidth={1}
        />
      </div>
    )
  const minX = Math.min(...entities.map((entity) => entity.positionX)) - 48
  const minY = Math.min(...entities.map((entity) => entity.positionY)) - 48
  const width =
    Math.max(...entities.map((entity) => entity.positionX)) +
    nodeWidth +
    48 -
    minX
  const height =
    Math.max(...entities.map((entity) => entity.positionY)) +
    nodeHeight +
    48 -
    minY
  const nodes = new Map(entities.map((entity) => [entity.id, entity]))
  return (
    <div
      className="project-preview flex aspect-[4/3] items-center justify-center p-6"
      aria-hidden="true"
    >
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="size-full"
        fill="none"
      >
        {relationships.map((relationship) => {
          const source = nodes.get(relationship.sourceEntityId)
          const target = nodes.get(relationship.targetEntityId)
          if (!source || !target) return null
          const startX = source.positionX + nodeWidth / 2
          const startY = source.positionY + nodeHeight / 2
          const endX = target.positionX + nodeWidth / 2
          const endY = target.positionY + nodeHeight / 2
          return (
            <path
              key={relationship.id}
              d={`M ${startX} ${startY} H ${(startX + endX) / 2} V ${endY} H ${endX}`}
              className="stroke-muted-foreground/50"
              strokeWidth={1.5}
            />
          )
        })}
        {entities.map((entity) => (
          <g
            key={entity.id}
            transform={`translate(${entity.positionX} ${entity.positionY})`}
          >
            <rect
              width={nodeWidth}
              height={nodeHeight}
              rx={8}
              className="fill-card stroke-muted-foreground/40"
            />
            <text
              x={12}
              y={37}
              className="fill-muted-foreground font-mono text-[13px]"
            >
              {entity.name.length > 15
                ? `${entity.name.slice(0, 14)}…`
                : entity.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
