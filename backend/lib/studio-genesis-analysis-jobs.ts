import { randomUUID } from "node:crypto"
import { normalizeProviderModelId, parseModelRuntimeId } from "@/lib/models/runtime-id"
import {
  analyzeStudioGenesisProductSet,
  buildStudioGenesisAnalysisPromptPreview,
  buildStudioGenesisAiWritePrompt,
  generateStudioGenesisAiWriteOptions,
  resolveStudioGenesisAnalysisMaxTokens,
} from "@/lib/studio-genesis-ai"
import {
  clampStudioGenesisImageCount,
  resolveStudioGenesisPromptConfigKey,
  resolveStudioGenesisShortLanguageCode,
  type StudioGenesisAnalysisJobAiRequest,
  type StudioGenesisAnalysisJobRecord,
  type StudioGenesisAiWriteJobRecord,
  type StudioGenesisImageJobRecord,
  type StudioGenesisAnalysisJobStatus,
  type StudioGenesisAnalysisNotification,
  type StudioGenesisJobRecord,
  type StudioGenesisWorkflowMode,
} from "@/lib/studio-genesis"
import { emitStudioGenesisJobUpdated } from "@/lib/studio-genesis-job-events"

const ANALYSIS_JOB_TTL_MS = 2 * 60 * 60 * 1000
const DEFAULT_WORKER_ID = "studio-genesis-local-worker-1"
const AI_WRITE_WORKER_ID = "picsetai-cn-prod-worker-5"
const IMAGE_WORKER_ID = "picsetai-cn-prod-worker-2"

const globalForStudioGenesisJobs = globalThis as typeof globalThis & {
  __studioGenesisAnalysisJobs?: Map<string, StudioGenesisJobRecord>
}

const analysisJobs =
  globalForStudioGenesisJobs.__studioGenesisAnalysisJobs ||
  new Map<string, StudioGenesisJobRecord>()

if (!globalForStudioGenesisJobs.__studioGenesisAnalysisJobs) {
  globalForStudioGenesisJobs.__studioGenesisAnalysisJobs = analysisJobs
}

function nowIso() {
  return new Date().toISOString()
}

function cleanupExpiredJobs() {
  const cutoff = Date.now() - ANALYSIS_JOB_TTL_MS
  for (const [jobId, job] of analysisJobs.entries()) {
    const updatedAt = Date.parse(String(job.updated_at || job.created_at || ""))
    if (Number.isFinite(updatedAt) && updatedAt < cutoff) {
      analysisJobs.delete(jobId)
    }
  }
}

