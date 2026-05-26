export const CLOTHING_STUDIO_STORAGE_KEY = "ideart:clothing-studio:workspace"
export const CLOTHING_STUDIO_MAX_PRODUCT_IMAGES = 6
export const CLOTHING_STUDIO_MAX_OUTPUT_COUNT = 15
export const CLOTHING_STUDIO_MAX_TRYON_OUTPUT_COUNT = 15

export type ClothingStudioStep = "input" | "analyzing" | "preview" | "generating" | "complete"
export type ClothingStudioMode = "tryon" | "basic"
export type ClothingStudioSpeedMode = "standard" | "fast" | "turbo"
export type ClothingStudioImageStatus = "pending" | "prompting" | "generating" | "done" | "error" | "cancelled"
export type ClothingStudioWhiteRefineView = "front" | "back"
export type ClothingStudioTryOnGender = "female" | "male" | "androgynous"

export type ClothingStudioBasicSelections = {
  whiteRefineEnabled: boolean
  whiteRefineView: ClothingStudioWhiteRefineView
  threeDimensionalEnabled: boolean
  threeDimensionalWithWhiteBase: boolean
  mannequinEnabled: boolean
  mannequinWithWhiteBase: boolean
  detailCloseupCount: number
  sellingPointCount: number
}

export type ClothingStudioTryOnSelections = {
  modelGender: ClothingStudioTryOnGender
  catalogCount: number
  lifestyleCount: number
  campaignCount: number
  detailCount: number
}

export type ClothingStudioPlanCategory =
  | "white-refine"
  | "three-dimensional"
  | "mannequin"
  | "detail-closeup"
  | "selling-point"
  | "tryon-catalog"
  | "tryon-lifestyle"
  | "tryon-campaign"
  | "tryon-detail"

export type ClothingStudioPlan = {
  id: string
  category: ClothingStudioPlanCategory
  order: number
  title: string
  description: string
  designContent: string
  promptHint?: string
}

export type ClothingStudioAnalysisResult = {
  summary: string
  images: ClothingStudioPlan[]
  imageUnderstandingText?: string
  modelId?: string
  provider?: string
  usage?: {
    total_tokens?: number
    prompt_tokens?: number
    completion_tokens?: number
  }
}

export type ClothingStudioJobStatus = "processing" | "success" | "failed"

export type ClothingStudioAnalysisJobAiRequest = {
  model: string
  contents: Array<{
    role: string
    parts: Array<
      | { text: string }
      | {
          inlineData: {
            data: string
            mimeType: string
          }
        }
    >
  }>
  provider?: string
  generationConfig?: {
    temperature: number
    maxOutputTokens: number
    responseMimeType?: string
  }
}

type ClothingStudioBaseJobRecord = {
  id: string
  user_id: string
  status: ClothingStudioJobStatus
  result_url: string | null
  error_message: string | null
  is_refunded: boolean
  cost_amount: number
  created_at: string
  updated_at: string
  trace_id: string | null
  client_job_id: string | null
  fe_attempt: number
  be_retry: number
  duration_ms: number | null
  error_code: string | null
  gen_model: string
  gen_resolution: string
  is_turbo: boolean
  gen_family: string
  clothing_mode: string | null
  workflow_mode: string | null
  speed_mode: string
  worker_id: string
  provider_meta: Record<string, unknown> | null
}

export type ClothingStudioAnalysisJobRecord = ClothingStudioBaseJobRecord & {
  type: "ANALYSIS"
  payload: {
    ai_request?: ClothingStudioAnalysisJobAiRequest
    imageCount: number
    uiLanguage: string
    clothingMode: string
    productImage: string
    requirements: string
    productImages: string[]
    targetLanguage: string
    promptConfigKey: string
    modelImage?: string
    refinedViews?: string[]
    threeDEnabled?: boolean
    threeDWhiteBackground?: boolean
    mannequinEnabled?: boolean
    mannequinWhiteBackground?: boolean
    detailCount?: number
    sellingPointCount?: number
  }
  result_data: Record<string, unknown> | null
}

