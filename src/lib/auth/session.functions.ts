import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { getCurrentUser } from "./auth.server"

export const getUser = createServerFn({ method: "GET" }).handler(() =>
  getCurrentUser(getRequestHeaders())
)
