import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { z } from "zod"
import { auth, db, requireUser } from "@/lib/auth/auth.server"
import { projectAccess } from "./access.server"
import { revokeAuthorization } from "./authorization-store.server"

import {
  disconnectClient,
  prepareAppConnection,
  projectConnectionStatus,
  setClientProjectAccess,
} from "./connection-store.server"

const requestSchema = z.object({ projectId: z.uuid() })
const oauthQuerySchema = z.object({ oauthQuery: z.string().min(1).max(16_000) })

export const getMcpConnection = createServerFn({ method: "POST" })
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    const origin = new URL(auth.options.baseURL).origin
    if (!(await projectAccess(db, user.id, data.projectId))) return null
    return {
      resource: await prepareAppConnection(db, origin),
      status: await projectConnectionStatus(db, user.id, data.projectId),
    }
  })
export const getMcpStatus = createServerFn({ method: "GET" })
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return projectConnectionStatus(db, user.id, data.projectId)
  })
export const disconnectMcp = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    requestSchema.extend({ authorizationId: z.uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return revokeAuthorization(
      db,
      user.id,
      data.projectId,
      data.authorizationId,
      new URL(auth.options.baseURL).origin
    )
  })

export const setMcpProjectAccess = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    requestSchema
      .extend({ connectionId: z.uuid(), enabled: z.boolean() })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return setClientProjectAccess(
      db,
      user.id,
      data.projectId,
      data.connectionId,
      data.enabled
    )
  })
export const disconnectMcpClient = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ connectionId: z.uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return disconnectClient(
      db,
      user.id,
      data.connectionId,
      new URL(auth.options.baseURL).origin
    )
  })

export const getMcpConsent = createServerFn({ method: "GET" })
  .validator((data: unknown) => oauthQuerySchema.parse(data))
  .handler(async ({ data }) => {
    const { readMcpConsent } = await import("./consent.server")
    return readMcpConsent(data.oauthQuery)
  })

export const decideMcpConsent = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    oauthQuerySchema.extend({ accept: z.boolean() }).parse(data)
  )
  .handler(async ({ data }) => {
    const { completeMcpConsent } = await import("./consent.server")
    return completeMcpConsent(data.oauthQuery, data.accept)
  })
