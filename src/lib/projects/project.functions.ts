import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { db, requireUser } from "@/lib/auth/auth.server"
import {
  createUntitledProject,
  deleteOwnedProject,
  findAccessibleProject,
  listAccessibleProjects,
} from "./project-store.server"

export const getProjects = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser(getRequestHeaders())
    return listAccessibleProjects(db, user.id)
  }
)

export const createProject = createServerFn({ method: "POST" }).handler(
  async () => {
    const user = await requireUser(getRequestHeaders())
    return createUntitledProject(db, user.id)
  }
)

export const getProject = createServerFn({ method: "GET" })
  .validator((data: unknown) => (typeof data === "string" ? data : ""))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return findAccessibleProject(db, user.id, data)
  })

export const deleteProject = createServerFn({ method: "POST" })
  .validator((data: unknown) => (typeof data === "string" ? data : ""))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return deleteOwnedProject(db, user.id, data)
  })
