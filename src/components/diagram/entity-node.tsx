import { memo, useEffect } from "react"
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react"
import type { Node, NodeProps } from "@xyflow/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Key01Icon } from "@hugeicons/core-free-icons"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { Attribute, Entity } from "@/lib/diagram/model"
import { dataTypeColor } from "./data-type-color"
import { cn } from "@/lib/utils"
import { useTheme } from "next-themes"

export type EntityFlowNode = Node<
  { entity: Entity; attributes: Array<Attribute> },
  "entity"
>

function EntityHandles({ isConnectable }: { isConnectable: boolean }) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
      />
    </>
  )
}

export const EntityNode = memo(function EntityNodeView({
  id,
  data,
  selected,
  isConnectable,
}: NodeProps<EntityFlowNode>) {
  const { resolvedTheme } = useTheme()
  // Composite keys anchor to their first visible field. Without a primary key,
  // use the first attribute; an empty entity connects at the title row.
  const primaryKeyIndex = data.attributes.findIndex(
    (attribute) => attribute.isPrimaryKey
  )
  const anchorIndex = primaryKeyIndex < 0 ? 0 : primaryKeyIndex
  const anchorId = data.attributes[anchorIndex]?.id
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    // Reordering fields or moving a PK can move the handles without resizing
    // the node. React Flow must recalculate the connected edges in that case.
    updateNodeInternals(id)
  }, [id, anchorId, anchorIndex, updateNodeInternals])
  return (
    <div className="diagram-node" data-selected={selected || undefined}>
      <Card
        className="gap-3 overflow-visible"
        size="sm"
        variant={resolvedTheme === "light" ? "translucent" : "default"}
      >
        <CardHeader className="relative">
          {!anchorId && <EntityHandles isConnectable={isConnectable} />}
          <CardTitle className="truncate" title={data.entity.name}>
            {data.entity.name}
          </CardTitle>
        </CardHeader>
        {data.attributes.length > 0 && (
          <>
            <Separator />
            <CardContent className="flex flex-col gap-2 px-0">
              {data.attributes.map((attribute) => (
                <div
                  key={attribute.id}
                  className="relative flex min-w-0 items-center gap-2 px-(--card-spacing) font-mono text-xs"
                >
                  {attribute.id === anchorId && (
                    <EntityHandles isConnectable={isConnectable} />
                  )}
                  <span className="flex size-3 shrink-0 items-center justify-center">
                    {attribute.isPrimaryKey && (
                      <HugeiconsIcon
                        icon={Key01Icon}
                        className="size-3"
                        strokeWidth={1.5}
                        aria-label="Primary key"
                      />
                    )}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={attribute.name}
                  >
                    {attribute.name}
                    {attribute.isNullable ? "?" : ""}
                  </span>
                  <span
                    className={cn(
                      "max-w-24 truncate",
                      dataTypeColor(attribute.dataType)
                    )}
                    title={attribute.dataType}
                  >
                    {attribute.dataType}
                  </span>
                </div>
              ))}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
})
