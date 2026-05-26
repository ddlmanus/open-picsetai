import { absolutizeWithPreferredOrigin } from "@/lib/server/public-url"
import { normalizeModelImageInputUrls } from "@/lib/server/model-image-input"

export async function normalizeGenerationReferenceImages(images: string[], requestOrigin?: string) {
  const publicImages = Array.from(
    new Set(
      (Array.isArray(images) ? images : [])
        .map((item) => absolutizeWithPreferredOrigin(String(item || "").trim(), requestOrigin))
        .filter(Boolean)
    )
  )
  return normalizeModelImageInputUrls(publicImages, { requestOrigin })
}
