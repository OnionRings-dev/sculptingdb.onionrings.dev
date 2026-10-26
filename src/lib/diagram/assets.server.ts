import "@tanstack/react-start/server-only"
import { readFile } from "node:fs/promises"

// Direct Bun tests do not define Vite's build-time environment.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const ssr = import.meta.env?.SSR

function inlineBytes(url: string) {
  const comma = url.indexOf(",")
  if (
    !url.startsWith("data:") ||
    comma < 0 ||
    !url.slice(0, comma).endsWith(";base64")
  )
    throw new Error("Diagram asset is not inlined")
  return Buffer.from(url.slice(comma + 1), "base64")
}

export async function rendererAssets() {
  if (ssr) {
    const [wasm, font] = await Promise.all([
      import("@resvg/resvg-wasm/index_bg.wasm?url&inline"),
      import("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url&inline"),
    ])
    return { wasm: inlineBytes(wasm.default), font: inlineBytes(font.default) }
  }
  // Tests run directly in Bun, outside Vite's asset transformation.
  const [wasm, font] = await Promise.all([
    readFile(new URL(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))),
    readFile(
      new URL(
        import.meta
          .resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")
      )
    ),
  ])
  return { wasm, font }
}

export async function elkSource() {
  if (ssr) return (await import("elkjs/lib/elk.bundled.js?raw")).default
  return readFile(
    new URL(import.meta.resolve("elkjs/lib/elk.bundled.js")),
    "utf8"
  )
}
