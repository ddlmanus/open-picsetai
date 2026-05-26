export const REFINEMENT_STUDIO_STORAGE_KEY = "ideart:refinement-studio:workspace"
export const REFINEMENT_STUDIO_MAX_PRODUCT_IMAGES = 50

export type RefinementStudioSpeedMode = "standard" | "fast" | "turbo"
export type RefinementStudioImageStatus = "pending" | "prompting" | "generating" | "done" | "error" | "cancelled"
export type RefinementStudioBackgroundSetting = "white" | "transparent" | "original" | "soft"
export type RefinementStudioJobStatus = "processing" | "success" | "failed"

export type RefinementStudioSettings = {
  imageModelId: string
  backgroundSetting: RefinementStudioBackgroundSetting
  aspectRatio: string
  imageSize: string
  speedMode: RefinementStudioSpeedMode
}

export type RefinementStudioModelOption = {
  id: string
  runtimeId: string
  modelId: string
  name: string
  category: "image"
  providerLabel: string
  cost: number
  isDefault?: boolean
}

export type RefinementStudioModelSettingsPayload = {
  imageModel: RefinementStudioModelOption | null
  imageModels: RefinementStudioModelOption[]
}

export type RefinementStudioAnalysisJobAiRequest = {
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
    maxOutputTokens: number
  }
}

export type RefinementStudioAnalysisResult = {
  text: string
}

export type RefinementStudioImageJobResult = {
  unit: string | null
  count: string
  result: string[]
  status: number
  message: string
}

type RefinementStudioBaseJobRecord = {
  id: string
  user_id: string
  status: RefinementStudioJobStatus
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
}

export type RefinementStudioAnalysisJobRecord = RefinementStudioBaseJobRecord & {
  type: "ANALYSIS"
  payload: {
    productImage: string
    clothingMode: "refinement_analysis"
    whiteBackground: boolean
    requirements: string
    imageCount: number
    uiLanguage: string
    promptConfigKey: string
    ai_request?: RefinementStudioAnalysisJobAiRequest
  }
  result_data: RefinementStudioAnalysisResult | null
}

export type RefinementStudioImageJobRecord = RefinementStudioBaseJobRecord & {
  type: "REFINE_IMAGE_GEN"
  payload: {
    batchId?: string
    index?: number
    title?: string
    description?: string
    requirements?: string
    aspectRatio: string
    fe_attempt: number
    imageSize: string
    isNewUserTrial: boolean
    jobType: "REFINE_IMAGE_GEN"
    model: string
    productImage: string
    prompt: string
    speedMode: string
    turboEnabled: boolean
    workflowMode: "product"
  }
  result_data: RefinementStudioImageJobResult | null
}

export type RefinementStudioJobRecord = RefinementStudioAnalysisJobRecord | RefinementStudioImageJobRecord

export type RefinementStudioGenerationJob = {
  id: string
  title: string
  sourceUrl: string
  sourceIndex: number
}

export type RefinementStudioGeneratedImage = {
  id: string
  title: string
  status: RefinementStudioImageStatus
  url: string
  prompt?: string
  error?: string
  model?: string
  provider?: string
  sourceUrl: string
  sourceIndex: number
}

export const REFINEMENT_STUDIO_BACKGROUND_OPTIONS = [
  { value: "white", label: "白底图" },
  { value: "transparent", label: "透明背景" },
  { value: "original", label: "保持原背景" },
  { value: "soft", label: "浅色棚拍背景" },
] as const

export const REFINEMENT_STUDIO_ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 正方形" },
  { value: "4:5", label: "4:5 详情主图" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "16:9", label: "16:9 横版" },
] as const

export const REFINEMENT_STUDIO_IMAGE_SIZES = [
  { value: "1K", label: "1K 标准" },
  { value: "2K", label: "2K 高清" },
  { value: "4K", label: "4K 超清" },
] as const

export const REFINEMENT_STUDIO_SPEED_MODES: Array<{
  value: RefinementStudioSpeedMode
  label: string
  description: string
}> = [
  { value: "standard", label: "标准", description: "标准速度，积分消耗最低" },
  { value: "fast", label: "快速", description: "更快完成批量精修，适合多图处理" },
  { value: "turbo", label: "极速", description: "以最快速度完成批量精修任务" },
]

export const DEFAULT_REFINEMENT_STUDIO_SETTINGS: RefinementStudioSettings = {
  imageModelId: "",
  backgroundSetting: "white",
  aspectRatio: "1:1",
  imageSize: "2K",
  speedMode: "standard",
}

export function normalizeRefinementStudioBackgroundSetting(value: unknown): RefinementStudioBackgroundSetting {
  const normalized = String(value || "").trim()
  if (normalized === "transparent") return "transparent"
  if (normalized === "original") return "original"
  if (normalized === "soft") return "soft"
  return "white"
}

export function resolveRefinementStudioPromptConfigKey() {
  return "refinement_analysis_prompt"
}

export function resolveRefinementStudioMappedSpeedMode(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "turbo") return "turbo"
  if (normalized === "fast") return "fast"
  return "normal"
}

export function isRefinementStudioTurboEnabled(value: unknown) {
  return String(value || "").trim().toLowerCase() === "turbo"
}

export function resolveBatchConcurrencyFromSpeedMode(speedMode: RefinementStudioSpeedMode) {
  if (speedMode === "turbo") return 3
  if (speedMode === "fast") return 2
  return 1
}

export function buildRefinementStudioJobs(productImages: string[]) {
  const images = (Array.isArray(productImages) ? productImages : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, REFINEMENT_STUDIO_MAX_PRODUCT_IMAGES)

  return images.map(
    (sourceUrl, sourceIndex): RefinementStudioGenerationJob => ({
      id: `refine-${sourceIndex + 1}`,
      title: `精修图 ${sourceIndex + 1}`,
      sourceUrl,
      sourceIndex,
    })
  )
}

export function buildRefinementStudioPlaceholders(jobs: RefinementStudioGenerationJob[]) {
  return jobs.map(
    (job): RefinementStudioGeneratedImage => ({
      id: job.id,
      title: job.title,
      status: "pending",
      url: "",
      error: "",
      prompt: "",
      model: "",
      provider: "",
      sourceUrl: job.sourceUrl,
      sourceIndex: job.sourceIndex,
    })
  )
}

export function buildRefinementStudioFilename(image: RefinementStudioGeneratedImage) {
  const safeTitle = String(image.title || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48)
  return `refinement-studio-${String(image.sourceIndex + 1).padStart(2, "0")}${safeTitle ? `-${safeTitle}` : ""}.png`
}
