import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { db, requireUser } from "@/lib/auth/auth.server"
import {
  createUntitledProject,
  deleteOwnedProject,
  findAccessibleProject,
  listAccessibleProjects,
  renameAccessibleProject,
} from "./project-store.server"
import {
  changeMemberSchema,
  invitePeopleSchema,
  renameProjectSchema,
  removeMemberSchema,
  searchPeopleSchema,
  sharingRequestSchema,
} from "./project-model"
import {
  inviteProjectPeople,
  loadProjectSharing,
  searchProjectPeople,
  removeProjectMember,
  updateProjectMember,
} from "./sharing-store.server"

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

export const renameProject = createServerFn({ method: "POST" })
  .validator((data: unknown) => renameProjectSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return renameAccessibleProject(db, user.id, data)
  })

export const getProjectSharing = createServerFn({ method: "GET" })
  .validator((data: unknown) => sharingRequestSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return loadProjectSharing(db, user.id, data.projectId)
  })

export const searchPeople = createServerFn({ method: "GET" })
  .validator((data: unknown) => searchPeopleSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return searchProjectPeople(db, user.id, data)
  })

export const invitePeople = createServerFn({ method: "POST" })
  .validator((data: unknown) => invitePeopleSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return inviteProjectPeople(db, user.id, data)
  })

export const changeMemberRole = createServerFn({ method: "POST" })
  .validator((data: unknown) => changeMemberSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return updateProjectMember(db, user.id, data)
  })

export const removeMember = createServerFn({ method: "POST" })
  .validator((data: unknown) => removeMemberSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return removeProjectMember(db, user.id, data)
  })
