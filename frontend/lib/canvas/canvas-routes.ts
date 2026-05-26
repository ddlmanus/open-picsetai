export function buildCanvasProjectUrl(projectId?: string | null) {
  const normalized = String(projectId || "").trim()
  return normalized ? `/canvas-studio?projectId=${encodeURIComponent(normalized)}` : "/canvas-studio"
}
