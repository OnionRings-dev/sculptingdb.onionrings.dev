import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { UserAdd01Icon } from "@hugeicons/core-free-icons"
import { UserAvatar } from "@/components/account/user-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  changeMemberRole,
  getProjectSharing,
  invitePeople,
  removeMember,
} from "@/lib/projects/project.functions"
import type {
  ProjectRole,
  ProjectSharing as Sharing,
} from "@/lib/projects/project-model"
import { EmailPicker } from "./email-picker"
import { MemberPermissions } from "./member-permissions"
import { invitePeopleSchema } from "@/lib/projects/project-model"

const roles = [
  { value: "view", label: "Can view" },
  { value: "edit", label: "Can edit" },
] as const

function RoleSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: ProjectRole
  onChange: (role: ProjectRole) => void
  label: string
  disabled?: boolean
}) {
  return (
    <Select
      items={roles}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
    >
      <SelectTrigger aria-label={label} className="shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {roles.map((role) => (
            <SelectItem key={role.value} value={role.value}>
              {role.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function ProjectSharing({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next)
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label="Invite people"
        title="Invite people"
      >
        <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={1.5} className="h-5 w-5"/>
      </DialogTrigger>
      {open && (
        <SharingDialog
          projectId={projectId}
          pending={pending}
          setPending={setPending}
        />
      )}
    </Dialog>
  )
}

function SharingDialog({
  projectId,
  pending,
  setPending,
}: {
  projectId: string
  pending: boolean
  setPending: (value: boolean) => void
}) {
  const [sharing, setSharing] = useState<Sharing | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Array<string>>([])
  const [query, setQuery] = useState("")
  const [role, setRole] = useState<ProjectRole>("view")
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getProjectSharing({ data: { projectId } })
      .then((value) => {
        if (cancelled) return
        if (!value) setError("Sharing is only available to the project owner.")
        setSharing(value)
      })
      .catch(() => {
        if (!cancelled) setError("Could not load sharing settings.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, loadAttempt])

  async function invite(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const emails = [
      ...new Set(
        [...selected, ...query.split(/[;,\s]+/).filter(Boolean)].map((email) =>
          email.trim().toLowerCase()
        )
      ),
    ]
    const parsed = invitePeopleSchema.safeParse({ projectId, emails, role })
    if (!parsed.success) {
      setError("Enter or select up to 20 valid email addresses.")
      return
    }
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const result = await invitePeople({ data: parsed.data })
      if (result.ok) {
        setSharing(result.sharing)
        setSelected([])
        setQuery("")
        setNotice("Access updated.")
      } else if (result.reason === "unknown_users")
        setError(`No registered account: ${result.emails.join(", ")}`)
      else setError("You no longer have permission to invite people.")
    } catch {
      setError("Could not invite people. Try again.")
    } finally {
      setPending(false)
    }
  }
  async function updateRole(userId: string, next: ProjectRole) {
    if (pending) return
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      if (
        !(await changeMemberRole({ data: { projectId, userId, role: next } }))
      )
        throw new Error("Permission unavailable")
      setSharing(
        (current) =>
          current && {
            ...current,
            members: current.members.map((member) =>
              member.id === userId ? { ...member, role: next } : member
            ),
          }
      )
      setNotice("Permission updated.")
    } catch {
      setError("Could not update this permission. Try again.")
    } finally {
      setPending(false)
    }
  }
  async function removeCollaborator(userId: string): Promise<boolean> {
    if (pending) return false
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      if (!(await removeMember({ data: { projectId, userId } }))) return false
      setSharing(
        (current) =>
          current && {
            ...current,
            members: current.members.filter((member) => member.id !== userId),
          }
      )
      setNotice("Access removed.")
      requestAnimationFrame(() =>
        document.getElementById("invite-emails")?.focus()
      )
      return true
    } catch {
      return false
    } finally {
      setPending(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
      <DialogHeader>
        <DialogTitle>Invite</DialogTitle>
        <DialogDescription className="sr-only">
          Share this project with registered users and choose their permissions.
        </DialogDescription>
      </DialogHeader>
      {loading ? (
        <div
          className="flex justify-center py-6"
          role="status"
          aria-label="Loading sharing settings"
        >
          <Spinner />
        </div>
      ) : sharing ? (
        <>
          <form onSubmit={invite} className="flex flex-col gap-3">
            <EmailPicker
              projectId={projectId}
              selected={selected}
              setSelected={setSelected}
              query={query}
              setQuery={setQuery}
              pending={pending}
              error={error}
              setError={setError}
              setNotice={setNotice}
              refreshKey={sharing}
              controls={
                <>
                  <RoleSelect
                    value={role}
                    onChange={setRole}
                    label="Invitation permission"
                    disabled={pending}
                  />
                  <Button
                    type="submit"
                    disabled={pending || (!selected.length && !query.trim())}
                  >
                    {pending && <Spinner data-icon="inline-start" />}Invite
                  </Button>
                </>
              }
            >
              <section
                aria-label="People with access"
                className="flex max-h-64 flex-col gap-3 overflow-y-auto"
              >
                {[
                  { ...sharing.owner, role: "owner" as const },
                  ...sharing.members,
                ].map((person) => (
                  <div
                    key={person.id}
                    className="flex min-w-0 items-center gap-3"
                  >
                    <UserAvatar user={person} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{person.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {person.email}
                      </div>
                    </div>
                    {person.role === "owner" ? (
                      <span className="text-xs text-muted-foreground">
                        Owner
                      </span>
                    ) : (
                      <MemberPermissions
                        member={person}
                        onChangeRole={(next) => {
                          void updateRole(person.id, next)
                        }}
                        onRemove={() => removeCollaborator(person.id)}
                        pending={pending}
                      />
                    )}
                  </div>
                ))}
              </section>
            </EmailPicker>
          </form>
        </>
      ) : (
        <Button
          variant="outline"
          onClick={() => setLoadAttempt((value) => value + 1)}
        >
          Retry
        </Button>
      )}
      {error && (
        <FieldError id="invite-error" role="alert">
          {error}
        </FieldError>
      )}
      <p
        role="status"
        className={notice ? "text-xs text-muted-foreground" : "sr-only"}
      >
        {notice}
      </p>
    </DialogContent>
  )
}
