import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import type { DiagramSnapshot } from "../src/db/schema"
import { spatialLayout } from "../src/lib/diagram/spatial-layout"
import {
  diagramSvg,
  renderDiagramView,
} from "../src/lib/diagram/diagram-view.server"
import { arrangeServerDiagram } from "../src/lib/diagram/auto-layout.server"

function fixture(): DiagramSnapshot {
  const first = randomUUID(),
    second = randomUUID()
  return {
    schemaVersion: 1,
    entities: [
      {
        id: first,
        name: 'User\u0000 <script>&"',
        description: null,
        positionX: -100,
        positionY: 20,
      },
      {
        id: second,
        name: "Project",
        description: null,
        positionX: -50,
        positionY: 40,
      },
    ],
    attributes: [
      {
        id: randomUUID(),
        entityId: first,
        name: "id",
        dataType: "uuid",
        description: null,
        isPrimaryKey: true,
        isNullable: false,
        isUnique: true,
        defaultValue: null,
        sortOrder: 1,
      },
      {
        id: randomUUID(),
        entityId: first,
        name: "name",
        dataType: "text",
        description: null,
        isPrimaryKey: false,
        isNullable: false,
        isUnique: false,
        defaultValue: null,
        sortOrder: 0,
      },
    ],
    relationships: [
      {
        id: randomUUID(),
        sourceEntityId: first,
        targetEntityId: second,
        sourceCardinality: "one",
        targetCardinality: "zero_or_many",
        label: "owns <&>",
        description: null,
      },
    ],
  }
}

test("spatial metadata preserves saved coordinates and detects overlapping card extents", () => {
  const snapshot = fixture(),
    original = structuredClone(snapshot)
  const layout = spatialLayout(snapshot)
  expect(layout.geometrySource).toBe("estimated")
  expect(layout.nodes[0]).toMatchObject({
    x: -100,
    y: 20,
    width: 240,
    height: 109,
    anchorY: 89,
  })
  expect(layout.overlapCount).toBe(1)
  expect(layout.overlaps).toEqual([
    {
      firstEntityId: snapshot.entities[0].id,
      secondEntityId: snapshot.entities[1].id,
    },
  ])
  expect(snapshot).toEqual(original)
})

test("diagram images escape text, use the curved paths and return a bounded PNG with explicit crop metadata", async () => {
  const snapshot = fixture(),
    bounds = { x: -200, y: -100, width: 1000, height: 700 }
  const svg = diagramSvg(snapshot).svg
  expect(svg).toContain("&lt;script&gt;&amp;&quot;")
  expect(svg).not.toContain("<script>")
  expect(svg).not.toContain("\u0000")
  expect(svg).toContain(" C ")
  const rendered = await renderDiagramView(snapshot, {
    bounds,
    width: 800,
    height: 600,
  })
  const png = Buffer.from(rendered.png, "base64")
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
  expect(png.readUInt32BE(16)).toBe(800)
  expect(png.readUInt32BE(20)).toBe(600)
  expect(rendered.metadata.view.bounds).toEqual(bounds)
  expect(rendered.metadata.nodes).toHaveLength(2)
  expect(() => diagramSvg(snapshot, { width: 100000 })).toThrow()
  expect(() =>
    diagramSvg(snapshot, { bounds: { ...bounds, width: 0 } })
  ).toThrow()
})

test("an empty graph still has an image and finite bounds", async () => {
  const view = await renderDiagramView(
    { schemaVersion: 1, entities: [], attributes: [], relationships: [] },
    { width: 320, height: 240 }
  )
  expect(view.metadata.nodes).toEqual([])
  expect(view.metadata.overlapCount).toBe(0)
  expect(view.metadata.view.bounds.width).toBeGreaterThan(0)
  expect(view.png.length).toBeGreaterThan(100)
})

test("server layout handles cycles and separates cards in both horizontal and vertical directions", async () => {
  const snapshot = fixture(),
    original = structuredClone(snapshot)
  snapshot.relationships.push({
    ...snapshot.relationships[0],
    id: randomUUID(),
    sourceEntityId: snapshot.entities[1].id,
    targetEntityId: snapshot.entities[0].id,
  })
  for (const direction of ["RIGHT", "DOWN"] as const) {
    const positions = await arrangeServerDiagram(snapshot, {
      direction,
      nodeSpacing: 100,
      layerSpacing: 180,
    })
    const arranged = {
      ...snapshot,
      entities: snapshot.entities.map((entity) => {
        const position = positions.find(
          (candidate) => candidate.id === entity.id
        )!
        return { ...entity, positionX: position.x, positionY: position.y }
      }),
    }
    expect(spatialLayout(arranged).overlapCount).toBe(0)
    expect(positions).toHaveLength(2)
  }
  expect(snapshot.entities).toEqual(original.entities)
})
