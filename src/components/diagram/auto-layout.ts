import ELK from "elkjs/lib/elk-api"
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker"
import type { DiagramSnapshot } from "@/db/schema"
import { createLayoutGraph, layoutPositions } from "@/lib/diagram/layout"
import type { LayoutGeometry } from "@/lib/diagram/layout"

export async function arrangeDiagram(
  snapshot: DiagramSnapshot,
  geometry: Array<LayoutGeometry>
) {
  const graph = createLayoutGraph(snapshot, geometry)
  const worker = new ElkWorker()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const failed = new Promise<never>((_, reject) => {
      worker.addEventListener(
        "error",
        () => reject(new Error("Layout worker failed")),
        { once: true }
      )
      timeout = setTimeout(
        () => reject(new Error("Layout took too long")),
        30_000
      )
    })
    const engine = new ELK({ workerFactory: () => worker })
    const result = await Promise.race([engine.layout(graph), failed])
    return layoutPositions(
      result,
      snapshot.entities.map(({ id }) => id)
    )
  } finally {
    clearTimeout(timeout)
    worker.terminate()
  }
}
