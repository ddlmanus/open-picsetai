import { getEffectiveModelConfig, resolveMerchantSceneRuntimeModel } from "@/lib/models/fetcher"
import { buildModelRuntimeId, parseModelRuntimeId } from "@/lib/models/runtime-id"
import { modelRouter } from "@/lib/models/router"
import { OpenAICompatibleProvider } from "@/lib/models/openai-compatible"
import { getAgentAnalysisChatOptions } from "@/lib/models/agent-analysis-provider"
import { resolveProviderCredentials } from "@/lib/models/provider-credentials"
import { createZenmuxChatProvider, isZenmuxProvider } from "@/lib/models/zenmux"
import { persistImageDataUrlToLocalUploads } from "@/lib/server/local-uploads"
import { normalizeModelImageInputUrl, normalizeModelImageInputUrls } from "@/lib/server/model-image-input"
import { absolutizeWithPreferredOrigin } from "@/lib/server/public-url"
import { ensurePublicImageUrl, ensurePublicImageUrls } from "@/lib/server/public-media"
import { normalizeGenerationReferenceImages } from "@/lib/xiaohongshu-ai"
import { parseDataUri } from "@/lib/utils"
import { listStudioGenesisModels, resolveBatchConcurrencyFromSpeedMode } from "@/lib/studio-genesis-ai"
import {
  CLOTHING_STUDIO_MAX_PRODUCT_IMAGES,
  DEFAULT_CLOTHING_STUDIO_SETTINGS,
  buildClothingStudioPlanBlueprint,
  normalizeClothingStudioAnalysisResult,
  resolveClothingStudioLanguageLabel,
  type ClothingStudioAnalysisResult,
  type ClothingStudioBasicSelections,
  type ClothingStudioGeneratedPrompt,
  type ClothingStudioMode,
  type ClothingStudioModelSettingsPayload,
  type ClothingStudioPlan,
  type ClothingStudioPromptGenerationResponse,
  type ClothingStudioSettings,
  type ClothingStudioTryOnSelections,
} from "@/lib/clothing-studio"

const CLOTHING_STUDIO_TEXT_SCENES = ["STUDIO_GENESIS_TEXT", "XIAOHONGSHU_TEXT", "GENERAL"] as const

type ClothingStudioChatModelCandidate = {
  runtimeId: string
  modelId: string
  provider: any
}

type ClothingStudioChatCompletionResult = {
  content: string
  modelId: string
  provider: string
  usage?: {
    total_tokens?: number
    prompt_tokens?: number
    completion_tokens?: number
  }
}

