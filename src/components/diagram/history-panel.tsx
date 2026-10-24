import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import type { HistoryEntry } from "@/lib/diagram/model"

export function HistoryPanel({
  history,
  selectedRevision,
  pending,
  onClose,
  onSelect,
}: {
  history: Array<HistoryEntry>
  selectedRevision: number
  pending: boolean
  onClose: () => void
  onSelect: (revision: number) => void
}) {
  return (
    <aside
      id="diagram-history"
      aria-label="History"
      className="flex h-full w-72 max-w-[44vw] shrink-0 flex-col border-r bg-background"
    >
      <header className="flex h-18 shrink-0 items-center justify-between gap-2 px-4">
        <h2 className="text-sm font-medium">History</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close history"
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
        </Button>
      </header>
      {history.length ? (
        <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4">
          {history.map((entry) => (
            <li key={entry.revision}>
              <button
                type="button"
                disabled={pending}
                onClick={() => onSelect(entry.revision)}
                aria-current={
                  entry.revision === selectedRevision ? "true" : undefined
                }
                className={cn(
                  "flex w-full flex-col gap-1 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  entry.revision === selectedRevision
                    ? "bg-muted"
                    : "hover:bg-muted/50"
                )}
                title={entry.createdAt}
              >
                <span className="text-sm break-words">{entry.summary}</span>
                <span className="text-xs text-muted-foreground">
                  v{entry.revision} · {entry.actorName || "Deleted user"} ·{" "}
                  {entry.origin === "mcp"
                    ? "AI"
                    : entry.origin === "restore"
                      ? "Restore"
                      : "Manual"}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>No changes yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </aside>
  )
}