export type ClothingStudioImageJobResult = {
  unit: string | null
  count: string
  result: string[]
  status: number
  message: string
  created_at?: string
  updated_at?: string
  image_mime_type?: string
  oss_path?: string
  oss_url?: string
  thumbnail_url?: string
  task_id?: string
  request?: {
    size?: string
    urls?: string[]
    prompt?: string
    aspectRatio?: string
  }
}

export type ClothingStudioImageJobRecord = ClothingStudioBaseJobRecord & {
  type: "IMAGE_GEN"
  payload: {
    batchId?: string
    planId?: string
    index?: number
    title?: string
    description?: string
    productImage: string
    productImages: string[]
    prompt: string
    model: string
    imageSize: string
    aspectRatio: string
    targetLanguage?: string
    requirements?: string
    workflowMode: "model" | "product"
    turboEnabled: boolean
    speedMode: string
    fe_attempt: number
    modelImage: string
  }
  result_data: ClothingStudioImageJobResult | null
}

export type ClothingStudioJobRecord = ClothingStudioAnalysisJobRecord | ClothingStudioImageJobRecord

export type ClothingStudioGeneratedPrompt = {
  title: string
  description: string
  prompt: string
}

export type ClothingStudioPromptGenerationResponse = {
  prompts: ClothingStudioGeneratedPrompt[]
  modelId?: string
  provider?: string
}

export type ClothingStudioGeneratedImage = {
  id: string
  planId: string
  index: number
  title: string
  status: ClothingStudioImageStatus
  url: string
  error?: string
  prompt?: string
  model?: string
  provider?: string
  category: ClothingStudioPlanCategory
}

export type ClothingStudioSettings = {
  textModelId: string
  imageModelId: string
  aspectRatio: string
  imageSize: string
  targetLanguage: string
  speedMode: ClothingStudioSpeedMode
}

export type ClothingStudioModelOption = {
  id: string
  runtimeId: string
  modelId: string
  name: string
  category: "chat" | "image"
  providerLabel: string
  cost: number
  isDefault?: boolean
}

export type ClothingStudioModelSettingsPayload = {
  textModel: ClothingStudioModelOption | null
  imageModel: ClothingStudioModelOption | null
  textModels: ClothingStudioModelOption[]
  imageModels: ClothingStudioModelOption[]
}

export const CLOTHING_STUDIO_ASPECT_RATIOS = [
  { value: "3:4", label: "3:4 竖版" },
  { value: "1:1", label: "1:1 正方形" },
  { value: "4:5", label: "4:5 详情主图" },
  { value: "16:9", label: "16:9 横版" },
] as const

export const CLOTHING_STUDIO_IMAGE_SIZES = [
  { value: "1K", label: "1K 标准" },
  { value: "2K", label: "2K 高清" },
  { value: "4K", label: "4K 超清" },
] as const

export const CLOTHING_STUDIO_TARGET_LANGUAGES = [
  { value: "none", label: "无文字(纯视觉)" },
  { value: "zh-CN", label: "中文(简体)" },
  { value: "zh-TW", label: "中文(繁体)" },
  { value: "en-US", label: "英语" },
  { value: "ja-JP", label: "日语" },
  { value: "ko-KR", label: "韩语" },
  { value: "de-DE", label: "德语" },
  { value: "fr-FR", label: "法语" },
  { value: "ar-SA", label: "阿拉伯语" },
  { value: "ru-RU", label: "俄语" },
  { value: "th-TH", label: "泰语" },
  { value: "id-ID", label: "印尼语" },
  { value: "vi-VN", label: "越南语" },
  { value: "ms-MY", label: "马来语" },
  { value: "es-ES", label: "西班牙语" },
  { value: "pt-PT", label: "葡萄牙语" },
  { value: "pt-BR", label: "巴西葡萄牙语" },
] as const

export const CLOTHING_STUDIO_SPEED_MODES: Array<{
  value: ClothingStudioSpeedMode
  label: string
  description: string
}> = [
  { value: "standard", label: "标准", description: "标准速度，积分消耗最低" },
  { value: "fast", label: "快速", description: "更快出图，适合高频试稿" },
  { value: "turbo", label: "极速", description: "最快速出图，适合方案探索" },
]