function stripCodeFences(input: string) {
  return String(input || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim()
}

function extractJsonObject(input: string) {
  const cleaned = stripCodeFences(input)
  const first = cleaned.indexOf("{")
  const last = cleaned.lastIndexOf("}")
  if (first !== -1 && last !== -1 && last > first) {
    return cleaned.slice(first, last + 1)
  }
  return cleaned
}

function normalizeImageResultUrl(result: any) {
  const directUrl = String(result?.imageUrl || "").trim()
  if (directUrl) return directUrl

  const firstListUrl = Array.isArray(result?.images) ? String(result.images[0] || "").trim() : ""
  if (firstListUrl) return firstListUrl

  const base64 = String(result?.imageBase64 || "").trim()
  if (!base64) return ""
  return base64.startsWith("data:image/") ? base64 : `data:image/png;base64,${base64}`
}

async function persistGeneratedImageIfNeeded(rawUrl: string) {
  const normalized = String(rawUrl || "").trim()
  if (!normalized.startsWith("data:image/")) return normalized

  const stored = await persistImageDataUrlToLocalUploads({
    dataUrl: normalized,
    preferredDir: "clothing-studio",
    filenameHint: "clothing-studio-generated",
    maxBytes: 60 * 1024 * 1024,
  })
  return stored?.url || normalized
}

function resolveQualityFromSpeedMode(speedMode: ClothingStudioSettings["speedMode"]) {
  if (speedMode === "turbo") return "standard"
  if (speedMode === "fast") return "hd"
  return "ultra"
}

function normalizeClothingStudioChatModelCandidate(model: any): ClothingStudioChatModelCandidate | null {
  const modelType = String(model?.type || "").trim().toUpperCase()
  if (modelType !== "CHAT") return null

  const provider = model?.provider
  const providerKey = String(provider?.key || "").trim().toLowerCase()
  const supportOpenAI = Boolean(provider?.supportOpenAI)
  const isThirdPartyOpenAICompatible = Boolean(provider?.isThirdParty && supportOpenAI)
  const isSupportedOfficialProvider =
    providerKey === "vectorengine" ||
    providerKey.includes("zenmux") ||
    providerKey === "openai" ||
    providerKey === "local" ||
    providerKey.includes("google") ||
    providerKey.includes("gemini")

  if (!isThirdPartyOpenAICompatible && !isSupportedOfficialProvider && !supportOpenAI) {
    return null
  }

  const modelId = String(model?.modelId || "").trim()
  if (!modelId || !provider) return null

  return {
    runtimeId: buildModelRuntimeId(modelId, provider?.key || model?.providerId || model?.id),
    modelId,
    provider,
  }
}

async function resolveClothingStudioTextModelCandidate(
  merchantId: string | null,
  requestedRuntimeId?: string
): Promise<ClothingStudioChatModelCandidate | null> {
  const requested = String(requestedRuntimeId || "").trim()
  if (requested) {
    const config = await getEffectiveModelConfig(requested, merchantId)
    const modelId = String(config?.modelId || parseModelRuntimeId(requested).modelId || "").trim()
    const provider = config?.provider
    if (config && provider && modelId && String(config.type || "").trim().toUpperCase() === "CHAT") {
      return {
        runtimeId: buildModelRuntimeId(modelId, provider.key || config.providerId || config.id),
        modelId,
        provider,
      }
    }
  }

  for (const usageScene of CLOTHING_STUDIO_TEXT_SCENES) {
    const resolved = await resolveMerchantSceneRuntimeModel({
      merchantId,
      usageScene,
      type: "CHAT",
    })
    const candidate = normalizeClothingStudioChatModelCandidate(resolved?.modelConfig)
    if (candidate) return candidate
  }

  return null
}

function isGeminiModelId(modelId: string) {
  return String(modelId || "").trim().toLowerCase().startsWith("gemini-")
}

function isOfficialGoogleGeminiProvider(candidate: ClothingStudioChatModelCandidate, baseUrl: string) {
  const providerKey = String(candidate.provider?.key || "").trim().toLowerCase()
  const normalizedBaseUrl = String(baseUrl || "").trim().toLowerCase()
  const isThirdParty = Boolean(candidate.provider?.isThirdParty)
  if (isThirdParty) return false
  if (providerKey.includes("google") || providerKey.includes("gemini")) return true
  return normalizedBaseUrl.includes("generativelanguage.googleapis.com") || normalizedBaseUrl.includes(".googleapis.com")
}

async function resolveGeminiInlineImagePart(rawUrl: string, requestOrigin?: string) {
  const normalized = String(rawUrl || "").trim()
  if (!normalized) return null

  if (normalized.startsWith("data:")) {
    const parsed = parseDataUri(normalized)
    if (!parsed?.base64Data) return null
    return {
      mimeType: parsed.mime || "image/png",
      data: parsed.base64Data,
    }
  }

  const modelInput = await normalizeModelImageInputUrl(absolutizeWithPreferredOrigin(normalized, requestOrigin), requestOrigin)
  if (modelInput.startsWith("data:")) {
    const parsed = parseDataUri(modelInput)
    if (parsed?.base64Data) {
      return {
        mimeType: parsed.mime || "image/png",
        data: parsed.base64Data,
      }
    }
  }

  const publicUrl = await ensurePublicImageUrl(absolutizeWithPreferredOrigin(normalized, requestOrigin), {
    preferredDir: "clothing-studio",
    filenameHint: "analysis-ref",
    mirrorRemote: true,
    fetchTimeoutMs: 25_000,
  })
  const resolved = publicUrl || absolutizeWithPreferredOrigin(normalized, requestOrigin)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 25_000)

  try {
    const response = await fetch(resolved, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`获取 Gemini 分析参考图失败: ${response.status}`)
    }
    const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0].trim()
    if (!mimeType.startsWith("image/")) {
      throw new Error(`Gemini 分析参考资源不是图片: ${mimeType}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return {
      mimeType,
      data: Buffer.from(arrayBuffer).toString("base64"),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function extractGeminiResponseText(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim()
}

function extractGeminiUsage(payload: any) {
  const usage = payload?.usageMetadata
  if (!usage || typeof usage !== "object") return undefined

  const totalTokens = Number(usage.totalTokenCount || 0)
  const promptTokens = Number(usage.promptTokenCount || 0)
  const completionTokens = Number(usage.candidatesTokenCount || 0)

  if (!Number.isFinite(totalTokens) && !Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) {
    return undefined
  }

  return {
    total_tokens: Number.isFinite(totalTokens) ? totalTokens : undefined,
    prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : undefined,
    completion_tokens: Number.isFinite(completionTokens) ? completionTokens : undefined,
  }
}

async function nativeGeminiTextCompletion(params: {
  modelId: string
  apiKey: string
  baseUrl: string
  userPrompt: string
  userContent?: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>
  requestOrigin?: string
  temperature: number
  maxTokens: number
  responseMimeType?: string
}) {
  const normalizedBaseUrl = String(params.baseUrl || "").trim().replace(/\/+$/, "")
  const versionedBaseUrl = /\/v\d+(?:beta)?$/i.test(normalizedBaseUrl)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl || "https://generativelanguage.googleapis.com"}/v1beta`
  const endpointUrl = new URL(`${versionedBaseUrl}/models/${encodeURIComponent(params.modelId)}:generateContent`)
  const isOfficialGoogleEndpoint =
    endpointUrl.hostname.toLowerCase() === "generativelanguage.googleapis.com" ||
    endpointUrl.hostname.toLowerCase().endsWith(".googleapis.com")

  if (isOfficialGoogleEndpoint) {
    endpointUrl.searchParams.set("key", params.apiKey)
  }

  const parts: Array<Record<string, unknown>> = []
  const sourceContent = Array.isArray(params.userContent) && params.userContent.length > 0
    ? params.userContent
    : [{ type: "text" as const, text: params.userPrompt }]

  for (const item of sourceContent) {
    if (item.type === "text") {
      const text = String(item.text || "").trim()
      if (text) parts.push({ text })
      continue
    }

    const imageUrl = String(item.image_url?.url || "").trim()
    if (!imageUrl) continue
    const inlineImage = await resolveGeminiInlineImagePart(imageUrl, params.requestOrigin)
    if (!inlineImage?.data) continue
    parts.push({
      inline_data: {
        mime_type: inlineImage.mimeType,
        data: inlineImage.data,
      },
    })
  }

  if (parts.length === 0) {
    throw new Error("Gemini 分析请求缺少有效内容")
  }

  const payload: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
      ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
    },
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120_000)

  try {
    const response = await fetch(endpointUrl.toString(), {
      method: "POST",
      headers: {
        ...(isOfficialGoogleEndpoint ? {} : { Authorization: `Bearer ${params.apiKey}` }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      throw new Error(`Gemini 分析失败: ${response.status} ${errorText.slice(0, 500)}`)
    }

    const data = await response.json().catch(() => ({}))
    const content = extractGeminiResponseText(data)
    if (!content) {
      throw new Error("Gemini 文本分析返回了空结果")
    }

    return {
      content,
      modelId: params.modelId,
      provider: "google_direct",
      usage: extractGeminiUsage(data),
    } satisfies ClothingStudioChatCompletionResult
  } finally {
    clearTimeout(timeoutId)
  }
}

async function chatTextCompletion(params: {
  merchantId: string | null
  requestedRuntimeId?: string
  systemPrompt?: string
  userPrompt: string
  userContent?: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>
  requestOrigin?: string
  temperature?: number
  maxTokens?: number
  responseMimeType?: string
  omitSystemPrompt?: boolean
  preferNativeGemini?: boolean
}) {
  const candidate = await resolveClothingStudioTextModelCandidate(params.merchantId, params.requestedRuntimeId)
  if (!candidate?.provider || !candidate.modelId) {
    throw new Error("未配置【产品分析模型】，请先在后台配置“产品分析模型”聊天模型")
  }

  const credentials = resolveProviderCredentials(candidate.provider)
  const apiKey = String(credentials.apiKey || "").trim()
  const baseUrl = String(credentials.baseUrl || candidate.provider?.baseUrl || "").trim()
  if (!apiKey) {
    throw new Error(`产品分析模型服务商(${candidate.provider?.name || candidate.provider?.key || "未命名服务商"})未配置可用凭证`)
  }

  const temperature = typeof params.temperature === "number" ? params.temperature : 0.45
  const maxTokens = typeof params.maxTokens === "number" ? params.maxTokens : 2800
  const responseMimeType = String(params.responseMimeType || "").trim()

  if (
    params.preferNativeGemini !== false &&
    isGeminiModelId(candidate.modelId) &&
    isOfficialGoogleGeminiProvider(candidate, baseUrl)
  ) {
    const combinedPrompt =
      params.omitSystemPrompt || !String(params.systemPrompt || "").trim()
        ? params.userPrompt
        : `${String(params.systemPrompt || "").trim()}\n\n${params.userPrompt}`

    const nativeContent = Array.isArray(params.userContent) && params.userContent.length > 0
      ? params.userContent.map((item) =>
          item.type === "text"
            ? { ...item, text: String(item.text || "").trim() || combinedPrompt }
            : item
        )
      : [{ type: "text" as const, text: combinedPrompt }]

    return nativeGeminiTextCompletion({
      modelId: candidate.modelId,
      apiKey,
      baseUrl: baseUrl || "https://generativelanguage.googleapis.com",
      userPrompt: combinedPrompt,
      userContent: nativeContent,
      requestOrigin: params.requestOrigin,
      temperature,
      maxTokens,
      responseMimeType,
    })
  }

  const providerConfig = {
    key: String(candidate.provider?.key || "").trim().toLowerCase(),
    isThirdParty: Boolean(candidate.provider?.isThirdParty),
    baseUrl: baseUrl || null,
    supportOpenAI: Boolean(candidate.provider?.supportOpenAI),
  }

  const provider = isZenmuxProvider(candidate.provider)
    ? createZenmuxChatProvider({
        baseUrl,
        apiKey,
        modelId: candidate.modelId,
        providerName: candidate.provider?.name || candidate.provider?.key || "ZenMux",
        providerConfig,
      })
    : new OpenAICompatibleProvider({
        baseUrl,
        apiKey,
        modelId: candidate.modelId,
        providerName: candidate.provider?.name || candidate.provider?.key || "OpenAI Compatible",
        providerConfig,
      })

  const response = await provider.chat(
    [
      ...(
        params.omitSystemPrompt || !String(params.systemPrompt || "").trim()
          ? []
          : [{ role: "system" as const, content: String(params.systemPrompt || "").trim() }]
      ),
      { role: "user", content: params.userContent || params.userPrompt },
    ],
    {
      ...getAgentAnalysisChatOptions({
        modelId: candidate.modelId,
        temperature,
        maxTokens,
      }),
      ...(responseMimeType === "application/json" ? { response_format: { type: "json_object" as const } } : {}),
    }
  )

  const content = String(response?.choices?.[0]?.message?.content || "").trim()
  if (!content) {
    throw new Error("文本模型返回了空结果")
  }

  return {
    content,
    modelId: candidate.modelId,
    provider: String(candidate.provider?.key || "openai-compatible").trim(),
    usage: response?.usage
      ? {
          total_tokens: Number(response.usage.total_tokens || 0) || undefined,
          prompt_tokens: Number(response.usage.prompt_tokens || 0) || undefined,
          completion_tokens: Number(response.usage.completion_tokens || 0) || undefined,
        }
      : undefined,
  } satisfies ClothingStudioChatCompletionResult
}

function buildTryOnLegacyAnalysisPrompt(params: {
  requirements: string
  targetLanguage: string
  imageCount: number
}) {
  const targetLanguageLabel = resolveClothingStudioLanguageLabel(params.targetLanguage)
  const imageCount = Math.max(1, params.imageCount)
  const userRequirements = String(params.requirements || "").trim() || "无"

  return [
    "你是一位顶级电商视觉导演。你的任务是分析上传的服装图片和模特参考图，并根据用户的设计需求，为一次模特拍摄活动制定一套**完整的视觉指南**。你需要先定义全局的视觉调性，然后针对每一张照片（镜头）制定极具营销感的构图、卖点展示及多语言文字方案，从核心全身视角→局部展示视角→氛围特写视角3个类型进行开张具体镜头的设计。",
    "",
    "### 输入数据",
    "1. **参考图片**：[请深度识别图中服装的面料感、工艺细节、剪裁版型及所属风格]",
    `2. **计划张数**：${imageCount}`,
    `3. **目标语言**：${targetLanguageLabel} [如果为“无文字”，则文字内容输出 None]`,
    "",
    "### 第一部分：整体设计规范",
    "你需要基于服装调性和模特特质，制定以下三个维度的策略：",
    "",
    "#### 1. 核心视觉基调 (Overall Visual Theme)",
    "- [基于图片特征定义整组照片的视觉灵魂、背景环境设定、全局色彩调性等]",
    "",
    "#### 2. 全局摄影参数建议 (Global Photography Specs)",
    "- [镜头焦段建议、全局布光原则、画质与技术参数标准]",
    "",
    "#### 3. 模特基础画像 (Minimal Model Profile)",
    "- [基于模特参考图，识别并提取 4 个核心特征：性别、肤色/人种、发色、发型。要求表述极其精炼（如：亚裔女性，肤色白皙，棕黑色直短发），仅作为身份锁定的锚点，严禁过度描述。]",
    "",
    "#### 4. 服装基础特征 (Garment Core Features)",
    "[服装核心特征：色彩+材质+版型的(服装名称)，仅作为服装锁定的锚点，严禁过度描述。]",
    "",
    "#### 5. 文字系统规范 (Typography System)",
    "- **标题字体**：[字体类型（如：无衬线粗体）、颜色（如：#FFFFFF 白色）]",
    "- **正文字体**：[字体类型、颜色]",
    "- **字号层级**：大标题:副标题:正文 = 3:1.8:1",
    "- **字体风格**：[如：现代简约、复古优雅、活力动感]",
    "",
    "### 第二部分：分镜头执行方案",
    `请根据计划张数 ${imageCount}，输出对应数量的分镜头方案，必须根据服装的不同视觉卖点进行差异化设计：`,
    "",
    "##### 方案 1：[镜头名称]",
    "**设计目标**：[强化卖点传达，增强购买欲]",
    "**模特要求**：[具体的动作、眼神、神态、肢体语言设定]",
    "**服饰工艺焦点**：[重点展示的服装细节或质感，需结合图片特征]",
    "**图中图元素**：[如有，详细说明每个图中图的类型、形状、位置、尺寸、内容]",
    "**构图方案**：",
    "- 人物占比：[建议占比，如 60-70%]",
    "- 布局方式：[场景化布局及黄金分割建议]",
    "- 文字区域：[明确文案预留位置]",
    "**内容要素**：",
    "- 展示重点：[结合场景突出服装核心卖点]",
    "- 突出卖点：[卖点在画面中的具体视觉表现]",
    "- 背景元素：[详细描述关联场景、道具与环境点缀物]",
    "- 装饰元素：[详细描述]",
    `**文字内容**（使用 ${targetLanguageLabel}）：`,
    "- 主标题：[有力文案] / [无文案或设置为无文字填 None]",
    "- 副标题：[细化说明] / [无文案或设置为无文字填 None]",
    "- 说明文字：[详情描述] / [无文案或设置为无文字填 None]",
    "**视觉氛围**：",
    "- 情绪关键词：[3-5个调性词]",
    "- 光影效果：[详细描述环境光效、色温与光影调性]",
    "",
    "### 输出格式要求",
    "必须且仅输出一个合法的 JSON 对象，不要包含 Markdown 代码块标签或说明文字。",
    "格式如下：",
    "{",
    '  "design_specs": "这里放入【第一部分：整体设计规范】生成的完整 Markdown 内容（包含核心视觉基调、全局摄影参数、模特基础画像）。",',
    '  "images": [',
    "    {",
    '      "title": "镜头名称",',
    '      "description": "镜头作用摘要",',
    '      "design_content": "这里放入该镜头的【第二部分：分镜头执行方案】中对应的全部详细 Markdown 内容（必须包含设计目标、模特要求、服饰工艺焦点、构图、内容要素、文字内容、视觉氛围等全部细节）。"',
    "    },",
    `    ... (分镜数量必须严格等于 ${imageCount})`,
    "  ]",
    "}",
    "",
    "## 重要提示",
    "1. **指令完整性**：必须输出完整的全局策略和每一个镜头的详细细节方案，严禁简化描述。",
    "2. **语言严格控制**：",
    "   - **【中文】**：分析及所有设计字段描述**必须严格使用中文**。",
    `   - **【目标语言】**：仅“文字内容”（主标题、副标题、说明文字）字段**必须**使用指定的目标语言（${targetLanguageLabel}）。`,
    `3. **参数化**：分镜数量必须严格等于 ${imageCount}。\``,
    "4. **用户需求**：用户提供的特殊需求或者对服装的细节强调，必须带到对应图片设计的方案中。",
    "",
    `用户特殊需求：${userRequirements}`,
  ].join("\n")
}

function buildBasicLegacyAnalysisPrompt(params: {
  requirements: string
  targetLanguage: string
  basicSelections: ClothingStudioBasicSelections
}) {
  const targetLanguageLabel = resolveClothingStudioLanguageLabel(params.targetLanguage)
  const requirementsText = String(params.requirements || "").trim() || "无"
  const whiteRefineViewLabel = params.basicSelections.whiteRefineView === "back" ? "背面" : "正面"
  const selectedTasks = [
    ...(params.basicSelections.whiteRefineEnabled ? [`- 白底精修图 (${whiteRefineViewLabel})`] : []),
    ...(params.basicSelections.threeDimensionalEnabled
      ? [`- 3D立体效果图（幽灵模特效果）${params.basicSelections.threeDimensionalWithWhiteBase ? "- 白底" : ""}`]
      : []),
    ...(params.basicSelections.mannequinEnabled ? ["- 人台图"] : []),
    ...(params.basicSelections.detailCloseupCount > 0 ? [`- 细节特写图 x ${params.basicSelections.detailCloseupCount}张`] : []),
    ...(params.basicSelections.sellingPointCount > 0 ? [`- 卖点图 x ${params.basicSelections.sellingPointCount}张`] : []),
  ]
  const selectedTaskBlock = selectedTasks.join("\n")

  const sections = [
    "你是一位专业的电商服装设计总监，精通摄影与AI图像生成。请分析服装图片并为选定类型制定详细设计规范。",
    "",
    "---",
    "",
    "## 任务说明",
    "用户需要生成以下类型的电商图片：",
    selectedTaskBlock,
    "",
    "---",
    "",
    "## 输入信息",
    "**服装图片**：[用户上传]",
    `**用户上传与需求**：\n${requirementsText}`,
    `**目标语言**：${targetLanguageLabel}`,
    "",
    "---",
    "",
    "## 分析步骤",
    "",
    "### 第一部分：服装深度分析",
    "请详细观察图片并提供以下分析：",
    "",
    "#### 1. 服装属性识别",
    "- **服装类型**：具体分类（如女士针丝衫等）",
    "- **材质特征**：推测纹理、光泽、厚度及材质",
    "- **颜色**：主辅色及色调",
    "- **图案/印花**：详细描述相关设计",
    "- **关键设计元素**：领袖版型及装饰细节",
    "",
    "#### 2. 关键细节识别",
    `根据\n${selectedTaskBlock}\n细节特写图片数量要求按照重要程度生成对应数量的不同部位的展示点：`,
    "1. **[部位名称]**：展示重点及方式",
    "2. ...",
    "展示材质时说明如何利用光影体现纹理质感。",
    "",
    "- **整体调性**：3-5个视觉关键词（如高级、简约）",
    "",
    "#### 3. 字体系统规范",
    "**标题字体**：[字体类型]",
    "**正文字体**：[字体类型]",
    "**字号层级**：大标题:副标题:正文 = 3:1.8:1",
    "",
    "---",
    "",
    "### 第二部分：各图片类型设计方案",
    "请为用户选择的每种图片类型提供详细指导。",
    "",
    "---",
  ]

  if (params.basicSelections.whiteRefineEnabled) {
    sections.push(
      "",
      "#### 【白底精修图】（如用户选择）",
      "**设计目标**：[展示轮廓款式，符合电商主图标准]",
      "**主体占比**：[建议 70-80%]",
      "**画面布局方式**：[居中构图，垂直放置，留出边距]",
      "**文字内容**（默认无文字）：",
      `**拍摄角度**：[展示角度默认${whiteRefineViewLabel}面对镜头，用户有特殊需求跟随用户需求]`,
      "**光线要求**：[均匀柔光，保留材质感]",
      "**重点展示**：[版型、颜色准确度、核心设计元素]",
      "**注意事项**：[纯白底 #FFFFFF，无阴影倒影]",
      "",
      "---"
    )
  }

  if (params.basicSelections.threeDimensionalEnabled) {
    sections.push(
      "",
      "#### 【3D立体效果图（幽灵模特）】（如用户选择）",
      "**设计目标**：[展示立体形态、垂坠感与剪裁]",
      `**背景设置**：[${params.basicSelections.threeDimensionalWithWhiteBase ? "纯白底 #FFFFFF" : "纯白底 #FFFFFF或具体场景，根据输入要求决定"}]`,
      "**主体占比**：[建议 75-85%]",
      "**画面布局方式**：[居中构图，自然展开]",
      `**文字内容**（使用 ${targetLanguageLabel}）：`,
      "- 主标题：[有力文案] / [无文案填None]",
      "- 副标题：[细化说明] / [无文案填None]",
      "- 说明文字：[参数或详情描述] / [无文案填None]",
      "**服装姿态**：[展示角度默认正面面对镜头，用户有特殊需求跟随用户需求]",
      "**立体感表现**：[光影强调肩、胸、腰部结构]",
      "**材质表现**：[体现真实质感]",
      "**注意事项**：原封不动的输出：[服饰提取转化为3D形态，幽灵效果自然，增强空间感与廓形，去除所有皱褶，匹配适配3D载体（幽灵模特/鞋模等），移除衣架/原人台痕迹，表面光洁]",
      "",
      "---"
    )
  }

  if (params.basicSelections.mannequinEnabled) {
    sections.push(
      "",
      "#### 【人台图】（如用户选择）",
      "**设计目标**：[展示人台上身效果与版型]",
      `**背景设置**：[${params.basicSelections.mannequinWithWhiteBase ? "纯白底 #FFFFFF" : "纯白底 #FFFFFF或具体场景，根据输入要求决定"}]`,
      "**主体占比**：[建议 70-80%]",
      "**画面布局方式**：[居中或黄金分割布局]",
      `**文字内容**（使用 ${targetLanguageLabel}）：`,
      "- 主标题：[有力文案] / [无文案填None]",
      "- 副标题：[细化说明] / [无文案填None]",
      "- 说明文字：[参数或详情描述] / [无文案填None]",
      "**拍摄角度**：[展示角度默认正面面对镜头，用户有特殊需求跟随用户需求]",
      "**背景建议**：[详细描述色彩与纹理]",
      "**重点展示**：[廓形、腰线、细节设计]",
      "**光线布置**：[主辅光平衡，突出立体感]",
      "**注意事项**：[匹配品类适配的极简哑光浅色展示载体；上衣、裤子类用半身人台，仅全身服饰使用全身人台]必须清晰的根据服饰类型输出使用什么类型的人台。",
      "",
      "---"
    )
  }

  if (params.basicSelections.detailCloseupCount > 0) {
    sections.push(
      "",
      "#### 【细节特写图】",
      "请严格根据用户要求数量生成方案。",
      "##### 细节图1：[部位名称]",
      "**设计目标**：[展示关键设计或精细工艺]",
      "**主体占比**：[建议 80-90%]",
      "**画面布局方式**：[特写构图，占比突出]",
      `**文字内容**（使用 ${targetLanguageLabel}）：`,
      "- 主标题：[有力文案] / [无文案填None]",
      "- 副标题：[细化说明] / [无文案填None]",
      "- 说明文字：[参数或详情描述] / [无文案填None]",
      "**拍摄部位**：[具体展示部位]",
      "**拍摄距离**：[微距/近景/中景]",
      "**拍摄角度**：[正面平视或俯仰角度建议]",
      "**光线布置**：[特写补光，强化质感与细节]",
      "**材质表现**：[利用光效体现纹理，如丝滑光泽]",
      "**注意事项**：[焦点精准，细节清晰可见]",
      "",
      "---"
    )
  }

  if (params.basicSelections.sellingPointCount > 0) {
    sections.push(
      "",
      "#### 【卖点图】",
      "请严格根据用户要求数量生成方案。",
      "##### 图1：卖点图 - [卖点名称]",
      "**设计目标**：[强化卖点传达，增强购买欲]",
      "**产品出现**：是",
      "**图中图元素**：[如有，详细说明每个图中图的类型、形状、位置、尺寸、内容]",
      "**构图方案**：",
      "- 产品占比：[建议 40-50%]",
      "- 布局方式：[场景化布局，黄金分割建议]",
      "- 文字区域：[明确主副标题及说明预留位置]",
      "**色彩系统规范**：",
      "- **色彩倾向**：主色调与辅助色选择建议",
      "- **色彩情绪**：传达的品牌调性或场景氛围",
      "- **搭配建议**：产品与背景/环境的色彩协调方案。注意：所有卖点图的色彩系统需保持高度的一致性方案。",
      "**内容要素**：",
      "- 展示重点：[结合场景突出核心卖点]",
      "- 突出卖点：[卖点在画面中的视觉体现]",
      "- 背景元素：[详细描述关联场景与道具]",
      "- 装饰元素：[增强代入感的氛围点缀物]",
      `**文字内容**（使用 ${targetLanguageLabel}）：`,
      "- 主标题：[有力文案] / [无文案填None]",
      "- 副标题：[细化说明] / [无文案填None]",
      "- 说明文字：[参数或详情描述] / [无文案填None]",
      "**氛围营造**：",
      "- 情绪关键词：[3-5个调性词]",
      "- 光影效果：[详细描述环境光效氛围]",
      "",
      "---"
    )
  }

  sections.push(
    "",
    "## 输出格式要求",
    "必须且仅输出一个合法的 JSON 对象，不包含任何 Markdown 代码块标签（如 ```json ）或额外解释文字。",
    "  格式如下：",
    "{",
    '  "design_specs": "这里是第一部分【服装深度分析】生成的完整 Markdown 内容，包含 1.服装属性识别、2.核心卖点、3.关键细节、4.整体视觉风格、5.字体系统规范等。",',
    '    "images": [',
    "      {",
    '        "title": "白底精修图",',
    '        "description": "镜头作用的一句话摘要，展现产品真实调性",',
    '        "design_content": "这里是该图片的详细设计规范 Markdown 内容（包含设计目标、占比、构图、光线、重点展示等）"',
    "      },",
    "      ... (根据用户选择的类型和数量输出数组项，确保数量完全一致)",
    "    ]",
    "}",
    "",
    "---",
    "",
    "## 重要提示",
    "1. ** 具体性 **：描述具体、专业、可执行。",
    `2. ** 语言 **：除卖点图的“文字内容”字段必须使用 ${targetLanguageLabel} 外，其余所有分析、指导及方案描述必须使用 ** 中文 **。`,
    "3. ** 一致性 **：视觉风格（包括色彩系统配置）需在不同图片方案间保持高度统一，符合品牌整体调性。",
    "4. ** 数量一致性 **：方案数量必须严格等于“任务说明”中指定的数量（如：细节图 x 3，则必须输出3个方案）。",
    "5. ** 解析友好 **：严格遵守 JSON 格式，严禁在此阶段生成任何 AI 生图提示词（Prompt）。",
    "",
    "现在，请开始分析服装并输出完整的设计规范文档。"
  )

  return sections.join("\n")
}

function buildAnalysisPrompt(params: {
  mode: ClothingStudioMode
  requirements: string
  targetLanguage: string
  imageUnderstandingText: string
  hasModelReference?: boolean
  plans: ClothingStudioPlan[]
  basicSelections: ClothingStudioBasicSelections
  tryOnSelections: ClothingStudioTryOnSelections
}) {
  if (params.mode === "tryon") {
    return buildTryOnLegacyAnalysisPrompt({
      requirements: params.requirements,
      targetLanguage: params.targetLanguage,
      imageCount: params.plans.length,
    })
  }

  return buildBasicLegacyAnalysisPrompt({
    requirements: params.requirements,
    targetLanguage: params.targetLanguage,
    basicSelections: params.basicSelections,
  })
}

export function buildClothingStudioAnalysisPromptPreview(params: {
  mode: ClothingStudioMode
  requirements: string
  targetLanguage: string
  imageUnderstandingText: string
  hasModelReference?: boolean
  plans: ClothingStudioPlan[]
  basicSelections: ClothingStudioBasicSelections
  tryOnSelections: ClothingStudioTryOnSelections
}) {
  return buildAnalysisPrompt(params)
}

function buildGenerationPrompt(params: {
  mode: ClothingStudioMode
  requirements: string
  targetLanguage: string
  summary: string
  imageUnderstandingText: string
  plan: ClothingStudioPlan
  hasModelReference?: boolean
}) {
  const baseLines = [
    "你是顶级服装电商视觉总监，需要基于服装参考图生成一张高转化、真实可信的服装电商图片。",
    `当前模式：${params.mode === "basic" ? "基础套图" : "模特试穿"}`,
    "",
    "整体策略：",
    params.summary || "请输出专业电商级服装视觉。",
    "",
    "服装视觉锚点：",
    params.imageUnderstandingText || "必须严格保持上传服装的款式、轮廓、颜色、材质、印花、logo 与工艺细节一致。",
    "",
    `当前任务标题：${params.plan.title}`,
    `任务类别：${params.plan.category}`,
    `画面目标：${params.plan.description}`,
    `设计内容：${params.plan.designContent}`,
    `补充提示：${params.plan.promptHint || "无"}`,
    "",
    "用户补充要求：",
    params.requirements || "无额外要求。",
    "",
    `输出语言偏好：${resolveClothingStudioLanguageLabel(params.targetLanguage)}`,
    "",
    "硬性约束：",
    "1. 服装必须保持同一款商品，不允许更换颜色、长度、版型、纹样、logo、纽扣、拉链、袖型或关键工艺。",
    "2. 不允许将服装生成成其他材质、其他品牌、其他款式，不能把服装简化成抽象时尚造型。",
    "3. 电商可用性优先，主体清晰、边缘干净、结构完整，不能出现 AI 水印、界面元素或无关文字。",
    "4. 服装要始终是主角，背景、模特和道具只能服务展示效果。",
  ]

  if (params.mode === "basic") {
    if (params.plan.category === "white-refine") {
      baseLines.push("5. 背景必须纯白或接近纯白，适合直接用于电商详情页。")
    }
    if (params.plan.category === "three-dimensional") {
      baseLines.push("5. 重点强化立体层次与空间感，但不能改变服装真实结构。")
    }
    if (params.plan.category === "mannequin") {
      baseLines.push("5. 必须用专业人台承托服装，避免生成真人模特。")
    }
    if (params.plan.category === "detail-closeup") {
      baseLines.push("5. 使用近景镜头聚焦服装细节和面料纹理。")
    }
    if (params.plan.category === "selling-point") {
      baseLines.push("5. 可以加入少量电商信息层级，但不要堆满海报文案。")
    }
  } else {
    baseLines.push("5. 必须生成真实自然的模特试穿状态，服装要准确穿在人身上，不能悬空、错位或穿模。")
    if (params.plan.category === "tryon-catalog") {
      baseLines.push("6. 以电商棚拍试穿为主，完整展示服装版型和上身比例。")
    }
    if (params.plan.category === "tryon-lifestyle") {
      baseLines.push("6. 使用自然生活方式场景，但不能削弱服装主体。")
    }
    if (params.plan.category === "tryon-campaign") {
      baseLines.push("6. 画面可以更具品牌大片感，但服装细节必须清晰。")
    }
    if (params.plan.category === "tryon-detail") {
      baseLines.push("6. 用局部镜头展示上身后的材质、褶皱、垂感与工艺细节。")
    }
    if (params.hasModelReference) {
      baseLines.push("7. 还会提供一张模特参考图，必须尽量保持同一人物的脸型、发型、肤色、体态与气质，只替换服装为当前商品。")
    }
  }

  return baseLines.join("\n")
}

function buildTryOnPromptGenerationFallback(params: {
  analysisResult: ClothingStudioAnalysisResult
  targetLanguage: string
}) {
  return params.analysisResult.images.map(
    (plan): ClothingStudioGeneratedPrompt => ({
      title: plan.title,
      description: plan.description,
      prompt: buildGenerationPrompt({
        mode: "tryon",
        requirements: "",
        targetLanguage: params.targetLanguage,
        summary: params.analysisResult.summary,
        imageUnderstandingText: params.analysisResult.imageUnderstandingText || "",
        plan,
        hasModelReference: true,
      }),
    })
  )
}

function compactPromptText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function stripPromptPunctuation(value: string) {
  return compactPromptText(value).replace(/[。；;，,]+$/g, "").trim()
}

function ensurePromptSentence(value: string) {
  const normalized = stripPromptPunctuation(value)
  return normalized ? `${normalized}。` : ""
}

function cleanPromptMarkdownLine(value: string) {
  return compactPromptText(
    String(value || "")
      .replace(/^\s*[-*]\s*/, "")
      .replace(/^\s*\d+\.\s*/, "")
      .replace(/\*\*/g, "")
  )
}

function parsePromptLabeledFields(input: string) {
  const fields: Record<string, string> = {}

  for (const rawLine of String(input || "").replace(/\r/g, "").split("\n")) {
    const line = cleanPromptMarkdownLine(rawLine)
    if (!line) continue

    const match = line.match(/^([^：:]+)[：:]\s*(.+)$/)
    if (!match) continue

    const key = compactPromptText(match[1])
    const value = compactPromptText(match[2])
    if (!key || !value) continue
    if (key === "主标题" || key === "副标题" || key === "说明文字") continue

    fields[key] = value
  }

  return fields
}

function simplifyPromptField(value: string) {
  return compactPromptText(String(value || "").replace(/[（(][^）)]*[）)]/g, "")).split("。")[0] || ""
}

function simplifyPromptColors(value: string) {
  const normalized = simplifyPromptField(value)
    .replace(/主色为/g, "")
    .replace(/辅色为/g, "")
    .replace(/主色/g, "")
    .replace(/辅色/g, "")
    .replace(/，?\s*色调.*$/g, "")

  const parts = normalized
    .split("，")
    .map((item) => stripPromptPunctuation(item))
    .filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0]}与${parts[1]}`
  }

  return normalized
}

function simplifyPromptMaterial(value: string) {
  return simplifyPromptField(value)
    .replace(/，?\s*整体.*$/g, "")
    .replace(/，?\s*呈现.*$/g, "")
    .replace(/，?\s*具有.*$/g, "")
}

function simplifyPromptKeyElements(value: string) {
  const parts = simplifyPromptField(value)
    .split(/[；;，]/)
    .map((item) => stripPromptPunctuation(item))
    .filter(Boolean)

  return parts.slice(0, 3).join("、")
}

function buildProductPromptGarmentLead(summary: string) {
  const fields = parsePromptLabeledFields(summary)
  const clothingType = simplifyPromptField(fields["服装类型"] || "")
  const colors = simplifyPromptColors(fields["颜色"] || "")
  const material = simplifyPromptMaterial(fields["材质特征"] || "")
  const keyElements = simplifyPromptKeyElements(fields["关键设计元素"] || "")
  const tone = simplifyPromptField(fields["整体调性"] || "")

  const lead = [clothingType, colors, material].filter(Boolean).join("，")

  return {
    lead,
    clothingType,
    keyElements,
    tone,
  }
}

function extractPromptTitleSuffix(title: string) {
  const normalized = compactPromptText(title)
  const parts = normalized.split(/[：:]/).map((item) => compactPromptText(item)).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : normalized
}

function buildPromptBackgroundSentence(background: string, notes?: string) {
  const direct = stripPromptPunctuation(background)
  const fallback = stripPromptPunctuation(notes || "")
  const candidate = direct || (/背景|白底|纯白|墙面|场景|针织/i.test(fallback) ? fallback : "")
  if (!candidate) return ""

  if (/^背景/.test(candidate)) return ensurePromptSentence(candidate)

  const normalized = candidate
    .replace(/^纯白背景\s*/i, "纯白#FFFFFF，")
    .replace(/^纯白底\s*/i, "纯白#FFFFFF，")

  return ensurePromptSentence(`背景为${normalized}`)
}

function buildPromptQualitySentence(category: ClothingStudioPlan["category"], tone: string) {
  if (category === "three-dimensional") {
    return "3D建模细腻，比例自然，高清画质。"
  }
  if (category === "selling-point") {
    return ensurePromptSentence(`摄影风格，高清画质${tone ? `，展现${tone}` : ""}`)
  }
  if (category === "mannequin") {
    return "人台展示自然，比例准确，高清画质。"
  }
  return "高清分辨率，画质锐利，无噪点。"
}

function buildSellingPointAtmosphereSentence(value: string) {
  const normalized = stripPromptPunctuation(value)
  if (!normalized) return ""

  const moodMatch = normalized.match(/情绪词[：:]\s*([^；;]+)/)
  const lightMatch = normalized.match(/光影[：:]\s*([^；;]+)/)
  const mood = stripPromptPunctuation(moodMatch?.[1] || "")
  const light = stripPromptPunctuation(lightMatch?.[1] || "")

  if (light && mood) {
    return ensurePromptSentence(`${light}，营造${mood}的氛围`)
  }
  if (light) return ensurePromptSentence(light)
  return ensurePromptSentence(normalized)
}

function resolveMannequinCarrier(clothingType: string) {
  const normalized = clothingType.toLowerCase()
  if (/(夹克|外套|上衣|衬衫|卫衣|毛衣|针织|背心|t恤|上装)/i.test(normalized)) {
    return "极简哑光浅色半身人台"
  }
  return "极简哑光浅色人台"
}

function buildProductPlanPrompt(params: {
  plan: ClothingStudioPlan
  summary: string
  targetLanguage: string
}) {
  void params.targetLanguage

  const fields = parsePromptLabeledFields(params.plan.designContent)
  const garment = buildProductPromptGarmentLead(params.summary)
  const lead = garment.lead || garment.clothingType || "服装"
  const ratio = stripPromptPunctuation(fields["主体占比"] || "")
  const layout = stripPromptPunctuation(fields["画面布局方式"] || fields["画面布局"] || "")
  const angle = stripPromptPunctuation(fields["拍摄角度"] || fields["服装姿态"] || "")
  const background = fields["背景设置"] || fields["背景建议"] || fields["背景元素"] || ""
  const notes = fields["注意事项"] || ""
  const lighting = stripPromptPunctuation(fields["光线要求"] || fields["光线布置"] || "")
  const focus = stripPromptPunctuation(fields["重点展示"] || fields["展示重点"] || fields["内容要素"] || "")
  const material = stripPromptPunctuation(fields["材质表现"] || "")
  const designGoal = stripPromptPunctuation(fields["设计目标"] || "")
  const composition = stripPromptPunctuation(fields["构图方案"] || "")
  const colorSystem = stripPromptPunctuation(fields["色彩系统"] || fields["色彩系统规范"] || "")
  const shotPart = stripPromptPunctuation(fields["拍摄部位"] || extractPromptTitleSuffix(params.plan.title))
  const shotDistance = stripPromptPunctuation(fields["拍摄距离"] || "")
  const atmosphere = stripPromptPunctuation(fields["氛围营造"] || "")
  const tone = garment.tone

  const sentences: string[] = []

  switch (params.plan.category) {
    case "white-refine": {
      const framing = [layout, angle, ratio ? `主体占比${ratio}` : ""].filter(Boolean).join("，")
      sentences.push(ensurePromptSentence(`${lead}，版型设计细节与颜色必须和参考图保持一致`))
      if (framing) sentences.push(ensurePromptSentence(framing))
      const backgroundSentence = buildPromptBackgroundSentence(background, notes)
      if (backgroundSentence) sentences.push(backgroundSentence)
      if (lighting) sentences.push(ensurePromptSentence(`采用${lighting}`))
      if (focus) sentences.push(ensurePromptSentence(`重点展示${focus}`))
      if (tone) sentences.push(ensurePromptSentence(`整体调性${tone}`))
      break
    }
    case "three-dimensional": {
      sentences.push(ensurePromptSentence(`服饰提取转化为3D立体形态，${lead}`))
      if (angle) sentences.push(ensurePromptSentence(angle))
      if (notes) sentences.push(ensurePromptSentence(notes))
      const framing = [ratio ? `主体占比${ratio}` : "", layout].filter(Boolean).join("，")
      if (framing) sentences.push(ensurePromptSentence(framing))
      if (lighting) sentences.push(ensurePromptSentence(lighting))
      if (material) sentences.push(ensurePromptSentence(material))
      const backgroundSentence = buildPromptBackgroundSentence(background, "")
      if (backgroundSentence) sentences.push(backgroundSentence)
      break
    }
    case "mannequin": {
      const carrier = resolveMannequinCarrier(garment.clothingType)
      sentences.push(ensurePromptSentence(`${lead}，使用${carrier}展示，版型结构与参考图一致`))
      const framing = [layout, angle, ratio ? `主体占比${ratio}` : ""].filter(Boolean).join("，")
      if (framing) sentences.push(ensurePromptSentence(framing))
      const backgroundSentence = buildPromptBackgroundSentence(background, fields["背景建议"] || notes)
      if (backgroundSentence) sentences.push(backgroundSentence)
      if (lighting) sentences.push(ensurePromptSentence(lighting))
      if (focus) sentences.push(ensurePromptSentence(`重点展示${focus}`))
      break
    }
    case "detail-closeup": {
      sentences.push(ensurePromptSentence(`细节特写图：${shotPart || "服装关键细节"}`))
      const framing = [
        shotDistance ? `${shotDistance}摄影` : "",
        angle,
        ratio ? `主体占比${ratio}` : "",
      ]
        .filter(Boolean)
        .join("，")
      if (framing) sentences.push(ensurePromptSentence(framing))
      if (lighting) sentences.push(ensurePromptSentence(lighting))
      if (notes) sentences.push(ensurePromptSentence(notes))
      if (material) sentences.push(ensurePromptSentence(material))
      sentences.push("服装版型与材质特征必须与参考图高度一致。")
      if (designGoal) sentences.push(ensurePromptSentence(designGoal))
      break
    }
    case "selling-point": {
      const sellingName = extractPromptTitleSuffix(params.plan.title) || "核心卖点"
      sentences.push(ensurePromptSentence(`卖点图：${sellingName}`))
      sentences.push(
        ensurePromptSentence(
          `${garment.clothingType || lead}${designGoal ? `，${designGoal}` : ""}${focus ? `，${focus}` : ""}，版型细节与参考图一致`
        )
      )
      if (composition) sentences.push(ensurePromptSentence(`构图方案为${composition}`))
      const backgroundSentence = buildPromptBackgroundSentence(background, "")
      if (backgroundSentence) sentences.push(backgroundSentence)
      if (atmosphere) sentences.push(buildSellingPointAtmosphereSentence(atmosphere))
      if (colorSystem) {
        sentences.push(
          ensurePromptSentence(colorSystem.startsWith("色彩系统") ? colorSystem : `色彩系统为${colorSystem}`)
        )
      }
      break
    }
    default: {
      sentences.push(ensurePromptSentence(`${lead}，关键设计元素与参考图保持一致`))
      if (designGoal) sentences.push(ensurePromptSentence(designGoal))
      if (layout || angle || ratio) {
        sentences.push(ensurePromptSentence([layout, angle, ratio ? `主体占比${ratio}` : ""].filter(Boolean).join("，")))
      }
      if (lighting) sentences.push(ensurePromptSentence(lighting))
      if (focus) sentences.push(ensurePromptSentence(focus))
      break
    }
  }

  sentences.push(buildPromptQualitySentence(params.plan.category, tone))

  return sentences.filter(Boolean).join("")
}

function buildProductPromptGenerationFallback(params: {
  analysisResult: ClothingStudioAnalysisResult
  targetLanguage: string
}) {
  return params.analysisResult.images.map(
    (plan): ClothingStudioGeneratedPrompt => ({
      title: plan.title,
      description: plan.description,
      prompt: buildProductPlanPrompt({
        plan,
        summary: params.analysisResult.summary,
        targetLanguage: params.targetLanguage,
      }),
    })
  )
}

function normalizePromptGenerationItems(
  input: unknown,
  fallback: ClothingStudioGeneratedPrompt[]
) {
  if (!Array.isArray(input)) return fallback

  const normalized = input
    .map((item, index): ClothingStudioGeneratedPrompt | null => {
      const fallbackItem = fallback[index]
      const prompt = String(
        (item as { prompt?: unknown; final_prompt?: unknown; content?: unknown } | null)?.prompt ||
          (item as { final_prompt?: unknown } | null)?.final_prompt ||
          (item as { content?: unknown } | null)?.content ||
          ""
      ).trim()

      if (!prompt) return null

      return {
        title: String((item as { title?: unknown } | null)?.title || fallbackItem?.title || `方案 ${index + 1}`).trim(),
        description: String(
          (item as { description?: unknown } | null)?.description || fallbackItem?.description || ""
        ).trim(),
        prompt,
      }
    })
    .filter((item): item is ClothingStudioGeneratedPrompt => Boolean(item))

  return normalized.length === fallback.length ? normalized : fallback
}

export async function generateClothingStudioTryOnPrompts(params: {
  merchantId: string | null
  textModelId?: string
  targetLanguage: string
  analysisResult: ClothingStudioAnalysisResult
}): Promise<ClothingStudioPromptGenerationResponse> {
  const fallback = buildTryOnPromptGenerationFallback({
    analysisResult: params.analysisResult,
    targetLanguage: params.targetLanguage,
  })

  const analysisJson = {
    design_specs: params.analysisResult.summary,
    images: params.analysisResult.images.map((plan) => ({
      title: plan.title,
      description: plan.description,
      design_content: plan.designContent,
    })),
  }

  try {
    const completion = await chatTextCompletion({
      merchantId: params.merchantId,
      requestedRuntimeId: params.textModelId,
      systemPrompt: [
        "你是电商模特试穿工作流里的最终提示词编写器。",
        "你的任务是把 analysisJson 中的整体视觉策略和分镜方案，转写成可直接给图片模型使用的最终生图 prompt。",
        "必须只返回 JSON，不要解释，不要 Markdown。",
      ].join("\n"),
      userPrompt: [
        "请根据下面的 analysisJson 生成最终提示词。",
        "要求：",
        `1. 返回 JSON：{\"prompts\":[{\"title\":\"string\",\"description\":\"string\",\"prompt\":\"string\"}]}`,
        `2. prompts 数量必须严格等于 ${fallback.length}`,
        "3. 每个 prompt 必须可直接用于单张模特试穿生图，完整覆盖主体、构图、背景、光影、材质、氛围、风格、画质和硬性约束。",
        "4. 必须明确强调：模特与参考模特图保持同一人物身份；服装与产品图保持绝对一致。",
        "5. 如果 analysisJson 中文字内容为 None 或当前目标语言为无文字(纯视觉)，必须明确要求画面无文案、无排版、无文字。",
        "6. 不要丢失任何镜头里的动作、卖点、背景、装饰和氛围要求。",
        "",
        `目标语言：${resolveClothingStudioLanguageLabel(params.targetLanguage)}`,
        `analysisJson: ${JSON.stringify(analysisJson)}`,
      ].join("\n"),
      temperature: 0.4,
      maxTokens: Math.min(8192, 1800 + fallback.length * 900),
      responseMimeType: "application/json",
    })

    const parsed = JSON.parse(extractJsonObject(completion.content))
    return {
      prompts: normalizePromptGenerationItems(parsed?.prompts, fallback),
      modelId: completion.modelId,
      provider: completion.provider,
    }
  } catch (error) {
    console.warn("[clothing-studio] try-on prompt generation failed, fallback to direct prompt", error)
    return {
      prompts: fallback,
      modelId: "",
      provider: "",
    }
  }
}

