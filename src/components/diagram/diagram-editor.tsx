import { useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowExpand01Icon,
  ArrowLeft01Icon,
  Cancel01Icon,
  Delete02Icon,
  Edit02Icon,
  HistoryIcon,
  Link01Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons"
import { AccountMenu } from "@/components/account/account-menu"
import { ProjectTitle } from "@/components/projects/project-title"
import { ProjectSharing } from "@/components/projects/project-sharing"
import { McpConnection } from "./mcp-connection"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AccountUser } from "@/lib/projects/types"
import type {
  Attribute,
  DiagramEditorData,
  Entity,
  Relationship,
} from "@/lib/diagram/model"
import { EntityNode } from "./entity-node"
import type { EntityFlowNode } from "./entity-node"
import { RelationshipEdge } from "./relationship-edge"
import type { RelationshipFlowEdge } from "./relationship-edge"
import { EntityDialog } from "./entity-dialog"
import { RelationshipDialog } from "./relationship-dialog"
import { HistoryPanel } from "./history-panel"
import { useDiagramEditor } from "./use-diagram-editor"

const nodeTypes = { entity: EntityNode }
const edgeTypes = { relationship: RelationshipEdge }

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  pressed,
}: {
  label: string
  icon: React.ComponentProps<typeof HugeiconsIcon>["icon"]
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        disabled={disabled}
      >
        <HugeiconsIcon icon={icon} strokeWidth={1.5} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function DiagramEditor({
  initialData,
  user,
}: {
  initialData: DiagramEditorData
  user: AccountUser
}) {
  return (
    <ReactFlowProvider>
      <TooltipProvider>
        <EditorCanvas initialData={initialData} user={user} />
      </TooltipProvider>
    </ReactFlowProvider>
  )
}

function EditorCanvas({
  initialData,
  user,
}: {
  initialData: DiagramEditorData
  user: AccountUser
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [entityDraft, setEntityDraft] = useState<{
    entity: Entity
    attributes: Array<Attribute>
    isNew: boolean
  } | null>(null)
  const [relationshipDraft, setRelationshipDraft] =
    useState<Relationship | null>(null)
  const editor = useDiagramEditor(
    initialData,
    entityDraft !== null || relationshipDraft !== null
  )
  const { data, nodes, edges, pending, preview, error } = editor
  const flow = useReactFlow<EntityFlowNode, RelationshipFlowEdge>()
  const surface = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const snapshot = preview?.snapshot ?? data.snapshot
  const editable = data.canEdit && !preview && !pending
  const selectedNodes = nodes.filter((node) => node.selected)
  const selectedEdges = edges.filter((edge) => edge.selected)
  const selected = selectedNodes.length + selectedEdges.length > 0

  function newEntity() {
    if (!editable || !surface.current) return
    const bounds = surface.current.getBoundingClientRect()
    const position = flow.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    })
    const startX = position.x - 120
    let x = startX
    let y = position.y - 50
    for (let attempt = 0; attempt <= snapshot.entities.length; attempt++) {
      if (
        !snapshot.entities.some(
          (entity) =>
            Math.abs(entity.positionX - x) < 260 &&
            Math.abs(entity.positionY - y) < 180
        )
      )
        break
      x += 300
      if (x > startX + 600) {
        x = startX
        y += 220
      }
    }
    setEntityDraft({
      entity: {
        id: crypto.randomUUID(),
        name: "Entity",
        description: null,
        positionX: x,
        positionY: y,
      },
      attributes: [],
      isNew: true,
    })
  }
  function editEntity(entityId: string) {
    if (!editable) return
    const entity = snapshot.entities.find(({ id }) => id === entityId)
    if (entity)
      setEntityDraft({
        entity,
        attributes: snapshot.attributes.filter(
          (attribute) => attribute.entityId === entityId
        ),
        isNew: false,
      })
  }
  function newRelationship() {
    if (!editable || !snapshot.entities.length) return
    setRelationshipDraft({
      id: crypto.randomUUID(),
      sourceEntityId: snapshot.entities[0].id,
      targetEntityId: snapshot.entities[1]?.id ?? snapshot.entities[0].id,
      sourceCardinality: "one",
      targetCardinality: "zero_or_many",
      label: null,
      description: null,
    })
  }
  function editSelection() {
    if (selectedNodes.length === 1 && !selectedEdges.length)
      editEntity(selectedNodes[0].id)
    else if (selectedEdges.length === 1 && !selectedNodes.length && editable)
      setRelationshipDraft(selectedEdges[0].data!.relationship)
  }
  function deleteSelection() {
    if (editable)
      void editor.commit({
        type: "delete_selection",
        entityIds: selectedNodes.map(({ id }) => id),
        relationshipIds: selectedEdges.map(({ id }) => id),
      })
  }

  return (
    <main
      className="diagram-editor flex h-svh w-full overflow-hidden"
      aria-label="Diagram editor"
    >
      {historyOpen && (
        <HistoryPanel
          history={data.history}
          selectedRevision={preview?.revision ?? data.revision}
          pending={pending}
          onClose={() => setHistoryOpen(false)}
          onSelect={(revision) => {
            void editor.showRevision(revision)
          }}
        />
      )}
      <div ref={surface} className="@container/canvas relative min-w-0 flex-1">
        <ReactFlow<EntityFlowNode, RelationshipFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={(changes) => {
            editor.onNodesChange(changes)
            const positions = changes.flatMap((change) =>
              change.type === "position" &&
              change.dragging === false &&
              change.position
                ? [
                    {
                      id: change.id,
                      x: change.position.x,
                      y: change.position.y,
                    },
                  ]
                : []
            )
            // React Flow emits completed positions for both dragging and keyboard moves.
            if (editable && positions.length)
              void editor.commit({ type: "move_entities", positions })
          }}
          onEdgesChange={editor.onEdgesChange}
          onNodeDoubleClick={(_, node) => editEntity(node.id)}
          onEdgeDoubleClick={(_, edge) => {
            if (editable) setRelationshipDraft(edge.data!.relationship)
          }}
          onConnect={(connection) => {
            if (editable)
              void editor.commit({
                type: "upsert_relationship",
                relationship: {
                  id: crypto.randomUUID(),
                  sourceEntityId: connection.source,
                  targetEntityId: connection.target,
                  sourceCardinality: "one",
                  targetCardinality: "zero_or_many",
                  label: null,
                  description: null,
                },
              })
          }}
          onBeforeDelete={async ({
            nodes: deletedNodes,
            edges: deletedEdges,
          }) => {
            if (editable)
              await editor.commit({
                type: "delete_selection",
                entityIds: deletedNodes.map(({ id }) => id),
                relationshipIds: deletedEdges.map(({ id }) => id),
              })
            return false
          }}
          nodesDraggable={editable}
          nodesConnectable={editable}
          edgesReconnectable={false}
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          colorMode={resolvedTheme === "light" ? "light" : "dark"}
          minZoom={0.15}
          maxZoom={2}
          panOnScroll
          panOnScrollSpeed={1}
          zoomOnScroll={false}
          zoomOnPinch
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        >
          <Background gap={20} size={1} color="var(--border)" />
        </ReactFlow>
        <header className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap items-start justify-between gap-3 @sm/canvas:flex-nowrap">
          <div className="diagram-toolbar pointer-events-auto flex w-full min-w-0 items-center gap-1 p-1 @sm/canvas:w-auto">
            <Button
              variant="ghost"
              size="icon"
              render={<Link to="/" />}
              nativeButton={false}
              aria-label="Back to projects"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.5} />
            </Button>
            <IconButton
              label="History"
              icon={HistoryIcon}
              onClick={() => setHistoryOpen((open) => !open)}
              pressed={historyOpen}
            />
            <ProjectTitle
              name={data.project.name}
              canEdit={data.canEdit}
              pending={pending}
              onRename={editor.rename}
            />
            {pending && <Spinner className="mr-2" />}
          </div>
          <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2">
            <div className="diagram-toolbar p-1">
              <McpConnection projectId={data.project.id} />
            </div>
            {data.canManageSharing && (
              <div className="diagram-toolbar p-1">
                <ProjectSharing projectId={data.project.id} />
              </div>
            )}
            <div className="ml-2">
              <AccountMenu user={user} />
            </div>
          </div>
        </header>
        {preview && (
          <div className="pointer-events-none absolute inset-x-4 top-32 flex justify-center @sm/canvas:top-20">
            <div className="diagram-toolbar pointer-events-auto flex flex-wrap items-center justify-center gap-2 p-2">
              <span className="text-xs text-muted-foreground">
                Version {preview.revision}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void editor.showRevision(data.revision)
                }}
                disabled={pending}
              >
                Current
              </Button>
              {data.canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void editor.commit({
                      type: "restore",
                      revision: preview.revision,
                    })
                  }}
                  disabled={pending}
                >
                  Restore
                </Button>
              )}
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-x-4 top-48 flex justify-center @sm/canvas:top-32">
            <Alert variant="destructive" className="max-w-md">
              <AlertDescription>{error}</AlertDescription>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  void editor.reload()
                }}
              >
                Reload
              </Button>
            </Alert>
          </div>
        )}
        {!snapshot.entities.length && !preview && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {data.canEdit ? (
              <Button
                variant="outline"
                className="pointer-events-auto"
                onClick={newEntity}
                disabled={pending}
              >
                <HugeiconsIcon
                  icon={Add01Icon}
                  data-icon="inline-start"
                  strokeWidth={1.5}
                />
                Entity
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Empty diagram</p>
            )}
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-4 bottom-8 flex flex-wrap items-end justify-between gap-3">
          <div className="diagram-toolbar pointer-events-auto flex items-center p-1">
            <IconButton
              label="Zoom out"
              icon={ZoomOutAreaIcon}
              onClick={() => {
                void flow.zoomOut()
              }}
            />
            <IconButton
              label="Zoom in"
              icon={ZoomInAreaIcon}
              onClick={() => {
                void flow.zoomIn()
              }}
            />
            <IconButton
              label="Fit diagram"
              icon={ArrowExpand01Icon}
              onClick={() => {
                void flow.fitView({ padding: 0.3, maxZoom: 1 })
              }}
            />
          </div>
          {data.canEdit && !preview && (
            <div className="diagram-toolbar pointer-events-auto flex items-center gap-1 p-1">
              {selected ? (
                <>
                  <IconButton
                    label="Edit selection"
                    icon={Edit02Icon}
                    onClick={editSelection}
                    disabled={
                      !editable ||
                      selectedNodes.length + selectedEdges.length !== 1
                    }
                  />
                  <IconButton
                    label="Delete selection"
                    icon={Delete02Icon}
                    onClick={deleteSelection}
                    disabled={!editable}
                  />
                  <IconButton
                    label="Clear selection"
                    icon={Cancel01Icon}
                    onClick={() => {
                      flow.setNodes((current) =>
                        current.map((node) => ({ ...node, selected: false }))
                      )
                      flow.setEdges((current) =>
                        current.map((edge) => ({ ...edge, selected: false }))
                      )
                    }}
                  />
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    onClick={newEntity}
                    disabled={!editable}
                    aria-label="Add entity"
                  >
                    <HugeiconsIcon
                      icon={Add01Icon}
                      data-icon="inline-start"
                      strokeWidth={1.5}
                    />
                    Entity
                  </Button>
                  <IconButton
                    label="Add relationship"
                    icon={Link01Icon}
                    onClick={newRelationship}
                    disabled={!editable || !snapshot.entities.length}
                  />
                </>
              )}
            </div>
          )}
          {!data.canEdit && (
            <span className="text-xs text-muted-foreground">View only</span>
          )}
        </div>
        {entityDraft && (
          <EntityDialog
            key={entityDraft.entity.id}
            {...entityDraft}
            pending={pending}
            saveError={error}
            onClose={() => setEntityDraft(null)}
            onSave={editor.commit}
          />
        )}
        {relationshipDraft && (
          <RelationshipDialog
            key={relationshipDraft.id}
            relationship={relationshipDraft}
            entities={snapshot.entities}
            pending={pending}
            saveError={error}
            onClose={() => setRelationshipDraft(null)}
            onSave={editor.commit}
          />
        )}
      </div>
    </main>
  )
}
