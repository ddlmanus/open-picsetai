import { NextRequest, NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import {
  resolveClothingStudioPlanCategoryFromPromptType,
  type ClothingStudioAnalysisResult,
  type ClothingStudioPlanCategory,
} from "@/lib/clothing-studio"
import {
  generateClothingStudioProductPrompts,
  generateClothingStudioTryOnPrompts,
} from "@/lib/clothing-studio-ai"

export const dynamic = "force-dynamic"

function inferPlanCategory(
  clothingMode: "prompt_generation" | "model_prompt_generation",
  item: any,
  index: number
): ClothingStudioPlanCategory {
  const explicitCategory = resolveClothingStudioPlanCategoryFromPromptType(
    String(item?.type || item?.category || item?.plan_type || "").trim()
  )
  if (explicitCategory) return explicitCategory

  const title = `${String(item?.title || "")} ${String(item?.description || "")}`.toLowerCase()
  if (clothingMode === "prompt_generation") {
    if (title.includes("3d") || title.includes("幽灵")) return "three-dimensional"
    if (title.includes("人台")) return "mannequin"
    if (title.includes("细节") || title.includes("特写")) return "detail-closeup"
    if (title.includes("卖点")) return "selling-point"
    return index === 0 ? "white-refine" : "detail-closeup"
  }

  if (title.includes("场景")) return "tryon-lifestyle"
  if (title.includes("广告")) return "tryon-campaign"
  if (title.includes("细节")) return "tryon-detail"
  return "tryon-catalog"
}

function buildAnalysisResultFromJson(
  clothingMode: "prompt_generation" | "model_prompt_generation",
  analysisJson: any
): ClothingStudioAnalysisResult {
  const rawImages = Array.isArray(analysisJson?.images) ? analysisJson.images : []
  return {
    summary: String(analysisJson?.design_specs || analysisJson?.designSpecs || analysisJson?.summary || "").trim(),
    images: rawImages.map((item: any, index: number) => ({
      id: String(item?.id || `clothing-plan-${index + 1}`).trim(),
      category: inferPlanCategory(clothingMode, item, index),
      order: typeof item?.order === "number" && Number.isFinite(item.order) ? item.order : index,
      title: String(item?.title || "").trim() || `方案 ${index + 1}`,
      description: String(item?.description || "").trim(),
      designContent: String(item?.design_content || item?.designContent || "").trim(),
      promptHint: String(item?.prompt_hint || item?.promptHint || "").trim(),
    })),
  }
}

export async function POST(request: NextRequest) {
  try {
    const scope = await getLocalUserScope()
    const userId = scope.userId

    const body = await request.json().catch(() => ({}))
    const clothingMode = String(body?.clothingMode || "").trim()
    if (clothingMode !== "prompt_generation" && clothingMode !== "model_prompt_generation") {
      return NextResponse.json({ error: "当前提示词生成模式不受支持" }, { status: 400 })
    }

    const analysisJson = body?.analysisJson || {}
    const rawImages = Array.isArray(analysisJson?.images) ? analysisJson.images : []
    if (rawImages.length === 0) {
      return NextResponse.json({ error: "缺少图片规划数据" }, { status: 400 })
    }

    const targetLanguage = String(body?.targetLanguage || "none").trim() || "none"
    const merchantId = scope.merchantId
    const analysisResult = buildAnalysisResultFromJson(
      clothingMode as "prompt_generation" | "model_prompt_generation",
      analysisJson
    )
    const promptGenerator =
      clothingMode === "prompt_generation"
        ? generateClothingStudioProductPrompts
        : generateClothingStudioTryOnPrompts

    const result = await promptGenerator({
      merchantId,
      textModelId: String(body?.textModelId || "").trim(),
      targetLanguage,
      analysisResult,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error("[api/clothing-studio/generate-prompts-v2] failed:", error)
    return NextResponse.json({ error: error?.message || "生成图片提示词失败" }, { status: 500 })
  }
}
