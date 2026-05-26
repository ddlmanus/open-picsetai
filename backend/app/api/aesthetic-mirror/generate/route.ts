import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { checkAndDeductPoints } from "@/lib/points"
import { getEffectiveModelConfig } from "@/lib/models/fetcher"
import {
  analyzeAestheticMirrorStylePrompt,
  buildAestheticMirrorSingleStylePrompt,
  buildAestheticMirrorSkuReplacePrompt,
  generateAestheticMirrorImage,
  listAestheticMirrorModels,
  resolveBatchConcurrencyFromSpeedMode,
} from "@/lib/aesthetic-mirror-ai"
import {
  DEFAULT_AESTHETIC_MIRROR_SETTINGS,
  AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES,
  AESTHETIC_MIRROR_MAX_REFERENCE_IMAGES,
  buildAestheticMirrorJobs,
  clampAestheticMirrorImageCount,
  type AestheticMirrorAnalysisJobAiRequest,
  type AestheticMirrorMode,
  type AestheticMirrorJobRecord,
} from "@/lib/aesthetic-mirror"
import { insertAestheticMirrorJob, updateAestheticMirrorJob } from "@/lib/aesthetic-mirror-job-store"
import { createStudioGenesisHistoryItem } from "@/lib/studio-genesis-history"

export const dynamic = "force-dynamic"
const AESTHETIC_MIRROR_WORKER_ID = "picsetai-cn-prod-worker-1"

function normalizeMode(input: unknown): AestheticMirrorMode {
  const normalized = String(input || "").trim()
  if (normalized === "batch") return "batch"
  if (normalized === "sku_replace") return "sku"
  if (normalized === "sku") return "sku"
  return "single"
}

