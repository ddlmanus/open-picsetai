export const AESTHETIC_MIRROR_STORAGE_KEY = "ideart:aesthetic-mirror:workspace"
export const AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES = 6
export const AESTHETIC_MIRROR_MAX_REFERENCE_IMAGES = 20
export const AESTHETIC_MIRROR_MAX_VARIATIONS = 8

export type AestheticMirrorMode = "single" | "batch" | "sku"
export type AestheticMirrorSpeedMode = "standard" | "fast" | "turbo"
export type AestheticMirrorImageStatus = "pending" | "prompting" | "generating" | "done" | "error" | "cancelled"
export type AestheticMirrorJobStatus = "processing" | "success" | "failed"

export type AestheticMirrorSettings = {
  imageModelId: string
  aspectRatio: string
  imageSize: string
  imageCount: number
  speedMode: AestheticMirrorSpeedMode
}

export type AestheticMirrorGeneratedImage = {
  id: string
  title: string
  status: AestheticMirrorImageStatus
  url: string
  prompt?: string
  error?: string
  model?: string
  provider?: string
  mode: AestheticMirrorMode
  referenceIndex: number
  referenceImage: string
  productIndex: number
  productImage: string
  variantIndex: number
}

export type AestheticMirrorGenerationJob = {
  id: string
  title: string
  mode: AestheticMirrorMode
  referenceIndex: number
  referenceImage: string
  productIndex: number
  productImage: string
  variantIndex: number
  productImages: string[]
}

export type AestheticMirrorModelOption = {
  id: string
  runtimeId: string
  modelId: string
  name: string
  category: "chat" | "image"
  providerLabel: string
  cost: number
  isDefault?: boolean
}

export type AestheticMirrorModelSettingsPayload = {
  imageModel: AestheticMirrorModelOption | null
  imageModels: AestheticMirrorModelOption[]
}

export type AestheticMirrorAnalysisJobAiRequest = {
  model: string
  contents: Array<{
    role: string
    parts: Array<
      | { text: string }
      | {
          inlineData: {
            data: string
            mimeType: string
          }
        }
    >
  }>
  provider?: string
  generationConfig?: {
    temperature: number
    responseSchema?: Record<string, unknown>
    thinkingConfig?: {
      thinkingBudget: number
    }
    responseMimeType?: string
  }
}

type AestheticMirrorBaseJobRecord = {
  id: string
  user_id: string
  status: AestheticMirrorJobStatus
  result_url: string | null
  error_message: string | null
  is_refunded: boolean
  cost_amount: number
  created_at: string
  updated_at: string
  trace_id: string | null
  client_job_id: string | null
  fe_attempt: number
  be_retry: number
  duration_ms: number | null
  error_code: string | null
  gen_model: string
  gen_resolution: string
  is_turbo: boolean
  gen_family: string
  clothing_mode: string | null
  workflow_mode: string | null
  speed_mode: string
  worker_id: string
  provider_meta: Record<string, unknown> | null
  project_id?: string | null
}

export type AestheticMirrorImageJobRecord = AestheticMirrorBaseJobRecord & {
  type: "STYLE_REPLICATE" | "SKU_REPLACE"
  payload: {
    mode?: "single" | "batch" | "sku_replace"
    model: string
    prompt: string
    metadata?: Record<string, unknown> | null
    trace_id: string | null
    imageSize: string
    speedMode: string
    ai_request?: AestheticMirrorAnalysisJobAiRequest
    fe_attempt: number
    project_id: string | null
    userPrompt?: string
    aspectRatio: string
    userContent?: string
    productImage: string
    turboEnabled: boolean
    client_job_id: string | null
    productImages: string[]
    isNewUserTrial?: boolean
    referenceImage?: string
    promptConfigKey?: string
    skuText?: string
    _ef_preprocess_ms?: number
  }
  result_data: Record<string, unknown> | null
}

export type AestheticMirrorJobRecord = AestheticMirrorImageJobRecord

export const AESTHETIC_MIRROR_ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 正方形" },
  { value: "4:5", label: "4:5 详情主图" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "16:9", label: "16:9 横版" },
] as const

export const AESTHETIC_MIRROR_IMAGE_SIZES = [
  { value: "1K", label: "1K 标准" },
  { value: "2K", label: "2K 高清" },
  { value: "4K", label: "4K 超清" },
] as const