export async function generateClothingStudioProductPrompts(params: {
  merchantId: string | null
  textModelId?: string
  targetLanguage: string
  analysisResult: ClothingStudioAnalysisResult
}): Promise<ClothingStudioPromptGenerationResponse> {
  const prompts = buildProductPromptGenerationFallback({
    analysisResult: params.analysisResult,
    targetLanguage: params.targetLanguage,
  })

  void params.merchantId
  void params.textModelId

  return {
    prompts,
    modelId: "",
    provider: "",
  }
}

export async function listClothingStudioModels(merchantId: string | null): Promise<ClothingStudioModelSettingsPayload> {
  const models = await listStudioGenesisModels(merchantId)
  return {
    textModel: models.textModel,
    imageModel: models.imageModel,
    textModels: models.textModels,
    imageModels: models.imageModels,
  }
}

export { resolveBatchConcurrencyFromSpeedMode }

export async function analyzeClothingStudioProductSet(params: {
  productImages: string[]
  modelImage?: string
  requirements?: string
  mode: ClothingStudioMode
  targetLanguage?: string
  basicSelections: ClothingStudioBasicSelections
  tryOnSelections: ClothingStudioTryOnSelections
  textModelId?: string
  merchantId: string | null
  requestOrigin?: string
}): Promise<ClothingStudioAnalysisResult> {
  const productImages = Array.from(
    new Set((Array.isArray(params.productImages) ? params.productImages : []).map((item) => String(item || "").trim()).filter(Boolean))
  ).slice(0, CLOTHING_STUDIO_MAX_PRODUCT_IMAGES)
  const modelImage = String(params.modelImage || "").trim()

  if (productImages.length === 0) {
    throw new Error("请先上传至少一张产品图")
  }

  const targetLanguage = String(params.targetLanguage || DEFAULT_CLOTHING_STUDIO_SETTINGS.targetLanguage).trim()
  const requirements = String(params.requirements || "").trim()
  const basicSelections = params.basicSelections
  const tryOnSelections = params.tryOnSelections
  const plans = buildClothingStudioPlanBlueprint({
    mode: params.mode,
    basicSelections,
    tryOnSelections,
    targetLanguage,
  })

  if (plans.length === 0) {
    throw new Error("请至少选择一个生成类型")
  }
  const publicProductImages = await ensurePublicImageUrls(productImages, {
    requestOrigin: params.requestOrigin,
    preferredDir: "clothing-studio",
    filenameHint: "product",
    mirrorRemote: true,
    fetchTimeoutMs: 25_000,
    max: CLOTHING_STUDIO_MAX_PRODUCT_IMAGES,
  })
  const publicModelImage = params.mode === "tryon" && modelImage
    ? await ensurePublicImageUrl(modelImage, {
        requestOrigin: params.requestOrigin,
        preferredDir: "clothing-studio",
        filenameHint: "model",
        mirrorRemote: true,
        fetchTimeoutMs: 25_000,
      })
    : ""
  const modelProductImages = await normalizeModelImageInputUrls(publicProductImages, {
    requestOrigin: params.requestOrigin,
    max: CLOTHING_STUDIO_MAX_PRODUCT_IMAGES,
  })
  const modelModelImage = publicModelImage
    ? (await normalizeModelImageInputUrls([publicModelImage], { requestOrigin: params.requestOrigin, max: 1 }))[0] || ""
    : ""

  const imageUnderstandingText = ""
  const userPrompt = buildAnalysisPrompt({
    mode: params.mode,
    requirements,
    targetLanguage,
    imageUnderstandingText,
    hasModelReference: Boolean(params.mode === "tryon" && publicModelImage),
    plans,
    basicSelections,
    tryOnSelections,
  })

  const completion = await chatTextCompletion({
    merchantId: params.merchantId,
    requestedRuntimeId: params.textModelId,
    systemPrompt: "",
    userPrompt,
    userContent: [
      { type: "text", text: userPrompt },
      ...modelProductImages.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ...(params.mode === "tryon" && modelModelImage ? [{ type: "image_url" as const, image_url: { url: modelModelImage } }] : []),
    ],
    requestOrigin: params.requestOrigin,
    temperature: 0.4,
    maxTokens: 8192,
    responseMimeType: "application/json",
    omitSystemPrompt: true,
    preferNativeGemini: true,
  })

  const parsed = JSON.parse(extractJsonObject(completion.content))

  return normalizeClothingStudioAnalysisResult(
    {
      ...parsed,
      imageUnderstandingText,
      modelId: completion.modelId,
      provider: completion.provider,
      usage: completion.usage,
    },
    {
      mode: params.mode,
      basicSelections,
      tryOnSelections,
      targetLanguage,
    }
  )
}

