import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon } from "@hugeicons/core-free-icons"
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

export function McpConnectInstructions({ resource }: { resource: string }) {
  return (
    <>
      <FieldGroup>
        <CopyField label="Server URL" value={resource} />
        <CopyField
          label="Codex"
          value={`codex mcp add sculpting-db --url ${resource} --oauth-client-registration dcr`}
          rows={3}
        />
        <CopyField
          label="OpenCode · opencode.json"
          value={JSON.stringify(
            {
              $schema: "https://opencode.ai/config.json",
              mcp: {
                servers: {
                  "sculpting-db": {
                    type: "remote",
                    url: resource,
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
        Codex starts authorization when adding the server. Use{" "}
        <code>codex mcp login sculpting-db</code> only if it still needs
        authorization. In OpenCode, run{" "}
        <code>opencode mcp auth sculpting-db</code>.
      </p>
      <p className="text-xs text-muted-foreground">
        After connecting, return here to enable this project. Remove the old
        project-specific server entries from your client after switching.
      </p>
    </>
  )
}