function createNotification(
  message: string,
  step: string,
  status: StudioGenesisAnalysisJobStatus = "processing"
): StudioGenesisAnalysisNotification {
  return {
    id: randomUUID(),
    step,
    message,
    status,
    createdAt: nowIso(),
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
  if (!modelId) return "studio_genesis"
  if (modelId.includes("nano") && modelId.includes("banana")) return "nano_banana"
  const compact = modelId
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return compact || "studio_genesis"
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
    created_at: params.createdAt,
    updated_at: params.updatedAt,
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

function createAiRequestPreview(params: {
  modelId: string
  provider?: string
  prompt: string
  imageUrls: string[]
  imageCount: number
  includeImageLabel?: boolean
  maxOutputTokens?: number
}) {
  const parts: StudioGenesisAnalysisJobAiRequest["contents"][number]["parts"] = [
    { text: params.prompt },
    ...(params.includeImageLabel ? [{ text: "This is the product image:" }] : []),
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
      maxOutputTokens: params.maxOutputTokens || resolveStudioGenesisAnalysisMaxTokens(params.imageCount),
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  } satisfies StudioGenesisAnalysisJobAiRequest
}

function updateJob<T extends StudioGenesisJobRecord["type"]>(
  jobId: string,
  updater: (
    current: Extract<StudioGenesisJobRecord, { type: T }>
  ) => Extract<StudioGenesisJobRecord, { type: T }>
) {
  const current = analysisJobs.get(jobId)
  if (!current) return null
  const next = updater(current as Extract<StudioGenesisJobRecord, { type: T }>)
  analysisJobs.set(jobId, next)
  emitStudioGenesisJobUpdated(next)
  return next
}

function appendNotification(
  jobId: string,
  message: string,
  step: string,
  status: StudioGenesisAnalysisJobStatus = "processing"
) {
  updateJob<"ANALYSIS">(jobId, (current) => {
    const last = current.notifications[current.notifications.length - 1]
    if (last && last.message === message && last.status === status) {
      return {
        ...current,
        updated_at: nowIso(),
      }
    }

    return {
      ...current,
      updated_at: nowIso(),
      notifications: [...current.notifications, createNotification(message, step, status)],
    }
  })
}

async function runStudioGenesisAnalysisJob(params: {
  jobId: string
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  imageType: "main" | "detail"
  targetPlatform: string
  workflowMode: StudioGenesisWorkflowMode
  portraitImage?: string
  referenceImages?: string[]
  requirements: string
  targetLanguage: string
  imageCount: number
  textModelId: string
}) {
  const startedAt = Date.now()

  try {
    const analysisResult = await analyzeStudioGenesisProductSet({
      productImages: params.productImages,
      imageType: params.imageType,
      targetPlatform: params.targetPlatform,
      workflowMode: params.workflowMode,
      portraitImage: params.portraitImage,
      referenceImages: params.referenceImages,
      requirements: params.requirements,
      targetLanguage: params.targetLanguage,
      imageCount: params.imageCount,
      textModelId: params.textModelId,
      merchantId: params.merchantId,
      requestOrigin: params.requestOrigin,
      onProgress: (message, step) => {
        appendNotification(params.jobId, message, step || "processing", "processing")
      },
    })

    const prompt = buildStudioGenesisAnalysisPromptPreview({
      imageType: params.imageType,
      targetPlatform: params.targetPlatform,
      workflowMode: params.workflowMode,
      requirements: params.requirements,
      targetLanguage: params.targetLanguage,
      imageCount: params.imageCount,
      imageUnderstandingText: analysisResult.imageUnderstandingText || "",
    })

    const aiRequest = createAiRequestPreview({
      modelId: String(analysisResult.modelId || parseModelRuntimeId(params.textModelId).modelId || "").trim(),
      provider: analysisResult.provider || undefined,
      prompt,
      imageUrls: params.productImages.map((item) => toAbsoluteImageUrl(item, params.requestOrigin)),
      imageCount: params.imageCount,
      includeImageLabel: true,
    })

    updateJob<"ANALYSIS">(params.jobId, (current) => ({
      ...current,
      status: "success",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      result_data: analysisResult,
      payload: {
        ...current.payload,
        ai_request: aiRequest,
      },
      provider_meta: {
        model: analysisResult.modelId || parseModelRuntimeId(params.textModelId).modelId || "unknown",
        source: analysisResult.provider || "unknown",
        image_count: params.imageCount,
        target_language: resolveStudioGenesisShortLanguageCode(params.targetLanguage),
      },
      notifications: [
        ...current.notifications,
        createNotification("分析完成，设计规范和图片规划已准备就绪。", "completed", "success"),
      ],
    }))
  } catch (error: any) {
    updateJob<"ANALYSIS">(params.jobId, (current) => ({
      ...current,
      status: "failed",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      error_message: String(error?.message || "分析失败"),
      notifications: [
        ...current.notifications,
        createNotification(String(error?.message || "分析失败"), "failed", "failed"),
      ],
    }))
  }
}

export function createStudioGenesisAnalysisJob(params: {
  userId: string
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  requirements: string
  imageType: "main" | "detail"
  targetPlatform: string
  workflowMode: StudioGenesisWorkflowMode
  portraitImage?: string
  referenceImages?: string[]
  targetLanguage: string
  uiLanguage: string
  projectId?: string | null
  imageCount: number
  textModelId: string
  imageModelId: string
  imageSize: string
  speedMode: string
  feAttempt?: number
}) {
  cleanupExpiredJobs()

  const now = nowIso()
  const jobId = randomUUID()
  const traceId = randomUUID()
  const normalizedImageCount = clampStudioGenesisImageCount(params.imageCount)
  const shortLanguage = resolveStudioGenesisShortLanguageCode(params.targetLanguage)
  const workflowMode: StudioGenesisWorkflowMode = params.workflowMode === "knowledge" ? "knowledge" : "product"
  const projectId = String(params.projectId || "").trim() || null

  const job: StudioGenesisAnalysisJobRecord = {
    id: jobId,
    user_id: params.userId,
    type: "ANALYSIS",
    status: "processing",
    payload: {
      trace_id: traceId,
      imageType: params.imageType,
      imageCount: normalizedImageCount,
      uiLanguage: String(params.uiLanguage || "zh-CN").trim() || "zh-CN",
      productImage: String(params.productImages[0] || "").trim(),
      requirements: String(params.requirements || "").trim(),
      productImages: params.productImages.map((item) => String(item || "").trim()).filter(Boolean),
      project_id: projectId,
      targetPlatform: String(params.targetPlatform || "").trim() || "none",
      workflowMode,
      portraitImage: String(params.portraitImage || "").trim(),
      referenceImages: Array.isArray(params.referenceImages)
        ? params.referenceImages.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      targetLanguage: shortLanguage,
      promptConfigKey:
        workflowMode === "knowledge"
          ? `knowledge_${resolveStudioGenesisPromptConfigKey(params.targetLanguage)}`
          : params.imageType === "detail"
            ? `detail_analysis_domestic_${shortLanguage}`
            : `main_analysis_domestic_${shortLanguage}`,
    },
    result_data: null,
    result_url: null,
    error_message: null,
    is_refunded: false,
    cost_amount: 0,
    created_at: now,
    updated_at: now,
    trace_id: traceId,
    project_id: projectId,
    client_job_id: null,
    fe_attempt: Math.max(1, Number(params.feAttempt || 1)),
    be_retry: 0,
    duration_ms: null,
    error_code: null,
    gen_model: deriveGenModel(params.imageModelId),
    gen_resolution: String(params.imageSize || "").trim().toLowerCase() || "2k",
    is_turbo: String(params.speedMode || "").trim().toLowerCase() === "turbo",
    gen_family: deriveGenFamily(params.imageModelId),
    clothing_mode: null,
    workflow_mode: workflowMode,
    speed_mode: mapSpeedMode(params.speedMode),
    worker_id: DEFAULT_WORKER_ID,
    provider_meta: null,
    notifications: [
      createNotification("分析任务已创建，正在进入产品分析流程...", "created", "processing"),
    ],
  }

  analysisJobs.set(jobId, job)
  emitStudioGenesisJobUpdated(job)

  void runStudioGenesisAnalysisJob({
    jobId,
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    productImages: job.payload.productImages,
    imageType: job.payload.imageType,
    targetPlatform: job.payload.targetPlatform,
    workflowMode,
    portraitImage: job.payload.portraitImage,
    referenceImages: job.payload.referenceImages,
    requirements: job.payload.requirements,
    targetLanguage: params.targetLanguage,
    imageCount: normalizedImageCount,
    textModelId: params.textModelId,
  })

  return job
}

async function runStudioGenesisAiWriteJob(params: {
  jobId: string
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  requirements: string
  targetPlatform: string
  imageType: "main" | "detail"
  textModelId: string
}) {
  const startedAt = Date.now()

  try {
    const result = await generateStudioGenesisAiWriteOptions({
      merchantId: params.merchantId,
      requestOrigin: params.requestOrigin,
      productImages: params.productImages,
      requirements: params.requirements,
      targetPlatform: params.targetPlatform,
      imageType: params.imageType,
      requestedRuntimeId: params.textModelId,
    })

    const aiRequest = createAiRequestPreview({
      modelId: String(result.modelId || parseModelRuntimeId(params.textModelId).modelId || "").trim(),
      provider: result.provider || undefined,
      prompt: result.prompt || buildStudioGenesisAiWritePrompt({
        targetPlatform: params.targetPlatform,
        requirements: params.requirements,
        imageType: params.imageType,
      }),
      imageUrls: params.productImages.map((item) => toAbsoluteImageUrl(item, params.requestOrigin)),
      imageCount: 1,
      includeImageLabel: true,
      maxOutputTokens: 8192,
    })

    const durationMs = Date.now() - startedAt

    updateJob<"AI_WRITE">(params.jobId, (current) => ({
      ...current,
      status: "success",
      updated_at: nowIso(),
      duration_ms: durationMs,
      result_data: {
        _timing: {
          total_ms: durationMs,
          queue_wait_ms: 0,
          ai_call_total_ms: durationMs,
          config_refresh_ms: 0,
        },
        options: result.options,
      },
      payload: {
        ...current.payload,
        ai_request: aiRequest,
      },
      provider_meta: {
        model: result.modelId || parseModelRuntimeId(params.textModelId).modelId || "unknown",
        usage: result.usage || {},
        source: result.provider || "unknown",
        image_count: 6,
        target_language: "en",
      },
    }))
  } catch (error: any) {
    console.error("[studio-genesis/ai-write-job] failed:", {
      jobId: params.jobId,
      modelId: normalizeProviderModelId(params.textModelId),
      runtimeId: params.textModelId,
      error: error?.message || String(error),
    })
    updateJob<"AI_WRITE">(params.jobId, (current) => ({
      ...current,
      status: "failed",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      error_message: String(error?.message || "AI帮写失败"),
    }))
  }
}

export function createStudioGenesisAiWriteJob(params: {
  userId: string
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  requirements: string
  targetPlatform: string
  imageType: "main" | "detail"
  uiLanguage: string
  projectId?: string | null
  textModelId: string
  imageModelId: string
  imageSize: string
  speedMode: string
  feAttempt?: number
}) {
  cleanupExpiredJobs()

  const now = nowIso()
  const jobId = randomUUID()
  const projectId = String(params.projectId || "").trim() || null

  const job: StudioGenesisAiWriteJobRecord = {
    id: jobId,
    user_id: params.userId,
    type: "AI_WRITE",
    status: "processing",
    payload: {
      imageType: params.imageType,
      uiLanguage: String(params.uiLanguage || "zh").trim() || "zh",
      productImage: String(params.productImages[0] || "").trim(),
      productImages: params.productImages.map((item) => String(item || "").trim()).filter(Boolean),
      project_id: projectId,
      targetPlatform: String(params.targetPlatform || "").trim() || "none",
      promptConfigKey: params.imageType === "detail" ? "detail_ai_write_domestic_zh" : "main_ai_write_domestic_zh",
    },
    result_data: null,
    result_url: null,
    error_message: null,
    is_refunded: false,
    cost_amount: 0,
    created_at: now,
    updated_at: now,
    trace_id: null,
    project_id: projectId,
    client_job_id: null,
    fe_attempt: Math.max(1, Number(params.feAttempt || 1)),
    be_retry: 0,
    duration_ms: null,
    error_code: null,
    gen_model: deriveGenModel(params.imageModelId),
    gen_resolution: String(params.imageSize || "").trim().toLowerCase() || "1k",
    is_turbo: String(params.speedMode || "").trim().toLowerCase() === "turbo",
    gen_family: deriveGenFamily(params.imageModelId),
    clothing_mode: null,
    workflow_mode: null,
    speed_mode: mapSpeedMode(params.speedMode),
    worker_id: AI_WRITE_WORKER_ID,
    provider_meta: null,
  }

  analysisJobs.set(jobId, job)
  emitStudioGenesisJobUpdated(job)

  void runStudioGenesisAiWriteJob({
    jobId,
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    productImages: job.payload.productImages,
    requirements: String(params.requirements || "").trim(),
    targetPlatform: job.payload.targetPlatform,
    imageType: job.payload.imageType,
    textModelId: params.textModelId,
  })

  return job
}

export function createStudioGenesisImageJob(params: {
  userId: string
  productImages: string[]
  prompt: string
  imageModelRuntimeId: string
  imageSize: string
  aspectRatio: string
  speedMode: string
  imageType?: "main" | "detail"
  projectId?: string | null
  traceId?: string | null
  feAttempt?: number
  estimatedCost?: number
}) {
  cleanupExpiredJobs()

  const now = nowIso()
  const jobId = randomUUID()
  const traceId = String(params.traceId || "").trim() || randomUUID()
  const projectId = String(params.projectId || "").trim() || null
  const imageSize = String(params.imageSize || "1K").trim() || "1K"
  const aspectRatio = String(params.aspectRatio || "1:1").trim() || "1:1"
  const mappedSpeedMode = mapSpeedMode(params.speedMode)
  const turboEnabled = mappedSpeedMode === "turbo"
  const clientJobId = `${traceId}-0`

  const job: StudioGenesisImageJobRecord = {
    id: jobId,
    user_id: params.userId,
    type: "IMAGE_GEN",
    status: "processing",
    payload: {
      model: String(parseModelRuntimeId(params.imageModelRuntimeId).modelId || "").trim() || "unknown",
      prompt: String(params.prompt || "").trim(),
      gpt_size: aspectRatio,
      metadata: {
        is_batch: true,
        image_size: imageSize,
        batch_index: 0,
        product_images: params.productImages.map((item) => String(item || "").trim()).filter(Boolean),
      },
      trace_id: traceId,
      imageSize,
      imageType: params.imageType === "detail" ? "detail" : "main",
      speedMode: mappedSpeedMode,
      fe_attempt: Math.max(1, Number(params.feAttempt || 1)),
      imageCount: 1,
      project_id: projectId,
      aspectRatio,
      gpt_quality: "auto",
      productImage: String(params.productImages[0] || "").trim(),
      turboEnabled,
      client_job_id: clientJobId,
      productImages: params.productImages.map((item) => String(item || "").trim()).filter(Boolean),
      isNewUserTrial: false,
      _ef_preprocess_ms: 48,
    },
    result_data: null,
    result_url: null,
    error_message: null,
    is_refunded: false,
    cost_amount: Math.max(0, Number(params.estimatedCost || 0)),
    created_at: now,
    updated_at: now,
    trace_id: traceId,
    project_id: projectId,
    client_job_id: clientJobId,
    fe_attempt: Math.max(1, Number(params.feAttempt || 1)),
    be_retry: 0,
    duration_ms: null,
    error_code: null,
    gen_model: deriveGenModel(params.imageModelRuntimeId),
    gen_resolution: imageSize.toLowerCase(),
    is_turbo: turboEnabled,
    gen_family: deriveGenFamily(params.imageModelRuntimeId),
    clothing_mode: null,
    workflow_mode: null,
    speed_mode: mappedSpeedMode,
    worker_id: IMAGE_WORKER_ID,
    provider_meta: null,
  }

  analysisJobs.set(jobId, job)
  emitStudioGenesisJobUpdated(job)
  return job
}

export function completeStudioGenesisImageJob(params: {
  jobId: string
  resultUrl: string
  prompt: string
  modelId: string
  provider: string
}) {
  const completedAt = nowIso()
  updateJob<"IMAGE_GEN">(params.jobId, (current) => ({
    ...current,
    status: "success",
    updated_at: completedAt,
    result_url: params.resultUrl,
    duration_ms: Math.max(0, Date.now() - Date.parse(current.created_at || completedAt)),
    payload: {
      ...current.payload,
      prompt: String(params.prompt || "").trim(),
      model: String(params.modelId || current.payload.model || "").trim() || current.payload.model,
    },
    result_data: buildImageJobResultData({
      jobId: params.jobId,
      prompt: params.prompt,
      productImages: current.payload.productImages,
      imageSize: current.payload.imageSize,
      aspectRatio: current.payload.aspectRatio,
      resultUrl: params.resultUrl,
      createdAt: current.created_at,
      updatedAt: completedAt,
    }),
    provider_meta: {
      model: params.modelId,
      source: params.provider,
      provider_chain_tried: [params.provider],
    },
  }))
}

export function attachStudioGenesisImageProviderTask(params: {
  jobId: string
  taskId: string
  endpointBase?: string
  modelId?: string
  provider?: string
}) {
  updateJob<"IMAGE_GEN">(params.jobId, (current) => ({
    ...current,
    updated_at: nowIso(),
    provider_meta: {
      ...(current.provider_meta || {}),
      task_id: String(params.taskId || "").trim(),
      endpoint_base: String(params.endpointBase || "").trim(),
      model: String(params.modelId || current.provider_meta?.model || current.payload.model || "").trim(),
      source: String(params.provider || current.provider_meta?.source || "").trim(),
    },
    result_data: current.result_data
      ? {
          ...current.result_data,
          task_id: String(params.taskId || current.result_data.task_id || "").trim(),
        }
      : current.result_data,
  }))
}

export function failStudioGenesisImageJob(jobId: string, message: string) {
  updateJob<"IMAGE_GEN">(jobId, (current) => ({
    ...current,
    status: "failed",
    updated_at: nowIso(),
    duration_ms: Math.max(0, Date.now() - Date.parse(current.created_at || nowIso())),
    error_message: String(message || "生成失败"),
  }))
}

export function getStudioGenesisAnalysisJob(jobId: string, userId: string) {
  cleanupExpiredJobs()
  const job = analysisJobs.get(String(jobId || "").trim())
  if (!job) return null
  if (String(job.user_id || "").trim() !== String(userId || "").trim()) return null
  return job
}
