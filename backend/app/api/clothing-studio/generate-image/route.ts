import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { getEffectiveModelConfig } from "@/lib/models/fetcher"
import { checkAndDeductPoints } from "@/lib/points"
import { listClothingStudioModels } from "@/lib/clothing-studio-ai"
import { createClothingStudioImageJob } from "@/lib/clothing-studio-jobs"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const scope = await getLocalUserScope()
    const userId = scope.userId

    const body = await request.json().catch(() => ({}))
    const productImage = String(body?.productImage || "").trim()
    const productImages = Array.isArray(body?.productImages)
      ? body.productImages.map((item: unknown) => String(item || "").trim()).filter(Boolean)
      : []
    const prompt = String(body?.prompt || "").trim()
    const workflowMode = body?.workflowMode === "product" ? "product" : "model"
    const batchId = String(body?.batchId || "").trim()
    const planId = String(body?.planId || "").trim()
    const index = Math.max(0, Number(body?.index ?? 0) || 0)
    const title = String(body?.title || "").trim()
    const description = String(body?.description || "").trim()
    const targetLanguage = String(body?.targetLanguage || "none").trim() || "none"
    const requirements = String(body?.requirements || "").trim()

    if (!productImage && productImages.length === 0) {
      return NextResponse.json({ error: "缺少产品图" }, { status: 400 })
    }

    if (!prompt) {
      return NextResponse.json({ error: "缺少生成提示词" }, { status: 400 })
    }

    const merchantId = scope.merchantId
    const modelSettings = await listClothingStudioModels(merchantId)
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
      return NextResponse.json({ error: "当前商户未配置可用生图模型" }, { status: 400 })
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

    const normalizedProductImages = productImages.length > 0 ? productImages : [productImage]
    const job = createClothingStudioImageJob({
      userId,
      merchantId,
      requestOrigin: request.nextUrl.origin,
      productImage: productImage || normalizedProductImages[0] || "",
      productImages: normalizedProductImages,
      prompt,
      batchId,
      planId,
      index,
      title,
      description,
      imageModelRuntimeId: selectedModel.runtimeId,
      requestedModel: requestedModel || selectedModel.modelId || selectedModel.name || selectedModel.runtimeId,
      imageSize: String(body?.imageSize || "2K").trim() || "2K",
      aspectRatio: String(body?.aspectRatio || "3:4").trim() || "3:4",
      targetLanguage,
      requirements,
      workflowMode,
      turboEnabled: Boolean(body?.turboEnabled),
      speedMode: String(body?.speedMode || "normal").trim() || "normal",
      feAttempt: Number(body?.feAttempt || body?.fe_attempt || 1),
      modelImage: workflowMode === "model" ? String(body?.modelImage || "").trim() : "",
      estimatedCost: Math.max(0, Number(billingConfig?.cost || 0)),
    })

    return NextResponse.json(job)
  } catch (error: any) {
    console.error("[api/clothing-studio/generate-image] failed:", error)
    return NextResponse.json({ error: error?.message || "创建图片生成任务失败" }, { status: 500 })
  }
}
