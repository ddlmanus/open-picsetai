import { NextRequest, NextResponse } from "next/server"
import { checkAndDeductPoints } from "@/lib/points"
import { getEffectiveModelConfig } from "@/lib/models/fetcher"
import { clampStudioGenesisImageCount, type StudioGenesisWorkflowMode } from "@/lib/studio-genesis"
import { listStudioGenesisModels } from "@/lib/studio-genesis-ai"
import { createStudioGenesisAnalysisJob } from "@/lib/studio-genesis-analysis-jobs"
import { getLocalUserScope } from "@/lib/local-user"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const scope = await getLocalUserScope()
    const userId = scope.userId

    const body = await request.json().catch(() => ({}))
    const workflowMode: StudioGenesisWorkflowMode = body?.workflowMode === "knowledge" ? "knowledge" : "product"
    const imageType = body?.imageType === "detail" ? "detail" : "main"
    const portraitImage = workflowMode === "knowledge" ? String(body?.portraitImage || "").trim() : ""
    const referenceImages = workflowMode === "knowledge" && Array.isArray(body?.referenceImages)
      ? body.referenceImages.map((item: unknown) => String(item || "").trim()).filter(Boolean)
      : []
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
    const normalizedProductImages = productImages
      .map((item: unknown) => String(item || "").trim())
      .filter(Boolean)
    if (sourceImages.length === 0) {
      return NextResponse.json({ error: "请先上传至少一张商品图" }, { status: 400 })
    }

    const imageCount = clampStudioGenesisImageCount(body?.imageCount)

    const merchantId = scope.merchantId
    const models = await listStudioGenesisModels(merchantId)
    const requestedTextModelId = String(body?.textModelId || "").trim()
    const textModelId = models.textModels.find((item) => item.runtimeId === requestedTextModelId)?.runtimeId
      || models.textModel?.runtimeId
      || models.textModels[0]?.runtimeId
      || ""
    const requestedImageModelId = String(body?.imageModelId || "").trim()
    const imageModelId = models.imageModels.find((item) => item.runtimeId === requestedImageModelId)?.runtimeId
      || models.imageModel?.runtimeId
      || models.imageModels[0]?.runtimeId
      || ""

    if (!textModelId) {
      return NextResponse.json({ error: "当前商户未配置可用分析模型" }, { status: 400 })
    }

    if (!imageModelId) {
      return NextResponse.json({ error: "当前商户未配置可用生图模型" }, { status: 400 })
    }

    const billingConfig = await getEffectiveModelConfig(imageModelId, merchantId)
    try {
      await checkAndDeductPoints(userId, imageModelId, "image", {
        merchantId,
        modelConfig: billingConfig || undefined,
        quantity: imageCount,
        dryRun: true,
      })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "积分不足或模型受限" }, { status: 403 })
    }

    const job = createStudioGenesisAnalysisJob({
      userId,
      merchantId,
      requestOrigin: request.nextUrl.origin,
      productImages: workflowMode === "knowledge" ? sourceImages : normalizedProductImages,
      requirements: String(body?.requirements || "").trim(),
      imageType,
      targetPlatform: String(body?.targetPlatform || "none").trim() || "none",
      workflowMode,
      portraitImage,
      referenceImages,
      targetLanguage: String(body?.targetLanguage || "none").trim() || "none",
      uiLanguage: String(body?.uiLanguage || body?.targetLanguage || "zh-CN").trim() || "zh-CN",
      projectId: body?.project_id == null ? null : String(body.project_id || "").trim() || null,
      imageCount,
      textModelId,
      imageModelId,
      imageSize: String(body?.imageSize || "2K").trim() || "2K",
      speedMode: String(body?.speedMode || "standard").trim() || "standard",
      feAttempt: Number(body?.feAttempt || 1),
    })

    return NextResponse.json(job)
  } catch (error: any) {
    console.error("[api/studio-genesis/analyze] failed:", error)
    return NextResponse.json({ error: error?.message || "分析失败" }, { status: 500 })
  }
}
