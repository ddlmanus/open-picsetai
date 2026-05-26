import { getEffectiveModelConfig, getPreferredModelConfigByScene } from "@/lib/models/fetcher"
import { OpenAICompatibleProvider } from "@/lib/models/openai-compatible"
import { getAgentAnalysisChatOptions } from "@/lib/models/agent-analysis-provider"
import { resolveProviderCredentials } from "@/lib/models/provider-credentials"
import { modelRouter } from "@/lib/models/router"
import { createZenmuxChatProvider, isZenmuxProvider } from "@/lib/models/zenmux"
import { analyzeReferenceImagesWithGemini } from "@/lib/ai/gemini-image-understanding"
import { persistImageDataUrlToLocalUploads } from "@/lib/server/local-uploads"
import { normalizeModelImageInputUrl } from "@/lib/server/model-image-input"
import { absolutizeWithPreferredOrigin } from "@/lib/server/public-url"
import { ensurePublicImageUrl } from "@/lib/server/public-media"
import { parseDataUri } from "@/lib/utils"
import { normalizeGenerationReferenceImages } from "@/lib/xiaohongshu-ai"
import {
  DEFAULT_AESTHETIC_MIRROR_SETTINGS,
  buildSelectedAestheticMirrorReferenceImages,
  type AestheticMirrorMode,
  type AestheticMirrorSettings,
} from "@/lib/aesthetic-mirror"
import { listStudioGenesisModels, resolveBatchConcurrencyFromSpeedMode } from "@/lib/studio-genesis-ai"

const AESTHETIC_MIRROR_ANALYSIS_SCENES = ["AGENT_ANALYSIS", "GENERAL"] as const

type AestheticMirrorChatModelCandidate = {
  modelId: string
  provider: any
}

type AestheticMirrorChatCompletionResult = {
  content: string
  modelId: string
  provider: string
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
    preferredDir: "aesthetic-mirror",
    filenameHint: "aesthetic-mirror-generated",
    maxBytes: 60 * 1024 * 1024,
  })
  return stored?.url || normalized
}

function resolveQualityFromSpeedMode(speedMode: AestheticMirrorSettings["speedMode"]) {
  if (speedMode === "turbo") return "standard"
  if (speedMode === "fast") return "hd"
  return "ultra"
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

function normalizeAestheticMirrorChatModelCandidate(modelConfig: any): AestheticMirrorChatModelCandidate | null {
  const provider = modelConfig?.provider
  const modelId = String(modelConfig?.modelId || "").trim()
  const modelType = String(modelConfig?.type || "").trim().toUpperCase()

  if (modelType !== "CHAT" || !provider || !modelId) return null

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

  return { modelId, provider }
}

async function resolveAestheticMirrorAnalysisModelCandidate(
  merchantId: string | null
): Promise<AestheticMirrorChatModelCandidate | null> {
  for (const usageScene of AESTHETIC_MIRROR_ANALYSIS_SCENES) {
    const modelConfig = await getPreferredModelConfigByScene({
      usageScene,
      type: "CHAT",
      merchantId,
    })
    const candidate = normalizeAestheticMirrorChatModelCandidate(modelConfig)
    if (candidate) return candidate
  }

  return null
}

function isGeminiModelId(modelId: string) {
  return String(modelId || "").trim().toLowerCase().startsWith("gemini-")
}

function isOfficialGoogleGeminiProvider(candidate: AestheticMirrorChatModelCandidate, baseUrl: string) {
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
    preferredDir: "aesthetic-mirror",
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
      throw new Error(`获取风格复刻分析图片失败: ${response.status}`)
    }
    const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0].trim()
    if (!mimeType.startsWith("image/")) {
      throw new Error(`风格复刻分析资源不是图片: ${mimeType}`)
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

async function nativeGeminiTextCompletion(params: {
  modelId: string
  apiKey: string
  baseUrl: string
  userContent: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>
  requestOrigin?: string
  temperature: number
  maxTokens: number
  responseMimeType?: string
  responseSchema?: Record<string, unknown>
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
  for (const item of params.userContent) {
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
      inlineData: {
        mimeType: inlineImage.mimeType,
        data: inlineImage.data,
      },
    })
  }

  if (parts.length === 0) {
    throw new Error("风格复刻分析请求缺少有效内容")
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
      thinkingConfig: {
        thinkingBudget: 0,
      },
      ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
      ...(params.responseSchema ? { responseSchema: params.responseSchema } : {}),
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
      throw new Error(`风格复刻分析失败: ${response.status} ${errorText.slice(0, 500)}`)
    }

    const data = await response.json().catch(() => ({}))
    const content = extractGeminiResponseText(data)
    if (!content) {
      throw new Error("风格复刻分析返回了空结果")
    }

    return {
      content,
      modelId: params.modelId,
      provider: "google_direct",
    } satisfies AestheticMirrorChatCompletionResult
  } finally {
    clearTimeout(timeoutId)
  }
}

