import { randomUUID } from "node:crypto"
import { checkAndDeductPoints } from "@/lib/points"
import { parseModelRuntimeId } from "@/lib/models/runtime-id"
import {
  analyzeClothingStudioProductSet,
  buildClothingStudioAnalysisPromptPreview,
  generateClothingStudioImageFromPrompt,
} from "@/lib/clothing-studio-ai"
import {
  buildClothingStudioPlanBlueprint,
  resolveClothingStudioLegacyMode,
  resolveClothingStudioPromptConfigKey,
  resolveClothingStudioShortLanguageCode,
  type ClothingStudioAnalysisJobAiRequest,
  type ClothingStudioAnalysisJobRecord,
  type ClothingStudioImageJobRecord,
  type ClothingStudioJobRecord,
  type ClothingStudioMode,
} from "@/lib/clothing-studio"
import { emitClothingStudioJobUpdated } from "@/lib/clothing-studio-job-events"
import { createStudioGenesisHistoryItem } from "@/lib/studio-genesis-history"

const ANALYSIS_JOB_TTL_MS = 2 * 60 * 60 * 1000
const ANALYSIS_WORKER_ID = "picsetai-cn-prod-worker-1"
const IMAGE_WORKER_ID = "picsetai-cn-prod-worker-2"

const globalForClothingStudioJobs = globalThis as typeof globalThis & {
  __clothingStudioJobs?: Map<string, ClothingStudioJobRecord>
}

const clothingStudioJobs =
  globalForClothingStudioJobs.__clothingStudioJobs || new Map<string, ClothingStudioJobRecord>()

if (!globalForClothingStudioJobs.__clothingStudioJobs) {
  globalForClothingStudioJobs.__clothingStudioJobs = clothingStudioJobs
}

function nowIso() {
  return new Date().toISOString()
}

function formatLegacyDateTime(input?: string) {
  const date = input ? new Date(input) : new Date()
  if (!Number.isFinite(date.getTime())) return ""

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace("T", " ")
}

function cleanupExpiredJobs() {
  const cutoff = Date.now() - ANALYSIS_JOB_TTL_MS
  for (const [jobId, job] of clothingStudioJobs.entries()) {
    const updatedAt = Date.parse(String(job.updated_at || job.created_at || ""))
    if (Number.isFinite(updatedAt) && updatedAt < cutoff) {
      clothingStudioJobs.delete(jobId)
    }
  }
}

