import { randomUUID } from "crypto"
import { after, NextRequest, NextResponse } from "next/server"
import { checkAndDeductPoints } from "@/lib/points"
import { getEffectiveModelConfig } from "@/lib/models/fetcher"
import {
  normalizeStudioGenesisAnalysisResult,
  resolveStudioGenesisLanguageLabel,
  type StudioGenesisPlan,
  type StudioGenesisWorkflowMode,
} from "@/lib/studio-genesis"
import {
  buildStudioGenesisPlanImagePrompt,
  generateStudioGenesisPlanImage,
  listStudioGenesisModels,
  resolveBatchConcurrencyFromSpeedMode,
} from "@/lib/studio-genesis-ai"
import {
  attachStudioGenesisImageProviderTask,
  completeStudioGenesisImageJob,
  createStudioGenesisImageJob,
  failStudioGenesisImageJob,
} from "@/lib/studio-genesis-analysis-jobs"
import { createStudioGenesisHistoryItem } from "@/lib/studio-genesis-history"
import { getLocalUserScope } from "@/lib/local-user"

export const dynamic = "force-dynamic"

function resolveRequestAnalysisInput(body: any) {
  return body?.analysisResult || body?.analysis_result || body?.analysisJson || body?.analysis_json || {}
}

function parseRequestPlans(body: any, analysisInput: any): StudioGenesisPlan[] {
  const rawPlans = Array.isArray(body?.plans)
    ? body.plans
    : Array.isArray(analysisInput?.images)
      ? analysisInput.images
      : []

  return rawPlans.map((item: any, index: number) => ({
        id: String(item?.id || "").trim() || `sg-plan-${index + 1}`,
        title: String(item?.title || "").trim(),
        description: String(item?.description || "").trim(),
        designContent: String(item?.designContent || item?.design_content || "").trim(),
        promptHint: String(item?.promptHint || item?.prompt_hint || "").trim(),
      }))
}

