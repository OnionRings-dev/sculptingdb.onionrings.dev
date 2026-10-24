import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, Link01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  disconnectMcp,
  getMcpConnection,
  getMcpStatus,
} from "@/lib/mcp/mcp.functions"

type Connection = NonNullable<Awaited<ReturnType<typeof getMcpConnection>>>

function CopyField({
  label,
  value,
  rows,
}: {
  label: string
  value: string
  rows?: number
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <InputGroup>
        {rows ? (
          <InputGroupTextarea
            aria-label={label}
            value={value}
            readOnly
            rows={rows}
          />
        ) : (
          <InputGroupInput aria-label={label} value={value} readOnly />
        )}
        <InputGroupAddon align={rows ? "block-end" : "inline-end"}>
          <InputGroupButton
            aria-label={`Copy ${label}`}
            onClick={() => {
              void copy()
            }}
          >
            <HugeiconsIcon
              icon={Copy01Icon}
              data-icon="inline-start"
              strokeWidth={1.5}
            />
            {copied ? "Copied" : "Copy"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {failed && (
        <FieldError>
          Could not copy. Select the text to copy it manually.
        </FieldError>
      )}
    </Field>
  )
}

export function McpConnection({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next)
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label="Connect MCP"
        title="Connect MCP"
      >
        <HugeiconsIcon icon={Link01Icon} strokeWidth={1.5} />
      </DialogTrigger>
      {open && (
        <ConnectionDialog
          key={projectId}
          projectId={projectId}
          pending={pending}
          setPending={setPending}
        />
      )}
    </Dialog>
  )
}

function ConnectionDialog({
  projectId,
  pending,
  setPending,
}: {
  projectId: string
  pending: boolean
  setPending: (value: boolean) => void
}) {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getMcpConnection({ data: { projectId } })
      .then((data) => {
        if (cancelled) return
        if (!data) throw new Error("Unavailable")
        setConnection(data)
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the connection. Try again.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const interval = setInterval(() => {
      getMcpStatus({ data: { projectId } })
        .then((status) => {
          if (!cancelled)
            setConnection((current) =>
              current ? { ...current, status } : current
            )
        })
        .catch(() => {
          /* The next poll retries; no credentials are kept in the browser. */
        })
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [projectId, attempt])
  async function revoke(authorizationId: string) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      if (!(await disconnectMcp({ data: { projectId, authorizationId } })))
        throw new Error("Unavailable")
      const status = await getMcpStatus({ data: { projectId } })
      setConnection((current) => (current ? { ...current, status } : current))
    } catch {
      setError("Could not revoke access. Try again.")
    } finally {
      setPending(false)
    }
  }
  const name = `sculpting-${projectId.slice(0, 8)}`
  return (
    <DialogContent
      className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
      showCloseButton={!pending}
    >
      <DialogHeader>
        <DialogTitle>Connect MCP</DialogTitle>
        <DialogDescription>
          Connect your client, then authorize this project in the browser.
        </DialogDescription>
      </DialogHeader>
      {loading ? (
        <div
          role="status"
          aria-label="Loading connection"
          className="flex justify-center p-6"
        >
          <Spinner />
        </div>
      ) : connection ? (
        <>
          <FieldGroup>
            <CopyField label="Project URL" value={connection.resource} />
            <CopyField
              label="Codex"
              value={`codex mcp add ${name} --url ${connection.resource}\ncodex mcp login ${name} --oauth-client-registration dcr`}
              rows={3}
            />
            <CopyField
              label="OpenCode · opencode.json"
              value={JSON.stringify(
                {
                  $schema: "https://opencode.ai/config.json",
                  mcp: {
                    servers: {
                      [name]: {
                        type: "remote",
                        url: connection.resource,
                        protocol: "2026-07-28",
                      },
                    },
                  },
                },
                null,
                2
              )}
              rows={8}
            />
          </FieldGroup>
          <p className="text-xs text-muted-foreground">
            In OpenCode, run <code>opencode mcp auth {name}</code>. Ask your
            agent to open this project when you are ready.
          </p>
          <Separator />
          <div className="flex flex-col gap-3" aria-label="MCP access">
            <p className="text-sm">
              {connection.status?.lease
                ? `In use by ${connection.status.lease.userName} · ${connection.status.lease.clientName ?? "MCP client"}`
                : "No active MCP client"}
            </p>
            {connection.status?.grants.map((grant) => (
              <div
                key={grant.id}
                className="flex min-w-0 items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {grant.clientName ?? "MCP client"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {grant.userName}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    void revoke(grant.id)
                  }}
                >
                  Revoke access
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Button
          variant="outline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry
        </Button>
      )}
      {error && <FieldError role="alert">{error}</FieldError>}
    </DialogContent>
  )
}
