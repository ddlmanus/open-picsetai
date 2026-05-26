import { modelRouter } from "@/lib/models/router"

export class OpenAIProvider {
  constructor(private readonly config: { apiKey: string; baseUrl?: string }) {}

  async editImage(imageUrls: string[], prompt: string, modelId: string, options: Record<string, unknown>) {
    const result = await modelRouter.generateWithDbCredentials(
      prompt,
      modelId,
      {
        key: "openai",
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      },
      {
        ...options,
        referenceImages: imageUrls,
      },
      "image"
    )
    return result?.imageUrl || result?.url || ""
  }
}
