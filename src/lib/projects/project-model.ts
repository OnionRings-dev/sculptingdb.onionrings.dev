import { z } from "zod"
import type { AccountUser } from "./types"

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(120)
export const renameProjectSchema = z.object({
  projectId: z.uuid(),
  name: projectNameSchema,
})
export const sharingRequestSchema = z.object({ projectId: z.uuid() })
export const searchPeopleSchema = sharingRequestSchema.extend({
  query: z.string().trim().max(254),
})
export const invitePeopleSchema = sharingRequestSchema.extend({
  emails: z
    .array(z.string().trim().toLowerCase().pipe(z.email()))
    .min(1)
    .max(20),
  role: z.enum(["view", "edit"]),
})
export const removeMemberSchema = sharingRequestSchema.extend({
  userId: z.string().min(1).max(256),
})
export const changeMemberSchema = removeMemberSchema.extend({
  role: z.enum(["view", "edit"]),
})
export type ProjectRole = "view" | "edit"
export type ProjectSharing = {
  owner: AccountUser
  members: Array<AccountUser & { role: ProjectRole }>
}
