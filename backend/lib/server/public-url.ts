export function absolutizeWithPreferredOrigin(url: string, requestOrigin?: string) {
  const value = String(url || "").trim()
  if (!value) return ""
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value
  const origin = String(requestOrigin || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "")
  if (!origin) return value
  return value.startsWith("/") ? `${origin}${value}` : `${origin}/${value}`
}
