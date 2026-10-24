import { useEffect, useState } from "react"
import { UserAvatar } from "@/components/account/user-avatar"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { searchPeople } from "@/lib/projects/project.functions"
import type { AccountUser } from "@/lib/projects/types"
import { invitePeopleSchema } from "@/lib/projects/project-model"

export function EmailPicker({
  projectId,
  selected,
  setSelected,
  query,
  setQuery,
  pending,
  error,
  setError,
  setNotice,
  refreshKey,
  controls,
  children,
}: {
  projectId: string
  selected: Array<string>
  setSelected: (value: Array<string>) => void
  query: string
  setQuery: (value: string) => void
  pending: boolean
  error: string | null
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
  refreshKey: object
  controls: React.ReactNode
  children: React.ReactNode
}) {
  const [results, setResults] = useState<Array<AccountUser>>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setResults([])
    setSearchError(false)
    if (query.trim().length < 2) {
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      searchPeople({ data: { projectId, query } })
        .then((people) => {
          if (!cancelled) setResults(people)
        })
        .catch(() => {
          if (!cancelled) setSearchError(true)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [projectId, query, refreshKey])

  const options = results.filter((person) => !selected.includes(person.email))
  return (
    <Combobox
      multiple
      inline
      open
      items={[...selected, ...options.map((person) => person.email)]}
      filteredItems={options.map((person) => person.email)}
      value={selected}
      onValueChange={(value) => {
        if (value.length > 20) {
          setError("Select up to 20 email addresses.")
          return
        }
        setSelected(value)
        setError(null)
        setNotice(null)
      }}
      inputValue={query}
      onInputValueChange={(value, details) => {
        // Keep a typed email when focus moves to Invite or the permission selector.
        if (
          details.reason === "input-clear" &&
          !details.isItemPress &&
          query.trim()
        ) {
          details.cancel()
          return
        }
        setQuery(value)
        setError(null)
        setNotice(null)
      }}
      disabled={pending}
    >
      <FieldGroup className="flex-row items-start gap-2">
        <Field
          className="min-w-0 flex-1"
          data-invalid={!!error}
          data-disabled={pending}
        >
          <FieldLabel htmlFor="invite-emails" className="sr-only">
            Email addresses
          </FieldLabel>
          <ComboboxChips
            aria-label="Selected email addresses"
            className="min-w-0"
          >
            {selected.map((email) => (
              <ComboboxChip
                key={email}
                aria-label={email}
                aria-description="Press Backspace or Delete to remove"
                removeLabel={`Remove ${email}`}
                className="max-w-full"
              >
                <span className="truncate">{email}</span>
              </ComboboxChip>
            ))}
            <ComboboxChipsInput
              id="invite-emails"
              placeholder={
                selected.length ? "Add another email" : "Email addresses"
              }
              maxLength={254}
              autoComplete="off"
              aria-invalid={!!error}
              aria-describedby={error ? "invite-error" : undefined}
              aria-description={
                selected.length
                  ? `${selected.length} selected. Press Left Arrow from the start to remove an email.`
                  : undefined
              }
              onKeyDown={(event) => {
                if (
                  (event.key === "Enter" ||
                    event.key === "," ||
                    event.key === ";") &&
                  query.trim() &&
                  !event.currentTarget.getAttribute("aria-activedescendant")
                ) {
                  event.preventDefault()
                  const email = query.trim().toLowerCase()
                  if (
                    invitePeopleSchema.shape.emails.element.safeParse(email)
                      .success &&
                    selected.length < 20
                  ) {
                    setSelected([...new Set([...selected, email])])
                    setQuery("")
                    setError(null)
                  }
                }
              }}
              onPaste={(event) => {
                const emails = event.clipboardData
                  .getData("text")
                  .split(/[;,\s]+/)
                  .filter(Boolean)
                  .map((email) => email.trim().toLowerCase())
                if (
                  emails.length > 1 &&
                  emails.every(
                    (email) =>
                      invitePeopleSchema.shape.emails.element.safeParse(email)
                        .success
                  )
                ) {
                  event.preventDefault()
                  const next = [...new Set([...selected, ...emails])]
                  if (next.length > 20) {
                    setError("Select up to 20 email addresses.")
                    return
                  }
                  setSelected(next)
                  setQuery("")
                  setError(null)
                }
              }}
            />
          </ComboboxChips>
        </Field>
        {controls}
      </FieldGroup>
      <Separator />
      {query.trim() ? (
        <section
          aria-label="Suggested collaborators"
          className="group/combobox-content"
          data-empty={options.length === 0 ? "" : undefined}
        >
          <ComboboxEmpty>
            {searching
              ? "Searching…"
              : searchError
                ? "Could not search. Try again."
                : query.trim().length < 2
                  ? "Type at least 2 characters"
                  : "No users found"}
          </ComboboxEmpty>
          <ComboboxList className="max-h-64">
            <ComboboxGroup>
              {options.map((person) => (
                <ComboboxItem key={person.id} value={person.email}>
                  <UserAvatar user={person} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate">{person.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {person.email}
                    </div>
                  </div>
                </ComboboxItem>
              ))}
            </ComboboxGroup>
          </ComboboxList>
        </section>
      ) : (
        children
      )}
    </Combobox>
  )
}
