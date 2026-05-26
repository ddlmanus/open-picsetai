export async function analyzeReferenceImagesWithGemini(_params: unknown) {
  return { status: "skipped", summary: "" }
}

export function buildImageUnderstandingPromptContext(summary: string, _language?: string) {
  const normalized = String(summary || "").trim()
  return normalized ? `Reference image understanding:\n${normalized}` : ""
}
