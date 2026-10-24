import { useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AccountUser } from "@/lib/projects/types"
import type { ProjectRole } from "@/lib/projects/project-model"

export function MemberPermissions({
  member,
  pending,
  onChangeRole,
  onRemove,
}: {
  member: AccountUser & { role: ProjectRole }
  pending: boolean
  onChangeRole: (role: ProjectRole) => void
  onRemove: () => Promise<boolean>
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)
  async function remove() {
    if (pending) return
    setFailed(false)
    if (!(await onRemove())) setFailed(true)
  }
  return (
    <AlertDialog
      open={confirming}
      onOpenChange={(open) => {
        if (!pending) {
          setConfirming(open)
          setFailed(false)
        }
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          render={<Button variant="outline" />}
          aria-label={`Permission for ${member.email}`}
          disabled={pending}
        >
          {member.role === "edit" ? "Can edit" : "Can view"}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            data-icon="inline-end"
            strokeWidth={1.5}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              value={member.role}
              onValueChange={(role) => {
                if (role === "view" || role === "edit") onChangeRole(role)
              }}
            >
              <DropdownMenuRadioItem value="view" disabled={pending}>
                Can view
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="edit" disabled={pending}>
                Can edit
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              Remove access
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent
        size="sm"
        finalFocus={() =>
          trigger.current ?? document.getElementById("invite-emails")
        }
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Remove access?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {member.email} will no longer have access to this project.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed && (
          <FieldError role="alert">
            Could not remove access. Try again.
          </FieldError>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              void remove()
            }}
            disabled={pending}
            aria-busy={pending}
          >
            {pending && <Spinner data-icon="inline-start" />}Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