async function aestheticMirrorChatTextCompletion(params: {
  merchantId: string | null
  userContent: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>
  requestOrigin?: string
  temperature?: number
  maxTokens?: number
  responseMimeType?: string
  responseSchema?: Record<string, unknown>
}) {
  const candidate = await resolveAestheticMirrorAnalysisModelCandidate(params.merchantId)
  if (!candidate?.provider || !candidate.modelId) {
    throw new Error("未配置【风格复刻分析模型】，请先在后台配置聊天模型")
  }

  const credentials = resolveProviderCredentials(candidate.provider)
  const apiKey = String(credentials.apiKey || "").trim()
  const baseUrl = String(credentials.baseUrl || candidate.provider?.baseUrl || "").trim()
  if (!apiKey) {
    throw new Error(`风格复刻分析模型服务商(${candidate.provider?.name || candidate.provider?.key || "未命名服务商"})未配置可用凭证`)
  }

  const temperature = typeof params.temperature === "number" ? params.temperature : 0.4
  const maxTokens = typeof params.maxTokens === "number" ? params.maxTokens : 8192
  const responseMimeType = String(params.responseMimeType || "").trim()
  const userContent =
    responseMimeType === "application/json"
      ? [{ type: "text" as const, text: "Please output valid JSON only." }, ...params.userContent]
      : params.userContent

  if (isGeminiModelId(candidate.modelId) && isOfficialGoogleGeminiProvider(candidate, baseUrl)) {
    return nativeGeminiTextCompletion({
      modelId: candidate.modelId,
      apiKey,
      baseUrl: baseUrl || "https://generativelanguage.googleapis.com",
      userContent,
      requestOrigin: params.requestOrigin,
      temperature,
      maxTokens,
      responseMimeType,
      responseSchema: params.responseSchema,
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
      {
        role: "user",
        content: userContent,
      },
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
    throw new Error("风格复刻分析模型返回了空结果")
  }

  return {
    content,
    modelId: candidate.modelId,
    provider: String(candidate.provider?.key || "openai-compatible").trim(),
  } satisfies AestheticMirrorChatCompletionResult
}

function buildAestheticMirrorSingleStylePrompt(userPrompt?: string) {
  const supplement = String(userPrompt || "").trim()
  return [
    "作为一名专业的电子商务产品摄影师和设计师，请分析提供的\"参考图\"、\"产品图\"以及\"用户需求\"。你的目标是为每张参考图编写一条高度详细的图像生成提示词。",
    "",
    "## 一、输入说明",
    "你将同时收到以下内容：",
    "1. 参考图 — 定义目标视觉风格、排版与氛围。",
    "         - 确认是否有独立于产品上字体的营销文字；产品及其附属的包装、卡纸、标签、吊牌上的任何文字都不是营销文字。若没有营销文字，则在文字文案与平面设计部分内容为【空】。",
    "2. 产品图 — 用户提供的产品图，可能包含多个角度。",
    "3. 用户特殊需求（可选） — 若用户提供了补充信息，所有信息以用户输入为标准。",
    "",
    "## 二、核心规则：风格层与产品层隔离",
    "--参考图中的产品用\"产品A\"、\"产品B\"等占位符替代，只描述占位符在画面中的位置和摆放姿态，不描述产品的任何视觉信息。风格（背景、构图、光影、色调、装饰）只从产品以外的画面区域提取。",
    "--产品图会直接传入生图模型。提示词末尾统一用一句话概括全部产品（如\"三件蝴蝶结发梳\"），仅此一次，不在其他位置描述产品。",
    "",
    "## 三、风格解构维度（从参考图提取）",
    "根据以下维度对参考图进行深度解构：",
    "1. 布局架构：识别网格系统、空间切割方式，确定构图类型（如：对称、对角线、F型分布）。对多宫格/拼接图需逐格解构子场景。产品位置只用占位符+方位词定位，产品本身不做任何解构，只描述产品以外的场景道具的位置和外观。",
    "2. 色彩逻辑与氛围：提取主色调、辅助色，分析色彩冷暖、对比度及整体情绪表达。",
    "3. 图形与符号解构：识别画面中非文本类的装饰图形、图标、线条、徽章符号及其视觉比重。",
    "4. 文字结构与信息层级：解构文本信息的优先级（主标题、副标题、说明文案、CTA等），分析字体族类应用（衬线/无衬线/手写/装饰体）、字重对比、排版对齐逻辑及文字与背景的交互关系。",
    "5. 载体与空间：分析画面中的空间深度与透视关系。解构画面的权重层级。明确背景如何引导视线落向产品主体，并定义多产品元素之间的主次引导顺序，保持原图的视觉叙事节奏。",
    "6. 光影层级：解析光源方向、光影的材质属性（硬光/柔光/漫反射/镜面反射）及明暗深度变化。",
    "",
    "## 四、执行标准",
    "0. 参考图分类（最高优先级）：先判断每张参考图是否包含产品实体。若参考图为成分展示、功效说明、使用场景、氛围渲染等不含产品实体的图片，则该图的提示词中不放入产品、不使用产品占位符、不添加产品形态锁定语句，仅复刻该图的视觉风格、信息内容和排版结构，并将信息内容替换为当前产品的对应信息。以下第1-3条规则仅适用于含产品实体的参考图。",
    "1. 多图拼接排版：若参考图为多宫格或多图拼接，整张拼接图视为一张参考图，只输出一条提示词，严禁拆分为多条。提示词结构：先总述整体氛围、主色调、光影风格；再使用结构化的空间方位词（如：第几行第几列）逐格描述每个网格区块的子视角、场景内容与产品呈现状态；最后统一输出一次产品形态锁定语句和产品主体描述。",
    "2. 产品形态锁定：每条提示词首句必须包含——\"产品的一切外观特征完全且仅以传入的产品图为准。形态、外形、颜色、材质、零件数量、连接关系、机械结构必须与产品图完全一致，不得改变。文字描述与产品图冲突时，以产品图为准。\"",
    "3. 主体融合与逻辑重组：生成图中的产品数量与用户提供的产品数量一致。按照参考图的\"布局架构\"放置产品。人物交互只描述动作，不描述产品外观。多主体需确保比例自然、透视统一。产品形态差异大时允许±10%调整占比，确保主体描述将产品图中的产品作为一个整体描述。",
    "4. 环境复刻与质感：极致还原参考图的背景纹理、色调色彩、环境氛围、镜头语言（焦距/景深控制）以及照片质感（如胶片颗粒、数字锐度等）。",
    "5. 文字文案与平面设计：根据上文输入参考图判断可以为【空】，若不为【空】参考图中的营销文字内容仅作为排版位置和层级的参考，不要直接搬用原文。营销文字内容根据当前产品重新生成——品牌名、型号、标语等从产品图读取或由用户提供,产品本身的所有文字信息禁止改变；严禁在提示词中描述以下内容：产品的材质、结构、部件、颜色细节、工艺特征，以及产品附属的包装、卡纸、标签、吊牌上的任何文字。营销文案（卖点、促销语等）根据产品特性重新撰写。若产品图上无可见文字且用户也未提供，则根据参考图添加文字。",
    "6. 语种一致性（核心）：若有文字，输出的提示词必须遵循\"参考图\"的语种类型（如：参考图为日文，提示词中的文案描述也应为日文）。除非用户明确指定了文案内容，否则严禁自行切换语种。",
    "7. 用户需求优先：必须将\"用户特殊需求\"中的指令作为最高优先级融入到提示词中。如果用户需求与参考图风格存在冲突，务必以用户需求为准进行调整和优化。",
    "",
    "## 五、输出格式",
    "为每张参考图输出一条独立提示词。仅输出提示词文本，不含Markdown格式、分隔符或解释。分以下三种情况输出。",
    "",
    "**不含产品的图**（成分展示、功效说明、使用场景、氛围渲染等）——不使用上述分段结构，直接输出一段完整的风格复刻提示词，复刻视觉风格、排版结构和信息层级，将信息内容替换为当前产品的对应信息。",
    "",
    "**多宫格/拼接图**——不使用上述分段结构，直接输出一段完整提示词：先总述整体氛围、主色调、光影风格；再逐格描述每个区块的子场景与产品呈现；最后统一输出产品形态锁定语句和产品概括。",
    "",
    "**其余情况**",
    "【产品形态锁定语句】",
    "【布局骨架】构图类型 + 每个占位符的位置与姿态 + 场景道具位置（此段只写空间关系，不写任何视觉风格和产品外观）",
    "【风格描述】背景材质与纹理、色调与氛围、光影、镜头语言与照片质感、装饰图形与符号",
    "【文字排版】根据文字文案与平面设计进行填充可以为【空】",
    "",
    "",
    `补充提示词：${supplement}`,
  ].join("\n")
}

export async function analyzeAestheticMirrorStylePrompt(params: {
  merchantId: string | null
  requestOrigin?: string
  referenceImage: string
  productImage: string
  userPrompt?: string
}) {
  const normalizedReferenceImages = await normalizeGenerationReferenceImages([params.referenceImage], params.requestOrigin)
  const normalizedProductImages = await normalizeGenerationReferenceImages([params.productImage], params.requestOrigin)
  const referenceImage = normalizedReferenceImages[0]
  const productImage = normalizedProductImages[0]

  if (!referenceImage || !productImage) {
    throw new Error("风格复刻分析缺少有效的参考图或产品图")
  }

  const analysisPrompt = buildAestheticMirrorSingleStylePrompt(params.userPrompt)
  const response = await aestheticMirrorChatTextCompletion({
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    temperature: 0.4,
    maxTokens: 8192,
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      required: ["prompt"],
      properties: {
        prompt: {
          type: "STRING",
        },
      },
    },
    userContent: [
      { type: "text", text: analysisPrompt },
      { type: "text", text: "This is the style reference image:" },
      { type: "image_url", image_url: { url: referenceImage } },
      { type: "text", text: "This is the product image to analyze:" },
      { type: "image_url", image_url: { url: productImage } },
    ],
  })

  const parsed = JSON.parse(extractJsonObject(response.content) || "{}")
  const prompt = String(parsed?.prompt || "").trim()
  if (!prompt) {
    throw new Error("风格复刻分析未返回有效 prompt")
  }

  return {
    prompt,
    analysisPrompt,
    analysisModelId: response.modelId,
    analysisProvider: response.provider,
    promptConfigKey: "style_prompt",
    referenceImage,
    productImage,
  }
}

export { buildAestheticMirrorSingleStylePrompt }

export function buildAestheticMirrorSkuReplacePrompt(skuText?: string) {
  const normalizedSkuText = String(skuText || "").trim()
  return [
    `修改文字 JSON: ${JSON.stringify({ text: normalizedSkuText })}`,
    "",
    "以像素级精度复刻提供的参考图。唯一允许的改动：将产品主体替换为产品图中的产品；当收到的修改文字 JSON 的 text 字段非空时，按该 text 更新对应文字。",
    "",
    "严格规则：",
    "- 背景、装饰、图形、配色、光影、阴影、构图——必须与参考图完全一致。",
    "- 图标、标签、徽章（如\"NEW\"角标等）必须精确保留参考图中的原始样式、大小、颜色和位置，禁止任何变形。",
    "- 替换后的产品必须与产品图在形态、颜色、材质、结构上完全一致。",
    "- 新产品放置在参考图中原产品的相同位置、相同比例、相同角度。",
    "- 新产品的光影方向必须与参考图场景一致。",
    "- 文字处理规则：",
    "  - 若修改文字 JSON 的 text 字段为空字符串 \"\"，则参考图中所有文字必须一字不改地保留原样，禁止任何重绘、翻译、改写、删除或新增。",
    "  - 若 text 字段非空，则定位并替换参考图中对应文字，字体、字号、颜色、排版完全延用原样；未被提及的文字原位保留。",
    "- 除产品主体和（可能的）指定文字外，不得添加、删除或修改任何元素。",
    "",
    "输出：超高分辨率，4K，商业产品摄影品质，照片级真实感。",
  ].join("\n")
}

async function summarizeReferenceImages(referenceImages: string[], requestOrigin?: string) {
  const images = referenceImages.map((item) => String(item || "").trim()).filter(Boolean)
  if (images.length === 0) return ""

  try {
    const response = await analyzeReferenceImagesWithGemini({
      images,
      locale: "zh-CN",
      userPrompt:
        "请总结这些电商详情页参考图共同体现的视觉风格，包括版式、构图、配色、光影、材质、背景、图形元素、装饰语言、文字氛围。优先提炼它们稳定一致的风格特征，不要描述具体商品主体。",
      requestOrigin,
      preferredApiKey: process.env.GEMINI_IMAGE_UNDERSTANDING_API_KEY || undefined,
      preferredBaseUrl: process.env.GEMINI_IMAGE_UNDERSTANDING_BASE_URL || undefined,
      preferredModel: process.env.GEMINI_IMAGE_UNDERSTANDING_MODEL || undefined,
      requireRelayCredentials: true,
    })
    return response.status === "ok" ? String(response.summary || "").trim() : ""
  } catch (error) {
    console.warn("[aesthetic-mirror] reference style understanding failed", error)
    return ""
  }
}

async function summarizeProductImages(productImages: string[], requestOrigin?: string) {
  try {
    const response = await analyzeReferenceImagesWithGemini({
      images: productImages,
      locale: "zh-CN",
      userPrompt:
        "请总结这些产品素材图中必须被保留的商品特征，包括主体品类、轮廓结构、包装样式、材质、颜色、logo区域、标签布局、不可变卖点。不要描述风格化设计建议。",
      requestOrigin,
      preferredApiKey: process.env.GEMINI_IMAGE_UNDERSTANDING_API_KEY || undefined,
      preferredBaseUrl: process.env.GEMINI_IMAGE_UNDERSTANDING_BASE_URL || undefined,
      preferredModel: process.env.GEMINI_IMAGE_UNDERSTANDING_MODEL || undefined,
      requireRelayCredentials: true,
    })
    return response.status === "ok" ? String(response.summary || "").trim() : ""
  } catch (error) {
    console.warn("[aesthetic-mirror] product understanding failed", error)
    return ""
  }
}

export async function listAestheticMirrorModels(merchantId: string | null) {
  const models = await listStudioGenesisModels(merchantId)
  return {
    imageModel: models.imageModel,
    imageModels: models.imageModels,
  }
}

export { resolveBatchConcurrencyFromSpeedMode }

export async function generateAestheticMirrorImage(params: {
  merchantId: string | null
  requestOrigin?: string
  referenceImages: string[]
  productImages: string[]
  mode: AestheticMirrorMode
  title: string
  prompt?: string
  resolvedPrompt?: string
  skuText?: string
  styleSummary?: string
  productSummary?: string
  settings: Pick<AestheticMirrorSettings, "imageModelId" | "aspectRatio" | "imageSize" | "speedMode">
  groupIndex?: number
  groupCount?: number
  productIndex?: number
  productCount?: number
  variantIndex?: number
  variantCount?: number
}) {
  const models = await listAestheticMirrorModels(params.merchantId)
  const runtimeId = String(params.settings.imageModelId || models.imageModel?.runtimeId || "").trim()
  const modelConfig = runtimeId ? await getEffectiveModelConfig(runtimeId, params.merchantId) : null
  const provider = modelConfig?.provider || null
  const modelId = String(modelConfig?.modelId || "").trim()

  if (!provider || !modelId) {
    throw new Error("未配置【风格复刻】生图模型，请先在后台为图片模型场景配置可用模型")
  }

  const normalizedStyleImages = await normalizeGenerationReferenceImages(params.referenceImages, params.requestOrigin)
  const normalizedProductImages = await normalizeGenerationReferenceImages(params.productImages, params.requestOrigin)
  const referenceImages = [...normalizedStyleImages, ...normalizedProductImages]

  if (referenceImages.length === 0) {
    throw new Error("缺少有效的参考图片")
  }

  if (params.mode === "sku") {
    const prompt = buildAestheticMirrorSkuReplacePrompt(params.skuText)

    const result = await modelRouter.generateWithDbCredentials(
      prompt,
      modelId,
      provider,
      {
        aspectRatio: String(params.settings.aspectRatio || DEFAULT_AESTHETIC_MIRROR_SETTINGS.aspectRatio).trim(),
        imageSize: String(params.settings.imageSize || DEFAULT_AESTHETIC_MIRROR_SETTINGS.imageSize).trim(),
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
      prompt,
      modelId,
      provider: String(provider.key || result.provider || "").trim(),
    }
  }

  const synthesizedPrompt = [
    "作为顶级的电子商务视觉总监与 AI 绘画专家，请深度解构参考图的视觉基因，并将产品图中的单个或多个主体元素完美融入该风格中。",
    normalizedStyleImages.length > 1
      ? "必须严格基于输入的参考设计图集合进行风格复刻，其中第 1 张参考图是主风格锚点，其余参考图用于补充版式、元素与氛围细节；画面主体必须替换为后续产品素材图中的商品，不得直接复制参考图中的原商品、品牌信息或无关文案。"
      : "必须严格基于第 1 张参考图进行风格复刻，但画面主体必须替换为后续产品素材图中的商品，不得直接复制参考图中的原商品、品牌信息或无关文案。",
    "必须保持所有输入产品图主体的核心形态特征、材质细节、包装外观、比例关系、颜色与关键结构准确一致，不能变形、不能改款、不能替换成别的产品。",
    "请从以下维度完整继承参考图的视觉语言：",
    "1. 布局拓扑（Layout Topology）：复刻参考图的网格系统、空间切割方式、视觉落点与整体构架关系，如对称、对角线、F 型分布等，并确保产品在画面中的摆放遵循合理的物理支撑逻辑。",
    "2. 视觉流向（Visual Flow）：复刻参考图的视线引导路径、前后景权重层级与视觉叙事节奏，明确背景如何引导视线落向产品主体，以及多产品元素之间的主次顺序。",
    "3. 元素逻辑（Element Logic）：复刻参考图中元素的排列密度、组合关系与语义一致性。若输入多个产品，必须明确它们之间的组合方式，如紧凑堆叠、阶梯排布或自然散落；同时保持产品与环境之间真实的遮挡、投影、嵌入和接触关系。",
    "4. 色彩机理（Color Mechanism）：复刻参考图的配色逻辑、色调统一方式、饱和度策略与明暗分布，确保最终画面的整体色彩气质与参考图高度一致。",
    "5. 容器排版（Container Typography）：先判断参考图是否包含文字。若参考图无文字，则最终画面严禁出现任何文字元素；若参考图有文字，则必须复刻其文字容器的形状、层级、排版阶梯、留白与视觉位置，并保持语种类型与参考图一致，除非用户明确指定文案内容，否则不得擅自切换语言。字体描述必须唯一且明确，严禁出现“或类似”“类似风格”等选择性或模糊表述。",
    "6. 光影质感（Light & Texture）：精准继承参考图的光源方向、光比、软硬光特征、材质反射逻辑、阴影边缘质量与空间气氛，让所有产品元素处于统一、真实、可信的物理光照环境中。",
    "请输出一张完整的高转化电商详情图，适合详情页、主图或卖点展示，不要生成拼图、多宫格、联系表、界面截图、系统 UI、边框海报、AI 水印、生成提示或额外 logo。",
  ]

  if (params.styleSummary) {
    synthesizedPrompt.push(`参考图风格摘要：${params.styleSummary}`)
  }

  if (params.productSummary) {
    synthesizedPrompt.push(`产品素材摘要：${params.productSummary}`)
  }

  if (params.mode === "batch") {
    if (typeof params.groupIndex === "number" && typeof params.groupCount === "number" && params.groupCount > 0) {
      synthesizedPrompt.push(`当前任务属于批量复刻模式中的第 ${params.groupIndex + 1}/${params.groupCount} 张参考图，必须仅以当前这张参考图作为本任务唯一风格锚点，不得混用其他参考图中的版式、元素或装饰语言。`)
    } else {
      synthesizedPrompt.push("当前任务属于批量复刻中的单张结果，请仅遵循当前这张参考图的风格，不要混入其他参考图特征。")
    }
    if (typeof params.variantIndex === "number" && (params.variantCount || 0) > 1) {
      synthesizedPrompt.push(`当前需要输出该参考图下的第 ${params.variantIndex + 1}/${params.variantCount} 组结果，请在保持当前参考图风格锚点稳定的前提下，对构图、排版或细节布局做合理变化。`)
    }
    if (typeof params.productIndex === "number" && typeof params.productCount === "number" && params.productCount > 1) {
      synthesizedPrompt.push(`当前输出对应本组中的第 ${params.productIndex + 1}/${params.productCount} 张产品素材图，请保持该商品主体的结构与细节准确无误。`)
    }
  }

  if (params.mode === "single" && typeof params.variantIndex === "number" && (params.variantCount || 0) > 1) {
    synthesizedPrompt.push(`当前需要生成第 ${params.variantIndex + 1}/${params.variantCount} 个变体，请在保持风格一致的前提下做出合理的构图变化。`)
  }

  if (params.prompt) {
    synthesizedPrompt.push(`用户补充提示：${params.prompt}`)
  }

  synthesizedPrompt.push(`输出目标：${params.title}`)
  synthesizedPrompt.push("若参考图包含文字，请仅生成与参考图语种一致、容器结构一致、视觉层级一致的文字系统；若参考图不包含文字，禁止生成任何文字、数字、标签或装饰性字符。")

  const prompt = String(params.resolvedPrompt || "").trim() || synthesizedPrompt.join("\n")

  const result = await modelRouter.generateWithDbCredentials(
    prompt,
    modelId,
    provider,
    {
      aspectRatio: String(params.settings.aspectRatio || DEFAULT_AESTHETIC_MIRROR_SETTINGS.aspectRatio).trim(),
      imageSize: String(params.settings.imageSize || DEFAULT_AESTHETIC_MIRROR_SETTINGS.imageSize).trim(),
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
    prompt,
    modelId,
    provider: String(provider.key || result.provider || "").trim(),
  }
}

export async function buildAestheticMirrorContext(params: {
  referenceImages: string[]
  productImages: string[]
  requestOrigin?: string
}) {
  const [styleSummary, productSummary] = await Promise.all([
    summarizeReferenceImages(params.referenceImages, params.requestOrigin),
    summarizeProductImages(params.productImages, params.requestOrigin),
  ])

  return {
    styleSummary,
    productSummary,
  }
}

export async function buildAestheticMirrorBatchContext(params: {
  referenceImages: string[]
  productImages: string[]
  imageCount: number
  requestOrigin?: string
}) {
  const selectedReferenceImages = buildSelectedAestheticMirrorReferenceImages(params.referenceImages, params.imageCount)
  const [styleSummaries, productSummary] = await Promise.all([
    Promise.all(selectedReferenceImages.map((image) => summarizeReferenceImages([image], params.requestOrigin))),
    summarizeProductImages(params.productImages, params.requestOrigin),
  ])

  return {
    selectedReferenceImages,
    styleSummaries,
    productSummary,
  }
}