function toAbsoluteImageUrl(url: string, requestOrigin?: string) {
  const normalized = String(url || "").trim()
  if (!normalized) return normalized
  if (/^https?:\/\//i.test(normalized)) return normalized
  const origin = String(requestOrigin || "").trim().replace(/\/$/, "")
  if (!origin) return normalized
  return normalized.startsWith("/") ? `${origin}${normalized}` : `${origin}/${normalized}`
}

function deriveGenFamily(runtimeId: string) {
  const modelId = parseModelRuntimeId(String(runtimeId || "").trim()).modelId.toLowerCase()
  if (!modelId) return "clothing_studio"
  if (modelId.includes("nano") && modelId.includes("banana")) return "nano_banana"
  const compact = modelId.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return compact || "clothing_studio"
}

function deriveGenModel(runtimeId: string) {
  const modelId = parseModelRuntimeId(String(runtimeId || "").trim()).modelId.toLowerCase()
  if (!modelId) return "basic"
  if (modelId.includes("pro")) return "pro"
  if (modelId.includes("ultra")) return "ultra"
  if (modelId.includes("turbo")) return "turbo"
  return "basic"
}

function mapSpeedMode(speedMode: string) {
  const normalized = String(speedMode || "").trim().toLowerCase()
  if (normalized === "turbo") return "turbo"
  if (normalized === "fast") return "fast"
  return "normal"
}

function deriveProviderMetaModel(modelId: string) {
  const normalized = String(modelId || "").trim().toLowerCase()
  if (!normalized) return "unknown"
  if (normalized.includes("nano-banana") && normalized.includes("pro")) return "image_nanoBanana_pro"
  if (normalized.includes("nano-banana") && normalized.includes("ultra")) return "image_nanoBanana_ultra"
  if (normalized.includes("nano-banana")) return "image_nanoBanana_basic"
  return normalized
}

function inferImageMimeType(url: string) {
  const normalized = String(url || "").trim().toLowerCase()
  if (normalized.endsWith(".webp")) return "image/webp"
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg"
  return "image/png"
}

function deriveResultAssetPath(url: string) {
  const normalized = String(url || "").trim()
  if (!normalized) return ""

  if (/^https?:\/\//i.test(normalized)) {
    try {
      return new URL(normalized).pathname.replace(/^\/+/, "")
    } catch {
      return normalized
    }
  }

  return normalized.replace(/^\/+/, "")
}

function buildImageJobResultData(params: {
  jobId: string
  prompt: string
  productImages: string[]
  imageSize: string
  aspectRatio: string
  resultUrl: string
  createdAt: string
  updatedAt: string
}) {
  const assetPath = deriveResultAssetPath(params.resultUrl)

  return {
    unit: null,
    count: "1",
    result: [params.resultUrl],
    status: 2,
    message: "",
    created_at: formatLegacyDateTime(params.createdAt),
    updated_at: formatLegacyDateTime(params.updatedAt),
    image_mime_type: inferImageMimeType(params.resultUrl),
    oss_path: assetPath || undefined,
    oss_url: params.resultUrl,
    thumbnail_url: params.resultUrl,
    task_id: `image_${params.jobId}`,
    request: {
      size: params.imageSize,
      urls: params.productImages,
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
    },
  }
}

function toStudioSpeedMode(speedMode: string) {
  const normalized = String(speedMode || "").trim().toLowerCase()
  if (normalized === "turbo") return "turbo" as const
  if (normalized === "fast") return "fast" as const
  return "standard" as const
}

function createAiRequestPreview(params: {
  modelId: string
  provider?: string
  prompt: string
  imageUrls: string[]
  maxOutputTokens: number
}) {
  const parts: ClothingStudioAnalysisJobAiRequest["contents"][number]["parts"] = [
    { text: params.prompt },
    ...params.imageUrls
      .filter(Boolean)
      .map((url) => ({
        inlineData: {
          data: url,
          mimeType: "image/png",
        },
      })),
  ]

  return {
    model: String(params.modelId || "").trim() || "unknown",
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    provider: String(params.provider || "").trim() || "unknown",
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: params.maxOutputTokens,
      responseMimeType: "application/json",
    },
  } satisfies ClothingStudioAnalysisJobAiRequest
}

function updateJob<T extends ClothingStudioJobRecord["type"]>(
  jobId: string,
  updater: (
    current: Extract<ClothingStudioJobRecord, { type: T }>
  ) => Extract<ClothingStudioJobRecord, { type: T }>
) {
  const current = clothingStudioJobs.get(jobId)
  if (!current) return null
  const next = updater(current as Extract<ClothingStudioJobRecord, { type: T }>)
  clothingStudioJobs.set(jobId, next)
  emitClothingStudioJobUpdated(next)
  return next
}

function toLegacyResultData(params: {
  mode: ClothingStudioMode
  analysisResult: Awaited<ReturnType<typeof analyzeClothingStudioProductSet>>
}) {
  return {
    design_specs: params.analysisResult.summary,
    images: params.analysisResult.images.map((item) => ({
      title: item.title,
      description: item.description,
      design_content: item.designContent,
    })),
  }
}

