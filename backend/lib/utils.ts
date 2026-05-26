export function parseDataUri(input: string) {
  const value = String(input || "").trim()
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!match) return null
  const mimeType = match[1] || "application/octet-stream"
  const data = match[3] || ""
  return {
    mimeType,
    mime: mimeType,
    isBase64: Boolean(match[2]),
    data,
    base64Data: Boolean(match[2]) ? data : "",
  }
}
