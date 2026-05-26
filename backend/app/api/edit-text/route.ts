import { NextRequest, NextResponse } from "next/server"
import { getEffectiveModelConfig, listEnvModelConfigs } from "@/lib/models/fetcher"
import { modelRouter } from "@/lib/models/router"

export const dynamic = "force-dynamic"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function absolutizeUrl(url: string, origin: string) {
  const value = String(url || "").trim()
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("data:")) return value
  const base = String(origin || "").replace(/\/$/, "")
  return value.startsWith("/") ? `${base}${value}` : `${base}/${value}`
}

function getAspectRatioLabel(width: number, height: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.max(1, a))
  const divisor = gcd(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function buildPrompt(params: {
  changes: Array<{ originalText: string; newText: string }>
  hasMask: boolean
  width?: number
  height?: number
}) {
  const changeText = params.changes
    .map((item) => `将图片中的文字 "${item.originalText}" 替换为 "${item.newText}"`)
    .join("，")
  const sizeText = params.width && params.height
    ? `严格保持原始图片尺寸 ${params.width}x${params.height}，宽高比 ${getAspectRatioLabel(params.width, params.height)}。`
    : "严格保持原始图片尺寸和比例。"

  return [
    changeText,
    params.hasMask ? "参考第二张图作为蒙版，白色区域是需要修改的文字区域。" : "只修改目标文字本身。",
    "其他元素、背景、主体、构图、颜色、光影、材质、边缘、噪点和清晰度必须保持不变。",
    "新文字必须在原文字位置替换，字体、字号、字重、颜色、排版、透视、阴影和背景融合要与原图一致。",
    "不要添加白底块、底纹、标签条、水印、AI 标识或任何额外文字。",
    sizeText,
  ].join("\n")
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const imageUrl = absolutizeUrl(String(body?.imageUrl || ""), request.nextUrl.origin)
    const maskImage = body?.maskImage ? absolutizeUrl(String(body.maskImage), request.nextUrl.origin) : ""
    const requestedModelId = String(body?.model || body?.imageModelId || "").trim()
    const changes = Array.isArray(body?.changes)
      ? body.changes
          .map((item: any) => ({
            originalText: String(item?.originalText || "").trim(),
            newText: String(item?.newText || "").trim(),
          }))
          .filter((item: any) => item.originalText && item.newText && item.originalText !== item.newText)
      : String(body?.originalText || "").trim() && String(body?.newText || "").trim()
        ? [{ originalText: String(body.originalText).trim(), newText: String(body.newText).trim() }]
        : []

    if (!imageUrl) {
      return NextResponse.json({ error: "缺少待编辑图片" }, { status: 400, headers: corsHeaders })
    }
    if (changes.length === 0) {
      return NextResponse.json({ error: "没有需要替换的文字" }, { status: 400, headers: corsHeaders })
    }

    const fallbackModel = listEnvModelConfigs("IMAGE")[0] || null
    const modelConfig = (requestedModelId ? await getEffectiveModelConfig(requestedModelId, "default") : null) || fallbackModel
    const imageModelId = String(modelConfig?.modelId || requestedModelId || "").trim()
    if (!imageModelId) {
      return NextResponse.json({ error: "未配置可用图片编辑模型" }, { status: 400, headers: corsHeaders })
    }

    const prompt = buildPrompt({
      changes,
      hasMask: Boolean(maskImage),
      width: Number(body?.naturalWidth || body?.width || body?.targetWidth || 0) || undefined,
      height: Number(body?.naturalHeight || body?.height || body?.targetHeight || 0) || undefined,
    })

    const referenceImages = maskImage ? [imageUrl, maskImage] : [imageUrl]
    const result = await modelRouter.generateWithDbCredentials(prompt, imageModelId, modelConfig?.provider || {}, {
      referenceImages,
      imageUrls: referenceImages,
      image_urls: referenceImages,
      aspectRatio: body?.aspectRatio || "auto",
      size: body?.size || body?.aspectRatio || "auto",
      imageSize: body?.imageSize || "1K",
      resolution: body?.resolution || "1K",
    })

    const url = String(result?.imageUrl || result?.url || "").trim()
    const imageBase64 = String(result?.imageBase64 || "").trim()
    if (!url && !imageBase64) {
      return NextResponse.json({ error: "文字修改模型未返回图片" }, { status: 502, headers: corsHeaders })
    }

    return NextResponse.json({
      success: true,
      url: url || `data:image/png;base64,${imageBase64}`,
      model: imageModelId,
    }, { headers: corsHeaders })
  } catch (error: any) {
    console.error("[api/edit-text] failed:", error)
    return NextResponse.json({ error: error?.message || "文字修改失败" }, { status: 500, headers: corsHeaders })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
