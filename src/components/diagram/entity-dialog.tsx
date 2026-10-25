import { useState } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { Accessibility } from "@dnd-kit/dom"
import { move } from "@dnd-kit/helpers"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { commandSchema } from "@/lib/diagram/model"
import type { Attribute, DiagramCommand, Entity } from "@/lib/diagram/model"
import { AttributeRow } from "./attribute-row"

const attributeAccessibility = Accessibility.configure({
  screenReaderInstructions: {
    draggable:
      "Press Space to reorder an attribute, use the arrow keys to move it, then Space to drop it. Press Escape to cancel.",
  },
  announcements: {
    dragstart: ({ operation: { source } }: DragStartEvent) =>
      source ? `Moving ${source.data.label}.` : undefined,
    dragover: ({ operation: { source } }: DragOverEvent) =>
      isSortable(source)
        ? `${source.data.label}, position ${source.index + 1}.`
        : undefined,
    dragend: ({ operation: { source }, canceled }: DragEndEvent) =>
      source
        ? `${canceled ? "Canceled moving" : "Moved"} ${source.data.label}.`
        : undefined,
  },
})

type EntityDialogProps = {
  entity: Entity
  attributes: Array<Attribute>
  isNew: boolean
  pending: boolean
  saveError: string | null
  onClose: () => void
  onSave: (command: DiagramCommand) => Promise<boolean>
}

export function EntityDialog({
  entity: initialEntity,
  attributes: initialAttributes,
  isNew,
  pending,
  saveError,
  onClose,
  onSave,
}: EntityDialogProps) {
  const [entity, setEntity] = useState(initialEntity)
  const [attributes, setAttributes] = useState(initialAttributes)
  const [validation, setValidation] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  function updateAttribute(id: string, patch: Partial<Attribute>) {
    setAttributes((current) =>
      current.map((attribute) =>
        attribute.id === id ? { ...attribute, ...patch } : attribute
      )
    )
  }
  function removeAttribute(id: string) {
    setAttributes((current) =>
      current.filter((attribute) => attribute.id !== id)
    )
  }
  function addAttribute() {
    setAttributes((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        entityId: entity.id,
        name: "",
        dataType: "string",
        description: null,
        isNullable: true,
        isPrimaryKey: false,
        isUnique: false,
        defaultValue: null,
        sortOrder: current.length,
      },
    ])
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || dragging) return
    const parsed = commandSchema.safeParse({
      type: "upsert_entity",
      entity,
      attributes: attributes.map((attribute, sortOrder) => ({
        ...attribute,
        sortOrder,
      })),
    })
    const names = attributes.map(({ name }) => name.trim())
    if (!parsed.success || new Set(names).size !== names.length) {
      setValidation(
        parsed.success
          ? "Attribute names must be unique."
          : parsed.error.issues[0].message
      )
      return
    }
    setValidation(null)
    if (await onSave(parsed.data)) onClose()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !dragging) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100svh-2rem)] flex-col overflow-hidden sm:max-w-3xl"
        showCloseButton={!pending && !dragging}
      >
        <DialogHeader>
          <DialogTitle>{isNew ? "New entity" : "Edit entity"}</DialogTitle>
          <DialogDescription className="sr-only">
            Entity name, description and attributes. Drag an attribute handle to
            reorder, or focus it and use Space and the arrow keys.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-col gap-4">
          <div className="min-h-0 overflow-y-auto px-1 pb-1">
            <FieldSet disabled={pending} className="gap-4">
              <FieldGroup className="gap-3">
                <Field>
                  <FieldLabel htmlFor="entity-name">Name</FieldLabel>
                  <Input
                    id="entity-name"
                    value={entity.name}
                    onChange={(event) =>
                      setEntity({ ...entity, name: event.target.value })
                    }
                    required
                    maxLength={120}
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="entity-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    id="entity-description"
                    rows={2}
                    value={entity.description ?? ""}
                    onChange={(event) =>
                      setEntity({
                        ...entity,
                        description: event.target.value || null,
                      })
                    }
                    maxLength={4000}
                  />
                </Field>
              </FieldGroup>
              <FieldSet className="min-w-0 gap-3">
                <FieldLegend variant="label">Attributes</FieldLegend>
                <DragDropProvider
                  plugins={(defaults) => [
                    ...defaults.filter((plugin) => plugin !== Accessibility),
                    attributeAccessibility,
                  ]}
                  onDragStart={() => setDragging(true)}
                  onDragEnd={(event) => {
                    setDragging(false)
                    if (!event.canceled)
                      setAttributes((current) => move(current, event))
                  }}
                >
                  <FieldGroup className="gap-3">
                    {attributes.map((attribute, index) => (
                      <AttributeRow
                        key={attribute.id}
                        attribute={attribute}
                        index={index}
                        disabled={pending}
                        onChange={updateAttribute}
                        onRemove={removeAttribute}
                      />
                    ))}
                  </FieldGroup>
                </DragDropProvider>
                <Button
                  variant="outline"
                  type="button"
                  onClick={addAttribute}
                  disabled={pending || dragging}
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    data-icon="inline-start"
                    strokeWidth={1.5}
                  />
                  Attribute
                </Button>
              </FieldSet>
            </FieldSet>
          </div>
          {(validation || saveError) && (
            <FieldError role="alert">{validation || saveError}</FieldError>
          )}
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending || dragging}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || dragging}>
              {pending && <Spinner data-icon="inline-start" />}Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