export const AESTHETIC_MIRROR_SPEED_MODES: Array<{
  value: AestheticMirrorSpeedMode
  label: string
  description: string
}> = [
  { value: "standard", label: "标准", description: "标准速度，积分消耗最低" },
  { value: "fast", label: "快速", description: "快速生成，积分消耗适中" },
  { value: "turbo", label: "极速", description: "更快出图，适合快速试稿。" },
]

export const DEFAULT_AESTHETIC_MIRROR_SETTINGS: AestheticMirrorSettings = {
  imageModelId: "",
  aspectRatio: "1:1",
  imageSize: "2K",
  imageCount: 1,
  speedMode: "fast",
}

export function clampAestheticMirrorImageCount(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_AESTHETIC_MIRROR_SETTINGS.imageCount
  return Math.max(1, Math.min(AESTHETIC_MIRROR_MAX_VARIATIONS, Math.round(numeric)))
}

function normalizeAestheticMirrorImageList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : []
}

export function buildSelectedAestheticMirrorReferenceImages(referenceImages: string[], imageCount: number) {
  void imageCount
  return normalizeAestheticMirrorImageList(referenceImages).slice(0, 1)
}

export function resolveAestheticMirrorBatchGroupCount(referenceImages: string[], imageCount: number) {
  void referenceImages
  return clampAestheticMirrorImageCount(imageCount)
}

export function buildAestheticMirrorJobs(params: {
  mode: AestheticMirrorMode
  referenceImages?: string[]
  productImages: string[]
  imageCount: number
}) {
  const images = normalizeAestheticMirrorImageList(params.productImages)
  const referenceImages = normalizeAestheticMirrorImageList(params.referenceImages)
  const imageCount = clampAestheticMirrorImageCount(params.imageCount)
  const jobs: AestheticMirrorGenerationJob[] = []
  const primaryReferenceImage = referenceImages[0] || ""

  if (params.mode === "single") {
    for (let variantIndex = 0; variantIndex < imageCount; variantIndex += 1) {
      jobs.push({
        id: `mirror-single-${variantIndex + 1}`,
        title: imageCount === 1 ? "详情图 1" : `详情图 ${variantIndex + 1}`,
        mode: "single",
        referenceIndex: 0,
        referenceImage: primaryReferenceImage,
        productIndex: 0,
        productImage: images[0] || "",
        variantIndex,
        productImages: images,
      })
    }
    return jobs
  }

  for (let variantIndex = 0; variantIndex < imageCount; variantIndex += 1) {
    images.forEach((image, productIndex) => {
      const modePrefix = params.mode === "sku" ? "sku" : "batch"
      const modeTitle = params.mode === "sku" ? "SKU" : "产品"
      jobs.push({
        id: `mirror-${modePrefix}-${productIndex + 1}-${variantIndex + 1}`,
        title:
          imageCount === 1
            ? `${modeTitle} ${productIndex + 1}`
            : `${modeTitle} ${productIndex + 1} · 第 ${variantIndex + 1} 组`,
        mode: params.mode,
        referenceIndex: 0,
        referenceImage: primaryReferenceImage,
        productIndex,
        productImage: image,
        variantIndex,
        productImages: [image],
      })
    })
  }

  return jobs
}

export function buildAestheticMirrorPlaceholders(jobs: AestheticMirrorGenerationJob[]) {
  return jobs.map(
    (job): AestheticMirrorGeneratedImage => ({
      id: job.id,
      title: job.title,
      status: "pending",
      url: "",
      error: "",
      prompt: "",
      model: "",
      provider: "",
      mode: job.mode,
      referenceIndex: job.referenceIndex,
      referenceImage: job.referenceImage,
      productIndex: job.productIndex,
      productImage: job.productImage,
      variantIndex: job.variantIndex,
    })
  )
}

export function buildAestheticMirrorFilename(image: AestheticMirrorGeneratedImage) {
  const safeTitle = String(image.title || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48)
  if (image.mode === "batch" || image.mode === "sku") {
    const modePrefix = image.mode === "sku" ? "sku" : "batch"
    return `aesthetic-mirror-${modePrefix}-p${String(image.productIndex + 1).padStart(2, "0")}-v${String(image.variantIndex + 1).padStart(2, "0")}${safeTitle ? `-${safeTitle}` : ""}.png`
  }
  return `aesthetic-mirror-${String(image.productIndex + 1).padStart(2, "0")}-${String(image.variantIndex + 1).padStart(2, "0")}${safeTitle ? `-${safeTitle}` : ""}.png`
}