async function resolveClothingStudioImageGenerationModel(params: {
  merchantId: string | null
  imageModelId?: string
}) {
  const models = await listClothingStudioModels(params.merchantId)
  const runtimeId = String(params.imageModelId || models.imageModel?.runtimeId || "").trim()
  if (!runtimeId) {
    throw new Error("未配置【服装组图】生图模型，请先在后台配置图片模型")
  }

  const modelConfig = await getEffectiveModelConfig(runtimeId, params.merchantId)
  const provider = modelConfig?.provider || null
  const modelId = String(modelConfig?.modelId || "").trim()

  if (!provider || !modelId) {
    throw new Error("服装组图图片模型不可用，请检查后台模型配置")
  }

  return {
    runtimeId,
    provider,
    modelId,
  }
}

async function generateClothingStudioImageWithPrompt(params: {
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  modelImage?: string
  mode: ClothingStudioMode
  prompt: string
  settings: Pick<ClothingStudioSettings, "imageModelId" | "aspectRatio" | "imageSize" | "speedMode">
}) {
  const resolvedModel = await resolveClothingStudioImageGenerationModel({
    merchantId: params.merchantId,
    imageModelId: params.settings.imageModelId,
  })

  const referenceInputs = [
    ...params.productImages,
    ...(params.mode === "tryon" && params.modelImage ? [params.modelImage] : []),
  ]
  const referenceImages = await normalizeGenerationReferenceImages(referenceInputs, params.requestOrigin)
  if (referenceImages.length === 0) {
    throw new Error("缺少有效的产品图参考")
  }

  const result = await modelRouter.generateWithDbCredentials(
    String(params.prompt || "").trim(),
    resolvedModel.modelId,
    resolvedModel.provider,
    {
      aspectRatio: String(params.settings.aspectRatio || DEFAULT_CLOTHING_STUDIO_SETTINGS.aspectRatio).trim(),
      imageSize: String(params.settings.imageSize || DEFAULT_CLOTHING_STUDIO_SETTINGS.imageSize).trim(),
      referenceImages,
      responseFormat: "url",
      quality: resolveQualityFromSpeedMode(params.settings.speedMode || "standard"),
      optimizePromptMode: params.settings.speedMode === "turbo" ? "fast" : "standard",
      renderSpeed: params.settings.speedMode === "turbo" ? "turbo" : "fast",
    },
    "image"
  )

  const rawUrl = normalizeImageResultUrl(result)
  if (!rawUrl) {
    throw new Error("图片模型返回了空结果")
  }

  return {
    url: await persistGeneratedImageIfNeeded(rawUrl),
    prompt: String(params.prompt || "").trim(),
    modelId: resolvedModel.modelId,
    runtimeId: resolvedModel.runtimeId,
    provider: String(resolvedModel.provider.key || result.provider || "").trim(),
  }
}

