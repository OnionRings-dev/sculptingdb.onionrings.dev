import { expect, test } from "bun:test"
import {
  relationshipLanes,
  relationshipPath,
} from "../src/lib/diagram/relationship-path"

const left = { x: 0, y: 60, width: 240 }
const right = { x: 500, y: 180, width: 240 }

test("cables choose facing sides in either direction and preserve field-row height", () => {
  const forward = relationshipPath(left, right)
  const backward = relationshipPath(right, left)
  expect(forward.path).toMatch(/^M 240,60 C /)
  expect(forward.path).toEndWith("500,180")
  expect(backward.path).toMatch(/^M 500,180 C /)
  expect(backward.path).toEndWith("240,60")
  expect(forward.label).toEqual(backward.label)
  expect(forward.sourceLabel.x).toBeGreaterThan(240)
  expect(forward.targetLabel.x).toBeLessThan(500)
  expect(backward.sourceLabel.x).toBeLessThan(500)
  expect(backward.targetLabel.x).toBeGreaterThan(240)
})

test("stacked entities use an exterior curve and short links keep endpoint labels in order", () => {
  const stacked = relationshipPath(left, { ...left, y: 400 })
  expect(stacked.path).toMatch(/^M 240,60 C /)
  expect(stacked.path).toEndWith("240,400")
  expect(stacked.label.x).toBeGreaterThan(240)
  const short = relationshipPath(left, { x: 250, y: 60, width: 240 })
  expect(short.sourceLabel.x).toBeLessThan(short.targetLabel.x)
  expect(short.path).not.toMatch(/NaN|Infinity/)
})

test("parallel and reciprocal relationships get distinct stable paths, regardless of input order", () => {
  const links = [
    { id: "b", sourceEntityId: "one", targetEntityId: "two" },
    { id: "a", sourceEntityId: "two", targetEntityId: "one" },
  ]
  const lanes = relationshipLanes(links)
  expect([...lanes]).toEqual([...relationshipLanes([...links].reverse())])
  const first = relationshipPath(left, right, lanes.get("b"))
  const second = relationshipPath(right, left, lanes.get("a"))
  expect(first.label.y).not.toBe(second.label.y)
  // Even perfectly aligned cards must not collapse their parallel paths.
  expect(relationshipPath(left, { ...right, y: left.y }, -24).label.y).not.toBe(
    relationshipPath(left, { ...right, y: left.y }, 24).label.y
  )
})

test("self relationships have visible distinct loops and separate endpoint labels", () => {
  const lanes = relationshipLanes([
    { id: "a", sourceEntityId: "one", targetEntityId: "one" },
    { id: "b", sourceEntityId: "one", targetEntityId: "one" },
  ])
  const first = relationshipPath(left, left, lanes.get("a"), true)
  const second = relationshipPath(left, left, lanes.get("b"), true)
  expect(first.path).toMatch(/^M 240,60 C /)
  expect(first.path).toEndWith("240,60")
  expect(first.path).not.toBe(second.path)
  expect(first.label.x).toBeGreaterThan(240)
  expect(first.sourceLabel.y).toBeLessThan(first.targetLabel.y)
})
