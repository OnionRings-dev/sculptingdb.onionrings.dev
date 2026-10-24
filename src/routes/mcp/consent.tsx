import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Spinner } from "@/components/ui/spinner"
import { decideMcpConsent, getMcpConsent } from "@/lib/mcp/mcp.functions"

export const Route = createFileRoute("/mcp/consent")({
  validateSearch: (search: Record<string, unknown>) => ({
    oauth_query:
      typeof search.oauth_query === "string" ? search.oauth_query : "",
  }),
  loaderDeps: ({ search }) => ({ oauthQuery: search.oauth_query }),
  loader: ({ deps }) =>
    getMcpConsent({ data: { oauthQuery: deps.oauthQuery } }),
  head: () => ({ meta: [{ title: "Authorize MCP | Sculpting DB" }] }),
  component: ConsentPage,
  errorComponent: () => (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Alert className="max-w-sm">
        <AlertDescription>
          This authorization request is expired or unavailable. Start the
          connection again from your MCP client.
        </AlertDescription>
      </Alert>
    </main>
  ),
})
function ConsentPage() {
  const data = Route.useLoaderData()
  const { oauth_query: oauthQuery } = Route.useSearch()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  async function decide(accept: boolean) {
    if (pending) return
    setPending(true)
    setFailed(false)
    try {
      const result = await decideMcpConsent({ data: { oauthQuery, accept } })
      window.location.assign(result.url)
    } catch {
      setFailed(true)
      setPending(false)
    }
  }
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Connect {data.clientName}</CardTitle>
          <CardDescription>{data.projectName}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            {data.canWrite
              ? "Read and edit this diagram, including its history."
              : "Read this diagram and its history."}
          </p>
          <p className="text-xs text-muted-foreground">
            Access stays limited to this project. You can revoke it from the
            editor.
          </p>
          {failed && (
            <Alert variant="destructive">
              <AlertDescription>
                Could not complete authorization. Try again.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void decide(false)
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              void decide(true)
            }}
            disabled={pending}
          >
            {pending && <Spinner data-icon="inline-start" />}Authorize
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
