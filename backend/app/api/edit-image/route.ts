import { NextRequest, NextResponse } from "next/server"
import { getEffectiveModelConfig, listEnvModelConfigs } from "@/lib/models/fetcher"
import { modelRouter } from "@/lib/models/router"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const imageUrls = Array.isArray(body?.imageUrls)
      ? body.imageUrls.map((item: unknown) => String(item || "").trim()).filter(Boolean)
      : []
    const prompt = String(body?.prompt || "").trim()
    const requestedModelId = String(body?.model || "").trim()

    if (imageUrls.length === 0) {
      return NextResponse.json({ error: "缺少待编辑图片" }, { status: 400 })
    }
    if (!prompt) {
      return NextResponse.json({ error: "请输入编辑要求" }, { status: 400 })
    }

    const fallbackModel = listEnvModelConfigs("IMAGE")[0] || null
    const modelConfig = (requestedModelId ? await getEffectiveModelConfig(requestedModelId, "default") : null) || fallbackModel
    const imageModelId = String(modelConfig?.modelId || requestedModelId || "").trim()
    if (!imageModelId) {
      return NextResponse.json({ error: "未配置可用生图模型" }, { status: 400 })
    }

    const result = await modelRouter.generateWithDbCredentials(prompt, imageModelId, modelConfig?.provider || {}, {
      referenceImages: imageUrls,
      imageSize: body?.imageSize || "1024x1024",
      aspectRatio: body?.aspectRatio || "1:1",
    })

    const url = String(result?.imageUrl || "").trim()
    const imageBase64 = String(result?.imageBase64 || "").trim()
    if (!url && !imageBase64) {
      return NextResponse.json({ error: "编辑模型未返回图片" }, { status: 502 })
    }

    return NextResponse.json({
      url: url || `data:image/png;base64,${imageBase64}`,
    })
  } catch (error: any) {
    console.error("[api/edit-image] failed:", error)
    return NextResponse.json({ error: error?.message || "编辑失败" }, { status: 500 })
  }
}
