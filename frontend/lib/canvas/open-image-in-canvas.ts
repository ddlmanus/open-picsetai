"use client"

export async function getImageNaturalSize(url: string): Promise<{ width: number; height: number } | null> {
  if (typeof window === "undefined") return null
  const normalized = String(url || "").trim()
  if (!normalized) return null

  return await new Promise((resolve) => {
    const img = window.document.createElement("img")
    let settled = false

    const finish = (value: { width: number; height: number } | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        finish({ width: img.naturalWidth, height: img.naturalHeight })
        return
      }
      finish(null)
    }
    img.onerror = () => finish(null)
    img.src = normalized

    window.setTimeout(() => finish(null), 10000)
  })
}

export function buildCanvasSeedImageSize(input?: { width: number; height: number } | null) {
  const fallback = input && input.width > 0 && input.height > 0 ? input : { width: 1080, height: 1440 }

  return {
    width: Math.max(1, Math.round(fallback.width)),
    height: Math.max(1, Math.round(fallback.height)),
  }
}

export async function openImageInCanvas(params: {
  imageUrl: string
  projectTitle: string
  layerName: string
  thumbnail?: string
}) {
  if (typeof window === "undefined") {
    throw new Error("当前环境不支持打开画布")
  }

  const imageUrl = String(params.imageUrl || "").trim()
  if (!imageUrl) {
    throw new Error("缺少可编辑图片")
  }

  const size = buildCanvasSeedImageSize(await getImageNaturalSize(imageUrl))
  const seedId = `canvas-seed-${Date.now()}-${Math.random().toString(16).slice(2)}`
  window.localStorage.setItem(
    `picset:canvas-seed:${seedId}`,
    JSON.stringify({
      imageUrl,
      projectTitle: String(params.projectTitle || "智能画布项目").trim(),
      layerName: String(params.layerName || "图片图层").trim(),
      thumbnail: String(params.thumbnail || imageUrl).trim(),
      width: size.width,
      height: size.height,
    })
  )

  window.open(`/canvas-studio?seed=${encodeURIComponent(seedId)}`, "_blank", "noopener,noreferrer")
  return imageUrl
}
