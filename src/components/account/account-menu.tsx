import { useState } from "react"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import { Logout01Icon, Settings01Icon } from "@hugeicons/core-free-icons"
import { UserAvatar } from "./user-avatar"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { authClient } from "@/lib/auth/client"
import { authNavigation } from "@/lib/auth/navigation"
import type { AccountUser } from "@/lib/projects/types"

export function AccountMenu({ user }: { user: AccountUser }) {
  const { theme, setTheme } = useTheme()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut() {
    if (pending) return
    authNavigation.beginSignOut()
    setPending(true)
    setFailed(false)
    try {
      const result = await authClient.signOut({
        callbackURL: "/",
        disableRedirect: true,
      })
      if (result.error || !result.data.url) throw new Error("Sign-out failed")
      window.location.assign(result.data.url)
    } catch {
      authNavigation.retrySignOut()
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <div className="relative flex shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-8 rounded-full border-0 p-0"
            />
          }
          aria-label="Account"
          disabled={pending}
          aria-busy={pending}
        >
          <UserAvatar user={user} size="lg" className="after:border-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={10} className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="truncate">{user.name || "Account"}</div>
              <div className="truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.5} />
                Appearance
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuGroup>
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={setTheme}
                  >
                    <DropdownMenuRadioItem value="light">
                      Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      System
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onClick={signOut}
              disabled={pending}
            >
              <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.5} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && (
        <Alert
          variant="destructive"
          className="absolute top-full right-0 mt-3 w-64"
        >
          <AlertDescription>Could not log out. Try again.</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
