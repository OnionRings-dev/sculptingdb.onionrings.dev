import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { db, requireUser } from "@/lib/auth/auth.server"
import { mutationSchema, revisionRequestSchema } from "./model"
import type { DiagramMutation } from "./model"
import {
  changeDiagram,
  loadDiagram,
  loadRevision,
} from "./diagram-store.server"

export const getDiagram = createServerFn({ method: "GET" })
  .validator((data: unknown) => (typeof data === "string" ? data : ""))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return loadDiagram(db, user.id, data)
  })

export const editDiagram = createServerFn({ method: "POST" })
  .validator((data: DiagramMutation) => mutationSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return changeDiagram(db, user.id, data)
  })

export const getDiagramRevision = createServerFn({ method: "GET" })
  .validator((data: { projectId: string; revision: number }) =>
    revisionRequestSchema.parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return loadRevision(db, user.id, data.projectId, data.revision)
  })
