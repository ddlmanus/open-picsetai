import { getEffectiveModelConfig, listEnvModelConfigs, resolveMerchantSceneRuntimeModel } from "@/lib/models/fetcher"
import { buildModelRuntimeId, parseModelRuntimeId } from "@/lib/models/runtime-id"
import { resolveProviderCredentials } from "@/lib/models/provider-credentials"
import { OpenAIProvider } from "@/lib/models/openai"
import { GoogleGeminiProvider } from "@/lib/models/google-gemini"
import { OpenAICompatibleProvider } from "@/lib/models/openai-compatible"
import { modelRouter } from "@/lib/models/router"
import { getAgentAnalysisChatOptions } from "@/lib/models/agent-analysis-provider"
import { createZenmuxChatProvider, createZenmuxVertexProvider, isZenmuxProvider, normalizeZenmuxVertexBaseUrl, resolveZenmuxProtocol } from "@/lib/models/zenmux"
import { persistImageDataUrlToLocalUploads } from "@/lib/server/local-uploads"
import { normalizeModelImageInputUrl } from "@/lib/server/model-image-input"
import { ensurePublicImageUrl } from "@/lib/server/public-media"
import { parseDataUri } from "@/lib/utils"
import {
  DEFAULT_REFINEMENT_STUDIO_SETTINGS,
  normalizeRefinementStudioBackgroundSetting,
  type RefinementStudioBackgroundSetting,
  type RefinementStudioModelOption,
  type RefinementStudioModelSettingsPayload,
  type RefinementStudioSettings,
} from "@/lib/refinement-studio"

function buildMerchantScopePriority(merchantId?: string | null): Array<string | null> {
  const scopes: Array<string | null> = []
  const pushScope = (value?: string | null) => {
    if (value === null) {
      if (!scopes.includes(null)) scopes.push(null)
      return
    }
    const normalized = String(value || "").trim()
    if (!normalized) return
    if (!scopes.includes(normalized)) scopes.push(normalized)
  }

  pushScope(merchantId || null)
  pushScope(null)
  return scopes
}

const REFINEMENT_ANALYSIS_TEXT_SCENES = ["STUDIO_GENESIS_TEXT", "XIAOHONGSHU_TEXT", "GENERAL"] as const

type RefinementAnalysisChatModelCandidate = {
  runtimeId: string
  modelId: string
  provider: any
}

function normalizeRefinementAnalysisChatModelCandidate(model: any): RefinementAnalysisChatModelCandidate | null {
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
    providerKey === "local"

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

async function resolveRefinementAnalysisModelCandidate(
  merchantId: string | null,
  requestedRuntimeId?: string
): Promise<RefinementAnalysisChatModelCandidate | null> {
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

  for (const usageScene of REFINEMENT_ANALYSIS_TEXT_SCENES) {
    const resolved = await resolveMerchantSceneRuntimeModel({
      merchantId,
      usageScene,
      type: "CHAT",
    })
    const candidate = normalizeRefinementAnalysisChatModelCandidate(resolved?.modelConfig)
    if (candidate) return candidate
  }

  return null
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
    preferredDir: "refinement-studio",
    filenameHint: "refinement-studio-generated",
    maxBytes: 60 * 1024 * 1024,
  })
  return stored?.url || normalized
}

function isImageMimeType(mime?: string | null) {
  if (!mime) return false
  return mime.toLowerCase().startsWith("image/")
}

function unwrapImageProxyUrl(rawUrl: string) {
  const trimmed = String(rawUrl || "").trim()
  if (!trimmed) return trimmed

  try {
    const parsed = new URL(trimmed)
    if (parsed.pathname === "/api/image-proxy") {
      const encoded = parsed.searchParams.get("url")
      if (!encoded) return trimmed
      try {
        return decodeURIComponent(encoded)
      } catch {
        return encoded
      }
    }
  } catch {
    // ignore non-url
  }

  if (trimmed.startsWith("/api/image-proxy?url=")) {
    const encoded = trimmed.slice("/api/image-proxy?url=".length).split("&")[0]
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }

  return trimmed
}

