export function isZenmuxProvider(provider: any) {
  return String(provider?.key || "").toLowerCase().includes("zenmux")
}

export function createZenmuxChatProvider(_config: unknown): never {
  throw new Error("Zenmux adapter is not wired in this minimal migration.")
}

export function createZenmuxVertexProvider(_config: unknown): never {
  throw new Error("Zenmux vertex adapter is not wired in this minimal migration.")
}

export function normalizeZenmuxVertexBaseUrl(baseUrl?: string | null) {
  return String(baseUrl || "").trim()
}

export function resolveZenmuxProtocol(_modelId: string, _type?: string) {
  return "openai-chat"
}
