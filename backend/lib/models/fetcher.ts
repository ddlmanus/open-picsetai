import { normalizeProviderModelId, parseModelRuntimeId } from "@/lib/models/runtime-id"

export type ModelConfigWithProvider = {
  id?: string
  providerId?: string
  modelId?: string
  name?: string
  type?: "CHAT" | "IMAGE"
  usageScene?: string
  cost?: number
  provider?: any
}

function readJsonModels(): ModelConfigWithProvider[] {
  const raw = String(process.env.STUDIO_GENESIS_MODELS_JSON || process.env.STUDIO_GENESIS_MODELS || "").trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : [parsed.text, parsed.image].filter(Boolean)
    return list.map((item: any) => normalizeEnvModel(item)).filter(Boolean) as ModelConfigWithProvider[]
  } catch {
    return []
  }
}

function normalizeEnvModel(input: any): ModelConfigWithProvider | null {
  const type = String(input?.type || input?.category || "").toUpperCase() === "IMAGE" ? "IMAGE" : "CHAT"
  const rawModelId = String(input?.modelId || input?.model || "").trim()
  const parsedRawModelId = parseModelRuntimeId(rawModelId)
  const modelId = normalizeProviderModelId(rawModelId)
  if (!modelId) return null
  const providerKey = String(input?.providerKey || input?.provider?.key || input?.provider || parsedRawModelId.providerId || (type === "IMAGE" ? "image" : "openai")).trim()
  return {
    id: `${providerKey}:${modelId}`,
    providerId: providerKey,
    modelId,
    name: String(input?.name || modelId).trim(),
    type,
    usageScene: type === "IMAGE" ? "STUDIO_GENESIS_IMAGE" : "STUDIO_GENESIS_TEXT",
    cost: Number(input?.cost || 0),
    provider: {
      key: providerKey,
      name: String(input?.providerName || input?.provider?.name || providerKey).trim(),
      baseUrl: String(input?.baseUrl || input?.provider?.baseUrl || "").trim(),
      apiKey: String(input?.apiKey || input?.provider?.apiKey || "").trim(),
      imageEndpoint: String(input?.imageEndpoint || input?.provider?.imageEndpoint || "").trim(),
      supportOpenAI: input?.supportOpenAI ?? true,
      isThirdParty: input?.isThirdParty ?? true,
      isEnabled: true,
    },
  }
}

function modelFromPrefix(prefix: string, type: "CHAT" | "IMAGE"): ModelConfigWithProvider | null {
  const modelId = String(process.env[`${prefix}_MODEL`] || process.env[`${prefix}_MODEL_ID`] || "").trim()
  if (!modelId) return null
  const providerKey = String(process.env[`${prefix}_PROVIDER`] || (type === "IMAGE" ? "image" : "openai")).trim()
  return normalizeEnvModel({
    type,
    modelId,
    name: process.env[`${prefix}_NAME`] || modelId,
    providerKey,
    providerName: process.env[`${prefix}_PROVIDER_NAME`] || providerKey,
    baseUrl: process.env[`${prefix}_BASE_URL`] || process.env.OPENAI_BASE_URL || "",
    apiKey: process.env[`${prefix}_API_KEY`] || process.env.OPENAI_API_KEY || "",
    imageEndpoint: process.env[`${prefix}_ENDPOINT`] || "",
    cost: process.env[`${prefix}_COST`] || 0,
  })
}

export function listEnvModelConfigs(type?: "CHAT" | "IMAGE") {
  const models = [
    ...readJsonModels(),
    modelFromPrefix("STUDIO_GENESIS_TEXT", "CHAT"),
    modelFromPrefix("STUDIO_GENESIS_CHAT", "CHAT"),
    modelFromPrefix("STUDIO_GENESIS_IMAGE", "IMAGE"),
  ].filter(Boolean) as ModelConfigWithProvider[]

  const seen = new Set<string>()
  return models.filter((model) => {
    if (type && model.type !== type) return false
    const key = `${model.providerId || model.provider?.key || ""}:${model.modelId || ""}:${model.type || ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function getEffectiveModelConfig(runtimeId: string, _merchantId?: string | null): Promise<ModelConfigWithProvider | null> {
  const requested = String(runtimeId || "").trim()
  const models = listEnvModelConfigs()
  return models.find((model) => {
    const providerId = String(model.providerId || model.provider?.key || "").trim()
    const modelId = String(model.modelId || "").trim()
    return requested === modelId || requested === `${providerId}:${modelId}`
  }) || null
}

export async function getPreferredModelConfigByScene(params: {
  merchantId?: string | null
  usageScene?: string
  type?: "CHAT" | "IMAGE"
}) {
  return listEnvModelConfigs(params.type)[0] || null
}

export async function resolveMerchantSceneRuntimeModel(params: {
  merchantId?: string | null
  usageScene: string
  type: "CHAT" | "IMAGE"
}) {
  const modelConfig = listEnvModelConfigs(params.type)[0] || null
  if (!modelConfig) return null
  return {
    modelId: modelConfig.modelId,
    modelConfig,
  }
}
