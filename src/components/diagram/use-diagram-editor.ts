import { useEffect, useEffectEvent, useRef, useState } from "react"
import { z } from "zod"
import { useEdgesState, useNodesState } from "@xyflow/react"
import type { DiagramSnapshot } from "@/db/schema"
import type { DiagramCommand, DiagramEditorData } from "@/lib/diagram/model"
import {
  editDiagram,
  getDiagram,
  getDiagramRevision,
} from "@/lib/diagram/diagram.functions"
import { flowEdges, flowNodes } from "./flow-model"
import type { EntityFlowNode } from "./entity-node"
import type { RelationshipFlowEdge } from "./relationship-edge"
import { renameProject } from "@/lib/projects/project.functions"
import type { LayoutGeometry } from "@/lib/diagram/layout"

type CommandBuilder = (data: DiagramEditorData) => Promise<DiagramCommand>

const statusSchema = z.object({
  revision: z.number().int().nonnegative(),
  name: z.string(),
  canEdit: z.boolean(),
  canManageSharing: z.boolean(),
})

export function useDiagramEditor(
  initialData: DiagramEditorData,
  pauseLive = false
) {
  const [data, setData] = useState(initialData)
  const current = useRef(initialData)
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    revision: number
    snapshot: DiagramSnapshot
  } | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityFlowNode>(
    flowNodes(initialData.snapshot)
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationshipFlowEdge>(
    flowEdges(initialData.snapshot)
  )
  const hint = useRef<z.infer<typeof statusSchema> | null>(null)
  const syncing = useRef(false)
  const syncGeneration = useRef(0)
  const canSynchronize = useEffectEvent(
    () => !busy.current && !pauseLive && !nodes.some((node) => node.dragging)
  )
  const applyRemote = useEffectEvent((latest: DiagramEditorData) => {
    current.current = latest
    setData(latest)
    if (!preview) display(latest.snapshot)
  })
  const synchronize = useEffectEvent(async () => {
    const status = hint.current
    if (!status || syncing.current || !canSynchronize()) return
    if (
      status.revision === current.current.revision &&
      status.name === current.current.project.name &&
      status.canEdit === current.current.canEdit &&
      status.canManageSharing === current.current.canManageSharing
    ) {
      hint.current = null
      return
    }
    syncing.current = true
    const generation = syncGeneration.current
    const revision = current.current.revision
    try {
      const latest = await getDiagram({ data: current.current.project.id })
      if (
        generation !== syncGeneration.current ||
        !canSynchronize() ||
        current.current.revision !== revision
      )
        return
      if (!latest) {
        window.location.assign("/")
        return
      }
      // History previews remain visible while the latest revision advances.
      applyRemote(latest)
      if (hint.current === status) hint.current = null
    } catch {
      /* A pending hint is retried without interrupting manual work. */
    } finally {
      syncing.current = false
    }
  })
  useEffect(() => {
    syncGeneration.current++
    const source = new EventSource(
      `/api/projects/${initialData.project.id}/events`
    )
    source.addEventListener("project", (event) => {
      try {
        const parsed = statusSchema.safeParse(
          JSON.parse((event as MessageEvent<string>).data)
        )
        if (parsed.success) hint.current = parsed.data
      } catch {
        /* Ignore an invalid event; the next authorized event can refresh it. */
      }
    })
    source.addEventListener("revoked", () => {
      source.close()
      window.location.assign("/")
    })
    const interval = setInterval(() => {
      void synchronize()
    }, 500)
    return () => {
      syncGeneration.current++
      clearInterval(interval)
      source.close()
    }
  }, [initialData.project.id])

  function display(snapshot: DiagramSnapshot) {
    setNodes((previous) => {
      const selected = new Set(
        previous.filter((node) => node.selected).map(({ id }) => id)
      )
      return flowNodes(snapshot).map((node) => ({
        ...node,
        selected: selected.has(node.id),
      }))
    })
    setEdges((previous) => {
      const selected = new Set(
        previous.filter((edge) => edge.selected).map(({ id }) => id)
      )
      return flowEdges(snapshot).map((edge) => ({
        ...edge,
        selected: selected.has(edge.id),
      }))
    })
  }
  function accept(next: DiagramEditorData) {
    current.current = next
    setData(next)
    setPreview(null)
    display(next.snapshot)
  }
  async function commit(
    command: DiagramCommand | CommandBuilder
  ): Promise<boolean> {
    if (
      busy.current ||
      !current.current.canEdit ||
      (preview && (typeof command === "function" || command.type !== "restore"))
    )
      return false
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const before = current.current
      const generation = syncGeneration.current
      const mutation =
        typeof command === "function" ? await command(before) : command
      if (generation !== syncGeneration.current) return false
      const result = await editDiagram({
        data: {
          projectId: before.project.id,
          expectedRevision: before.revision,
          command: mutation,
        },
      })
      if (result.ok) {
        accept(result.data)
        return true
      }
      if (result.reason === "conflict") {
        accept(result.data)
        setError(
          "The diagram changed in another session. The latest version is loaded; try your change again."
        )
      } else {
        setData((value) => ({ ...value, canEdit: false }))
        current.current = { ...current.current, canEdit: false }
        display(current.current.snapshot)
        setError("Editing is no longer available. Reload to check your access.")
      }
      return false
    } catch {
      display(preview?.snapshot ?? current.current.snapshot)
      setError(
        typeof command === "function"
          ? "Could not arrange the diagram. Try again."
          : "Could not save the change. Try again."
      )
      return false
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  async function arrange(geometry: Array<LayoutGeometry>) {
    return commit(async (latest) => {
      const { arrangeDiagram } = await import("./auto-layout")
      const positions = await arrangeDiagram(latest.snapshot, geometry)
      return {
        type: "batch",
        summary: "Arranged diagram",
        commands: [{ type: "move_entities", positions }],
      }
    })
  }
  async function showRevision(revision: number) {
    if (busy.current) return
    if (revision === current.current.revision) {
      setPreview(null)
      display(current.current.snapshot)
      return
    }
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const snapshot = await getDiagramRevision({
        data: { projectId: current.current.project.id, revision },
      })
      if (!snapshot) throw new Error("Revision unavailable")
      setPreview({ revision, snapshot })
      display(snapshot)
    } catch {
      setError("Could not load this version. Try again.")
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  async function reload() {
    if (busy.current) return
    busy.current = true
    setPending(true)
    try {
      const latest = await getDiagram({ data: current.current.project.id })
      if (!latest) {
        window.location.assign("/")
        return
      }
      accept(latest)
      setError(null)
    } catch {
      setError("Could not reload the diagram. Try again.")
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  async function rename(name: string): Promise<boolean> {
    if (busy.current || !current.current.canEdit) return false
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const project = await renameProject({
        data: { projectId: current.current.project.id, name },
      })
      if (!project) {
        setError("You no longer have permission to rename this project.")
        return false
      }
      current.current = { ...current.current, project }
      setData((value) => ({ ...value, project }))
      return true
    } catch {
      setError("Could not rename the project. Try again.")
      return false
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return {
    data,
    pending,
    error,
    preview,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    commit,
    arrange,
    showRevision,
    reload,
    rename,
  }
}