export const CLOTHING_STUDIO_TRYON_GENDERS = [
  { value: "female", label: "女模" },
  { value: "male", label: "男模" },
  { value: "androgynous", label: "中性" },
] as const

export const DEFAULT_CLOTHING_STUDIO_SETTINGS: ClothingStudioSettings = {
  textModelId: "",
  imageModelId: "",
  aspectRatio: "3:4",
  imageSize: "2K",
  targetLanguage: "none",
  speedMode: "standard",
}

export const DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS: ClothingStudioBasicSelections = {
  whiteRefineEnabled: true,
  whiteRefineView: "front",
  threeDimensionalEnabled: true,
  threeDimensionalWithWhiteBase: true,
  mannequinEnabled: false,
  mannequinWithWhiteBase: true,
  detailCloseupCount: 1,
  sellingPointCount: 0,
}

export const DEFAULT_CLOTHING_STUDIO_TRYON_SELECTIONS: ClothingStudioTryOnSelections = {
  modelGender: "female",
  catalogCount: 1,
  lifestyleCount: 1,
  campaignCount: 0,
  detailCount: 1,
}

export function clampClothingStudioOutputCount(
  value: unknown,
  max: number = CLOTHING_STUDIO_MAX_OUTPUT_COUNT
) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  const safeMax = Number.isFinite(max) ? Math.max(0, Math.round(max)) : CLOTHING_STUDIO_MAX_OUTPUT_COUNT
  return Math.max(0, Math.min(safeMax, Math.round(numeric)))
}

export function clampClothingStudioTryOnOutputCount(value: unknown) {
  return clampClothingStudioOutputCount(value, CLOTHING_STUDIO_MAX_TRYON_OUTPUT_COUNT)
}

export function normalizeClothingStudioBasicSelections(
  input: Partial<ClothingStudioBasicSelections> | null | undefined
): ClothingStudioBasicSelections {
  return {
    whiteRefineEnabled:
      typeof input?.whiteRefineEnabled === "boolean"
        ? input.whiteRefineEnabled
        : DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS.whiteRefineEnabled,
    whiteRefineView: input?.whiteRefineView === "back" ? "back" : DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS.whiteRefineView,
    threeDimensionalEnabled:
      typeof input?.threeDimensionalEnabled === "boolean"
        ? input.threeDimensionalEnabled
        : DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS.threeDimensionalEnabled,
    threeDimensionalWithWhiteBase:
      typeof input?.threeDimensionalWithWhiteBase === "boolean"
        ? input.threeDimensionalWithWhiteBase
        : DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS.threeDimensionalWithWhiteBase,
    mannequinEnabled:
      typeof input?.mannequinEnabled === "boolean"
        ? input.mannequinEnabled
        : DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS.mannequinEnabled,
    mannequinWithWhiteBase:
      typeof input?.mannequinWithWhiteBase === "boolean"
        ? input.mannequinWithWhiteBase
        : DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS.mannequinWithWhiteBase,
    detailCloseupCount: clampClothingStudioOutputCount(input?.detailCloseupCount),
    sellingPointCount: clampClothingStudioOutputCount(input?.sellingPointCount),
  }
}

export function normalizeClothingStudioTryOnSelections(
  input: Partial<ClothingStudioTryOnSelections> | null | undefined
): ClothingStudioTryOnSelections {
  return {
    modelGender:
      input?.modelGender === "male" || input?.modelGender === "androgynous"
        ? input.modelGender
        : DEFAULT_CLOTHING_STUDIO_TRYON_SELECTIONS.modelGender,
    catalogCount: clampClothingStudioTryOnOutputCount(input?.catalogCount),
    lifestyleCount: clampClothingStudioTryOnOutputCount(input?.lifestyleCount),
    campaignCount: clampClothingStudioTryOnOutputCount(input?.campaignCount),
    detailCount: clampClothingStudioTryOnOutputCount(input?.detailCount),
  }
}

export function resolveClothingStudioLanguageLabel(value: string) {
  const matched = CLOTHING_STUDIO_TARGET_LANGUAGES.find((item) => item.value === value)
  return matched?.label || value || "无文字(纯视觉)"
}

