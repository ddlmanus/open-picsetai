import {
  generateApimartImage,
  getApimartImageModelKind,
  isApimartImageProvider,
} from "@/lib/models/providers/apimart-image"
import { normalizeProviderModelId } from "@/lib/models/runtime-id"

function buildImageGenerationEndpoint(endpointBase: string) {
  const base = String(endpointBase || "https://api.openai.com/v1").replace(/\/$/, "")
  if (/\/images\/generations$/.test(base)) return base
  if (/\/v1$/.test(base)) return `${base}/images/generations`
  return `${base}/v1/images/generations`
}

function normalizeReferenceImages(options: Record<string, any>) {
  return Array.isArray(options?.referenceImages)
    ? options.referenceImages.map((item: any) => String(item || "").trim()).filter(Boolean)
    : []
}

async function generateOpenAICompatibleImage(params: {
  prompt: string
  modelId: string
  provider: any
  apiKey: string
  endpointBase: string
  options: Record<string, any>
}) {
  const endpoint = buildImageGenerationEndpoint(params.endpointBase)
  const referenceImages = normalizeReferenceImages(params.options)
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: normalizeProviderModelId(params.modelId),
      prompt: params.prompt,
      n: 1,
      size: String(params.options?.imageSize || params.options?.size || "1024x1024"),
      response_format: "url",
      reference_images: referenceImages,
      image_urls: referenceImages,
      aspect_ratio: params.options?.aspectRatio,
      quality: params.options?.quality,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Image model request failed: HTTP ${response.status}`)
  }
  const first = Array.isArray(payload?.data) ? payload.data[0] : null
  return {
    ...payload,
    imageUrl: payload?.imageUrl || payload?.url || first?.url || payload?.data?.image_urls?.[0] || payload?.image_urls?.[0] || "",
    imageBase64: payload?.imageBase64 || first?.b64_json || "",
    provider: params.provider?.key || "env",
  }
}

function resolveImageRuntime(provider: any) {
  const apiKey = String(provider?.apiKey || provider?.api_key || process.env.STUDIO_GENESIS_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim()
  const explicitEndpoint = String(provider?.imageEndpoint || process.env.STUDIO_GENESIS_IMAGE_ENDPOINT || "").trim()
  const baseUrl = String(provider?.baseUrl || process.env.STUDIO_GENESIS_IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")
  return {
    apiKey,
    endpointBase: explicitEndpoint || baseUrl,
    baseUrl,
  }
}

export const modelRouter = {
  async generateWithDbCredentials(
    prompt: string,
    modelId: string,
    provider: any,
    options: Record<string, any>,
    _type?: string
  ) {
    const runtime = resolveImageRuntime(provider)
    if (!runtime.apiKey) throw new Error("未配置图片模型 API Key")

    const providerModelId = normalizeProviderModelId(modelId)

    if (isApimartImageProvider(provider, runtime.endpointBase) && getApimartImageModelKind(providerModelId)) {
      return generateApimartImage({
        prompt,
        modelId: providerModelId,
        apiKey: runtime.apiKey,
        endpointBase: runtime.endpointBase,
        options,
        providerKey: provider?.key || "apimart",
      })
    }

    return generateOpenAICompatibleImage({
      prompt,
      modelId: providerModelId,
      provider,
      apiKey: runtime.apiKey,
      endpointBase: runtime.endpointBase,
      options,
    })
  },
  async generate(prompt: string, modelId: string, options: Record<string, any>) {
    return this.generateWithDbCredentials(prompt, modelId, {}, options)
  },
  getProvider(_providerKey: string) {
    return {
      editImage: async (imageUrls: string[], prompt: string, modelId: string, options: Record<string, any>) => {
        const result = await this.generateWithDbCredentials(prompt, modelId, {}, {
          ...options,
          referenceImages: imageUrls,
        })
        return result?.imageUrl || result?.url || ""
      },
    }
  },
}
