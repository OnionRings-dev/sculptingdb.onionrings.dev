import "@tanstack/react-start/server-only"

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { createAppAuth } from "./config.server"
import { readAuthEnv } from "./env.server"
import * as schema from "@/db/schema"

const env = readAuthEnv(process.env)
const pool = new Pool({ connectionString: env.databaseURL })
export const db = drizzle(pool, { schema })
export const auth = createAppAuth(env, db)

export async function getCurrentUser(headers: Headers) {
  const session = await auth.api.getSession({ headers })
  // Session credentials must not be serialized into router data.
  return session ? session.user : null
}

export async function requireUser(headers: Headers) {
  const user = await getCurrentUser(headers)
  if (!user) throw new Response("Unauthorized", { status: 401 })
  return user
}