async function normalizeImageInputUrl(rawUrl: string, origin: string): Promise<string> {
  let normalized = unwrapImageProxyUrl(rawUrl)
  if (!normalized) return normalized

  const modelInput = await normalizeModelImageInputUrl(normalized, origin)
  if (modelInput.startsWith("data:")) return modelInput

  if (modelInput.startsWith("/")) {
    normalized = `${origin}${modelInput}`
  } else {
    normalized = modelInput
  }

  return await ensurePublicImageUrl(normalized, {
    preferredDir: "refinement-studio",
    filenameHint: "refinement-source",
    mirrorRemote: true,
    fetchTimeoutMs: 25_000,
  }) || normalized
}

async function verifyImageReachable(url: string): Promise<void> {
  const parsedData = parseDataUri(url)
  if (parsedData?.base64Data) return

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`)
    }
    const mime = response.headers.get("content-type")
    if (!isImageMimeType(mime)) {
      throw new Error(`Fetched resource is not image: ${mime || "unknown"}`)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchImageAsDataUrl(url: string, timeoutMs = 45000): Promise<string> {
  const parsedData = parseDataUri(url)
  if (parsedData?.base64Data) return url

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`)
    }
    const mime = response.headers.get("content-type") || "image/jpeg"
    if (!isImageMimeType(mime)) {
      throw new Error(`Fetched resource is not image: ${mime || "unknown"}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${mime};base64,${buffer.toString("base64")}`
  } finally {
    clearTimeout(timeoutId)
  }
}

function resolveQualityFromSpeedMode(speedMode: RefinementStudioSettings["speedMode"]) {
  if (speedMode === "turbo") return "standard"
  if (speedMode === "fast") return "hd"
  return "ultra"
}

function buildBackgroundInstruction(setting: RefinementStudioBackgroundSetting) {
  if (setting === "transparent") {
    return "输出透明背景的产品图，主体边缘干净，不要保留原背景杂物。"
  }
  if (setting === "original") {
    return "保留原始背景和主体关系，只做专业级清理、光影优化、瑕疵修复和清晰度增强。"
  }
  if (setting === "soft") {
    return "使用浅色、干净、柔和的电商棚拍背景，营造专业产品摄影效果。"
  }
  return "输出纯白或接近纯白的电商白底图，背景干净统一。"
}

function buildRefinementFallbackPrompt(params: {
  requirements?: string
  backgroundSetting: RefinementStudioBackgroundSetting
  aspectRatio: string
  imageSize: string
}) {
  return [
    "你是资深电商产品修图师与商业后期总监，请对上传的产品图进行专业级精修。",
    "目标是让图片更清晰、更干净、更有质感，同时严格保持商品主体真实一致。",
    "",
    "核心任务：",
    "- 提升整体清晰度、细节、材质表现和产品边缘质量。",
    "- 去除背景杂物、脏点、划痕、灰尘、压缩噪点和不必要瑕疵。",
    "- 优化高光、阴影、反射和轮廓，让商品更专业但不能失真。",
    `- ${buildBackgroundInstruction(params.backgroundSetting)}`,
    `- 构图比例偏好：${params.aspectRatio}`,
    `- 输出清晰度偏好：${params.imageSize}`,
    "",
    "硬性约束：",
    "1. 不允许改变产品品牌、包装、形状、结构、颜色、logo、标签、文字内容和关键材质。",
    "2. 不允许加入 AI 水印、额外文案、海报元素或不相关道具。",
    "3. 必须保持真实商业修图效果，不能变成另一个商品，也不能出现过度风格化。",
    "",
    "用户补充要求：",
    params.requirements?.trim() || "无额外要求，按高质量电商产品精修标准处理。",
  ].join("\n")
}

