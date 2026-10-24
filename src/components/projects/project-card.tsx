import { Link } from "@tanstack/react-router"
import { UserAvatar } from "@/components/account/user-avatar"
import { Separator } from "@/components/ui/separator"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ProjectPreview } from "./project-preview"
import { ProjectActions } from "./project-actions"
import type { ProjectSummary } from "@/lib/projects/types"

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Card className="relative h-full min-w-0 gap-0 py-0">
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="block min-w-0 rounded-xl outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-ring"
      >
        <CardContent className="p-0">
          <ProjectPreview preview={project.preview} />
        </CardContent>
        <Separator />
        <CardHeader className="min-h-14 min-w-0 content-center items-center gap-x-3 gap-y-0 rounded-none py-3">
          <CardTitle className="min-w-0 truncate">{project.name}</CardTitle>
          {project.description && (
            <CardDescription className="min-w-0 truncate">
              {project.description}
            </CardDescription>
          )}
          {!project.isOwner && (
            <CardAction
              className="self-center"
              aria-label={`Project owner: ${project.owner.name || "User"}`}
            >
              <UserAvatar user={project.owner} size="sm" />
            </CardAction>
          )}
        </CardHeader>
      </Link>
      {project.canDelete && (
        <div className="absolute top-2 right-2">
          <ProjectActions project={project} />
        </div>
      )}
    </Card>
  )
}
