import "@tanstack/react-start/server-only"
import type { Database } from "@/lib/mcp/access.server"
import { projectAccess } from "@/lib/mcp/access.server"

export async function projectEvents(
  request: Request,
  database: Database,
  userId: string,
  projectId: string
) {
  if (!(await projectAccess(database, userId, projectId)))
    return new Response("Not found", { status: 404 })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop: () => void = () => {}
  const isStopped = () => stopped
  let previous = ""
  let ticks = 0
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      stop = () => {
        if (isStopped()) return
        stopped = true
        clearTimeout(timer)
        request.signal.removeEventListener("abort", stop)
        try {
          controller.close()
        } catch {
          /* Reader cancelled. */
        }
      }
      request.signal.addEventListener("abort", stop, { once: true })
      async function poll() {
        if (isStopped()) return
        try {
          const access = await projectAccess(database, userId, projectId)
          if (isStopped()) return
          if (!access) {
            controller.enqueue(encoder.encode("event: revoked\ndata: {}\n\n"))
            stop()
            return
          }
          const data = JSON.stringify({
            revision: access.revision,
            name: access.name,
            canEdit: access.canEdit,
            canManageSharing: access.canManage,
            updatedAt: access.updatedAt.toISOString(),
          })
          ticks++
          if (data !== previous) {
            controller.enqueue(
              encoder.encode(`event: project\ndata: ${data}\n\n`)
            )
            previous = data
          } else if (ticks % 15 === 0)
            controller.enqueue(encoder.encode(": keepalive\n\n"))
          if (ticks >= 300) {
            stop()
            return
          }
          timer = setTimeout(() => {
            void poll()
          }, 1000)
        } catch {
          stop()
        }
      }
      if (request.signal.aborted) stop()
      else void poll()
    },
    cancel() {
      stop()
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