function buildRefinementAnalysisBackgroundInstruction(setting: RefinementStudioBackgroundSetting) {
  if (setting === "transparent") {
    return "请确保精修后的图片输出为透明背景，主体边缘干净利落，不保留原背景杂物，不添加白边、灰边或多余阴影。"
  }
  if (setting === "original") {
    return "请保留原图背景与主体关系，只对产品主体做商业级精修，去除瑕疵、优化质感、增强清晰度，不要更换背景。"
  }
  if (setting === "soft") {
    return "请将背景处理为浅色、干净、柔和的电商棚拍背景，营造自然高级的商业摄影效果，不要添加无关道具。"
  }
  return "请确保精修后的图片背景为纯白色（#FFFFFF），去除原图中的背景杂物，实现干净的电商白底图效果。"
}

export function buildRefinementAnalysisPrompt(params: {
  requirements?: string
  backgroundSetting: RefinementStudioBackgroundSetting
}) {
  const requirementText = params.requirements?.trim()
  const whiteModePrompt = [
    "> 你是一名专业的商业产品精修师，需要对所有品类的产品进行专业级精修处理，以达到崭新、高级且极具吸引力的视觉效果。请根据用户提供的产品原图，严格按照以下规范生成对应的专业精修提示词。",
    "",
    "**必须强调：产品外观需与原图完全一致，包含造型、尺寸比例、细节结构、标识/Logo的位置与样式，不得随意修改产品原有形态、颜色、细节与核心特征**。特别注意**金属材质特殊要求**，**玻璃/水晶特殊要求**。",
    ">",
    "> **核心精修要求：**",
    "> 0.  **颜色绝对保真约束**：必须100%保留产品原图的原始颜色、底色与材质色相，仅做色彩均匀化、去偏色、提亮质感处理，严禁主动替换产品本身固有色。",
    "> 1.  **背景规范**：将背景统一替换为纯净无杂色的纯白，色号为 **#FFFFFF**（RGB: 255, 255, 255），确保背景无渐变、无阴影、无任何干扰元素，让产品主体成为绝对视觉焦点。",
    "> 2.  **质感还原与强化**：强化产品材质的原始特性，如玻璃的通透感、布料的柔软纹理、塑料的细腻哑光等，并全面优化，去除表面划痕、污渍、指纹、氧化痕迹等所有瑕疵，使其呈现崭新无瑕的状态。",
    "> 3.  **光影与立体感优化**：采用专业商业棚拍级布光，通过添加柔和渐变的底部倒影、细腻的高光层次和自然的阴影过渡，增强产品的立体感与悬浮感，让产品从背景中脱颖而出，光影贴合产品原有形态，层次自然不突兀。",
    "> 4.  **细节精致度提升**：强化产品上的文字、Logo、标签等元素的锐利度，确保边缘干净利落、颜色均匀饱满；处理接缝、螺丝、边角等细节，使其整齐无痕，精准还原产品本身的精致肌理。",
    "> 5.  **色彩与氛围营造**：根据产品的定位与目标受众，调整整体色调至舒适高级的状态，做到无偏色、不发灰、色彩饱和度适中；美妆类可营造清新治愈感，电子类可营造科技未来感，家居类可营造温暖氛围感。添加轻微的空气感光晕或环境光效提升吸引力，光效不抢占产品主体视觉。",
    "> 6.  **构图优化**：构图上遵循居中或黄金分割原则，确保画面平衡、专业，产品在画面中占比合理，无裁切不全、位置偏移等问题。",
    ">",
    "> **金属材质特殊要求**：金属材质按原图特性100%保留本色，所有金属统一执行「彻底清除表面划痕、污渍、指纹、氧化发乌、斑驳瑕疵，强化[磨砂/拉丝/镜面]等材质质感（根据原图判断）、肌理与光泽，边缘锐利干净」的基础精修，禁止使用“铸造、原始、粗糙”等词汇；",
    "> - 若产品为**亮银色/铬色金属**（如不锈钢、镀铬件）：必须追加「完美镀铬表面，镜面干净通透，无杂色瑕疵」；",
    "> - 若产品为**黄铜/黑色/哑光/拉丝/磨砂等非镀铬金属**：仅强化对应质感，不添加镀铬描述，严格保留原始底色与质感特征。",
    ">",
    "> **玻璃/水晶特殊要求**：核心目标： 极致的通透感、厚重感和复杂折射。材质词汇： 使用“晶莹剔透、水晶般的绝对通透、水晶般切割、厚重质感、强化浮雕文字锐度”。光线：强制要求引入“大面积专业柔光箱布光”与“细腻的渐变侧光”，以产生平滑、流转的高光边缘。折射与高光：强调“真实的物理折射”与“干净利落的轮廓光”，高光应为完整的长条状或块状渐变，而非破碎的纹理。",
    "若为刻面/雕花/水晶玻璃（如醒酒器、香水瓶）：光影限定：必须引入“具有细腻条纹或网格图案的侧光”，利用光线的破碎感穿透复杂切面，产生“五彩缤纷、错综复杂”的折射图案。",
    "> 输出格式：单行文本精修提示词，中文描述,不要输出json，直接输出文本即可。",
    "",
    "背景指令：请确保精修后的图片背景为纯白色（#FFFFFF），去除原图中的背景杂物，实现干净的电商白底图效果。",
  ].join("\n")

  const backgroundOverride =
    params.backgroundSetting === "white"
      ? ""
      : `\n\n补充背景指令：以上白底背景要求以本次背景设置为准。${buildRefinementAnalysisBackgroundInstruction(params.backgroundSetting)}`

  const requirementsBlock = requirementText
    ? `\n\n用户补充要求：请在不违反以上硬性约束的前提下，将以下要求自然融合进最终输出的单行中文精修提示词中：${requirementText}`
    : ""

  return `${whiteModePrompt}${backgroundOverride}${requirementsBlock}`
}

