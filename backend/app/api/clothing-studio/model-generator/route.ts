import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { checkAndDeductPoints } from "@/lib/points"
import { getEffectiveModelConfig } from "@/lib/models/fetcher"
import { generateClothingStudioModelCandidates } from "@/lib/clothing-studio-ai"

export const dynamic = "force-dynamic"

function normalizeCount(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.min(4, Math.round(numeric)))
}

export async function POST(request: NextRequest) {
  try {
    const scope = await getLocalUserScope()
    const userId = scope.userId

    const body = await request.json().catch(() => ({}))
    const merchantId = scope.merchantId

    const imageModelId = String(body?.imageModelId || "").trim()
    if (!imageModelId) {
      return NextResponse.json({ error: "当前商户未配置可用生图模型" }, { status: 400 })
    }

    const count = normalizeCount(body?.count)
    const billingConfig = await getEffectiveModelConfig(imageModelId, merchantId)
    try {
      await checkAndDeductPoints(userId, imageModelId, "image", {
        merchantId,
        modelConfig: billingConfig || undefined,
        quantity: count,
        dryRun: true,
      })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || "积分不足或模型受限" }, { status: 403 })
    }

    const result = await generateClothingStudioModelCandidates({
      merchantId,
      imageModelId,
      textModelId: String(body?.textModelId || "").trim(),
      gender: String(body?.gender || "女性").trim() || "女性",
      ageRange: String(body?.ageRange || "26-35岁").trim() || "26-35岁",
      ethnicity: String(body?.ethnicity || "亚洲人").trim() || "亚洲人",
      requirements: String(body?.requirements || "").trim(),
      count,
      turbo: Boolean(body?.turbo),
      aspectRatio: String(body?.aspectRatio || "3:4").trim() || "3:4",
      imageSize: String(body?.imageSize || "2K").trim() || "2K",
    })

    const batchId = randomUUID()
    const createdAt = new Date().toISOString()
    const items = []
    const errors: string[] = []

    for (const item of result.items) {
      try {
        await checkAndDeductPoints(userId, imageModelId, "image", {
          merchantId,
          modelConfig: billingConfig || undefined,
          quantity: 1,
        })
        items.push({
          id: randomUUID(),
          batchId,
          url: item.url,
          prompt: item.prompt,
          summary: item.summary,
          createdAt,
          modelId: item.modelId,
          provider: item.provider,
          analysisModelId: item.analysisModelId,
          analysisProvider: item.analysisProvider,
        })
      } catch (error: any) {
        errors.push(String(error?.message || "积分扣除失败"))
      }
    }

    if (items.length === 0) {
      return NextResponse.json({ error: errors[0] || "模特图生成失败" }, { status: 500 })
    }

    return NextResponse.json({
      batchId,
      items,
      prompt: result.prompt,
      summary: result.summary,
      warning: errors.length > 0 ? `其中 ${errors.length} 张生成失败，请稍后重试。` : "",
    })
  } catch (error: any) {
    console.error("[api/clothing-studio/model-generator] failed:", error)
    return NextResponse.json({ error: error?.message || "模特图生成失败" }, { status: 500 })
  }
}
