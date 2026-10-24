import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import type { Node, NodeProps } from "@xyflow/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Key01Icon } from "@hugeicons/core-free-icons"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { Attribute, Entity } from "@/lib/diagram/model"

export type EntityFlowNode = Node<
  { entity: Entity; attributes: Array<Attribute> },
  "entity"
>

export const EntityNode = memo(function EntityNodeView({
  data,
  selected,
  isConnectable,
}: NodeProps<EntityFlowNode>) {
  return (
    <div className="diagram-node" data-selected={selected || undefined}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
      />
      <Card className="gap-3" size="sm">
        <CardHeader>
          <CardTitle className="truncate" title={data.entity.name}>
            {data.entity.name}
          </CardTitle>
        </CardHeader>
        {data.attributes.length > 0 && (
          <>
            <Separator />
            <CardContent className="flex flex-col gap-2">
              {data.attributes.map((attribute) => (
                <div
                  key={attribute.id}
                  className="flex min-w-0 items-center gap-2 font-mono text-xs"
                >
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
                    className="max-w-24 truncate text-muted-foreground"
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
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
      />
    </div>
  )
})