function extractChatTextFromResponse(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item
        if (typeof item?.text === "string") return item.text
        return ""
      })
      .filter(Boolean)
      .join("\n")
      .trim()
  }
  return ""
}

function normalizeRefinementAnalysisOutput(rawText: string): string {
  let text = String(rawText || "").trim()
  if (!text) return ""

  text = text
    .replace(/^```[a-zA-Z]*\s*/g, "")
    .replace(/\s*```$/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^(最终提示词|提示词|精修提示词|输出提示词)\s*[:：]\s*/i, "")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()

  return text
}

async function prepareRefinementStudioInputImage(params: {
  imageUrl: string
  requestOrigin?: string
}) {
  const normalizedInputUrl = await normalizeImageInputUrl(String(params.imageUrl || ""), params.requestOrigin || "")
  if (!normalizedInputUrl) {
    throw new Error("缺少有效的产品图")
  }

  await verifyImageReachable(normalizedInputUrl)
  return normalizedInputUrl
}

export async function resolveMerchantDefaultImageEditRuntimeModel(params: {
  merchantId?: string | null
  preferredProviderKey?: string | null
}): Promise<string | null> {
  const preferredProviderKey = String(params.preferredProviderKey || "").trim().toLowerCase()
  const picked = listEnvModelConfigs("IMAGE").find((model) => {
    const providerKey = String(model.provider?.key || model.providerId || "").trim().toLowerCase()
    return !preferredProviderKey || providerKey === preferredProviderKey
  }) || listEnvModelConfigs("IMAGE")[0]
  if (!picked?.modelId) return null
  return buildModelRuntimeId(picked.modelId, picked.provider?.key || picked.providerId || "image")
}