export async function generateClothingStudioPlanImage(params: {
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  modelImage?: string
  requirements?: string
  mode: ClothingStudioMode
  settings: Pick<ClothingStudioSettings, "imageModelId" | "aspectRatio" | "imageSize" | "speedMode" | "targetLanguage">
  analysisResult: Pick<ClothingStudioAnalysisResult, "summary" | "imageUnderstandingText">
  plan: ClothingStudioPlan
}) {
  const prompt = buildGenerationPrompt({
    mode: params.mode,
    requirements: String(params.requirements || "").trim(),
    targetLanguage: String(params.settings.targetLanguage || DEFAULT_CLOTHING_STUDIO_SETTINGS.targetLanguage).trim(),
    summary: String(params.analysisResult.summary || "").trim(),
    imageUnderstandingText: String(params.analysisResult.imageUnderstandingText || "").trim(),
    plan: params.plan,
    hasModelReference: Boolean(params.mode === "tryon" && params.modelImage),
  })

  const result = await generateClothingStudioImageWithPrompt({
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    productImages: params.productImages,
    modelImage: params.modelImage,
    mode: params.mode,
    prompt,
    settings: params.settings,
  })

  return {
    url: result.url,
    prompt: result.prompt,
    modelId: result.modelId,
    provider: result.provider,
  }
}

