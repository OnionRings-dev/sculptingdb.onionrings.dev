import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { ProjectPerson } from "@/lib/projects/types"

type UserAvatarProps = {
  user: Pick<ProjectPerson, "name" | "image">
  size?: "default" | "sm" | "lg"
  className?: string
}

export function UserAvatar({ user, size, className }: UserAvatarProps) {
  const initials =
    user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join("")
      .toLocaleUpperCase() || "?"
  return (
    <Avatar size={size} className={className} title={user.name || "User"}>
      {user.image && (
        <AvatarImage src={user.image} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  )
}