export async function POST(request: NextRequest) {
  const scope = await getLocalUserScope()
  const userId = scope.userId

  const body = await request.json().catch(() => ({}))
  const workflowMode: StudioGenesisWorkflowMode = body?.workflowMode === "knowledge" ? "knowledge" : "product"
  const portraitImage = workflowMode === "knowledge" ? String(body?.portraitImage || "").trim() : ""
  const referenceImages = workflowMode === "knowledge" && Array.isArray(body?.referenceImages)
    ? body.referenceImages.map((item: unknown) => String(item || "").trim()).filter(Boolean)
    : []
  const rawAnalysisInput = resolveRequestAnalysisInput(body)
  const productImages = Array.isArray(body?.productImages)
    ? body.productImages.map((item: unknown) => String(item || "").trim()).filter(Boolean)
    : []
  if (workflowMode === "knowledge" && !portraitImage) {
    return NextResponse.json({ error: "请先上传讲师形象图" }, { status: 400 })
  }
  if (workflowMode === "product" && productImages.length === 0) {
    return NextResponse.json({ error: "请先上传至少一张商品图" }, { status: 400 })
  }
  const sourceImages = workflowMode === "knowledge" ? [portraitImage, ...referenceImages] : productImages

  const plans = parseRequestPlans(body, rawAnalysisInput)
  if (plans.length === 0) {
    return NextResponse.json({ error: "缺少有效的图片计划" }, { status: 400 })
  }

  const merchantId = scope.merchantId
  const models = await listStudioGenesisModels(merchantId)
  const imageModelId = String(body?.imageModelId || models.imageModel?.runtimeId || "").trim()
  const analysisResult = normalizeStudioGenesisAnalysisResult(
    {
      ...(rawAnalysisInput || {}),
      images: plans,
    },
    {
      imageCount: plans.length,
      targetLanguage: String(body?.targetLanguage || "none").trim() || "none",
      workflowMode,
    }
  )

  if (!imageModelId) {
    return NextResponse.json({ error: "当前商户未配置可用生图模型" }, { status: 400 })
  }

  const billingConfig = await getEffectiveModelConfig(imageModelId, merchantId)
  try {
    await checkAndDeductPoints(userId, imageModelId, "image", {
      merchantId,
      modelConfig: billingConfig || undefined,
      quantity: plans.length,
      dryRun: true,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "积分不足或模型受限" }, { status: 403 })
  }

  const requestId = randomUUID()
  const requestOrigin = request.nextUrl.origin
  const speedMode = String(body?.speedMode || "standard").trim() || "standard"
  const concurrency = resolveBatchConcurrencyFromSpeedMode(
    speedMode === "fast" || speedMode === "turbo" ? speedMode : "standard"
  )
  const targetLanguage = String(body?.targetLanguage || "none").trim() || "none"
  const settings = {
    imageModelId,
    aspectRatio: String(body?.aspectRatio || "3:4").trim() || "3:4",
    imageSize: String(body?.imageSize || "2K").trim() || "2K",
    speedMode: speedMode === "fast" || speedMode === "turbo" ? speedMode : "standard",
    targetLanguage,
  } as const

  const events: any[] = [{
    type: "batch_start",
    requestId,
    total: plans.length,
    concurrency,
    targetLanguageLabel: resolveStudioGenesisLanguageLabel(targetLanguage),
  }]
  const imageType = body?.imageType === "detail" ? "detail" : "main"
  const requirements = String(body?.requirements || "").trim()
  const projectId = body?.project_id == null ? null : String(body.project_id || "").trim() || null
  const queuedJobs = plans.map((plan, planIndex) => {
    const precomputedPrompt = buildStudioGenesisPlanImagePrompt({
      requestOrigin,
      productImages: sourceImages,
      imageType,
      workflowMode,
      portraitImage,
      referenceImages,
      requirements,
      settings,
      analysisResult,
      plan,
      normalizedReferenceCount: sourceImages.length,
    })

    const imageJob = createStudioGenesisImageJob({
      userId,
      productImages: sourceImages,
      prompt: precomputedPrompt,
      imageModelRuntimeId: imageModelId,
      imageSize: settings.imageSize,
      aspectRatio: settings.aspectRatio,
      speedMode: settings.speedMode,
      imageType,
      projectId,
      traceId: requestId,
      feAttempt: Number(body?.feAttempt || 1),
      estimatedCost: Number(billingConfig?.cost || 0),
    })

    events.push({
      type: "image_status",
      requestId,
      planId: plan.id,
      index: planIndex,
      jobId: imageJob.id,
      title: plan.title,
      status: "prompting",
    })
    events.push({
      type: "prompt_ready",
      requestId,
      planId: plan.id,
      index: planIndex,
      jobId: imageJob.id,
      prompt: precomputedPrompt,
    })

    return { plan, planIndex, imageJobId: imageJob.id, precomputedPrompt }
  })

  after(async () => {
    try {
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

          const queued = queuedJobs[queuedIndex]
          try {
            const result = await generateStudioGenesisPlanImage({
              merchantId,
              requestOrigin,
              productImages: sourceImages,
              imageType,
              workflowMode,
              portraitImage,
              referenceImages,
              requirements,
              settings,
              analysisResult,
              plan: queued.plan,
              precomputedPrompt: queued.precomputedPrompt,
              onTaskSubmitted: (task) => {
                attachStudioGenesisImageProviderTask({
                  jobId: queued.imageJobId,
                  taskId: task.taskId,
                  endpointBase: task.endpointBase,
                  modelId: task.modelId,
                  provider: task.provider,
                })
              },
            })

            completeStudioGenesisImageJob({
              jobId: queued.imageJobId,
              resultUrl: result.url,
              prompt: result.prompt,
              modelId: result.modelId,
              provider: result.provider,
            })

            await checkAndDeductPoints(userId, imageModelId, "image", {
              merchantId,
              modelConfig: billingConfig || undefined,
              quantity: 1,
            })

            try {
              await createStudioGenesisHistoryItem(
                { userId, merchantId },
                {
                  batchId: requestId,
                  planId: queued.plan.id,
                  index: queued.planIndex,
                  title: queued.plan.title,
                  description: queued.plan.description,
                  prompt: result.prompt,
                  imageUrl: result.url,
                  sourceImageUrl: result.url,
                  model: result.modelId,
                  provider: result.provider,
                  aspectRatio: settings.aspectRatio,
                  imageSize: settings.imageSize,
                  targetLanguage: settings.targetLanguage,
                  requirements,
                  productImages,
                }
              )
            } catch (historyError) {
              console.error("[api/studio-genesis/generate] persist history failed:", historyError)
            }
          } catch (error: any) {
            const message = String(error?.message || "生成失败")
            failStudioGenesisImageJob(queued.imageJobId, message)
            if (/积分不足|仅限会员/.test(message)) {
              haltedByError = message
            }
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()))
    } catch (error) {
      console.error("[api/studio-genesis/generate] background generation failed:", error)
    }
  })

  return NextResponse.json({
    requestId,
    events,
    queued: queuedJobs.length,
  })
}
