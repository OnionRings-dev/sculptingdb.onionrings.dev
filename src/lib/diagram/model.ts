import { z } from "zod"
import type { DiagramSnapshot } from "@/db/schema"

export type Entity = DiagramSnapshot["entities"][number]
export type Attribute = DiagramSnapshot["attributes"][number]
export type Relationship = DiagramSnapshot["relationships"][number]
export const cardinalities = [
  { value: "zero_or_one", label: "0..1" },
  { value: "one", label: "1" },
  { value: "zero_or_many", label: "0..*" },
  { value: "one_or_many", label: "1..*" },
] as const
const cardinalitySchema = z.enum([
  "zero_or_one",
  "one",
  "zero_or_many",
  "one_or_many",
])
const nameSchema = z.string().trim().min(1, "A name is required").max(120)
const descriptionSchema = z.string().max(4000).nullable()
const coordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000)

export const entitySchema = z.object({
  id: z.uuid(),
  name: nameSchema,
  description: descriptionSchema,
  positionX: coordinateSchema,
  positionY: coordinateSchema,
})
export const attributeSchema = z
  .object({
    id: z.uuid(),
    entityId: z.uuid(),
    name: nameSchema,
    dataType: nameSchema,
    description: descriptionSchema,
    isNullable: z.boolean(),
    isPrimaryKey: z.boolean(),
    isUnique: z.boolean(),
    defaultValue: z.string().max(1000).nullable(),
    sortOrder: z.number().int().min(0),
  })
  .refine((value) => !value.isPrimaryKey || !value.isNullable, {
    message: "Primary keys cannot be nullable",
    path: ["isNullable"],
  })
export const relationshipSchema = z.object({
  id: z.uuid(),
  sourceEntityId: z.uuid(),
  targetEntityId: z.uuid(),
  label: z.string().trim().max(120).nullable(),
  description: descriptionSchema,
  sourceCardinality: cardinalitySchema,
  targetCardinality: cardinalitySchema,
})

export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    entities: z.array(entitySchema).max(500),
    attributes: z.array(attributeSchema).max(10_000),
    relationships: z.array(relationshipSchema).max(5000),
  })
  .superRefine((snapshot, context) => {
    const entities = new Set(snapshot.entities.map(({ id }) => id))
    const attributes = new Set(snapshot.attributes.map(({ id }) => id))
    const relationships = new Set(snapshot.relationships.map(({ id }) => id))
    if (
      entities.size !== snapshot.entities.length ||
      attributes.size !== snapshot.attributes.length ||
      relationships.size !== snapshot.relationships.length
    ) {
      context.addIssue({ code: "custom", message: "Duplicate identifiers" })
    }
    const names = new Set<string>()
    for (const attribute of snapshot.attributes) {
      const key = `${attribute.entityId}:${attribute.name}`
      if (!entities.has(attribute.entityId) || names.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Attributes must have unique names within their entity",
        })
      }
      names.add(key)
    }
    for (const relationship of snapshot.relationships) {
      if (
        !entities.has(relationship.sourceEntityId) ||
        !entities.has(relationship.targetEntityId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Relationship endpoints must belong to this diagram",
        })
      }
    }
  })

export const editCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("upsert_entity"),
    entity: entitySchema,
    attributes: z.array(attributeSchema).max(1000),
  }),
  z.object({
    type: z.literal("move_entities"),
    positions: z
      .array(
        z.object({ id: z.uuid(), x: coordinateSchema, y: coordinateSchema })
      )
      .min(1)
      .max(500),
  }),
  z.object({
    type: z.literal("upsert_relationship"),
    relationship: relationshipSchema,
  }),
  z.object({
    type: z.literal("delete_selection"),
    entityIds: z.array(z.uuid()).max(500),
    relationshipIds: z.array(z.uuid()).max(5000),
  }),
])
export const commandSchema = z.discriminatedUnion("type", [
  ...editCommandSchema.options,
  z.object({
    type: z.literal("restore"),
    revision: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("batch"),
    commands: z.array(editCommandSchema).min(1).max(100),
    summary: z.string().trim().min(1).max(240),
  }),
])
export type DiagramCommand = z.infer<typeof commandSchema>
export const mutationSchema = z.object({
  projectId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  command: commandSchema,
})
export type DiagramMutation = z.infer<typeof mutationSchema>
export const revisionRequestSchema = z.object({
  projectId: z.uuid(),
  revision: z.number().int().positive(),
})

