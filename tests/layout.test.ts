import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { DiagramSnapshot } from "../src/db/schema"
import { createLayoutGraph, layoutPositions } from "../src/lib/diagram/layout"
import type { LayoutGeometry } from "../src/lib/diagram/layout"

// Node runs ELK's in-process adapter; the editor uses its real Web Worker.
// Bun's global Worker selects a different branch in ELK's bundled adapter.
function calculate(snapshot: DiagramSnapshot, geometry: Array<LayoutGeometry>) {
  const script = `
    import ELK from "elkjs/lib/elk.bundled.js";
    import {createLayoutGraph, layoutPositions} from "./src/lib/diagram/layout.ts";
    let input=""; for await(const chunk of process.stdin) input+=chunk;
    const {snapshot,geometry}=JSON.parse(input);
    const result=await new ELK().layout(createLayoutGraph(snapshot,geometry));
    console.log(JSON.stringify(layoutPositions(result,snapshot.entities.map(e=>e.id))));
  `
  return JSON.parse(
    execFileSync("node", ["--input-type=module", "-e", script], {
      input: JSON.stringify({ snapshot, geometry }),
      timeout: 10_000,
      encoding: "utf8",
    })
  ) as Array<{ id: string; x: number; y: number }>
}

function fixture() {
  const entities = [
    "User",
    "Session",
    "Organization",
    "Workspace",
    "Member",
    "Invitation",
    "Account",
    "Verification",
  ].map((name) => ({
    id: randomUUID(),
    name,
    description: null,
    positionX: 0,
    positionY: 0,
  }))
  const links = [
    [0, 1],
    [0, 4],
    [0, 5],
    [0, 6],
    [1, 2],
    [2, 3],
    [2, 4],
    [2, 5],
    [3, 4],
  ]
  const snapshot: DiagramSnapshot = {
    schemaVersion: 1,
    entities,
    attributes: [],
    relationships: links.map(([source, target]) => ({
      id: randomUUID(),
      sourceEntityId: entities[source].id,
      targetEntityId: entities[target].id,
      label: "A relationship label",
      description: null,
      sourceCardinality: "one",
      targetCardinality: "zero_or_many",
    })),
  }
  const geometry = entities.map(({ id }, index) => ({
    id,
    width: 240,
    height: index % 2 ? 100 : 360,
    anchorY: index === 4 ? 112 : 64,
  }))
  return { snapshot, geometry }
}

function expectSeparated(
  positions: ReturnType<typeof calculate>,
  geometry: Array<LayoutGeometry>
) {
  expect(positions).toHaveLength(geometry.length)
  for (let i = 0; i < positions.length; i++) {
    const a = positions[i],
      aSize = geometry.find((n) => n.id === a.id)!
    expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true)
    for (let j = i + 1; j < positions.length; j++) {
      const b = positions[j],
        bSize = geometry.find((n) => n.id === b.id)!
      expect(
        a.x + aSize.width <= b.x ||
          b.x + bSize.width <= a.x ||
          a.y + aSize.height <= b.y ||
          b.y + bSize.height <= a.y
      ).toBe(true)
    }
  }
}

test("layout separates differently sized cards, reserves label space and keeps disconnected entities", () => {
  const { snapshot, geometry } = fixture(),
    original = structuredClone(snapshot)
  const positions = calculate(snapshot, geometry)
  expectSeparated(positions, geometry)
  expect(new Set(positions.map((p) => p.id))).toEqual(
    new Set(snapshot.entities.map((e) => e.id))
  )
  expect(snapshot).toEqual(original)
  const graph = createLayoutGraph(snapshot, geometry)
  const port = graph.children!.find((n) => n.id === geometry[4].id)!.ports![0]
  expect(port.y).toBe(112)
  expect(graph.edges![0].labels![0].width).toBeGreaterThan(100)
})

test("cycles, parallel relationships and self-relations remain layoutable", () => {
  const { snapshot, geometry } = fixture()
  snapshot.relationships.push(
    { ...snapshot.relationships[0], id: randomUUID() },
    {
      ...snapshot.relationships[0],
      id: randomUUID(),
      sourceEntityId: snapshot.entities[2].id,
      targetEntityId: snapshot.entities[0].id,
    },
    {
      ...snapshot.relationships[0],
      id: randomUUID(),
      sourceEntityId: snapshot.entities[0].id,
      targetEntityId: snapshot.entities[0].id,
    }
  )
  expectSeparated(calculate(snapshot, geometry), geometry)
})

test("repeating layout is stable regardless of saved positions and array order", () => {
  const { snapshot, geometry } = fixture()
  const first = calculate(snapshot, geometry)
  snapshot.entities.reverse().forEach((e) => {
    e.positionX = 900
    e.positionY = -400
  })
  snapshot.relationships.reverse()
  const second = calculate(snapshot, geometry.reverse())
  expect(new Map(second.map((p) => [p.id, p]))).toEqual(
    new Map(first.map((p) => [p.id, p]))
  )
})

test("missing measurements and incomplete results fail before a partial move can be saved", () => {
  const { snapshot, geometry } = fixture()
  expect(() => createLayoutGraph(snapshot, geometry.slice(1))).toThrow(
    "dimensions"
  )
  expect(() =>
    createLayoutGraph(
      snapshot,
      geometry.map((n) => ({ ...n, width: NaN }))
    )
  ).toThrow("dimensions")
  expect(() =>
    layoutPositions(
      { id: "diagram", children: [] },
      snapshot.entities.map((e) => e.id)
    )
  ).toThrow("Incomplete")
  expect(layoutPositions({ id: "diagram", children: [] }, [])).toEqual([])
})
