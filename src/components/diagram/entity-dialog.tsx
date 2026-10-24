import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { commandSchema } from "@/lib/diagram/model"
import type { Attribute, DiagramCommand, Entity } from "@/lib/diagram/model"

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
  function updateAttribute(id: string, patch: Partial<Attribute>) {
    setAttributes((current) =>
      current.map((attribute) =>
        attribute.id === id ? { ...attribute, ...patch } : attribute
      )
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
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>{isNew ? "New entity" : "Edit entity"}</DialogTitle>
          <DialogDescription className="sr-only">
            Entity name, description and attributes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-5">
          <FieldSet disabled={pending}>
            <FieldGroup>
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
            <FieldSet>
              <FieldLegend variant="label">Attributes</FieldLegend>
              <FieldGroup className="gap-4">
                {attributes.map((attribute, index) => (
                  <FieldSet
                    key={attribute.id}
                    className="gap-3 rounded-lg border p-3"
                  >
                    <FieldLegend className="sr-only">
                      Attribute {index + 1}
                    </FieldLegend>
                    <FieldGroup className="flex-row items-end gap-2">
                      <Field className="min-w-0 flex-1">
                        <FieldLabel
                          className="sr-only"
                          htmlFor={`${attribute.id}-name`}
                        >
                          Attribute {index + 1} name
                        </FieldLabel>
                        <Input
                          id={`${attribute.id}-name`}
                          placeholder="Name"
                          value={attribute.name}
                          onChange={(event) =>
                            updateAttribute(attribute.id, {
                              name: event.target.value,
                            })
                          }
                          required
                          maxLength={120}
                        />
                      </Field>
                      <Field className="min-w-0 flex-1">
                        <FieldLabel
                          className="sr-only"
                          htmlFor={`${attribute.id}-type`}
                        >
                          Attribute {index + 1} type
                        </FieldLabel>
                        <Input
                          id={`${attribute.id}-type`}
                          placeholder="Type"
                          value={attribute.dataType}
                          onChange={(event) =>
                            updateAttribute(attribute.id, {
                              dataType: event.target.value,
                            })
                          }
                          required
                          maxLength={120}
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove attribute ${index + 1}`}
                        onClick={() =>
                          setAttributes((current) =>
                            current.filter(({ id }) => id !== attribute.id)
                          )
                        }
                      >
                        <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.5} />
                      </Button>
                    </FieldGroup>
                    <FieldGroup className="flex-row flex-wrap gap-4">
                      <Field orientation="horizontal" className="w-auto">
                        <Checkbox
                          id={`${attribute.id}-pk`}
                          checked={attribute.isPrimaryKey}
                          onCheckedChange={(checked) =>
                            updateAttribute(attribute.id, {
                              isPrimaryKey: checked,
                              ...(checked ? { isNullable: false } : {}),
                            })
                          }
                        />
                        <FieldLabel htmlFor={`${attribute.id}-pk`}>
                          PK
                        </FieldLabel>
                      </Field>
                      <Field
                        orientation="horizontal"
                        className="w-auto"
                        data-disabled={attribute.isPrimaryKey}
                      >
                        <Checkbox
                          id={`${attribute.id}-nullable`}
                          disabled={attribute.isPrimaryKey}
                          checked={attribute.isNullable}
                          onCheckedChange={(checked) =>
                            updateAttribute(attribute.id, {
                              isNullable: checked,
                            })
                          }
                        />
                        <FieldLabel htmlFor={`${attribute.id}-nullable`}>
                          Nullable
                        </FieldLabel>
                      </Field>
                      <Field orientation="horizontal" className="w-auto">
                        <Checkbox
                          id={`${attribute.id}-unique`}
                          checked={attribute.isUnique}
                          onCheckedChange={(checked) =>
                            updateAttribute(attribute.id, { isUnique: checked })
                          }
                        />
                        <FieldLabel htmlFor={`${attribute.id}-unique`}>
                          Unique
                        </FieldLabel>
                      </Field>
                    </FieldGroup>
                    <Field>
                      <FieldLabel
                        htmlFor={`${attribute.id}-default`}
                        className="sr-only"
                      >
                        Attribute {index + 1} default value
                      </FieldLabel>
                      <Input
                        id={`${attribute.id}-default`}
                        placeholder="Default value"
                        value={attribute.defaultValue ?? ""}
                        maxLength={1000}
                        onChange={(event) =>
                          updateAttribute(attribute.id, {
                            defaultValue: event.target.value || null,
                          })
                        }
                      />
                    </Field>
                  </FieldSet>
                ))}
              </FieldGroup>
              <Button variant="outline" type="button" onClick={addAttribute}>
                <HugeiconsIcon
                  icon={Add01Icon}
                  data-icon="inline-start"
                  strokeWidth={1.5}
                />
                Attribute
              </Button>
            </FieldSet>
          </FieldSet>
          {(validation || saveError) && (
            <FieldError role="alert">{validation || saveError}</FieldError>
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