async function runClothingStudioAnalysisJob(params: {
  jobId: string
  userId: string
  merchantId: string | null
  requestOrigin?: string
  mode: ClothingStudioMode
  productImages: string[]
  modelImage?: string
  requirements: string
  targetLanguage: string
  uiLanguage: string
  textModelId: string
  imageModelId: string
  imageSize: string
  speedMode: string
  basicSelections: Parameters<typeof buildClothingStudioPlanBlueprint>[0]["basicSelections"]
  tryOnSelections: Parameters<typeof buildClothingStudioPlanBlueprint>[0]["tryOnSelections"]
}) {
  const startedAt = Date.now()

  try {
    const plans = buildClothingStudioPlanBlueprint({
      mode: params.mode,
      basicSelections: params.basicSelections,
      tryOnSelections: params.tryOnSelections,
      targetLanguage: params.targetLanguage,
    })

    const prompt = buildClothingStudioAnalysisPromptPreview({
      mode: params.mode,
      requirements: params.requirements,
      targetLanguage: params.targetLanguage,
      imageUnderstandingText: "",
      hasModelReference: Boolean(params.mode === "tryon" && params.modelImage),
      plans,
      basicSelections: params.basicSelections,
      tryOnSelections: params.tryOnSelections,
    })

    const analysisResult = await analyzeClothingStudioProductSet({
      productImages: params.productImages,
      modelImage: params.modelImage,
      requirements: params.requirements,
      mode: params.mode,
      targetLanguage: params.targetLanguage,
      basicSelections: params.basicSelections,
      tryOnSelections: params.tryOnSelections,
      textModelId: params.textModelId,
      merchantId: params.merchantId,
      requestOrigin: params.requestOrigin,
    })

    const aiRequest = createAiRequestPreview({
      modelId: String(analysisResult.modelId || parseModelRuntimeId(params.textModelId).modelId || "").trim(),
      provider: analysisResult.provider || undefined,
      prompt,
      imageUrls: [
        ...params.productImages.map((item) => toAbsoluteImageUrl(item, params.requestOrigin)),
        ...(params.mode === "tryon" && params.modelImage
          ? [toAbsoluteImageUrl(params.modelImage, params.requestOrigin)]
          : []),
      ],
      maxOutputTokens: 8192,
    })

    updateJob<"ANALYSIS">(params.jobId, (current) => ({
      ...current,
      status: "success",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      payload: {
        ...current.payload,
        ai_request: aiRequest,
      },
      result_data: toLegacyResultData({
        mode: params.mode,
        analysisResult,
      }),
      provider_meta: {
        model: analysisResult.modelId || parseModelRuntimeId(params.textModelId).modelId || "unknown",
        usage: analysisResult.usage || undefined,
        source: analysisResult.provider || "unknown",
        image_count: plans.length,
        target_language: resolveClothingStudioShortLanguageCode(params.targetLanguage),
      },
    }))
  } catch (error: any) {
    updateJob<"ANALYSIS">(params.jobId, (current) => ({
      ...current,
      status: "failed",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      error_message: String(error?.message || "分析失败"),
    }))
  }
}

async function runClothingStudioImageJob(params: {
  jobId: string
  userId: string
  merchantId: string | null
  requestOrigin?: string
  batchId?: string
  planId?: string
  index?: number
  title?: string
  description?: string
  productImages: string[]
  modelImage?: string
  workflowMode: "model" | "product"
  prompt: string
  imageModelRuntimeId: string
  targetLanguage?: string
  requirements?: string
  settings: {
    aspectRatio: string
    imageSize: string
    speedMode: string
  }
}) {
  const startedAt = Date.now()

  try {
    const result = await generateClothingStudioImageFromPrompt({
      merchantId: params.merchantId,
      requestOrigin: params.requestOrigin,
      productImages: params.productImages,
      modelImage: params.workflowMode === "model" ? params.modelImage : undefined,
      mode: params.workflowMode === "product" ? "basic" : "tryon",
      prompt: params.prompt,
      settings: {
        imageModelId: params.imageModelRuntimeId,
        aspectRatio: params.settings.aspectRatio,
        imageSize: params.settings.imageSize,
        speedMode: toStudioSpeedMode(params.settings.speedMode),
      },
    })

    await checkAndDeductPoints(params.userId, params.imageModelRuntimeId, "image", {
      merchantId: params.merchantId,
      quantity: 1,
    })

    const completedAt = nowIso()
    updateJob<"IMAGE_GEN">(params.jobId, (current) => ({
      ...current,
      status: "success",
      updated_at: completedAt,
      duration_ms: Date.now() - startedAt,
      result_url: result.url,
      result_data: buildImageJobResultData({
        jobId: params.jobId,
        prompt: params.prompt,
        productImages: params.productImages,
        imageSize: params.settings.imageSize,
        aspectRatio: params.settings.aspectRatio,
        resultUrl: result.url,
        createdAt: current.created_at,
        updatedAt: completedAt,
      }),
      provider_meta: {
        model: deriveProviderMetaModel(result.modelId),
        source: result.provider,
        provider_chain_tried: [result.provider],
      },
    }))

    try {
      await createStudioGenesisHistoryItem(
        { userId: params.userId, merchantId: params.merchantId },
        {
          batchId: String(params.batchId || params.jobId).trim(),
          planId: String(params.planId || params.jobId).trim(),
          index: Math.max(0, Number(params.index || 0) || 0),
          title: String(params.title || "").trim(),
          description: String(params.description || "").trim(),
          prompt: result.prompt || params.prompt,
          imageUrl: result.url,
          sourceImageUrl: String(params.modelImage || params.productImages[0] || result.url).trim(),
          model: result.modelId,
          provider: result.provider,
          aspectRatio: params.settings.aspectRatio,
          imageSize: params.settings.imageSize,
          targetLanguage: String(params.targetLanguage || "none").trim() || "none",
          requirements: String(params.requirements || "").trim(),
          productImages: params.productImages,
        }
      )
    } catch (historyError) {
      console.error("[clothing-studio] persist history failed:", historyError)
    }
  } catch (error: any) {
    updateJob<"IMAGE_GEN">(params.jobId, (current) => ({
      ...current,
      status: "failed",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      error_message: String(error?.message || "图片生成失败"),
    }))
  }
}

