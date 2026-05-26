import { randomUUID } from "node:crypto"
import { checkAndDeductPoints } from "@/lib/points"
import { parseModelRuntimeId } from "@/lib/models/runtime-id"
import {
  analyzeRefinementStudioPrompt,
  buildRefinementAnalysisPrompt,
  generateRefinementStudioImage,
} from "@/lib/refinement-studio-ai"
import {
  getRefinementStudioJobForUser,
  insertRefinementStudioJob,
  updateRefinementStudioJob,
} from "@/lib/refinement-studio-job-store"
import {
  DEFAULT_REFINEMENT_STUDIO_SETTINGS,
  isRefinementStudioTurboEnabled,
  normalizeRefinementStudioBackgroundSetting,
  resolveRefinementStudioMappedSpeedMode,
  resolveRefinementStudioPromptConfigKey,
  type RefinementStudioAnalysisJobAiRequest,
  type RefinementStudioAnalysisJobRecord,
  type RefinementStudioBackgroundSetting,
  type RefinementStudioImageJobRecord,
  type RefinementStudioJobRecord,
  type RefinementStudioSettings,
} from "@/lib/refinement-studio"
import { createStudioGenesisHistoryItem } from "@/lib/studio-genesis-history"

const DEFAULT_WORKER_ID = "refinement-studio-local-worker-1"

function nowIso() {
  return new Date().toISOString()
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
  if (!modelId) return "refinement_studio"
  if (modelId.includes("nano") && modelId.includes("banana")) return "nano_banana"
  const compact = modelId.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return compact || "refinement_studio"
}

function deriveGenModel(runtimeId: string) {
  const modelId = parseModelRuntimeId(String(runtimeId || "").trim()).modelId.toLowerCase()
  if (!modelId) return "basic"
  if (modelId.includes("pro")) return "pro"
  if (modelId.includes("ultra")) return "ultra"
  if (modelId.includes("turbo")) return "turbo"
  return "basic"
}

function createAnalysisAiRequestPreview(params: {
  modelId: string
  provider?: string
  prompt: string
  imageUrl: string
}) {
  return {
    model: String(params.modelId || "").trim() || "unknown",
    contents: [
      {
        role: "user",
        parts: [
          { text: params.prompt },
          {
            inlineData: {
              data: params.imageUrl,
              mimeType: "image/png",
            },
          },
        ],
      },
    ],
    provider: String(params.provider || "").trim() || "unknown",
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
    },
  } satisfies RefinementStudioAnalysisJobAiRequest
}

async function updateJob<T extends RefinementStudioJobRecord["type"]>(
  jobId: string,
  updater: (
    current: Extract<RefinementStudioJobRecord, { type: T }>
  ) => Extract<RefinementStudioJobRecord, { type: T }>
) {
  return await updateRefinementStudioJob(jobId, updater)
}

async function runRefinementStudioAnalysisJob(params: {
  jobId: string
  merchantId: string | null
  requestOrigin?: string
  imageUrl: string
  requirements: string
  backgroundSetting: RefinementStudioBackgroundSetting
}) {
  const startedAt = Date.now()
  const analysisPrompt = buildRefinementAnalysisPrompt({
    requirements: params.requirements,
    backgroundSetting: params.backgroundSetting,
  })

  try {
    const analysis = await analyzeRefinementStudioPrompt({
      merchantId: params.merchantId,
      requestOrigin: params.requestOrigin,
      imageUrl: params.imageUrl,
      requirements: params.requirements,
      settings: {
        backgroundSetting: params.backgroundSetting,
        aspectRatio: DEFAULT_REFINEMENT_STUDIO_SETTINGS.aspectRatio,
        imageSize: DEFAULT_REFINEMENT_STUDIO_SETTINGS.imageSize,
      },
    })

    await updateJob<"ANALYSIS">(params.jobId, (current) => ({
      ...current,
      status: "success",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      result_data: {
        text: analysis.prompt,
      },
      payload: {
        ...current.payload,
        ai_request: createAnalysisAiRequestPreview({
          modelId: String(analysis.analysisModelId || "").trim() || "unknown",
          provider: analysis.analysisProvider || undefined,
          prompt: analysisPrompt,
          imageUrl: toAbsoluteImageUrl(analysis.imageUrl, params.requestOrigin),
        }),
      },
      provider_meta: {
        model: String(analysis.analysisModelId || "").trim() || "unknown",
        source: String(analysis.analysisProvider || "").trim() || "unknown",
        image_count: 1,
        target_language: "zh-CN",
      },
    }))
  } catch (error: any) {
    await updateJob<"ANALYSIS">(params.jobId, (current) => ({
      ...current,
      status: "failed",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      error_message: String(error?.message || "分析失败"),
    }))
  }
}

