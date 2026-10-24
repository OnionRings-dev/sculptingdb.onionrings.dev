// Types are freeform model text. Recognize common SQL/TypeScript aliases without
// rewriting the displayed type; custom types keep the neutral theme color.
export function dataTypeColor(dataType: string): string {
  const type = dataType
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\?$/, "")
    .trim()
  if (/\[\s*\]$/.test(type) || /^(array|list|set)(\s*<|$)/.test(type))
    return "text-data-type-array"
  if (
    /^(string|text|varchar|nvarchar|char|nchar|character|citext)\b/.test(type)
  )
    return "text-data-type-string"
  if (/^(bool|boolean|bit)\b/.test(type)) return "text-data-type-boolean"
  if (
    /^(number|smallint|integer|int\d*|bigint|uint\d*|tinyint|mediumint|serial|smallserial|bigserial|float\d*|double|real|decimal|numeric|money)\b/.test(
      type
    )
  )
    return "text-data-type-number"
  if (
    /^(date|datetime\d*|timestamp|timestamptz|time|timetz|interval)\b/.test(
      type
    )
  )
    return "text-data-type-date"
  if (/^(uuid|guid|ulid)\b/.test(type)) return "text-data-type-id"
  if (/^(json|jsonb|object|record|map|struct)\b/.test(type))
    return "text-data-type-json"
  if (
    /^(binary|varbinary|blob|bytea|bytes|buffer|uint8array|arraybuffer)\b/.test(
      type
    )
  )
    return "text-data-type-binary"
  if (/^enum\b/.test(type)) return "text-data-type-enum"
  return "text-muted-foreground"
}
