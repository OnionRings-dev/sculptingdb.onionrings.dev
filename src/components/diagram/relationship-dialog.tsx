import { useState } from "react"
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
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { cardinalities, relationshipSchema } from "@/lib/diagram/model"
import type { DiagramCommand, Entity, Relationship } from "@/lib/diagram/model"

export function RelationshipDialog({
  relationship: initial,
  entities,
  pending,
  saveError,
  onClose,
  onSave,
}: {
  relationship: Relationship
  entities: Array<Entity>
  pending: boolean
  saveError: string | null
  onClose: () => void
  onSave: (command: DiagramCommand) => Promise<boolean>
}) {
  const [relationship, setRelationship] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const entityItems = entities.map((entity) => ({
    value: entity.id,
    label: entity.name,
  }))
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = relationshipSchema.safeParse(relationship)
    if (!parsed.success) {
      setError("Choose both entities.")
      return
    }
    if (
      await onSave({ type: "upsert_relationship", relationship: parsed.data })
    )
      onClose()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Relationship</DialogTitle>
          <DialogDescription className="sr-only">
            Choose entities and cardinalities.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FieldSet disabled={pending}>
            <FieldGroup>
              {(["source", "target"] as const).map((side) => (
                <FieldGroup key={side} className="flex-row gap-3">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel htmlFor={`${side}-entity`}>
                      {side === "source" ? "From" : "To"}
                    </FieldLabel>
                    <Combobox
                      items={entityItems}
                      value={
                        entityItems.find(
                          (item) =>
                            item.value === relationship[`${side}EntityId`]
                        ) ?? null
                      }
                      itemToStringLabel={(item) => item.label}
                      itemToStringValue={(item) => item.value}
                      isItemEqualToValue={(item, value) =>
                        item.value === value.value
                      }
                      autoHighlight
                      disabled={pending}
                      onValueChange={(item) => {
                        if (item)
                          setRelationship((current) => ({
                            ...current,
                            [`${side}EntityId`]: item.value,
                          }))
                      }}
                    >
                      <ComboboxInput
                        id={`${side}-entity`}
                        placeholder="Search entities…"
                        className="w-full"
                        disabled={pending}
                      />
                      <ComboboxContent>
                        <ComboboxEmpty>No entities found.</ComboboxEmpty>
                        <ComboboxList>
                          <ComboboxGroup>
                            <ComboboxCollection>
                              {(item: (typeof entityItems)[number]) => (
                                <ComboboxItem key={item.value} value={item}>
                                  <span className="truncate">{item.label}</span>
                                </ComboboxItem>
                              )}
                            </ComboboxCollection>
                          </ComboboxGroup>
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                  </Field>
                  <Field className="w-24">
                    <FieldLabel htmlFor={`${side}-cardinality`}>
                      Cardinality
                    </FieldLabel>
                    <Select
                      items={cardinalities}
                      value={relationship[`${side}Cardinality`]}
                      onValueChange={(value) => {
                        if (value)
                          setRelationship({
                            ...relationship,
                            [`${side}Cardinality`]: value,
                          })
                      }}
                    >
                      <SelectTrigger
                        id={`${side}-cardinality`}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {cardinalities.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              ))}
              <Field>
                <FieldLabel htmlFor="relationship-label">Label</FieldLabel>
                <Input
                  id="relationship-label"
                  value={relationship.label ?? ""}
                  onChange={(event) =>
                    setRelationship({
                      ...relationship,
                      label: event.target.value || null,
                    })
                  }
                  maxLength={120}
                />
              </Field>
            </FieldGroup>
          </FieldSet>
          {(error || saveError) && (
            <FieldError role="alert">{error || saveError}</FieldError>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