async function runRefinementStudioImageJob(params: {
  jobId: string
  userId: string
  merchantId: string | null
  requestOrigin?: string
  batchId?: string
  index?: number
  title?: string
  description?: string
  requirements?: string
  imageUrl: string
  prompt: string
  imageModelRuntimeId: string
  settings: Pick<RefinementStudioSettings, "backgroundSetting" | "aspectRatio" | "imageSize" | "speedMode">
}) {
  const startedAt = Date.now()

  try {
    const result = await generateRefinementStudioImage({
      merchantId: params.merchantId,
      requestOrigin: params.requestOrigin,
      imageUrl: params.imageUrl,
      prompt: params.prompt,
      settings: {
        imageModelId: params.imageModelRuntimeId,
        backgroundSetting: params.settings.backgroundSetting,
        aspectRatio: params.settings.aspectRatio,
        imageSize: params.settings.imageSize,
        speedMode: params.settings.speedMode,
      },
    })

    await checkAndDeductPoints(params.userId, params.imageModelRuntimeId, "image", {
      merchantId: params.merchantId,
      quantity: 1,
    })

    const completedAt = nowIso()
    await updateJob<"REFINE_IMAGE_GEN">(params.jobId, (current) => ({
      ...current,
      status: "success",
      updated_at: completedAt,
      duration_ms: Date.now() - startedAt,
      result_url: result.url,
      result_data: {
        unit: null,
        count: "1",
        result: [result.url],
        status: 2,
        message: "",
      },
      provider_meta: {
        model: result.modelId,
        source: result.provider,
        provider_chain_tried: [result.provider],
      },
    }))

    try {
      await createStudioGenesisHistoryItem(
        { userId: params.userId, merchantId: params.merchantId },
        {
          batchId: String(params.batchId || params.jobId).trim(),
          planId: params.jobId,
          index: Math.max(0, Number(params.index || 0) || 0),
          title: String(params.title || "").trim(),
          description: String(params.description || "").trim(),
          prompt: result.prompt || params.prompt,
          imageUrl: result.url,
          sourceImageUrl: params.imageUrl,
          model: result.modelId,
          provider: result.provider,
          aspectRatio: params.settings.aspectRatio,
          imageSize: params.settings.imageSize,
          targetLanguage: "none",
          requirements: String(params.requirements || "").trim(),
          productImages: [params.imageUrl],
        }
      )
    } catch (historyError) {
      console.error("[refinement-studio] persist history failed:", historyError)
    }
  } catch (error: any) {
    await updateJob<"REFINE_IMAGE_GEN">(params.jobId, (current) => ({
      ...current,
      status: "failed",
      updated_at: nowIso(),
      duration_ms: Date.now() - startedAt,
      error_message: String(error?.message || "产品精修失败"),
    }))
  }
}