export async function listRefinementStudioModels(merchantId: string | null): Promise<RefinementStudioModelSettingsPayload> {
  const seen = new Set<string>()
  const imageModels: RefinementStudioModelOption[] = listEnvModelConfigs("IMAGE")
    .flatMap((row) => {
      const providerKey = String(row.provider?.key || row.providerId || row.id).trim()
      const modelId = String(row.modelId || "").trim()
      if (!providerKey || !modelId) return []
      const runtimeId = buildModelRuntimeId(modelId, providerKey)
      if (seen.has(runtimeId)) return []
      seen.add(runtimeId)
      return [
        {
          id: runtimeId,
          runtimeId,
          modelId,
          name: String(row.name || modelId).trim() || modelId,
          category: "image" as const,
          providerLabel: String(row.provider?.name || row.provider?.key || "").trim(),
          cost: Number(row.cost || 0),
        },
      ]
    })

  const preferredRuntimeId = String(
    (await resolveMerchantDefaultImageEditRuntimeModel({ merchantId })) || imageModels[0]?.runtimeId || ""
  ).trim()

  return {
    imageModel: imageModels.find((item) => item.runtimeId === preferredRuntimeId) || imageModels[0] || null,
    imageModels: imageModels.map((item) => ({ ...item, isDefault: item.runtimeId === preferredRuntimeId })),
  }
}

export async function analyzeRefinementStudioPrompt(params: {
  merchantId: string | null
  requestOrigin?: string
  imageUrl: string
  requirements?: string
  settings: Pick<RefinementStudioSettings, "backgroundSetting" | "aspectRatio" | "imageSize">
}) {
  const normalizedInputUrl = await prepareRefinementStudioInputImage({
    imageUrl: params.imageUrl,
    requestOrigin: params.requestOrigin,
  })

  const backgroundSetting = normalizeRefinementStudioBackgroundSetting(params.settings.backgroundSetting)
  const fallbackPrompt = buildRefinementFallbackPrompt({
    requirements: String(params.requirements || "").trim(),
    backgroundSetting,
    aspectRatio: String(params.settings.aspectRatio || DEFAULT_REFINEMENT_STUDIO_SETTINGS.aspectRatio).trim(),
    imageSize: String(params.settings.imageSize || DEFAULT_REFINEMENT_STUDIO_SETTINGS.imageSize).trim(),
  })

  try {
    const candidate = await resolveRefinementAnalysisModelCandidate(params.merchantId)
    if (!candidate?.provider || !candidate.modelId) {
      throw new Error("未配置【产品分析模型】，请先在后台配置“产品分析模型”聊天模型")
    }

    const credentials = resolveProviderCredentials(candidate.provider)
    const apiKey = String(credentials.apiKey || "").trim()
    const baseUrl = credentials.baseUrl || candidate.provider?.baseUrl || undefined

    if (!apiKey) {
      throw new Error(`产品分析模型服务商(${candidate.provider?.name || candidate.provider?.key || "未命名服务商"})未配置可用凭证`)
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
          content: [
            {
              type: "text",
              text: buildRefinementAnalysisPrompt({
                requirements: String(params.requirements || "").trim(),
                backgroundSetting,
              }),
            },
            {
              type: "image_url",
              image_url: { url: normalizedInputUrl },
            },
          ],
        },
      ],
      getAgentAnalysisChatOptions({
        modelId: candidate.modelId,
        temperature: 0.4,
        maxTokens: 8192,
      })
    )

    const prompt = normalizeRefinementAnalysisOutput(extractChatTextFromResponse(response))
    if (!prompt) {
      return {
        imageUrl: normalizedInputUrl,
        prompt: fallbackPrompt,
        analysisModelId: candidate.modelId,
        analysisProvider: String(candidate.provider?.key || "openai-compatible").trim(),
      }
    }

    return {
      imageUrl: normalizedInputUrl,
      prompt,
      analysisModelId: candidate.modelId,
      analysisProvider: String(candidate.provider?.key || "openai-compatible").trim(),
    }
  } catch (error) {
    console.warn("[refinement-studio] prompt analysis failed, fallback to direct prompt", error)
    return {
      imageUrl: normalizedInputUrl,
      prompt: fallbackPrompt,
      analysisModelId: "",
      analysisProvider: "",
    }
  }
}