export function canonicalSnapshot(snapshot: DiagramSnapshot): DiagramSnapshot {
  return {
    schemaVersion: 1,
    entities: [...snapshot.entities].sort((a, b) => a.id.localeCompare(b.id)),
    attributes: [...snapshot.attributes].sort(
      (a, b) =>
        a.entityId.localeCompare(b.entityId) ||
        a.sortOrder - b.sortOrder ||
        a.id.localeCompare(b.id)
    ),
    relationships: [...snapshot.relationships].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
  }
}

export function applyCommand(
  current: DiagramSnapshot,
  command: Exclude<DiagramCommand, { type: "restore" }>
): { snapshot: DiagramSnapshot; summary: string } {
  let snapshot: DiagramSnapshot = { ...current }
  let summary: string
  switch (command.type) {
    case "batch": {
      for (const change of command.commands)
        snapshot = applyCommand(snapshot, change).snapshot
      summary = command.summary
      break
    }
    case "upsert_entity": {
      if (
        command.attributes.some(
          (attribute) => attribute.entityId !== command.entity.id
        )
      )
        throw new Error("Invalid attribute owner")
      const exists = current.entities.some(({ id }) => id === command.entity.id)
      snapshot = {
        ...snapshot,
        entities: [
          ...current.entities.filter(({ id }) => id !== command.entity.id),
          command.entity,
        ],
        attributes: [
          ...current.attributes.filter(
            ({ entityId }) => entityId !== command.entity.id
          ),
          ...command.attributes,
        ],
      }
      summary = `${exists ? "Updated" : "Added"} “${command.entity.name}”`
      break
    }
    case "move_entities": {
      const positions = new Map(
        command.positions.map((position) => [position.id, position])
      )
      if (
        command.positions.some(
          ({ id }) => !current.entities.some((entity) => entity.id === id)
        )
      )
        throw new Error("Unknown entity")
      snapshot.entities = current.entities.map((entity) => {
        const position = positions.get(entity.id)
        return position
          ? { ...entity, positionX: position.x, positionY: position.y }
          : entity
      })
      summary =
        command.positions.length === 1 ? "Moved entity" : "Moved entities"
      break
    }
    case "upsert_relationship": {
      const exists = current.relationships.some(
        ({ id }) => id === command.relationship.id
      )
      snapshot.relationships = [
        ...current.relationships.filter(
          ({ id }) => id !== command.relationship.id
        ),
        command.relationship,
      ]
      summary = exists ? "Updated relationship" : "Added relationship"
      break
    }
    case "delete_selection": {
      const deletedEntities = new Set(command.entityIds)
      const deletedRelationships = new Set(command.relationshipIds)
      snapshot = {
        ...snapshot,
        entities: current.entities.filter(({ id }) => !deletedEntities.has(id)),
        attributes: current.attributes.filter(
          ({ entityId }) => !deletedEntities.has(entityId)
        ),
        relationships: current.relationships.filter(
          (edge) =>
            !deletedRelationships.has(edge.id) &&
            !deletedEntities.has(edge.sourceEntityId) &&
            !deletedEntities.has(edge.targetEntityId)
        ),
      }
      summary = deletedEntities.size
        ? "Deleted entities"
        : "Deleted relationships"
      break
    }
  }
  return {
    snapshot: canonicalSnapshot(snapshotSchema.parse(snapshot)),
    summary,
  }
}

export type HistoryEntry = {
  revision: number
  summary: string
  origin: "manual" | "mcp" | "restore"
  actorName: string | null
  createdAt: string
}
export type DiagramEditorData = {
  project: { id: string; name: string; description: string | null }
  canEdit: boolean
  canManageSharing: boolean
  revision: number
  snapshot: DiagramSnapshot
  history: Array<HistoryEntry>
}
export type MutationResult =
  | { ok: true; data: DiagramEditorData }
  | { ok: false; reason: "conflict"; data: DiagramEditorData }
  | { ok: false; reason: "forbidden" }
