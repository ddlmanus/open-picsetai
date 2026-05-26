export function buildModelRuntimeId(modelId: string, providerId?: string | null) {
  const model = String(modelId || "").trim()
  const provider = String(providerId || "").trim()
  return provider ? `${provider}:${model}` : model
}

export function parseModelRuntimeId(runtimeId: string) {
  const value = String(runtimeId || "").trim()
  const separatorIndex = value.indexOf(":")
  if (separatorIndex === -1) return { providerId: "", modelId: value }
  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  }
}

export function normalizeProviderModelId(modelId: string) {
  return parseModelRuntimeId(modelId).modelId
}
