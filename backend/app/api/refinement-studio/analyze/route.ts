import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { getEffectiveModelConfig } from "@/lib/models/fetcher"
import { checkAndDeductPoints } from "@/lib/points"
import { createRefinementStudioAnalysisJob } from "@/lib/refinement-studio-jobs"
import { listRefinementStudioModels } from "@/lib/refinement-studio-ai"
import { normalizeRefinementStudioBackgroundSetting } from "@/lib/refinement-studio"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const scope = await getLocalUserScope()
    const userId = scope.userId

    const body = await request.json().catch(() => ({}))
    const productImage = String(
      body?.productImage ||
      (Array.isArray(body?.productImages) ? body.productImages[0] : "") ||
      ""
    ).trim()

    if (!productImage) {
      return NextResponse.json({ error: "请先上传产品图" }, { status: 400 })
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

    const backgroundSetting = body?.backgroundSetting
      ? normalizeRefinementStudioBackgroundSetting(body.backgroundSetting)
      : body?.whiteBackground === true
        ? "white"
        : "white"

    const job = await createRefinementStudioAnalysisJob({
      userId,
      merchantId,
      requestOrigin: request.nextUrl.origin,
      imageUrl: productImage,
      requirements: String(body?.requirements || "").trim(),
      backgroundSetting,
      uiLanguage: String(body?.uiLanguage || "zh-CN").trim() || "zh-CN",
      imageModelRuntimeId: selectedModel.runtimeId,
      imageSize: String(body?.imageSize || "2K").trim() || "2K",
      speedMode: String(body?.speedMode || "normal").trim() || "normal",
      feAttempt: Number(body?.feAttempt || 1),
    })

    return NextResponse.json(job)
  } catch (error: any) {
    console.error("[api/refinement-studio/analyze] failed:", error)
    return NextResponse.json({ error: error?.message || "产品分析失败" }, { status: 500 })
  }
}