export function createClothingStudioAnalysisJob(params: {
  userId: string
  merchantId: string | null
  requestOrigin?: string
  mode: ClothingStudioMode
  productImages: string[]
  modelImage?: string
  requirements: string
  targetLanguage: string
  uiLanguage: string
  textModelId: string
  imageModelId: string
  imageSize: string
  speedMode: string
  feAttempt?: number
  basicSelections: Parameters<typeof buildClothingStudioPlanBlueprint>[0]["basicSelections"]
  tryOnSelections: Parameters<typeof buildClothingStudioPlanBlueprint>[0]["tryOnSelections"]
}) {
  cleanupExpiredJobs()

  const now = nowIso()
  const jobId = randomUUID()
  const clothingMode = resolveClothingStudioLegacyMode(params.mode)
  const promptConfigKey = resolveClothingStudioPromptConfigKey(
    params.mode,
    params.uiLanguage || params.targetLanguage
  )
  const imageCount = buildClothingStudioPlanBlueprint({
    mode: params.mode,
    basicSelections: params.basicSelections,
    tryOnSelections: params.tryOnSelections,
    targetLanguage: params.targetLanguage,
  }).length
  const basePayload = {
    imageCount,
    uiLanguage: String(params.uiLanguage || "zh-CN").trim() || "zh-CN",
    clothingMode,
    productImage: String(params.productImages[0] || "").trim(),
    requirements: String(params.requirements || "").trim(),
    productImages: params.productImages.map((item) => String(item || "").trim()).filter(Boolean),
    targetLanguage: resolveClothingStudioShortLanguageCode(params.targetLanguage),
    promptConfigKey,
  }

  const job: ClothingStudioAnalysisJobRecord = {
    id: jobId,
    user_id: params.userId,
    type: "ANALYSIS",
    status: "processing",
    payload: {
      ...basePayload,
      ...(params.mode === "tryon"
        ? {
            modelImage: String(params.modelImage || "").trim(),
          }
        : {
            refinedViews: params.basicSelections.whiteRefineEnabled ? [params.basicSelections.whiteRefineView] : [],
            threeDEnabled: params.basicSelections.threeDimensionalEnabled,
            threeDWhiteBackground: params.basicSelections.threeDimensionalWithWhiteBase,
            mannequinEnabled: params.basicSelections.mannequinEnabled,
            mannequinWhiteBackground: params.basicSelections.mannequinWithWhiteBase,
            detailCount: params.basicSelections.detailCloseupCount,
            sellingPointCount: params.basicSelections.sellingPointCount,
          }),
    },
    result_data: null,
    result_url: null,
    error_message: null,
    is_refunded: false,
    cost_amount: 0,
    created_at: now,
    updated_at: now,
    trace_id: null,
    client_job_id: null,
    fe_attempt: Math.max(1, Number(params.feAttempt || 1)),
    be_retry: 0,
    duration_ms: null,
    error_code: null,
    gen_model: deriveGenModel(params.imageModelId),
    gen_resolution: String(params.imageSize || "").trim().toLowerCase() || "1k",
    is_turbo: String(params.speedMode || "").trim().toLowerCase() === "turbo",
    gen_family: deriveGenFamily(params.imageModelId),
    clothing_mode: clothingMode,
    workflow_mode: null,
    speed_mode: mapSpeedMode(params.speedMode),
    worker_id: ANALYSIS_WORKER_ID,
    provider_meta: null,
  }

  clothingStudioJobs.set(jobId, job)
  emitClothingStudioJobUpdated(job)

  void runClothingStudioAnalysisJob({
    jobId,
    userId: params.userId,
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    mode: params.mode,
    productImages: job.payload.productImages,
    modelImage: String(job.payload.modelImage || "").trim(),
    requirements: job.payload.requirements,
    targetLanguage: params.targetLanguage,
    uiLanguage: job.payload.uiLanguage,
    textModelId: params.textModelId,
    imageModelId: params.imageModelId,
    imageSize: params.imageSize,
    speedMode: params.speedMode,
    basicSelections: params.basicSelections,
    tryOnSelections: params.tryOnSelections,
  })

  return job
}