export async function generateRefinementStudioImage(params: {
  merchantId: string | null
  requestOrigin?: string
  imageUrl: string
  prompt: string
  settings: Pick<RefinementStudioSettings, "imageModelId" | "backgroundSetting" | "aspectRatio" | "imageSize" | "speedMode">
}) {
  const normalizedInputUrl = await prepareRefinementStudioInputImage({
    imageUrl: params.imageUrl,
    requestOrigin: params.requestOrigin,
  })

  const models = await listRefinementStudioModels(params.merchantId)
  const runtimeId = String(params.settings.imageModelId || models.imageModel?.runtimeId || "").trim()
  if (!runtimeId) {
    throw new Error("未配置【图片精修】模型，请先在后台配置 usageScene=IMAGE_EDIT 的图片模型")
  }

  const effectiveModelConfig = await getEffectiveModelConfig(runtimeId, params.merchantId)
  const resolvedProvider = effectiveModelConfig?.provider || null
  const resolvedModelId = String(effectiveModelConfig?.modelId || "").trim()
  if (!resolvedProvider || !resolvedModelId) {
    throw new Error(`图片精修模型不可用: ${runtimeId}`)
  }

  const credentials = resolveProviderCredentials(resolvedProvider)
  const providerKey = String(credentials.providerKey || resolvedProvider.key || "").trim().toLowerCase()
  const quality = resolveQualityFromSpeedMode(params.settings.speedMode || "standard")
  const backgroundSetting = normalizeRefinementStudioBackgroundSetting(params.settings.backgroundSetting)
  const prompt = String(params.prompt || "").trim()
  if (!prompt) {
    throw new Error("缺少有效的精修提示词")
  }
  const rawResult = await modelRouter.generateWithDbCredentials(prompt, resolvedModelId, resolvedProvider, {
    referenceImages: [normalizedInputUrl],
    aspectRatio: params.settings.aspectRatio,
    imageSize: params.settings.imageSize,
    quality,
    background: backgroundSetting === "transparent" ? "transparent" : "opaque",
  }, "image")
  const rawUrl = normalizeImageResultUrl(rawResult)

  const normalizedUrl = normalizeImageResultUrl({ imageUrl: rawUrl, imageBase64: rawUrl })
  if (!normalizedUrl) {
    throw new Error("图片精修模型返回了空结果")
  }

  return {
    url: await persistGeneratedImageIfNeeded(normalizedUrl),
    prompt,
    modelId: resolvedModelId,
    provider: String(providerKey || resolvedProvider.key || "").trim(),
  }
}

export async function refineRefinementStudioImage(params: {
  merchantId: string | null
  requestOrigin?: string
  imageUrl: string
  requirements?: string
  settings: Pick<RefinementStudioSettings, "imageModelId" | "backgroundSetting" | "aspectRatio" | "imageSize" | "speedMode">
}) {
  const analysis = await analyzeRefinementStudioPrompt({
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    imageUrl: params.imageUrl,
    requirements: params.requirements,
    settings: {
      backgroundSetting: params.settings.backgroundSetting,
      aspectRatio: params.settings.aspectRatio,
      imageSize: params.settings.imageSize,
    },
  })

  const result = await generateRefinementStudioImage({
    merchantId: params.merchantId,
    requestOrigin: params.requestOrigin,
    imageUrl: analysis.imageUrl,
    prompt: analysis.prompt,
    settings: params.settings,
  })

  return {
    ...result,
    prompt: analysis.prompt,
    analysisModelId: analysis.analysisModelId,
  }
}
