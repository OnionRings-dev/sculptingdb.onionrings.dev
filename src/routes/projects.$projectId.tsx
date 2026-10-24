import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { AccountMenu } from "@/components/account/account-menu"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { getDiagram } from "@/lib/diagram/diagram.functions"
import { DiagramEditor } from "@/components/diagram/diagram-editor"

export const Route = createFileRoute("/projects/$projectId")({
  loader: async ({ params }) => {
    const project = await getDiagram({ data: params.projectId })
    if (!project) throw notFound()
    return project
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.project.name} | Sculpting DB`
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
  const data = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  return user ? (
    <DiagramEditor key={data.project.id} initialData={data} user={user} />
  ) : null
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
