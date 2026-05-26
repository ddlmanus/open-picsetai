import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import {
  normalizeClothingStudioBasicSelections,
  normalizeClothingStudioTryOnSelections,
} from "@/lib/clothing-studio"
import { createClothingStudioAnalysisJob } from "@/lib/clothing-studio-jobs"
import { listClothingStudioModels } from "@/lib/clothing-studio-ai"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const scope = await getLocalUserScope()
    const userId = scope.userId

    const body = await request.json().catch(() => ({}))
    const productImages = Array.isArray(body?.productImages)
      ? body.productImages.map((item: unknown) => String(item || "").trim()).filter(Boolean)
      : []
    if (productImages.length === 0) {
      return NextResponse.json({ error: "请先上传至少一张产品图" }, { status: 400 })
    }

    const merchantId = scope.merchantId
    const models = await listClothingStudioModels(merchantId)
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

    const mode = String(body?.mode || "").trim() === "tryon" ? "tryon" : "basic"
    const job = createClothingStudioAnalysisJob({
      userId,
      merchantId,
      requestOrigin: request.nextUrl.origin,
      productImages,
      modelImage: String(body?.modelImage || "").trim(),
      requirements: String(body?.requirements || "").trim(),
      mode,
      targetLanguage: String(body?.targetLanguage || "none").trim() || "none",
      uiLanguage: String(body?.uiLanguage || "zh-CN").trim() || "zh-CN",
      textModelId,
      imageModelId,
      imageSize: String(body?.imageSize || "1K").trim() || "1K",
      speedMode: String(body?.speedMode || "normal").trim() || "normal",
      feAttempt: Number(body?.feAttempt || 1),
      basicSelections: normalizeClothingStudioBasicSelections(body?.basicSelections || {}),
      tryOnSelections: normalizeClothingStudioTryOnSelections(body?.tryOnSelections || {}),
    })

    return NextResponse.json(job)
  } catch (error: any) {
    console.error("[api/clothing-studio/analyze] failed:", error)
    return NextResponse.json({ error: error?.message || "分析失败" }, { status: 500 })
  }
}