export function resolveClothingStudioShortLanguageCode(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized) return "none"
  if (normalized === "none") return "none"
  if (normalized.toLowerCase().startsWith("zh")) return "zh"
  const [head] = normalized.split("-")
  return head || normalized
}

export function resolveClothingStudioPromptConfigKey(mode: ClothingStudioMode, targetLanguage: string) {
  const shortLanguage = resolveClothingStudioShortLanguageCode(targetLanguage)
  if (mode === "tryon") {
    return `clothing_model_tryon_strategy_prompt_${shortLanguage}`
  }
  return `clothing_unified_analysis_prompt_${shortLanguage}`
}

export function resolveClothingStudioLegacyMode(mode: ClothingStudioMode) {
  return mode === "tryon" ? "model_strategy" : "product_analysis"
}

export function mapClothingStudioPlanCategoryToPromptType(category: ClothingStudioPlanCategory) {
  switch (category) {
    case "white-refine":
      return "refined"
    case "three-dimensional":
      return "3d"
    case "mannequin":
      return "mannequin"
    case "detail-closeup":
      return "detail"
    case "selling-point":
      return "selling-point"
    case "tryon-catalog":
      return "catalog"
    case "tryon-lifestyle":
      return "lifestyle"
    case "tryon-campaign":
      return "campaign"
    case "tryon-detail":
      return "detail"
    default:
      return ""
  }
}

export function resolveClothingStudioPlanCategoryFromPromptType(value: string): ClothingStudioPlanCategory | null {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return null

  switch (normalized) {
    case "refined":
    case "white-refine":
      return "white-refine"
    case "3d":
    case "three-dimensional":
      return "three-dimensional"
    case "mannequin":
      return "mannequin"
    case "detail":
    case "detail-closeup":
      return "detail-closeup"
    case "selling-point":
      return "selling-point"
    case "catalog":
    case "tryon-catalog":
      return "tryon-catalog"
    case "lifestyle":
    case "tryon-lifestyle":
      return "tryon-lifestyle"
    case "campaign":
    case "tryon-campaign":
      return "tryon-campaign"
    case "tryon-detail":
      return "tryon-detail"
    default:
      return null
  }
}