export function createClothingStudioImageJob(params: {
  userId: string
  merchantId: string | null
  requestOrigin?: string
  batchId?: string
  planId?: string
  index?: number
  title?: string
  description?: string
  productImage: string
  productImages: string[]
  prompt: string
  imageModelRuntimeId: string
  requestedModel?: string
  imageSize: string
  aspectRatio: string
  targetLanguage?: string
  requirements?: string
  workflowMode?: "model" | "product"
  turboEnabled?: boolean
  speedMode: string
  feAttempt?: number
  modelImage?: string
  estimatedCost?: number
}) {
  cleanupExpiredJobs()

  const now = nowIso()
  const jobId = randomUUID()
  const mappedSpeedMode = mapSpeedMode(params.speedMode)
  const turboEnabled =
    typeof params.turboEnabled === "boolean"
      ? params.turboEnabled
      : mappedSpeedMode === "turbo"

  const job: ClothingStudioImageJobRecord = {
    id: jobId,
    user_id: params.userId,
    type: "IMAGE_GEN",
    status: "processing",
    payload: {
      batchId: String(params.batchId || "").trim(),
      planId: String(params.planId || "").trim(),
      index: Math.max(0, Number(params.index || 0) || 0),
      title: String(params.title || "").trim(),
      description: String(params.description || "").trim(),
      productImage: String(params.productImage || params.productImages[0] || "").trim(),
      productImages: params.productImages.map((item) => String(item || "").trim()).filter(Boolean),
      prompt: String(params.prompt || "").trim(),
      model:
        String(
          params.requestedModel || parseModelRuntimeId(params.imageModelRuntimeId).modelId || ""
      ).trim() || "unknown",
      imageSize: String(params.imageSize || "").trim() || "2K",
      aspectRatio: String(params.aspectRatio || "").trim() || "3:4",
      targetLanguage: String(params.targetLanguage || "none").trim() || "none",
      requirements: String(params.requirements || "").trim(),
      workflowMode: params.workflowMode || "model",
      turboEnabled,
      speedMode: mappedSpeedMode,
      fe_attempt: Math.max(1, Number(params.feAttempt || 1)),
      modelImage: String(params.modelImage || "").trim(),
    },
    result_data: null,
    result_url: null,
    error_message: null,
    is_refunded: false,
    cost_amount: Math.max(0, Number(params.estimatedCost || 0)),
    created_at: now,
    updated_at: now,
    trace_id: null,
    client_job_id: null,
    fe_attempt: Math.max(1, Number(params.feAttempt || 1)),
    be_retry: 0,
    duration_ms: null,
    error_code: null,
    gen_model: deriveGenModel(params.imageModelRuntimeId),
    gen_resolution: String(params.imageSize || "").trim().toLowerCase() || "2k",
    is_turbo: turboEnabled,
    gen_family: deriveGenFamily(params.imageModelRuntimeId),
    clothing_mode: null,
    workflow_mode: params.workflowMode || "model",
    speed_mode: mappedSpeedMode,
    worker_id: IMAGE_WORKER_ID,
    provider_meta: null,
  }

  clothingStudioJobs.set(jobId, job)
  emitClothingStudioJobUpdated(job)

  void runClothingStudioImageJob({
    jobId,
    userId: params.userId,
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    batchId: job.payload.batchId,
    planId: job.payload.planId,
    index: job.payload.index,
    title: job.payload.title,
    description: job.payload.description,
    productImages: job.payload.productImages,
    modelImage: job.payload.modelImage,
    workflowMode: job.payload.workflowMode,
    prompt: job.payload.prompt,
    imageModelRuntimeId: params.imageModelRuntimeId,
    targetLanguage: job.payload.targetLanguage,
    requirements: job.payload.requirements,
    settings: {
      aspectRatio: job.payload.aspectRatio,
      imageSize: job.payload.imageSize,
      speedMode: job.payload.speedMode,
    },
  })

  return job
}

export function getClothingStudioJob(jobId: string, userId: string) {
  cleanupExpiredJobs()
  const job = clothingStudioJobs.get(String(jobId || "").trim())
  if (!job) return null
  if (String(job.user_id || "").trim() !== String(userId || "").trim()) return null
  return job
}
