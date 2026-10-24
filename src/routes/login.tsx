import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { authClient } from "@/lib/auth/client"

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  head: () => ({ meta: [{ title: "Login | Sculpting DB" }] }),
  component: LoginPage,
})

function LoginPage() {
  const { error } = Route.useSearch()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signIn() {
    setPending(true)
    setFailed(false)

    try {
      const result = await authClient.signIn.social({
        provider: "onionrings",
        callbackURL: "/",
        errorCallbackURL: "/login",
      })
      if (result.error || !result.data.url) {
        setFailed(true)
        setPending(false)
      }
    } catch {
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="relative flex flex-col items-center">
        <Button disabled={pending} aria-busy={pending} onClick={signIn}>
          Login
        </Button>
        {(error || failed) && (
          <Alert
            variant="destructive"
            className="absolute top-full mt-4 w-72 max-w-[calc(100vw-3rem)]"
          >
            <AlertDescription>
              Sign-in could not be completed. Please try again.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}