function normalizePlanText(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function createPlan(
  category: ClothingStudioPlanCategory,
  order: number,
  title: string,
  description: string,
  designContent: string,
  promptHint = ""
): ClothingStudioPlan {
  return {
    id: `clothing-plan-${category}-${order + 1}`,
    category,
    order,
    title,
    description,
    designContent,
    promptHint,
  }
}

export function resolveClothingStudioSelectedCount(params: {
  mode: ClothingStudioMode
  basicSelections: ClothingStudioBasicSelections
  tryOnSelections: ClothingStudioTryOnSelections
}) {
  if (params.mode === "basic") {
    return (
      (params.basicSelections.whiteRefineEnabled ? 1 : 0) +
      (params.basicSelections.threeDimensionalEnabled ? 1 : 0) +
      (params.basicSelections.mannequinEnabled ? 1 : 0) +
      params.basicSelections.detailCloseupCount +
      params.basicSelections.sellingPointCount
    )
  }

  return (
    params.tryOnSelections.catalogCount +
    params.tryOnSelections.lifestyleCount +
    params.tryOnSelections.campaignCount +
    params.tryOnSelections.detailCount
  )
}

export function buildClothingStudioPlanBlueprint(params: {
  mode: ClothingStudioMode
  basicSelections: ClothingStudioBasicSelections
  tryOnSelections: ClothingStudioTryOnSelections
  targetLanguage: string
}) {
  const plans: ClothingStudioPlan[] = []
  let order = 0

  if (params.mode === "basic") {
    if (params.basicSelections.whiteRefineEnabled) {
      const viewLabel = params.basicSelections.whiteRefineView === "back" ? "背面" : "正面"
      plans.push(
        createPlan(
          "white-refine",
          order++,
          `白底精修图 · ${viewLabel}`,
          `纯白背景下的${viewLabel}服装精修图，强调版型轮廓、面料质感和工艺细节。`,
          `以电商标准白底精修为目标，完整展示服装${viewLabel}，边缘干净，颜色准确，避免夸张透视。`,
          "背景纯白，保留真实材质纹理与立体阴影。"
        )
      )
    }

    if (params.basicSelections.threeDimensionalEnabled) {
      plans.push(
        createPlan(
          "three-dimensional",
          order++,
          "3D立体效果图",
          "构建立体层次和空间感，适合展示服装轮廓、体积感与材质层次。",
          "以高级电商立体展示的方式表现服装，增强体积感、层次感和视觉冲击力，但不能改变服装真实结构。",
          params.basicSelections.threeDimensionalWithWhiteBase ? "可以带轻微白底承托或纯净展台感。" : "不需要白底承托，可使用简洁空间背景。"
        )
      )
    }

    if (params.basicSelections.mannequinEnabled) {
      plans.push(
        createPlan(
          "mannequin",
          order++,
          "人台展示图",
          "使用专业人台展示服装穿着轮廓，适合展示版型、垂坠感和整体上身效果。",
          "将服装放置在专业中性人台上，展示完整版型和穿着轮廓，保持服装结构、褶皱和垂感真实。",
          params.basicSelections.mannequinWithWhiteBase ? "背景保持纯净，适合商品详情页排版。" : "可用轻微空间层次背景。"
        )
      )
    }

    for (let index = 0; index < params.basicSelections.detailCloseupCount; index += 1) {
      plans.push(
        createPlan(
          "detail-closeup",
          order++,
          `细节特写图 ${index + 1}`,
          "突出面料、走线、纽扣、领口、袖口、蕾丝或其他关键工艺细节。",
          "使用近景特写镜头，放大展示服装最重要的材质、纹理和工艺细节，强调真实质感。",
          "镜头聚焦于最能体现品质的部位，避免主体模糊。"
        )
      )
    }

    for (let index = 0; index < params.basicSelections.sellingPointCount; index += 1) {
      plans.push(
        createPlan(
          "selling-point",
          order++,
          `卖点展示图 ${index + 1}`,
          "突出核心卖点和消费场景，可适度加入标题式文案版式。",
          "围绕服装的核心卖点做营销型构图，突出价值点、质感和购买动机，画面可保留少量电商式信息层级。",
          `文案语言偏好：${resolveClothingStudioLanguageLabel(params.targetLanguage)}。如果是纯视觉模式，则不要额外加字。`
        )
      )
    }

    return plans
  }

  const genderLabel =
    params.tryOnSelections.modelGender === "male"
      ? "男模"
      : params.tryOnSelections.modelGender === "androgynous"
        ? "中性模特"
        : "女模"

  for (let index = 0; index < params.tryOnSelections.catalogCount; index += 1) {
    plans.push(
      createPlan(
        "tryon-catalog",
        order++,
        `棚拍试穿图 ${index + 1}`,
        `${genderLabel}在电商棚拍环境中完整展示服装穿着效果，重点表现版型、长度和上身比例。`,
        `使用${genderLabel}完成标准电商棚拍试穿，画面简洁、主体明确，服装需完整且真实地穿在模特身上。`,
        "构图优先完整展示服装，避免夸张时尚片处理。"
      )
    )
  }

  for (let index = 0; index < params.tryOnSelections.lifestyleCount; index += 1) {
    plans.push(
      createPlan(
        "tryon-lifestyle",
        order++,
        `场景穿搭图 ${index + 1}`,
        `${genderLabel}在生活化场景中试穿服装，突出穿搭氛围、适用场景和品牌调性。`,
        `让${genderLabel}穿着服装进入符合产品调性的场景，如通勤、咖啡馆、街拍或家居环境，呈现自然生活方式氛围。`,
        "保留服装主体识别度，避免场景喧宾夺主。"
      )
    )
  }

  for (let index = 0; index < params.tryOnSelections.campaignCount; index += 1) {
    plans.push(
      createPlan(
        "tryon-campaign",
        order++,
        `广告大片图 ${index + 1}`,
        `${genderLabel}穿着服装完成更强视觉张力的广告大片，适合做首屏主视觉或品牌海报。`,
        `以高端时尚广告的方式呈现${genderLabel}试穿效果，突出气质、层次与品牌感，但不能改变服装真实样式和颜色。`,
        "可以强化光影和氛围，但不能牺牲服装细节。"
      )
    )
  }

  for (let index = 0; index < params.tryOnSelections.detailCount; index += 1) {
    plans.push(
      createPlan(
        "tryon-detail",
        order++,
        `上身细节图 ${index + 1}`,
        `展示${genderLabel}试穿时的面料垂感、局部工艺、领口袖口或腰线等关键细节。`,
        "使用局部特写镜头表现服装穿上身后的质感和细节，强调贴合度、垂感与做工品质。",
        "既要看到上身状态，也要让细节足够清晰。"
      )
    )
  }

  return plans
}

function buildFallbackSummary(mode: ClothingStudioMode, targetLanguage: string) {
  const language = resolveClothingStudioLanguageLabel(targetLanguage)
  return [
    `## ${mode === "basic" ? "基础套图" : "模特试穿"}生成策略`,
    "",
    `- 输出语言：${language}`,
    "- 保持服装款式、版型、面料颜色、花纹、logo 与关键工艺完全一致。",
    "- 优先保证电商可用性，画面干净、信息清晰、适合详情页或商品主图链路。",
    "- 强化材质与结构表达，避免服装被背景、道具或模特动作遮挡。",
  ].join("\n")
}

export function normalizeClothingStudioAnalysisResult(
  input: any,
  options: {
    mode: ClothingStudioMode
    basicSelections: ClothingStudioBasicSelections
    tryOnSelections: ClothingStudioTryOnSelections
    targetLanguage: string
  }
): ClothingStudioAnalysisResult {
  const blueprint = buildClothingStudioPlanBlueprint(options)
  const rawPlans = Array.isArray(input?.images) ? input.images : []

  const images = blueprint.map((fallbackPlan, index) => {
    const source =
      rawPlans.find((item: any) => String(item?.id || "").trim() === fallbackPlan.id) ||
      rawPlans.find((item: any) => String(item?.category || "").trim() === fallbackPlan.category) ||
      rawPlans[index] ||
      {}

    return {
      id: String(source?.id || "").trim() || fallbackPlan.id,
      category: (String(source?.category || "").trim() as ClothingStudioPlanCategory) || fallbackPlan.category,
      order:
        typeof source?.order === "number" && Number.isFinite(source.order)
          ? source.order
          : fallbackPlan.order,
      title: normalizePlanText(source?.title) || fallbackPlan.title,
      description: normalizePlanText(source?.description) || fallbackPlan.description,
      designContent:
        normalizePlanText(source?.designContent || source?.design_content) || fallbackPlan.designContent,
      promptHint: normalizePlanText(source?.promptHint || source?.prompt_hint) || fallbackPlan.promptHint,
    }
  })

  return {
    summary:
      String(input?.summary || input?.design_specs || input?.designSpecs || "").trim() ||
      buildFallbackSummary(options.mode, options.targetLanguage),
    images,
    imageUnderstandingText: String(input?.imageUnderstandingText || input?.image_understanding_text || "").trim(),
    modelId: String(input?.modelId || input?.model_id || "").trim(),
    provider: String(input?.provider || "").trim(),
    usage:
      input?.usage && typeof input.usage === "object"
        ? {
            total_tokens: Number((input.usage as { total_tokens?: unknown }).total_tokens || 0) || undefined,
            prompt_tokens: Number((input.usage as { prompt_tokens?: unknown }).prompt_tokens || 0) || undefined,
            completion_tokens: Number((input.usage as { completion_tokens?: unknown }).completion_tokens || 0) || undefined,
          }
        : undefined,
  }
}

export function buildClothingStudioGeneratedPlaceholders(plans: ClothingStudioPlan[]) {
  return plans.map(
    (plan, index): ClothingStudioGeneratedImage => ({
      id: plan.id,
      planId: plan.id,
      index,
      title: plan.title,
      status: "pending",
      url: "",
      error: "",
      prompt: "",
      model: "",
      provider: "",
      category: plan.category,
    })
  )
}

export function buildClothingStudioImageFilename(index: number, title: string) {
  const safeTitle = String(title || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48)
  return `clothing-studio-${String(index + 1).padStart(2, "0")}${safeTitle ? `-${safeTitle}` : ""}.png`
}
