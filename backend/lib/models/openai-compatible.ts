import {
  generateApimartImage,
  getApimartImageModelKind,
  isApimartImageProvider,
} from "@/lib/models/providers/apimart-image"
import { normalizeProviderModelId } from "@/lib/models/runtime-id"

export class OpenAICompatibleProvider {
  constructor(private readonly config: {
    baseUrl?: string
    apiKey: string
    modelId: string
    providerName?: string
    providerConfig?: Record<string, unknown>
  }) {}

  private isApimartBaseUrl(baseUrl: string) {
    try {
      return new URL(baseUrl).hostname.toLowerCase().includes("api.apimart.ai")
    } catch {
      return String(baseUrl || "").toLowerCase().includes("api.apimart.ai")
    }
  }

  private buildChatCompletionsEndpoint(baseUrl: string) {
    return /\/chat\/completions$/.test(baseUrl)
      ? baseUrl
      : /\/v1$/.test(baseUrl)
        ? `${baseUrl}/chat/completions`
        : `${baseUrl}/v1/chat/completions`
  }

  private buildResponsesEndpoint(baseUrl: string) {
    if (/\/responses$/.test(baseUrl)) return baseUrl
    if (/\/chat\/completions$/.test(baseUrl)) return baseUrl.replace(/\/chat\/completions$/, "/responses")
    if (/\/v1$/.test(baseUrl)) return `${baseUrl}/responses`
    return `${baseUrl}/v1/responses`
  }

  private hasImageInput(messages: unknown[]) {
    return messages.some((message: any) => {
      const content = message?.content
      return Array.isArray(content) && content.some((item: any) => item?.type === "image_url" || item?.image_url)
    })
  }

  private toResponsesInput(messages: unknown[]) {
    return (Array.isArray(messages) ? messages : []).map((message: any) => {
      const role = String(message?.role || "user").trim() || "user"
      const content = message?.content
      if (Array.isArray(content)) {
        return {
          role,
          content: content
            .map((item: any) => {
              if (item?.type === "text") {
                const text = String(item.text || "").trim()
                return text ? { type: "input_text", text } : null
              }
              if (item?.type === "image_url" || item?.image_url) {
                const imageUrl = String(item?.image_url?.url || item?.image_url || "").trim()
                return imageUrl ? { type: "input_image", image_url: imageUrl } : null
              }
              const text = String(item?.text || "").trim()
              return text ? { type: "input_text", text } : null
            })
            .filter(Boolean),
        }
      }

      return {
        role,
        content: [
          {
            type: "input_text",
            text: String(content || "").trim(),
          },
        ].filter((item) => item.text),
      }
    })
  }

  private extractResponsesContent(payload: any) {
    const body = payload?.data && typeof payload.data === "object" ? payload.data : payload
    const choiceContent = body?.choices?.[0]?.message?.content
    if (typeof choiceContent === "string") return choiceContent

    const outputText = String(body?.output_text || "").trim()
    if (outputText) return outputText

    const output = Array.isArray(body?.output) ? body.output : []
    const textParts: string[] = []
    for (const item of output) {
      const content = Array.isArray(item?.content) ? item.content : []
      for (const part of content) {
        const text = String(part?.text || part?.content || "").trim()
        if (text) textParts.push(text)
      }
    }
    return textParts.join("\n").trim()
  }

  async chat(messages: unknown[], options: Record<string, unknown>) {
    const baseUrl = String(this.config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")
    const resolvedModelId = normalizeProviderModelId(String(options.model || this.config.modelId || ""))
    const supportsTemperature = !/^gpt-5(?:\.|$)/i.test(resolvedModelId)
    const shouldUseResponsesApi = this.isApimartBaseUrl(baseUrl) && this.hasImageInput(messages)
    const endpoint = shouldUseResponsesApi
      ? this.buildResponsesEndpoint(baseUrl)
      : this.buildChatCompletionsEndpoint(baseUrl)
    const body = shouldUseResponsesApi
      ? {
          model: resolvedModelId,
          input: this.toResponsesInput(messages),
          ...(supportsTemperature ? { temperature: options.temperature } : {}),
          max_tokens: options.max_tokens,
        }
      : {
          model: resolvedModelId,
          messages,
          ...(supportsTemperature ? { temperature: options.temperature } : {}),
          max_tokens: options.max_tokens,
          response_format: options.response_format,
          ...(typeof options.extraBody === "object" && options.extraBody ? options.extraBody : {}),
        }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `Chat model request failed: HTTP ${response.status}`)
    }
    if (shouldUseResponsesApi) {
      const content = this.extractResponsesContent(payload)
      return {
        ...(payload?.data && typeof payload.data === "object" ? payload.data : payload),
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content,
            },
            finish_reason: payload?.data?.choices?.[0]?.finish_reason || payload?.choices?.[0]?.finish_reason || "stop",
          },
        ],
        usage: payload?.data?.usage || payload?.usage || null,
      }
    }
    return payload
  }

  async editImage(imageUrls: string[], prompt: string, modelId?: string, options: Record<string, unknown> = {}) {
    const baseUrl = String(this.config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")
    const resolvedModelId = normalizeProviderModelId(modelId || this.config.modelId)
    const referenceImages = (Array.isArray(imageUrls) ? imageUrls : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)

    if (isApimartImageProvider(this.config.providerConfig, baseUrl) && getApimartImageModelKind(resolvedModelId)) {
      const result = await generateApimartImage({
        prompt,
        modelId: resolvedModelId,
        apiKey: this.config.apiKey,
        endpointBase: baseUrl,
        options: {
          ...options,
          referenceImages,
        },
        providerKey: String(this.config.providerConfig?.key || "apimart"),
      })
      return result.imageUrl || result.url || ""
    }

    const endpoint = /\/images\/generations$/.test(baseUrl)
      ? baseUrl
      : /\/v1$/.test(baseUrl)
        ? `${baseUrl}/images/generations`
        : `${baseUrl}/v1/images/generations`
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: resolvedModelId,
        prompt,
        n: 1,
        size: String(options.imageSize || options.size || "1024x1024"),
        response_format: "url",
        reference_images: referenceImages,
        image_urls: referenceImages,
        aspect_ratio: options.aspectRatio,
        quality: options.quality,
        background: options.background,
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `Image edit request failed: HTTP ${response.status}`)
    }
    const first = Array.isArray(payload?.data) ? payload.data[0] : null
    return payload?.imageUrl || payload?.url || first?.url || payload?.data?.image_urls?.[0] || payload?.image_urls?.[0] || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : "")
  }
}
