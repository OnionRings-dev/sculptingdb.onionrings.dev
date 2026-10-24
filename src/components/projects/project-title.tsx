import { useRef, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { projectNameSchema } from "@/lib/projects/project-model"

export function ProjectTitle({
  name,
  canEdit,
  pending,
  onRename,
}: {
  name: string
  canEdit: boolean
  pending: boolean
  onRename: (name: string) => Promise<boolean>
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const saving = useRef(false)
  const cancel = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)

  function close() {
    setEditing(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  async function save() {
    if (saving.current || cancel.current) return
    const parsed = projectNameSchema.safeParse(draft)
    if (!parsed.success) {
      setError("Enter a name (up to 120 characters).")
      return
    }
    if (parsed.data === name) {
      close()
      return
    }
    saving.current = true
    const saved = await onRename(parsed.data)
    saving.current = false
    if (saved) {
      close()
      void router.invalidate()
    } else setError("Could not rename the project. Try again.")
  }
  return editing ? (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      className="relative min-w-0 flex-1 @md/canvas:max-w-48 @md/canvas:flex-none"
    >
      <FieldGroup className="@container-normal">
        <Field data-invalid={!!error} className="*:w-auto">
          <FieldLabel htmlFor="project-name" className="sr-only">
            Project name
          </FieldLabel>
          <Input
            id="project-name"
            className="field-sizing-content max-w-full"
            value={draft}
            autoFocus
            maxLength={120}
            disabled={pending}
            aria-invalid={!!error}
            aria-describedby={error ? "project-name-error" : undefined}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onBlur={() => {
              void save()
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Escape") {
                event.preventDefault()
                cancel.current = true
                close()
              }
            }}
          />
          {error && (
            <FieldError
              id="project-name-error"
              role="alert"
              className="absolute top-full mt-2 w-56 rounded-lg border bg-popover p-2"
            >
              {error}
            </FieldError>
          )}
        </Field>
      </FieldGroup>
    </form>
  ) : (
    <h1
      className="min-w-0 flex-1 @md/canvas:max-w-48 @md/canvas:flex-none"
      title={name}
    >
      {canEdit ? (
        <Button
          ref={trigger}
          variant="ghost"
          className="w-full min-w-0 justify-start"
          disabled={pending}
          aria-label={`Rename project: ${name}`}
          onClick={() => {
            cancel.current = false
            setDraft(name)
            setError(null)
            setEditing(true)
          }}
        >
          <span className="truncate">{name}</span>
        </Button>
      ) : (
        <span className="block truncate px-2 text-sm">{name}</span>
      )}
    </h1>
  )
}
