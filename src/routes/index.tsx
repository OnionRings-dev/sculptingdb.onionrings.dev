import { useRef, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { AccountMenu } from "@/components/account/account-menu"
import { ProjectCard } from "@/components/projects/project-card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { createProject, getProjects } from "@/lib/projects/project.functions"

export const Route = createFileRoute("/")({
  loader: () => getProjects(),
  component: ProjectsPage,
})

function ProjectsPage() {
  const { user } = Route.useRouteContext()
  const projects = Route.useLoaderData()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const creating = useRef(false)
  const query = search.trim().toLocaleLowerCase()
  const filtered = projects.filter((project) =>
    `${project.name} ${project.description ?? ""}`
      .toLocaleLowerCase()
      .includes(query)
  )

  async function newProject() {
    if (creating.current) return
    creating.current = true
    setPending(true)
    setFailed(false)
    let projectId: string
    try {
      const project = await createProject()
      projectId = project.id
    } catch {
      setFailed(true)
      creating.current = false
      setPending(false)
      return
    }
    try {
      await navigate({ to: "/projects/$projectId", params: { projectId } })
    } catch {
      // The project already exists. A full navigation avoids a duplicate on retry.
      window.location.assign(`/projects/${projectId}`)
    }
  }

  return (
    <main className="mx-auto min-h-svh max-w-7xl px-5 py-8 sm:px-10 sm:py-12 lg:px-12">
      <h1 className="sr-only">Projects</h1>
      <header className="mb-12 flex items-center gap-3 sm:mb-16 sm:gap-4">
        <div role="search" className="min-w-0 flex-1">
          <InputGroup className="max-w-md">
            <InputGroupInput
              type="search"
              placeholder="Search projects"
              aria-label="Search projects"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
            />
            <InputGroupAddon>
              <HugeiconsIcon icon={Search01Icon} strokeWidth={1.5} />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <Button
          variant="outline"
          onClick={newProject}
          disabled={pending}
          aria-busy={pending}
        >
          New{" "}
          {pending ? (
            <Spinner data-icon="inline-end" />
          ) : (
            <HugeiconsIcon
              icon={Add01Icon}
              data-icon="inline-end"
              strokeWidth={1.5}
            />
          )}
        </Button>
        {user && <AccountMenu user={user} />}
      </header>
      {failed && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>
            Could not create the project. Try again.
          </AlertDescription>
        </Alert>
      )}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <Empty className="min-h-72" role="status">
          <EmptyHeader>
            <EmptyTitle>
              {query ? "No projects found" : "No projects yet"}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </main>
  )
}
