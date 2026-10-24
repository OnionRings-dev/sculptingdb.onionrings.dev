import { useRef, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { deleteProject } from "@/lib/projects/project.functions"
import type { ProjectSummary } from "@/lib/projects/types"

export function ProjectActions({
  project,
}: {
  project: Pick<ProjectSummary, "id" | "name">
}) {
  const router = useRouter()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function removeProject() {
    setPending(true)
    setFailed(false)
    try {
      if (!(await deleteProject({ data: project.id })))
        throw new Error("Deletion failed")
    } catch {
      setFailed(true)
      setPending(false)
      return
    }
    setOpen(false)
    try {
      await router.invalidate()
    } catch {
      // Deletion succeeded; refresh without offering to repeat it.
      window.location.reload()
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) {
          setOpen(nextOpen)
          setFailed(false)
        }
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={`Options for ${project.name}`}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={1.5} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setOpen(true)}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.5} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent size="sm" finalFocus={triggerRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project?</AlertDialogTitle>
          <AlertDialogDescription>
            “{project.name}” and its contents will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed && (
          <Alert variant="destructive">
            <AlertDescription>
              Could not delete the project. Try again.
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={removeProject}
            disabled={pending}
            aria-busy={pending}
          >
            {pending && <Spinner data-icon="inline-start" />}Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
