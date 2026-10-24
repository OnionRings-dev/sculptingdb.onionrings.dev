import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth/client"
import { useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"

export const Route = createFileRoute("/")({ component: App })

function App() {
  const { user } = Route.useRouteContext()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut() {
    setPending(true)
    setFailed(false)
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error("Sign-out failed")
      window.location.assign("/login")
    } catch {
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4">
        <h1>Welcome{user?.name ? `, ${user.name}` : ""}.</h1>
        <Button
          variant="outline"
          disabled={pending}
          aria-busy={pending}
          onClick={signOut}
        >
          Log out
        </Button>
        {failed && (
          <Alert variant="destructive">
            <AlertDescription>
              Sign-out could not be completed. Please try again.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}
