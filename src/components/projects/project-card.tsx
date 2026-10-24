import { Link } from "@tanstack/react-router"
import { UserAvatar } from "@/components/account/user-avatar"
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
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
  const { collaborators } = project
  return (
    <div className="relative min-w-0">
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="block min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <Card className="h-full gap-0 py-0">
          <CardContent className="p-0">
            <ProjectPreview preview={project.preview} />
          </CardContent>
          <CardHeader className="min-h-21 min-w-0 gap-x-3 border-t py-4">
            <CardTitle className="min-w-0 truncate">{project.name}</CardTitle>
            <CardDescription className="min-h-5 min-w-0 truncate">
              {project.description}
            </CardDescription>
            {collaborators.length > 0 && (
              <CardAction className="self-center">
                <AvatarGroup aria-label="Collaborators">
                  {collaborators.slice(0, 3).map((person) => (
                    <UserAvatar key={person.id} user={person} size="sm" />
                  ))}
                  {collaborators.length > 3 && (
                    <AvatarGroupCount
                      title={collaborators
                        .slice(3)
                        .map(({ name }) => name || "User")
                        .join(", ")}
                    >
                      +{collaborators.length - 3}
                    </AvatarGroupCount>
                  )}
                </AvatarGroup>
              </CardAction>
            )}
          </CardHeader>
        </Card>
      </Link>
      {project.canDelete && (
        <div className="absolute top-2 right-2">
          <ProjectActions project={project} />
        </div>
      )}
    </div>
  )
}
