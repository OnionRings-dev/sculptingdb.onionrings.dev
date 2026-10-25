import { useSortable } from "@dnd-kit/react/sortable"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon, DragDropVerticalIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import type { Attribute } from "@/lib/diagram/model"

const textFields = [
  {
    key: "name",
    label: "name",
    placeholder: "Name",
    maxLength: 120,
    className: "col-start-2 row-start-1",
  },
  {
    key: "dataType",
    label: "type",
    placeholder: "Type",
    maxLength: 120,
    className: "col-start-3 row-start-1",
  },
  {
    key: "defaultValue",
    label: "default value",
    placeholder: "Default value",
    maxLength: 1000,
    className:
      "col-span-3 col-start-2 row-start-2 sm:col-span-1 sm:col-start-4 sm:row-start-1",
  },
] as const

const flags = [
  { key: "isPrimaryKey", label: "PK" },
  { key: "isNullable", label: "Nullable" },
  { key: "isUnique", label: "Unique" },
] as const

export function AttributeRow({
  attribute,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  attribute: Attribute
  index: number
  disabled: boolean
  onChange: (id: string, patch: Partial<Attribute>) => void
  onRemove: (id: string) => void
}) {
  const { ref, handleRef } = useSortable({
    id: attribute.id,
    index,
    disabled,
    data: { label: attribute.name || `attribute ${index + 1}` },
  })

  return (
    <FieldSet ref={ref} disabled={disabled} className="min-w-0 gap-3">
      <FieldLegend className="sr-only">Attribute {index + 1}</FieldLegend>
      <Separator />
      <FieldGroup className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,0.8fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto]">
        <Button
          ref={handleRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          className="col-start-1 row-start-1 cursor-grab touch-none active:cursor-grabbing"
          aria-label={`Reorder ${attribute.name || `attribute ${index + 1}`}`}
          title="Drag to reorder, or press Space and use the arrow keys."
        >
          <HugeiconsIcon icon={DragDropVerticalIcon} strokeWidth={1.5} />
        </Button>
        {textFields.map((field) => (
          <Field key={field.key} className={field.className}>
            <FieldLabel
              className="sr-only"
              htmlFor={`${attribute.id}-${field.key}`}
            >
              Attribute {index + 1} {field.label}
            </FieldLabel>
            <Input
              id={`${attribute.id}-${field.key}`}
              placeholder={field.placeholder}
              value={attribute[field.key] ?? ""}
              required={field.key !== "defaultValue"}
              maxLength={field.maxLength}
              autoComplete="off"
              onChange={(event) =>
                onChange(attribute.id, {
                  [field.key]:
                    field.key === "defaultValue"
                      ? event.target.value || null
                      : event.target.value,
                })
              }
            />
          </Field>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="col-start-4 row-start-1 sm:col-start-5"
          disabled={disabled}
          aria-label={`Remove attribute ${index + 1}`}
          onClick={() => onRemove(attribute.id)}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.5} />
        </Button>
        <FieldGroup className="col-span-3 col-start-2 row-start-3 flex-row flex-wrap gap-x-3 gap-y-2 sm:row-start-2">
          {flags.map(({ key, label }) => {
            const unavailable =
              disabled || (key === "isNullable" && attribute.isPrimaryKey)
            return (
              <Field
                key={key}
                orientation="horizontal"
                className="w-auto gap-1.5"
                data-disabled={unavailable}
              >
                <Checkbox
                  id={`${attribute.id}-${key}`}
                  disabled={unavailable}
                  checked={attribute[key]}
                  onCheckedChange={(checked) =>
                    onChange(attribute.id, {
                      [key]: checked,
                      ...(key === "isPrimaryKey" && checked
                        ? { isNullable: false }
                        : {}),
                    })
                  }
                />
                <FieldLabel htmlFor={`${attribute.id}-${key}`}>
                  {label}
                </FieldLabel>
              </Field>
            )
          })}
        </FieldGroup>
      </FieldGroup>
    </FieldSet>
  )
}
