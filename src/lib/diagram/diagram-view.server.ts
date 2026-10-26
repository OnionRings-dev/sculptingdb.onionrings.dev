import "@tanstack/react-start/server-only"
import { Resvg, initWasm } from "@resvg/resvg-wasm"
import { z } from "zod"
import type { DiagramSnapshot } from "@/db/schema"
import { cardinalities } from "./model"
import { rendererAssets } from "./assets.server"
import { spatialLayout } from "./spatial-layout"
import { relationshipLanes, relationshipPath } from "./relationship-path"

export const viewOptionsSchema = z
  .object({
    bounds: z
      .object({
        x: z.number().finite().min(-2_000_000).max(2_000_000),
        y: z.number().finite().min(-2_000_000).max(2_000_000),
        width: z.number().finite().min(1).max(2_000_000),
        height: z.number().finite().min(1).max(2_000_000),
      })
      .strict()
      .optional(),
    width: z.number().int().min(320).max(1600).default(1600),
    height: z.number().int().min(240).max(1000).default(1000),
  })
  .strict()
export type ViewOptions = z.input<typeof viewOptionsSchema>
let renderer: Promise<Uint8Array> | undefined
async function loadRenderer() {
  renderer ??= rendererAssets()
    .then(async ({ wasm, font }) => {
      await initWasm(wasm)
      return font
    })
    .catch((error: unknown) => {
      renderer = undefined
      throw error
    })
  return renderer
}
const escape = (text: string) =>
  text
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 || code === 9 || code === 10 || code === 13
    })
    .join("")
    .replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[char]!
    )
const shorten = (text: string, length: number) =>
  escape(text.length > length ? `${text.slice(0, length - 1)}…` : text)
function label(x: number, y: number, text: string) {
  const width = Math.min(text.length, 50) * 8 + 10
  return `<g><rect x="${x - width / 2}" y="${y - 12}" width="${width}" height="20" rx="3" fill="#101010"/><text x="${x}" y="${y + 3}" text-anchor="middle" font-size="14" fill="#bdbdbd">${shorten(text, 50)}</text></g>`
}

export function diagramSvg(
  snapshot: DiagramSnapshot,
  options: ViewOptions = {}
) {
  options = viewOptionsSchema.parse(options)
  const layout = spatialLayout(snapshot)
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]))
  const lanes = relationshipLanes(snapshot.relationships)
  const edges = snapshot.relationships.map((relationship) => {
    const source = nodes.get(relationship.sourceEntityId)!,
      target = nodes.get(relationship.targetEntityId)!
    const cable = relationshipPath(
      { ...source, y: source.y + source.anchorY },
      { ...target, y: target.y + target.anchorY },
      lanes.get(relationship.id),
      source.id === target.id
    )
    return { relationship, cable }
  })
  const allBounds = [layout.bounds, ...edges.map((edge) => edge.cable.bounds)]
  const x = Math.min(...allBounds.map((box) => box.x)) - 48,
    y = Math.min(...allBounds.map((box) => box.y)) - 48
  const bounds = options.bounds ?? {
    x,
    y,
    width: Math.max(...allBounds.map((box) => box.x + box.width)) - x + 48,
    height: Math.max(...allBounds.map((box) => box.y + box.height)) - y + 48,
  }
  const width = options.width ?? 1600,
    height = options.height ?? 1000
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" font-family="Geist" preserveAspectRatio="xMidYMid meet">`,
  ]
  parts.push(
    `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#101010"/>`
  )
  for (const { cable } of edges)
    parts.push(
      `<path d="${cable.path}" fill="none" stroke="#777777" stroke-width="1.5" stroke-linecap="round"/>`
    )
  for (const { relationship, cable } of edges) {
    if (relationship.label)
      parts.push(label(cable.label.x, cable.label.y, relationship.label))
    const source = cardinalities.find(
      (entry) => entry.value === relationship.sourceCardinality
    )!.label
    const target = cardinalities.find(
      (entry) => entry.value === relationship.targetCardinality
    )!.label
    parts.push(
      label(cable.sourceLabel.x, cable.sourceLabel.y, source),
      label(cable.targetLabel.x, cable.targetLabel.y, target)
    )
  }
  for (const node of layout.nodes) {
    const attributes = snapshot.attributes
      .filter((attribute) => attribute.entityId === node.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    parts.push(
      `<g transform="translate(${node.x},${node.y})"><rect width="${node.width}" height="${node.height}" rx="10" fill="#1c1c1c" stroke="#414141"/><text x="12" y="28" font-size="18" font-weight="500" fill="#f5f5f5">${shorten(node.name, 23)}</text>`
    )
    if (attributes.length)
      parts.push(`<path d="M 0,44 H 240" stroke="#414141"/>`)
    attributes.forEach((attribute, index) => {
      const baseline = 69 + index * 24
      if (attribute.isPrimaryKey)
        parts.push(
          `<text x="8" y="${baseline}" font-size="8" fill="#bdbdbd">PK</text>`
        )
      parts.push(
        `<text x="28" y="${baseline}" font-size="12" fill="#eeeeee">${shorten(attribute.name + (attribute.isNullable ? "?" : ""), 19)}</text><text x="228" y="${baseline}" text-anchor="end" font-size="11" fill="#8cb8c6">${shorten(attribute.dataType, 12)}</text>`
      )
    })
    parts.push(`</g>`)
  }
  if (!layout.nodes.length)
    parts.push(
      `<text x="${bounds.x + bounds.width / 2}" y="${bounds.y + bounds.height / 2}" text-anchor="middle" font-size="20" fill="#bdbdbd">Empty diagram</text>`
    )
  parts.push("</svg>")
  return {
    svg: parts.join(""),
    metadata: {
      ...layout,
      view: { bounds, width, height },
      imageDescription:
        "Server-rendered overview of the saved diagram, not a browser screenshot. Card dimensions are estimated; pan, zoom and selection are not captured.",
    },
  }
}

export async function renderDiagramView(
  snapshot: DiagramSnapshot,
  options: ViewOptions = {}
) {
  const view = diagramSvg(snapshot, options)
  const font = await loadRenderer()
  const document = new Resvg(view.svg, {
    background: "#101010",
    font: { fontBuffers: [font], defaultFontFamily: "Geist" },
  })
  try {
    const image = document.render()
    try {
      return {
        metadata: view.metadata,
        png: Buffer.from(image.asPng()).toString("base64"),
      }
    } finally {
      image.free()
    }
  } finally {
    document.free()
  }
}
