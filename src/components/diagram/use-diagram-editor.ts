import { useRef, useState } from "react"
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

export function useDiagramEditor(initialData: DiagramEditorData) {
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
  async function commit(command: DiagramCommand): Promise<boolean> {
    if (
      busy.current ||
      !current.current.canEdit ||
      (preview && command.type !== "restore")
    )
      return false
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await editDiagram({
        data: {
          projectId: current.current.project.id,
          expectedRevision: current.current.revision,
          command,
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
      setError("Could not save the change. Try again.")
      return false
    } finally {
      busy.current = false
      setPending(false)
    }
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
    showRevision,
    reload,
    rename,
  }
}
