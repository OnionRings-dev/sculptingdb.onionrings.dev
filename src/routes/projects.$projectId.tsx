import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { AccountMenu } from "@/components/account/account-menu"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { getProject } from "@/lib/projects/project.functions"

export const Route = createFileRoute("/projects/$projectId")({
  loader: async ({ params }) => {
    const project = await getProject({ data: params.projectId })
    if (!project) throw notFound()
    return project
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.name} | Sculpting DB`
          : "Project | Sculpting DB",
      },
    ],
  }),
  component: ProjectPage,
  notFoundComponent: ProjectNotFound,
})

function ProjectHeader() {
  const { user } = Route.useRouteContext()
  return (
    <header className="mb-16 flex items-center justify-between">
      <Button
        variant="ghost"
        size="icon"
        render={<Link to="/" />}
        nativeButton={false}
        aria-label="Back to projects"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.5} />
      </Button>
      {user && <AccountMenu user={user} />}
    </header>
  )
}

function ProjectPage() {
  const project = Route.useLoaderData()
  return (
    <main className="mx-auto min-h-svh max-w-7xl px-5 py-8 sm:px-10 sm:py-12 lg:px-12">
      <ProjectHeader />
      <div className="mx-auto flex max-w-2xl flex-col gap-3 pt-8">
        <h1 className="text-2xl font-medium tracking-tight break-words">
          {project.name}
        </h1>
        {project.description && (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
            {project.description}
          </p>
        )}
      </div>
    </main>
  )
}

function ProjectNotFound() {
  return (
    <main className="mx-auto min-h-svh max-w-7xl px-5 py-8 sm:px-10 sm:py-12 lg:px-12">
      <ProjectHeader />
      <Empty className="min-h-72">
        <EmptyHeader>
          <EmptyTitle>Project not found</EmptyTitle>
        </EmptyHeader>
      </Empty>
    </main>
  )
}