export async function generateClothingStudioImageFromPrompt(params: {
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  modelImage?: string
  mode?: ClothingStudioMode
  prompt: string
  settings: Pick<ClothingStudioSettings, "imageModelId" | "aspectRatio" | "imageSize" | "speedMode">
}) {
  return await generateClothingStudioImageWithPrompt({
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    productImages: params.productImages,
    modelImage: params.modelImage,
    mode: params.mode || "tryon",
    prompt: params.prompt,
    settings: params.settings,
  })
}

function clampModelGeneratorCount(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.min(4, Math.round(numeric)))
}

function buildModelGenerationSummary(params: {
  gender: string
  ageRange: string
  ethnicity: string
  requirements?: string
}) {
  return [
    params.gender,
    params.ageRange,
    params.ethnicity,
    String(params.requirements || "").trim(),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(", ")
}

function buildModelGenerationFallbackPrompt(params: {
  gender: string
  ageRange: string
  ethnicity: string
  requirements?: string
  aspectRatio: string
}) {
  return [
    "生成一张用于服装模特试穿参考的高质量真人模特全身图。",
    `人物设定：${params.gender}，${params.ageRange}，${params.ethnicity}。`,
    "画面要求：全身入镜，头到脚完整可见，站姿自然，正面或轻微 3/4 角度，四肢完整，五官自然，皮肤细节真实。",
    "服装要求：穿纯色、贴身、无图案、无品牌标识的基础打底服，避免宽松外套、裙摆遮挡或复杂配饰。",
    "摄影要求：纯净影棚背景，柔和均匀布光，主体居中，无遮挡，无文字，无水印，无多余道具。",
    `画面比例：${params.aspectRatio}。`,
    params.requirements ? `附加要求：${params.requirements}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

async function buildClothingStudioModelGenerationPrompt(params: {
  merchantId: string | null
  textModelId?: string
  gender: string
  ageRange: string
  ethnicity: string
  requirements?: string
  aspectRatio: string
}) {
  const fallbackPrompt = buildModelGenerationFallbackPrompt(params)
  const fallbackSummary = buildModelGenerationSummary(params)

  try {
    const completion = await chatTextCompletion({
      merchantId: params.merchantId,
      requestedRuntimeId: params.textModelId,
      systemPrompt: [
        "你是电商服装试穿工作流里的模特生成导演。",
        "你的任务是把用户给定的人设条件整理成一段可直接用于图片模型生成真人模特图的提示词。",
        "必须优先保证：真人感、全身完整、站姿自然、影棚纯净、适合作为后续服装试穿参考。",
        "不要输出解释，只返回 JSON。",
      ].join("\n"),
      userPrompt: [
        "请生成一段用于 AI 生图的模特图提示词。",
        `性别：${params.gender}`,
        `年龄：${params.ageRange}`,
        `肤色 / 人种：${params.ethnicity}`,
        `额外要求：${String(params.requirements || "").trim() || "无"}`,
        `尺寸比例：${params.aspectRatio}`,
        "硬性要求：",
        "1. 必须是写实真人模特，全身完整可见，头脚不能被裁切。",
        "2. 必须是纯净影棚风格，主体清晰，背景干净。",
        "3. 穿纯色基础打底服，不要宽松外套、复杂配饰、包袋、帽子、墨镜或夸张姿势。",
        "4. 不能生成多人，不能出现手部畸形、肢体缺失、模糊脸、文字、水印或拼贴。",
        '输出 JSON：{"prompt":"string","summary":"string"}',
      ].join("\n"),
    })

    const parsed = JSON.parse(extractJsonObject(completion.content))
    return {
      prompt: String(parsed?.prompt || "").trim() || fallbackPrompt,
      summary: String(parsed?.summary || "").trim() || fallbackSummary,
      analysisModelId: completion.modelId,
      analysisProvider: completion.provider,
    }
  } catch (error) {
    console.warn("[clothing-studio] model prompt generation failed, fallback to direct prompt", error)
    return {
      prompt: fallbackPrompt,
      summary: fallbackSummary,
      analysisModelId: "",
      analysisProvider: "",
    }
  }
}

export async function generateClothingStudioModelCandidates(params: {
  merchantId: string | null
  imageModelId?: string
  textModelId?: string
  gender: string
  ageRange: string
  ethnicity: string
  requirements?: string
  count?: number
  turbo?: boolean
  aspectRatio?: string
  imageSize?: string
}) {
  const models = await listClothingStudioModels(params.merchantId)
  const runtimeId = String(params.imageModelId || models.imageModel?.runtimeId || "").trim()
  if (!runtimeId) {
    throw new Error("未配置【服装组图】生图模型，请先在后台配置图片模型")
  }

  const modelConfig = await getEffectiveModelConfig(runtimeId, params.merchantId)
  const provider = modelConfig?.provider || null
  const modelId = String(modelConfig?.modelId || "").trim()

  if (!provider || !modelId) {
    throw new Error("服装组图图片模型不可用，请检查后台模型配置")
  }

  const aspectRatio = String(params.aspectRatio || DEFAULT_CLOTHING_STUDIO_SETTINGS.aspectRatio).trim() || DEFAULT_CLOTHING_STUDIO_SETTINGS.aspectRatio
  const imageSize = String(params.imageSize || DEFAULT_CLOTHING_STUDIO_SETTINGS.imageSize).trim() || DEFAULT_CLOTHING_STUDIO_SETTINGS.imageSize
  const count = clampModelGeneratorCount(params.count)
  const promptPackage = await buildClothingStudioModelGenerationPrompt({
    merchantId: params.merchantId,
    textModelId: params.textModelId,
    gender: params.gender,
    ageRange: params.ageRange,
    ethnicity: params.ethnicity,
    requirements: params.requirements,
    aspectRatio,
  })

  const items = []
  for (let index = 0; index < count; index += 1) {
    const result = await modelRouter.generateWithDbCredentials(
      promptPackage.prompt,
      modelId,
      provider,
      {
        aspectRatio,
        imageSize,
        responseFormat: "url",
        quality: params.turbo ? "standard" : "hd",
        optimizePromptMode: params.turbo ? "fast" : "standard",
        renderSpeed: params.turbo ? "turbo" : "fast",
        background: "opaque",
      },
      "image"
    )

    const rawUrl = normalizeImageResultUrl(result)
    if (!rawUrl) {
      throw new Error("图片模型返回了空结果")
    }

    items.push({
      url: await persistGeneratedImageIfNeeded(rawUrl),
      prompt: promptPackage.prompt,
      summary: promptPackage.summary,
      modelId,
      provider: String(provider.key || result.provider || "").trim(),
      analysisModelId: promptPackage.analysisModelId,
      analysisProvider: promptPackage.analysisProvider,
    })
  }

  return {
    prompt: promptPackage.prompt,
    summary: promptPackage.summary,
    modelId,
    provider: String(provider.key || "").trim(),
    analysisModelId: promptPackage.analysisModelId,
    analysisProvider: promptPackage.analysisProvider,
    items,
  }
}