export async function POST(request: NextRequest) {
  const scope = await getLocalUserScope()
    const userId = scope.userId

  const body = await request.json().catch(() => ({}))
  const mode = normalizeMode(body?.mode)
  const projectId = body?.project_id == null ? null : String(body.project_id || "").trim() || null
  const referenceImages = Array.isArray(body?.referenceImages)
    ? body.referenceImages.map((item: unknown) => String(item || "").trim()).filter(Boolean).slice(0, AESTHETIC_MIRROR_MAX_REFERENCE_IMAGES)
    : []
  const referenceImage = String(body?.referenceImage || referenceImages[0] || "").trim()
  const normalizedReferenceImages = referenceImages.length > 0 ? referenceImages : referenceImage ? [referenceImage] : []
  const productImages = Array.isArray(body?.productImages)
    ? body.productImages.map((item: unknown) => String(item || "").trim()).filter(Boolean).slice(0, AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES)
    : []
  const requestedJobIds = Array.isArray(body?.jobIds)
    ? new Set(body.jobIds.map((item: unknown) => String(item || "").trim()).filter(Boolean))
    : null

  if (normalizedReferenceImages.length === 0) {
    return NextResponse.json({ error: "请先上传参考设计图" }, { status: 400 })
  }

  if (productImages.length === 0) {
    return NextResponse.json({ error: "请先上传至少一张产品素材图" }, { status: 400 })
  }

  const requestedImageCount = clampAestheticMirrorImageCount(body?.imageCount)
  const allJobs = buildAestheticMirrorJobs({
    mode,
    referenceImages: normalizedReferenceImages,
    productImages,
    imageCount: requestedImageCount,
  })
  const jobs = requestedJobIds && requestedJobIds.size > 0
    ? allJobs.filter((job) => requestedJobIds.has(job.id))
    : allJobs

  if (jobs.length === 0) {
    return NextResponse.json({ error: "缺少有效的生成任务" }, { status: 400 })
  }

  const merchantId = scope.merchantId
  const models = await listAestheticMirrorModels(merchantId)
  const imageModelId = String(body?.imageModelId || models.imageModel?.runtimeId || "").trim()

  if (!imageModelId) {
    return NextResponse.json({ error: "当前商户未配置可用生图模型" }, { status: 400 })
  }

  const billingConfig = await getEffectiveModelConfig(imageModelId, merchantId)
  try {
    await checkAndDeductPoints(userId, imageModelId, "image", {
      merchantId,
      modelConfig: billingConfig || undefined,
      quantity: jobs.length,
      dryRun: true,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "积分不足或模型受限" }, { status: 403 })
  }

  const requestId = randomUUID()
  const speedMode = String(body?.speedMode || DEFAULT_AESTHETIC_MIRROR_SETTINGS.speedMode).trim()
  const concurrency = resolveBatchConcurrencyFromSpeedMode(
    speedMode === "fast" || speedMode === "turbo" ? speedMode : "standard"
  )
  const settings = {
    imageModelId,
    aspectRatio: String(body?.aspectRatio || DEFAULT_AESTHETIC_MIRROR_SETTINGS.aspectRatio).trim() || DEFAULT_AESTHETIC_MIRROR_SETTINGS.aspectRatio,
    imageSize: String(body?.imageSize || DEFAULT_AESTHETIC_MIRROR_SETTINGS.imageSize).trim() || DEFAULT_AESTHETIC_MIRROR_SETTINGS.imageSize,
    speedMode: speedMode === "fast" || speedMode === "turbo" ? speedMode : "standard",
  } as const

  const prompt = String(body?.prompt || "").trim()
  const skuText = String(body?.skuText || "").trim()
  const requestStartedAt = Date.now()

  function nowIso() {
    return new Date().toISOString()
  }

  function mapSpeedMode(value: string) {
    const normalized = String(value || "").trim().toLowerCase()
    if (normalized === "turbo") return "turbo"
    if (normalized === "fast") return "fast"
    return "normal"
  }

  function deriveGenFamily(runtimeId: string) {
    const normalized = String(runtimeId || "").trim().toLowerCase()
    if (!normalized) return "nano_banana"
    if (normalized.includes("banana")) return "nano_banana"
    if (normalized.includes("gpt-image")) return "gpt_image"
    return "nano_banana"
  }

  function deriveGenModel(runtimeId: string) {
    const normalized = String(runtimeId || "").trim().toLowerCase()
    if (!normalized) return "banana2"
    if (normalized.includes("banana")) return "banana2"
    if (normalized.includes("gpt-image")) return "gpt_image_2"
    return "banana2"
  }

  function buildStyleAiRequestPreview(params: {
    analysisPrompt: string
    referenceImage: string
    productImage: string
    modelId: string
    provider: string
  }): AestheticMirrorAnalysisJobAiRequest {
    return {
      model: String(params.modelId || "").trim() || "unknown",
      contents: [
        {
          role: "user",
          parts: [
            { text: params.analysisPrompt },
            { text: "This is the style reference image:" },
            {
              inlineData: {
                data: params.referenceImage,
                mimeType: "image/png",
              },
            },
            { text: "This is the product image to analyze:" },
            {
              inlineData: {
                data: params.productImage,
                mimeType: "image/png",
              },
            },
          ],
        },
      ],
      provider: String(params.provider || "").trim() || "unknown",
      generationConfig: {
        temperature: 0.4,
        responseSchema: {
          type: "OBJECT",
          required: ["prompt"],
          properties: {
            prompt: {
              type: "STRING",
            },
          },
        },
        thinkingConfig: {
          thinkingBudget: 0,
        },
        responseMimeType: "application/json",
      },
    }
  }

  const events: any[] = [{
    type: "batch_start",
    requestId,
    total: jobs.length,
    concurrency,
    mode,
  }]
  const queuedJobs: Array<{
    job: (typeof jobs)[number]
    jobIndex: number
    serverJobId: string
    referenceImagesForJob: string[]
    baseGeneratedJob: AestheticMirrorJobRecord
  }> = []

  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex]
    const clientJobId =
      mode === "batch"
        ? `${requestId}-${job.referenceIndex}-${job.productIndex}`
        : mode === "sku"
          ? `${requestId}-${job.productIndex}`
          : `${requestId}-${job.variantIndex}`

    const baseGeneratedJob: AestheticMirrorJobRecord = {
      id: randomUUID(),
      user_id: userId,
      type: mode === "sku" ? "SKU_REPLACE" : "STYLE_REPLICATE",
      status: "processing",
      payload: {
        mode: mode === "sku" ? "sku_replace" : mode,
        model: "nano-banana2",
        prompt: mode === "sku" ? buildAestheticMirrorSkuReplacePrompt(skuText) : "",
        metadata:
          mode === "sku"
            ? undefined
            : {
                is_batch: mode === "batch",
                ...(mode === "batch" ? { reference_index: job.referenceIndex } : { placeholder_id: `placeholder-${Date.now()}-${jobIndex}` }),
                product_images: job.productImages,
                ...(mode === "single" ? { reference_image: job.referenceImage } : {}),
              },
        trace_id: requestId,
        imageSize: settings.imageSize,
        speedMode: settings.speedMode,
        fe_attempt: 1,
        project_id: projectId,
        userPrompt: mode === "sku" ? undefined : prompt,
        aspectRatio: settings.aspectRatio,
        userContent: mode === "sku" ? undefined : `补充提示词：${prompt}`,
        productImage: job.productImage || job.productImages[0] || "",
        turboEnabled: false,
        client_job_id: clientJobId,
        productImages: job.productImages,
        isNewUserTrial: false,
        referenceImage: job.referenceImage,
        promptConfigKey: mode === "sku" ? undefined : "style_prompt",
        skuText: mode === "sku" ? skuText : undefined,
        _ef_preprocess_ms: 0,
      },
      result_data: null,
      result_url: null,
      error_message: null,
      is_refunded: false,
      cost_amount: 4,
      created_at: nowIso(),
      updated_at: nowIso(),
      trace_id: requestId,
      client_job_id: clientJobId,
      fe_attempt: 1,
      be_retry: 0,
      duration_ms: null,
      error_code: null,
      gen_model: deriveGenModel(imageModelId),
      gen_resolution: String(settings.imageSize || "").trim().toLowerCase() || "2k",
      is_turbo: false,
      gen_family: deriveGenFamily(imageModelId),
      clothing_mode: null,
      workflow_mode: null,
      speed_mode: mapSpeedMode(settings.speedMode),
      worker_id: AESTHETIC_MIRROR_WORKER_ID,
      provider_meta: null,
      project_id: projectId,
    }

    await insertAestheticMirrorJob(baseGeneratedJob)
    events.push({
      type: "image_status",
      requestId,
      jobId: job.id,
      serverJobId: baseGeneratedJob.id,
      index: jobIndex,
      title: job.title,
      status: "prompting",
    })

    queuedJobs.push({
      job,
      jobIndex,
      serverJobId: baseGeneratedJob.id,
      referenceImagesForJob: mode === "batch" || mode === "sku" ? [job.referenceImage] : normalizedReferenceImages,
      baseGeneratedJob,
    })
  }

  void (async () => {
    let nextIndex = 0
    let haltedByError = ""

    const claimNext = () => {
      if (haltedByError) return -1
      if (nextIndex >= queuedJobs.length) return -1
      const current = nextIndex
      nextIndex += 1
      return current
    }

    const worker = async () => {
      while (true) {
        const queuedIndex = claimNext()
        if (queuedIndex < 0) return

        const {
          job,
          jobIndex,
          serverJobId,
          referenceImagesForJob,
          baseGeneratedJob,
        } = queuedJobs[queuedIndex]

        try {
          const analyzedPrompt = mode === "single" || mode === "batch"
            ? await analyzeAestheticMirrorStylePrompt({
                merchantId,
                requestOrigin: request.nextUrl.origin,
                referenceImage: job.referenceImage || normalizedReferenceImages[0] || "",
                productImage: job.productImage || productImages[0] || "",
                userPrompt: prompt,
              })
            : null

          if (analyzedPrompt) {
            await updateAestheticMirrorJob(serverJobId, (current) => ({
              ...current,
              updated_at: nowIso(),
              payload: {
                ...current.payload,
                prompt: analyzedPrompt.prompt,
                ai_request: buildStyleAiRequestPreview({
                  analysisPrompt: buildAestheticMirrorSingleStylePrompt(prompt),
                  referenceImage: analyzedPrompt.referenceImage,
                  productImage: analyzedPrompt.productImage,
                  modelId: analyzedPrompt.analysisModelId,
                  provider: analyzedPrompt.analysisProvider,
                }),
                promptConfigKey: analyzedPrompt.promptConfigKey,
                referenceImage: analyzedPrompt.referenceImage,
              },
              provider_meta: {
                model: analyzedPrompt.analysisModelId,
                source: analyzedPrompt.analysisProvider,
                image_count: 1,
              },
            }))
          }

          const result = await generateAestheticMirrorImage({
            merchantId,
            requestOrigin: request.nextUrl.origin,
            referenceImages: referenceImagesForJob,
            productImages: job.productImages,
            mode,
            title: job.title,
            prompt,
            resolvedPrompt: analyzedPrompt?.prompt,
            skuText,
            styleSummary: "",
            productSummary: "",
            settings,
            groupIndex: mode === "batch" || mode === "sku" ? job.referenceIndex : undefined,
            groupCount: mode === "batch" || mode === "sku" ? 1 : undefined,
            productIndex: mode === "batch" || mode === "sku" ? job.productIndex : undefined,
            productCount: mode === "batch" || mode === "sku" ? productImages.length : undefined,
            variantIndex: job.variantIndex,
            variantCount: requestedImageCount,
          })

          await checkAndDeductPoints(userId, imageModelId, "image", {
            merchantId,
            modelConfig: billingConfig || undefined,
            quantity: 1,
          })

          await updateAestheticMirrorJob(serverJobId, (current) => ({
            ...current,
            status: "success",
            updated_at: nowIso(),
            duration_ms: Date.now() - requestStartedAt,
            result_url: result.url,
            result_data: {
              unit: null,
              count: "1",
              result: [result.url],
              status: 2,
              message: "",
            },
            payload: {
              ...current.payload,
              prompt: result.prompt,
            },
            provider_meta: {
              ...(current.provider_meta || {}),
              image_count: 1,
            },
          }))

          try {
            await createStudioGenesisHistoryItem(
              { userId, merchantId },
              {
                batchId: requestId,
                planId: job.id,
                index: jobIndex,
                title: job.title,
                description:
                  mode === "batch"
                    ? "风格复刻 · 批量复刻"
                    : mode === "sku"
                      ? "风格复刻 · SKU 替换"
                      : "风格复刻 · 单图复刻",
                prompt: result.prompt,
                imageUrl: result.url,
                sourceImageUrl: job.productImage || result.url,
                model: result.modelId,
                provider: result.provider,
                aspectRatio: settings.aspectRatio,
                imageSize: settings.imageSize,
                targetLanguage: "none",
                requirements: prompt,
                productImages: job.productImages,
              }
            )
          } catch (historyError) {
            console.error("[api/aesthetic-mirror/generate] persist history failed:", historyError)
          }
        } catch (error: any) {
          const message = String(error?.message || "生成失败")
          await updateAestheticMirrorJob(serverJobId, (current) => ({
            ...current,
            status: "failed",
            updated_at: nowIso(),
            duration_ms: Date.now() - requestStartedAt,
            error_message: message,
          }))
          if (/积分不足|仅限会员/.test(message)) {
            haltedByError = message
            return
          }
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))
  })().catch((error) => {
    console.error("[api/aesthetic-mirror/generate] background generation failed:", error)
  })

  return NextResponse.json({
    requestId,
    events,
    queued: queuedJobs.length,
  })
}