export async function createRefinementStudioAnalysisJob(params: {
  userId: string
  merchantId: string | null
  requestOrigin?: string
  imageUrl: string
  requirements?: string
  backgroundSetting?: RefinementStudioBackgroundSetting
  uiLanguage?: string
  imageModelRuntimeId?: string
  imageSize?: string
  speedMode?: string
  feAttempt?: number
}) {
  const now = nowIso()
  const jobId = randomUUID()
  const backgroundSetting = normalizeRefinementStudioBackgroundSetting(params.backgroundSetting)
  const whiteBackground = backgroundSetting === "white"
  const imageModelRuntimeId = String(params.imageModelRuntimeId || "").trim()

  const job: RefinementStudioAnalysisJobRecord = {
    id: jobId,
    user_id: params.userId,
    type: "ANALYSIS",
    status: "processing",
    payload: {
      productImage: String(params.imageUrl || "").trim(),
      clothingMode: "refinement_analysis",
      whiteBackground,
      requirements: String(params.requirements || "").trim(),
      imageCount: 1,
      uiLanguage: String(params.uiLanguage || "zh-CN").trim() || "zh-CN",
      promptConfigKey: resolveRefinementStudioPromptConfigKey(),
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
    gen_model: deriveGenModel(imageModelRuntimeId),
    gen_resolution: "1k",
    is_turbo: isRefinementStudioTurboEnabled(params.speedMode),
    gen_family: deriveGenFamily(imageModelRuntimeId),
    clothing_mode: "refinement_analysis",
    workflow_mode: null,
    speed_mode: resolveRefinementStudioMappedSpeedMode(params.speedMode),
    worker_id: DEFAULT_WORKER_ID,
    provider_meta: null,
  }

  await insertRefinementStudioJob(job)

  void runRefinementStudioAnalysisJob({
    jobId,
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    imageUrl: job.payload.productImage,
    requirements: job.payload.requirements,
    backgroundSetting,
  })

  return job
}

export async function createRefinementStudioImageJob(params: {
  userId: string
  merchantId: string | null
  requestOrigin?: string
  batchId?: string
  index?: number
  title?: string
  description?: string
  requirements?: string
  imageUrl: string
  prompt: string
  imageModelRuntimeId: string
  requestedModel?: string
  backgroundSetting?: RefinementStudioBackgroundSetting
  aspectRatio: string
  imageSize: string
  speedMode: string
  feAttempt?: number
  estimatedCost?: number
}) {
  const now = nowIso()
  const jobId = randomUUID()

  const job: RefinementStudioImageJobRecord = {
    id: jobId,
    user_id: params.userId,
    type: "REFINE_IMAGE_GEN",
    status: "processing",
    payload: {
      batchId: String(params.batchId || "").trim(),
      index: Math.max(0, Number(params.index || 0) || 0),
      title: String(params.title || "").trim(),
      description: String(params.description || "").trim(),
      requirements: String(params.requirements || "").trim(),
      aspectRatio:
        String(params.aspectRatio || DEFAULT_REFINEMENT_STUDIO_SETTINGS.aspectRatio).trim() ||
        DEFAULT_REFINEMENT_STUDIO_SETTINGS.aspectRatio,
      fe_attempt: Math.max(1, Number(params.feAttempt || 1)),
      imageSize:
        String(params.imageSize || DEFAULT_REFINEMENT_STUDIO_SETTINGS.imageSize).trim() ||
        DEFAULT_REFINEMENT_STUDIO_SETTINGS.imageSize,
      isNewUserTrial: false,
      jobType: "REFINE_IMAGE_GEN",
      model: String(params.requestedModel || parseModelRuntimeId(params.imageModelRuntimeId).modelId || "").trim(),
      productImage: String(params.imageUrl || "").trim(),
      prompt: String(params.prompt || "").trim(),
      speedMode: resolveRefinementStudioMappedSpeedMode(params.speedMode),
      turboEnabled: isRefinementStudioTurboEnabled(params.speedMode),
      workflowMode: "product",
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
    is_turbo: isRefinementStudioTurboEnabled(params.speedMode),
    gen_family: deriveGenFamily(params.imageModelRuntimeId),
    clothing_mode: null,
    workflow_mode: "product",
    speed_mode: resolveRefinementStudioMappedSpeedMode(params.speedMode),
    worker_id: DEFAULT_WORKER_ID,
    provider_meta: null,
  }

  await insertRefinementStudioJob(job)

  void runRefinementStudioImageJob({
    jobId,
    userId: params.userId,
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    batchId: job.payload.batchId,
    index: job.payload.index,
    title: job.payload.title,
    description: job.payload.description,
    requirements: job.payload.requirements,
    imageUrl: job.payload.productImage,
    prompt: job.payload.prompt,
    imageModelRuntimeId: params.imageModelRuntimeId,
    settings: {
      backgroundSetting: normalizeRefinementStudioBackgroundSetting(params.backgroundSetting),
      aspectRatio: job.payload.aspectRatio,
      imageSize: job.payload.imageSize,
      speedMode: isRefinementStudioTurboEnabled(params.speedMode)
        ? "turbo"
        : String(params.speedMode || "").trim().toLowerCase() === "fast"
          ? "fast"
          : "standard",
    },
  })

  return job
}

export async function getRefinementStudioJob(jobId: string, userId: string) {
  return await getRefinementStudioJobForUser(jobId, userId)
}
