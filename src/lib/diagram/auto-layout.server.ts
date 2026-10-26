import "@tanstack/react-start/server-only"
import { Worker } from "node:worker_threads"
import type { ElkNode } from "elkjs/lib/elk-api"
import type { DiagramSnapshot } from "@/db/schema"
import { createLayoutGraph, layoutPositions } from "./layout"
import type { LayoutOptions } from "./layout"
import { estimateGeometry } from "./spatial-layout"
import { elkSource } from "./assets.server"

let source: Promise<string> | undefined
const workerCode = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const moduleObject = { exports: {} };
const context = vm.createContext({ module: moduleObject, exports: moduleObject.exports, console, setTimeout, clearTimeout, inputJSON: JSON.stringify(workerData.graph) });
vm.runInContext('globalThis.global = globalThis', context);
try {
  vm.runInContext(workerData.source, context, { timeout: 5000 });
  const Constructor = moduleObject.exports.default || moduleObject.exports;
  const engine = new Constructor();
  engine.layout(vm.runInContext('JSON.parse(inputJSON)', context)).then(graph => parentPort.postMessage({ graph }), () => parentPort.postMessage({ failed: true }));
} catch { parentPort.postMessage({ failed: true }); }
`

export async function arrangeServerDiagram(
  snapshot: DiagramSnapshot,
  options: LayoutOptions
) {
  const graph = createLayoutGraph(snapshot, estimateGeometry(snapshot), options)
  const worker = new Worker(workerCode, {
    eval: true,
    workerData: { source: await (source ??= elkSource()), graph },
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await new Promise<ElkNode>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Layout timed out")), 30_000)
      worker.once("message", (message: { graph?: ElkNode }) =>
        message.graph
          ? resolve(message.graph)
          : reject(new Error("Layout failed"))
      )
      worker.once("error", () => reject(new Error("Layout worker failed")))
      worker.once("exit", () => reject(new Error("Layout worker stopped")))
    })
    return layoutPositions(
      result,
      snapshot.entities.map((entity) => entity.id)
    )
  } finally {
    clearTimeout(timeout)
    await worker.terminate()
  }
}
