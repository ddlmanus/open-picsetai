import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveSessionMerchantId } from "@/lib/admin-scope"
import { listStudioGenesisModels } from "@/lib/studio-genesis-ai"
import { createStudioGenesisAiWriteJob } from "@/lib/studio-genesis-analysis-jobs"
import { getLocalUserScope } from "@/lib/local-user"

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
      return NextResponse.json({ error: "请先上传至少一张商品图" }, { status: 400 })
    }

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

    const job = createStudioGenesisAiWriteJob({
      userId,
      merchantId,
      requestOrigin: request.nextUrl.origin,
      productImages,
      requirements: String(body?.requirements || "").trim(),
      targetPlatform: String(body?.targetPlatform || "none").trim() || "none",
      imageType: body?.imageType === "detail" ? "detail" : "main",
      uiLanguage: String(body?.uiLanguage || "zh").trim() || "zh",
      projectId: body?.project_id == null ? null : String(body.project_id || "").trim() || null,
      textModelId,
      imageModelId,
      imageSize: String(body?.imageSize || "1K").trim() || "1K",
      speedMode: String(body?.speedMode || "standard").trim() || "standard",
      feAttempt: Number(body?.feAttempt || 1),
    })

    return NextResponse.json(job)
  } catch (error: any) {
    console.error("[api/studio-genesis/ai-write] failed:", error)
    return NextResponse.json({ error: error?.message || "AI帮写失败" }, { status: 500 })
  }
}
