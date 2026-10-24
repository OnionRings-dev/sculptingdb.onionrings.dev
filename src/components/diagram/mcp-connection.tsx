import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { McpServerIcon } from "@hugeicons/core-free-icons"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldGroup,
} from "@/components/ui/field"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  disconnectMcp,
  disconnectMcpClient,
  getMcpConnection,
  getMcpStatus,
  setMcpProjectAccess,
} from "@/lib/mcp/mcp.functions"
import { McpConnectInstructions } from "./mcp-connect-instructions"

type Connection = NonNullable<Awaited<ReturnType<typeof getMcpConnection>>>
type Client = NonNullable<Connection["status"]>["clients"][number]

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
        aria-label="MCP clients"
        title="MCP clients"
      >
        <HugeiconsIcon icon={McpServerIcon} strokeWidth={1.5} />
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

function ClientRow({
  client,
  pending,
  onToggle,
  onDisconnect,
}: {
  client: Client
  pending: boolean
  onToggle: (enabled: boolean) => void
  onDisconnect: () => Promise<boolean>
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <Field orientation="horizontal">
        <FieldContent className="min-w-0">
          <FieldLabel
            htmlFor={`mcp-${client.id}`}
            className="truncate"
            title={`Client ID: ${client.clientId}`}
          >
            {client.clientName} · {client.id.slice(-6)}
          </FieldLabel>
          <FieldDescription className="truncate">
            {client.userName}
          </FieldDescription>
        </FieldContent>
        <Switch
          id={`mcp-${client.id}`}
          aria-label={`Allow ${client.clientName} ${client.id.slice(-6)} to access this project`}
          checked={client.enabled}
          disabled={pending || !client.canToggle}
          onCheckedChange={onToggle}
        />
        {client.isOwn && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setConfirm(true)}
          >
            Disconnect
          </Button>
        )}
      </Field>
      <AlertDialog
        open={confirm}
        onOpenChange={(next) => {
          if (!pending) setConfirm(next)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {client.clientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the client's access to all your projects. You can
              connect it again later. To disable only this project, use its
              switch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => {
                void onDisconnect().then((success) => {
                  if (success) setConfirm(false)
                })
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  const [instructions, setInstructions] = useState(false)
  const generation = useRef(0)
  const busy = useRef(false)
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
      if (busy.current) return
      const requestGeneration = generation.current
      getMcpStatus({ data: { projectId } })
        .then((status) => {
          if (!cancelled && requestGeneration === generation.current)
            setConnection((current) =>
              current ? { ...current, status } : current
            )
        })
        .catch(() => {
          /* Retry on the next poll. */
        })
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
      generation.current++
    }
  }, [projectId, attempt])
  async function mutate(action: () => Promise<boolean>) {
    if (busy.current) return false
    busy.current = true
    generation.current++
    setPending(true)
    setError(null)
    try {
      if (!(await action())) throw new Error("Unavailable")
      const status = await getMcpStatus({ data: { projectId } })
      setConnection((current) => (current ? { ...current, status } : current))
      return true
    } catch {
      setError("Could not update client access. Try again.")
      return false
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const status = connection?.status
  return (
    <DialogContent
      className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
      showCloseButton={false}
    >
      <DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <DialogTitle>
            {instructions ? "Connect a client" : "MCP clients"}
          </DialogTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !connection}
            onClick={() => setInstructions((value) => !value)}
          >
            <span className="relative top-px">
              {instructions ? "Back" : "Connect"}
            </span>
          </Button>
        </div>
        <DialogDescription>
          {instructions
            ? "Connect Sculpting DB once, then choose which projects to enable."
            : "Choose which clients can access this project."}
        </DialogDescription>
      </DialogHeader>
      {loading ? (
        <div
          role="status"
          aria-label="Loading clients"
          className="flex justify-center p-6"
        >
          <Spinner />
        </div>
      ) : connection ? (
        instructions ? (
          <McpConnectInstructions resource={connection.resource} />
        ) : (
          <>
            {status?.lease && (
              <p className="text-xs text-muted-foreground">
                In use by {status.lease.userName} ·{" "}
                {status.lease.clientName ?? "MCP client"}
              </p>
            )}
            {!!status?.clients.length && (
              <FieldGroup aria-label="Connected MCP clients">
                {status.clients.map((client) => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    pending={pending}
                    onToggle={(enabled) => {
                      void mutate(() =>
                        setMcpProjectAccess({
                          data: { projectId, connectionId: client.id, enabled },
                        })
                      )
                    }}
                    onDisconnect={() =>
                      mutate(() =>
                        disconnectMcpClient({
                          data: { connectionId: client.id },
                        })
                      )
                    }
                  />
                ))}
              </FieldGroup>
            )}
            {!!status?.legacy.length && (
              <>
                {!!status.clients.length && <Separator />}
                <p className="text-xs text-muted-foreground">
                  Project connections
                </p>
                {status.legacy.map((grant) => (
                  <div
                    key={grant.id}
                    className="flex min-w-0 items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {grant.clientName ?? "MCP client"} ·{" "}
                        {grant.id.slice(-6)}
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
                        void mutate(() =>
                          disconnectMcp({
                            data: { projectId, authorizationId: grant.id },
                          })
                        )
                      }}
                    >
                      Revoke access
                    </Button>
                  </div>
                ))}
              </>
            )}
            {!status?.clients.length && !status?.legacy.length && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No clients connected</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </>
        )
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
