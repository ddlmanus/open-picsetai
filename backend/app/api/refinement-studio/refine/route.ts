import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { getEffectiveModelConfig } from "@/lib/models/fetcher"
import { checkAndDeductPoints } from "@/lib/points"
import { createRefinementStudioImageJob } from "@/lib/refinement-studio-jobs"
import { listRefinementStudioModels } from "@/lib/refinement-studio-ai"
import { normalizeRefinementStudioBackgroundSetting } from "@/lib/refinement-studio"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const scope = await getLocalUserScope()
    const userId = scope.userId

    const body = await request.json().catch(() => ({}))
    const productImage = String(body?.productImage || "").trim()
    const prompt = String(body?.prompt || "").trim()
    const batchId = String(body?.batchId || "").trim()
    const index = Math.max(0, Number(body?.index ?? 0) || 0)
    const title = String(body?.title || "").trim()
    const description = String(body?.description || "").trim()
    const requirements = String(body?.requirements || "").trim()

    if (!productImage) {
      return NextResponse.json({ error: "缺少产品图" }, { status: 400 })
    }

    if (!prompt) {
      return NextResponse.json({ error: "缺少精修提示词" }, { status: 400 })
    }

    const merchantId = scope.merchantId
    const modelSettings = await listRefinementStudioModels(merchantId)
    const requestedRuntimeId = String(body?.imageModelId || "").trim()
    const requestedModel = String(body?.model || "").trim()
    const selectedModel =
      modelSettings.imageModels.find((item) =>
        item.runtimeId === requestedRuntimeId ||
        item.modelId === requestedModel ||
        item.name === requestedModel
      ) ||
      modelSettings.imageModel ||
      modelSettings.imageModels[0] ||
      null

    if (!selectedModel?.runtimeId) {
      return NextResponse.json({ error: "当前商户未配置可用图片精修模型" }, { status: 400 })
    }

    const billingConfig = await getEffectiveModelConfig(selectedModel.runtimeId, merchantId)
    try {
      await checkAndDeductPoints(userId, selectedModel.runtimeId, "image", {
        merchantId,
        modelConfig: billingConfig || undefined,
        quantity: 1,
        dryRun: true,
      })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "积分不足或模型受限" }, { status: 403 })
    }

    const job = await createRefinementStudioImageJob({
      userId,
      merchantId,
      requestOrigin: request.nextUrl.origin,
      imageUrl: productImage,
      prompt,
      batchId,
      index,
      title,
      description,
      requirements,
      imageModelRuntimeId: selectedModel.runtimeId,
      requestedModel: requestedModel || selectedModel.modelId || selectedModel.name || selectedModel.runtimeId,
      backgroundSetting: normalizeRefinementStudioBackgroundSetting(body?.backgroundSetting),
      aspectRatio: String(body?.aspectRatio || "1:1").trim() || "1:1",
      imageSize: String(body?.imageSize || "2K").trim() || "2K",
      speedMode: String(body?.speedMode || "normal").trim() || "normal",
      feAttempt: Number(body?.feAttempt || body?.fe_attempt || 1),
      estimatedCost: Math.max(0, Number(billingConfig?.cost || 0)),
    })

    return NextResponse.json(job)
  } catch (error: any) {
    console.error("[api/refinement-studio/refine] failed:", error)
    return NextResponse.json({ error: error?.message || "创建精修任务失败" }, { status: 500 })
  }
}
