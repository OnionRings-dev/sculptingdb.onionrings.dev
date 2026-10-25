import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  GithubIcon,
  Key01Icon,
} from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { dataTypeColor } from "@/components/diagram/data-type-color"
import { useSignIn } from "@/lib/auth/use-sign-in"
import { mcpLoginCallback } from "@/lib/mcp/login"

const exampleEntities = [
  {
    name: "User",
    fields: [
      { name: "id", type: "uuid" },
      { name: "name", type: "string" },
      { name: "email", type: "string" },
    ],
  },
  {
    name: "Project",
    fields: [
      { name: "id", type: "uuid" },
      { name: "ownerId", type: "uuid" },
      { name: "name", type: "string" },
    ],
  },
]

function DiagramExample() {
  return (
    <figure className="project-preview relative isolate flex flex-col items-center justify-center gap-12 overflow-hidden rounded-3xl border px-6 py-12 sm:flex-row sm:gap-10 sm:py-24">
      <figcaption className="sr-only">
        An example schema connecting a User to their Projects.
      </figcaption>
      <svg
        className="absolute inset-0 -z-1 size-full stroke-muted-foreground/50"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M 30 50 H 70"
          className="hidden sm:block"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M 50 30 V 70"
          className="sm:hidden"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {exampleEntities.map((entity) => (
        <Card key={entity.name} size="sm" className="w-48 shrink-0 gap-3">
          <CardHeader>
            <CardTitle>{entity.name}</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent>
            <dl className="flex flex-col gap-2 font-mono text-xs">
              {entity.fields.map((field) => (
                <div key={field.name} className="flex items-center gap-2">
                  <dt className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex size-3 shrink-0 items-center">
                      {field.name === "id" && (
                        <HugeiconsIcon
                          icon={Key01Icon}
                          className="size-3"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    {field.name}
                  </dt>
                  <dd className={dataTypeColor(field.type)}>{field.type}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </figure>
  )
}

export function LandingPage({ authError }: { authError?: string }) {
  const { pending, failed, signIn } = useSignIn()
  return (
    <div className="mx-auto flex min-h-svh max-w-6xl flex-col px-6 sm:px-10">
      <header className="flex items-center justify-between gap-4 py-6 sm:py-8">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="text-sm font-medium">Sculpting DB</span>
          <Badge variant="beta">Beta</Badge>
        </div>
        <Button
          variant="ghost"
          nativeButton={false}
          render={
            <a
              href="https://github.com/OnionRings-dev/sculptingdb.onionrings.dev"
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <HugeiconsIcon
            icon={GithubIcon}
            data-icon="inline-start"
            aria-hidden="true"
          />
          GitHub
        </Button>
      </header>
      <main className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1fr_1.1fr] lg:gap-14 lg:py-24">
        <div className="flex max-w-lg flex-col items-start gap-7">
          <h1 className="text-5xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
            Shape your data.
            <br />
            <span className="text-muted-foreground">Then build.</span>
          </h1>
          <p className="max-w-sm text-base leading-relaxed text-pretty text-muted-foreground">
            Design entities and relationships on a simple canvas. Work by hand
            or connect your AI, and keep every iteration.
          </p>
          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                void signIn(mcpLoginCallback(window.location.search))
              }}
            >
              Start sketching
              {pending ? (
                <Spinner data-icon="inline-end" aria-hidden="true" />
              ) : (
                <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
              )}
            </Button>
            {(failed || (authError && !pending)) && (
              <Alert variant="destructive" className="max-w-sm">
                <AlertDescription>
                  Sign-in could not be completed. Please try again.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
        <DiagramExample />
      </main>
    </div>
  )
}
