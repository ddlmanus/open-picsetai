import { NextRequest, NextResponse } from "next/server"
import { getEffectiveModelConfig, listEnvModelConfigs } from "@/lib/models/fetcher"
import { OpenAICompatibleProvider } from "@/lib/models/openai-compatible"
import { resolveProviderCredentials } from "@/lib/models/provider-credentials"

export const dynamic = "force-dynamic"

type OcrBlock = {
  text: string
  box: number[]
}

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

function parseJsonFromText(text: string) {
  const raw = String(text || "").trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    if (fenced) {
      try {
        return JSON.parse(fenced.trim())
      } catch {
        // fall through
      }
    }
    const firstArray = raw.match(/\[[\s\S]*\]/)?.[0]
    if (firstArray) {
      try {
        return JSON.parse(firstArray)
      } catch {
        // fall through
      }
    }
    return null
  }
}

function normalizeOcrBlocks(input: unknown): OcrBlock[] {
  const source = Array.isArray(input)
    ? input
    : Array.isArray((input as any)?.blocks)
      ? (input as any).blocks
      : Array.isArray((input as any)?.texts)
        ? (input as any).texts
        : []

  return source
    .map((item: any) => {
      const text = String(item?.text || item?.content || "").trim()
      if (!text) return null
      const box = Array.isArray(item?.box)
        ? item.box
        : Array.isArray(item?.bbox)
          ? item.bbox
          : Array.isArray(item?.rect)
            ? item.rect
            : []
      const normalizedBox = box
        .map((value: unknown) => Math.round(Number(value)))
        .filter((value: number) => Number.isFinite(value))
        .slice(0, 4)
      return {
        text,
        box: normalizedBox.length === 4 ? normalizedBox : [0, 0, 1000, 1000],
      }
    })
    .filter(Boolean) as OcrBlock[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const imageUrl = absolutizeUrl(String(body?.imageUrl || ""), request.nextUrl.origin)
    const requestedModelId = String(body?.model || body?.textModelId || "").trim()

    if (!imageUrl) {
      return NextResponse.json({ success: false, error: "缺少图片" }, { status: 400, headers: corsHeaders })
    }

    const fallbackModel = listEnvModelConfigs("CHAT")[0] || null
    const modelConfig = (requestedModelId ? await getEffectiveModelConfig(requestedModelId, "default") : null) || fallbackModel
    const modelId = String(modelConfig?.modelId || requestedModelId || "").trim()
    const credentials = resolveProviderCredentials(modelConfig?.provider || {})

    if (!modelId || !credentials.apiKey) {
      return NextResponse.json({ success: false, error: "未配置可用文字识别模型" }, { status: 400, headers: corsHeaders })
    }

    const client = new OpenAICompatibleProvider({
      baseUrl: credentials.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey: credentials.apiKey,
      modelId,
      providerName: modelConfig?.provider?.name || credentials.providerKey || "OCR",
    })

    const prompt = [
      "识别图片中的所有可编辑文字。",
      "只返回 JSON，不要解释。",
      "格式：{\"blocks\":[{\"text\":\"文字内容\",\"box\":[yMin,xMin,yMax,xMax]}]}。",
      "box 使用 0-1000 的归一化坐标；如果无法准确定位，也必须给出大致区域。",
      "没有文字时返回 {\"blocks\":[]}。",
    ].join("\n")

    const result = await client.chat(
      [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      {
        model: modelId,
        temperature: 0,
        max_tokens: 1200,
        response_format: { type: "json_object" },
      }
    )

    const content = String(result?.choices?.[0]?.message?.content || "")
    const parsed = parseJsonFromText(content)
    return NextResponse.json({ success: true, blocks: normalizeOcrBlocks(parsed) }, { headers: corsHeaders })
  } catch (error: any) {
    console.error("[api/ocr] failed:", error)
    return NextResponse.json({ success: false, error: error?.message || "文字识别失败" }, { status: 500, headers: corsHeaders })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
