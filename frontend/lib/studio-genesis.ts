export const STUDIO_GENESIS_STORAGE_KEY = "ideart:studio-genesis:workspace"
export const STUDIO_GENESIS_MAX_PRODUCT_IMAGES = 6
export const STUDIO_GENESIS_MAX_PLAN_COUNT = 15

export type StudioGenesisStep = "input" | "analyzing" | "preview" | "generating" | "complete"
export type StudioGenesisWorkflowMode = "product" | "knowledge"
export type StudioGenesisSpeedMode = "standard" | "fast" | "turbo"
export type StudioGenesisImageStatus = "pending" | "prompting" | "generating" | "done" | "error" | "cancelled"

export type StudioGenesisPlan = {
  id: string
  title: string
  description: string
  designContent: string
  promptHint?: string
}

export type StudioGenesisAnalysisResult = {
  isComplexProduct?: boolean
  designSpecs: string
  images: StudioGenesisPlan[]
  imageUnderstandingText?: string
  modelId?: string
  provider?: string
}

export type StudioGenesisAnalysisJobStatus = "processing" | "success" | "failed"

export type StudioGenesisAiWriteOption = {
  prompt_text: string
}

export type StudioGenesisAiWriteTiming = {
  total_ms?: number
  queue_wait_ms?: number
  ai_call_total_ms?: number
  config_refresh_ms?: number
}

export type StudioGenesisAiWriteResult = {
  _timing?: StudioGenesisAiWriteTiming
  options: StudioGenesisAiWriteOption[]
}

export type StudioGenesisAnalysisNotification = {
  id: string
  step: string
  message: string
  status: StudioGenesisAnalysisJobStatus
  createdAt: string
}

export type StudioGenesisAnalysisJobAiRequest = {
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
    responseMimeType: string
    thinkingConfig?: {
      thinkingBudget: number
    }
  }
}

export type StudioGenesisAiWriteJobAiRequest = StudioGenesisAnalysisJobAiRequest

export type StudioGenesisImageJobResult = {
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

export type StudioGenesisAnalysisJobRecord = {
  id: string
  user_id: string
  type: "ANALYSIS"
  status: StudioGenesisAnalysisJobStatus
  payload: {
    trace_id: string
    imageType: "main" | "detail"
    imageCount: number
    uiLanguage: string
    productImage: string
    requirements: string
    productImages: string[]
    project_id: string | null
    targetPlatform: string
    workflowMode?: StudioGenesisWorkflowMode
    portraitImage?: string
    referenceImages?: string[]
    targetLanguage: string
    promptConfigKey: string
    ai_request?: StudioGenesisAnalysisJobAiRequest
  }
  result_data: StudioGenesisAnalysisResult | null
  result_url: string | null
  error_message: string | null
  is_refunded: boolean
  cost_amount: number
  created_at: string
  updated_at: string
  trace_id: string
  project_id: string | null
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
  workflow_mode: StudioGenesisWorkflowMode | null
  speed_mode: string
  worker_id: string
  provider_meta: Record<string, unknown> | null
  notifications: StudioGenesisAnalysisNotification[]
}

export type StudioGenesisAiWriteJobRecord = {
  id: string
  user_id: string
  type: "AI_WRITE"
  status: StudioGenesisAnalysisJobStatus
  payload: {
    imageType: "main" | "detail"
    uiLanguage: string
    productImage: string
    productImages: string[]
    project_id: string | null
    targetPlatform: string
    promptConfigKey: string
    ai_request?: StudioGenesisAiWriteJobAiRequest
  }
  result_data: StudioGenesisAiWriteResult | null
  result_url: string | null
  error_message: string | null
  is_refunded: boolean
  cost_amount: number
  created_at: string
  updated_at: string
  trace_id: string | null
  project_id: string | null
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
  workflow_mode: StudioGenesisWorkflowMode | null
  speed_mode: string
  worker_id: string
  provider_meta: Record<string, unknown> | null
}

export type StudioGenesisImageJobRecord = {
  id: string
  user_id: string
  type: "IMAGE_GEN"
  status: StudioGenesisAnalysisJobStatus
  payload: {
    model: string
    prompt: string
    gpt_size?: string
    gpt_quality?: string
    metadata?: Record<string, unknown> | null
    trace_id: string | null
    imageSize: string
    imageType: "main" | "detail"
    speedMode: string
    fe_attempt: number
    imageCount: number
    project_id: string | null
    aspectRatio: string
    productImage: string
    turboEnabled: boolean
    client_job_id: string | null
    productImages: string[]
    isNewUserTrial?: boolean
    _ef_preprocess_ms?: number
  }
  result_data: StudioGenesisImageJobResult | null
  result_url: string | null
  error_message: string | null
  is_refunded: boolean
  cost_amount: number
  created_at: string
  updated_at: string
  trace_id: string | null
  project_id: string | null
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
  workflow_mode: StudioGenesisWorkflowMode | null
  speed_mode: string
  worker_id: string
  provider_meta: Record<string, unknown> | null
}

export type StudioGenesisJobRecord =
  | StudioGenesisAnalysisJobRecord
  | StudioGenesisAiWriteJobRecord
  | StudioGenesisImageJobRecord

export type StudioGenesisGeneratedImage = {
  id: string
  planId: string
  index: number
  jobId?: string
  title: string
  status: StudioGenesisImageStatus
  url: string
  error?: string
  prompt?: string
  model?: string
  provider?: string
}

export type StudioGenesisSettings = {
  textModelId: string
  imageModelId: string
  aspectRatio: string
  imageSize: string
  imageCount: number
  targetLanguage: string
  speedMode: StudioGenesisSpeedMode
}

export type StudioGenesisModelOption = {
  id: string
  runtimeId: string
  modelId: string
  name: string
  category: "chat" | "image"
  providerLabel: string
  cost: number
  isDefault?: boolean
}

export type StudioGenesisModelSettingsPayload = {
  textModel: StudioGenesisModelOption | null
  imageModel: StudioGenesisModelOption | null
  textModels: StudioGenesisModelOption[]
  imageModels: StudioGenesisModelOption[]
}

export const STUDIO_GENESIS_ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 方图" },
  { value: "4:5", label: "4:5 详情主图" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "9:16", label: "9:16 长图" },
  { value: "16:9", label: "16:9 横版" },
] as const

export const STUDIO_GENESIS_IMAGE_SIZES = [
  { value: "1K", label: "1K 标准" },
  { value: "2K", label: "2K 高清" },
  { value: "4K", label: "4K 超清" },
] as const

export const STUDIO_GENESIS_TARGET_LANGUAGES = [
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

export const STUDIO_GENESIS_SPEED_MODES: Array<{
  value: StudioGenesisSpeedMode
  label: string
  description: string
}> = [
  { value: "standard", label: "标准", description: "标准速度，积分消耗最低" },
  { value: "fast", label: "快速", description: "更快出图，适合高频试稿" },
  { value: "turbo", label: "极速", description: "更快出图，适合快速试稿。" },
]

export const DEFAULT_STUDIO_GENESIS_SETTINGS: StudioGenesisSettings = {
  textModelId: "",
  imageModelId: "",
  aspectRatio: "3:4",
  imageSize: "2K",
  imageCount: 1,
  targetLanguage: "none",
  speedMode: "standard",
}

export function clampStudioGenesisImageCount(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_STUDIO_GENESIS_SETTINGS.imageCount
  return Math.max(1, Math.min(STUDIO_GENESIS_MAX_PLAN_COUNT, Math.round(numeric)))
}

export function resolveStudioGenesisLanguageLabel(value: string) {
  const matched = STUDIO_GENESIS_TARGET_LANGUAGES.find((item) => item.value === value)
  return matched?.label || value || "无文字(纯视觉)"
}

export function resolveStudioGenesisShortLanguageCode(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized) return "none"
  if (normalized === "none") return "none"
  if (normalized.toLowerCase().startsWith("zh")) return "zh"
  const [head] = normalized.split("-")
  return head || normalized
}

export function resolveStudioGenesisPromptConfigKey(value: string) {
  return `batch_analysis_prompt_${resolveStudioGenesisShortLanguageCode(value)}`
}

export function createStudioGenesisPlanId(index: number) {
  return `sg-plan-${index + 1}`
}

function buildKnowledgeFallbackPlan(index: number): StudioGenesisPlan {
  const presets: StudioGenesisPlan[] = [
    {
      id: createStudioGenesisPlanId(0),
      title: "主视觉封面",
      description: "课程套图的首屏主海报，先建立讲师信任感，再建立课程价值与报名欲望。",
      designContent: "课程主视觉封面页。优先使用老师人物锚点图或与课程相关的沉浸式主场景，建立高级、可信、可报名的第一印象。推荐使用大面积主视觉照片配合顶部或底部波浪切面、圆形聚焦母题、短主标题、副标题和1-2个强背书数据，像成熟课程招生封面而不是普通电商图。",
      promptHint: "封面要像专业课程销售首页：强主视觉、大标题、短副标题、少量背书徽章，整体留白干净。",
    },
    {
      id: createStudioGenesisPlanId(1),
      title: "导师介绍页",
      description: "展示讲师专业形象、身份标签和成果规模，是整套海报里最强的人物背书页。",
      designContent: "导师介绍页。重点突出老师半身或全身正面形象、身份标签、从业年限、培训规模、成果数据与教学风格。人物形象必须与锚点图保持同一人，并延续整套海报的暖色疗愈氛围。适合深色背景或带氛围虚化的课堂环境，配少量数据徽章与简介文案。",
      promptHint: "这一页以人物为绝对主角，做高信任感导师页，突出身份标签、年限、学员规模和教学风格。",
    },
    {
      id: createStudioGenesisPlanId(2),
      title: "核心亮点页",
      description: "用编号卡片提炼课程最强卖点，快速回答用户为什么值得报名。",
      designContent: "课程亮点页。将课程核心优势拆成3-4个清晰的卖点模块，优先使用大编号、圆角卡片、交替深浅底块或气泡式信息框，形成一眼能扫完的信息结构。页面应保持轻排版、重节奏，不要堆成长段说明。",
      promptHint: "参考成熟课程样张中的编号亮点页，使用大数字、胶囊卡片、短句卖点和深浅交替卡片。",
    },
    {
      id: createStudioGenesisPlanId(3),
      title: "适配人群页",
      description: "回答谁最适合报名，帮助潜在学员快速代入自己的身份与需求。",
      designContent: "适配人群页。适合使用居中的标题结构、拱形或半圆背景切面、3个左右的横向胶囊标题和简短解释文案，让不同受众一眼找到自己的位置。整体视觉要轻盈、整洁、具备课程招生感。",
      promptHint: "这一页偏信息筛选，适合用3段式横向胶囊模块呈现目标学员，而不是做复杂场景图。",
    },
    {
      id: createStudioGenesisPlanId(4),
      title: "课程内容总览页",
      description: "展示课程前半段或基础模块，让用户看到体系化内容和学习颗粒度。",
      designContent: "课程内容总览页。适合用一个大圆角信息板承载 3-4 条课程模块，模块采用编号条、短标题和一句解释，底部可配一张课堂/器物/操作场景图，形成“结构化课程 + 场景感”结合的版式。",
      promptHint: "参考课程大纲页模板：大圆角白色内容板、编号条模块、底部横向场景图，信息清楚又不死板。",
    },
    {
      id: createStudioGenesisPlanId(5),
      title: "进阶内容页",
      description: "承接前一页继续展开课程中后段、高阶模块或更深层的进阶内容。",
      designContent: "进阶内容页。延续课程总览页的版式母版，继续用大圆角信息板、编号模块和底部场景图展示进阶内容，强调学员会从入门过渡到深化应用、疗愈实践或更高阶的能力建立。",
      promptHint: "这一页与课程总览页形成上下承接，版式相似但内容升级，保持统一模板的续篇感。",
    },
    {
      id: createStudioGenesisPlanId(6),
      title: "变现实战页",
      description: "强调课程不只学知识，还能落地到职业、项目或商业变现。",
      designContent: "变现实战页。适合继续沿用课程内容模板，但把重点放在项目落地、实操应用、客户服务、商业化或职业发展路径上。文案要更结果导向，视觉上仍保持温暖、专业、可信赖的课程体系感。",
      promptHint: "把课程的落地与变现价值做得更明确，像“学完如何用起来、赚起来”的实战模块页。",
    },
    {
      id: createStudioGenesisPlanId(7),
      title: "状态卡点页",
      description: "先点出用户当下的困境与卡点，再为后续课程价值做情绪承接。",
      designContent: "状态卡点页。适合使用浅底拱形结构和多条横向对照信息条，左侧用较深色小胶囊概括痛点主题，右侧或下方用较浅色说明句解释具体困境。整体要像成熟课程中的“你是不是也有这些问题”页面。",
      promptHint: "这是一页典型问题识别页，用浅底、圆角条块、痛点标签和简明句式帮助用户迅速共鸣。",
    },
    {
      id: createStudioGenesisPlanId(8),
      title: "核心价值页",
      description: "把课程的整体价值再浓缩总结一次，强化‘这门课为什么值得学’。",
      designContent: "核心价值总结页。适合切换到更深的咖棕色背景，使用 3-4 张高对比信息卡或票据式卡片，提炼课程的友好度、实操度、进阶性和变现性。底部可叠加氛围感疗愈场景照片，增强情绪厚度。",
      promptHint: "这一页要更像价值总结海报，深色背景配白色卡片，形成强对比和更厚重的品牌感。",
    },
    {
      id: createStudioGenesisPlanId(9),
      title: "课程细节页",
      description: "用图标化模块讲清课程形式、服务、时间安排和交付体验。",
      designContent: "课程细节页。适合使用 2x2 图标圆形模块或四宫格信息结构，分别解释课程形式、时间安排、配套服务、惊喜权益等信息。视觉上应比前面页面更规整、更易读，像高质量课程宣传册中的细节说明页。",
      promptHint: "用四个圆形图标模块做课程细节页，强调形式、时间、服务和附加权益，排版要工整。",
    },
    {
      id: createStudioGenesisPlanId(10),
      title: "场景启发页",
      description: "展示课程内容如何进入学员的真实生活或课堂使用场景，增强可想象性。",
      designContent: "场景启发页。适合在浅色背景中使用 3-4 条场景化短句卖点，下方搭配三联图或多张小图，展示实际应用场景、动作细节、器物特写或课堂片段，让课程显得具体、可感知、可复制。",
      promptHint: "这页要像‘学完后生活里怎么用’的启发页，上面短句模块，下面三联图或场景拼图。",
    },
    {
      id: createStudioGenesisPlanId(11),
      title: "学完收获页",
      description: "系统总结学员学完以后能带走的能力、结果和身份升级。",
      designContent: "学完收获页。适合使用沉浸式实拍大图作为背景，叠加半透明编号条，列出 5-6 个学完后的具体收获，让页面兼具氛围感与信息密度。要像成熟课程套图里的结果清单页。",
      promptHint: "用氛围实拍背景叠加半透明编号条，列出学完可带走的能力与成果，兼顾质感和清晰度。",
    },
    {
      id: createStudioGenesisPlanId(12),
      title: "课程信息页",
      description: "作为整套海报的结尾页，集中给出课程名称、时间、形式和报名提示。",
      designContent: "课程信息页。适合做极简收尾，使用大面积纯色或轻纹理背景、居中标题、2-3 个大胶囊信息条和品牌/行动号召区域。页面应保持安静、干净、可信，承担最终转化收口作用。",
      promptHint: "结尾页保持极简，居中标题加大胶囊信息条，突出课程时间、形式和报名信息。",
    },
  ]

  return presets[index] || {
    id: createStudioGenesisPlanId(index),
    title: `课程页 ${index + 1}`,
    description: "围绕课程转化目标设计的知识付费海报页面。",
    designContent: "知识付费课程海报页面。保持讲师一致性、场景一致性与品牌统一感，承担清晰的信息转化角色。",
    promptHint: "保持讲师与系列风格一致，突出清晰页面职责。",
  }
}

export function buildStudioGenesisFallbackPlan(
  index: number,
  targetLanguage: string,
  workflowMode: StudioGenesisWorkflowMode = "product"
): StudioGenesisPlan {
  if (workflowMode === "knowledge") {
    return buildKnowledgeFallbackPlan(index)
  }

  const normalizedLanguage = String(targetLanguage || "").trim().toLowerCase()
  const isEnglish = normalizedLanguage === "en" || normalizedLanguage.startsWith("en-")
  return {
    id: createStudioGenesisPlanId(index),
    title: `${isEnglish ? "Visual" : "画面"} ${index + 1}`,
    description: isEnglish
      ? "Commercial product storytelling shot with a clear selling point."
      : "围绕核心卖点的商业详情页场景图。",
    designContent: isEnglish
      ? "Keep the product identity exact, strengthen material details, and present a clean conversion-oriented composition."
      : "保持商品外观完全一致，强化材质与细节，呈现清晰、利于转化的商业构图。",
    promptHint: "",
  }
}

function normalizeSingleLineText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function decodeEscapedMultilineText(value: string) {
  let text = String(value || "")

  for (let index = 0; index < 2; index += 1) {
    const next = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\\\\r\\\\n/g, "\n")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\\\t/g, "  ")
      .replace(/\\t/g, "  ")
      .replace(/\\u2022/g, "•")
      .replace(/\\\\\"/g, "\"")
      .replace(/\\"/g, "\"")
      .replace(/\\\\'/g, "'")
      .replace(/\\'/g, "'")
      .replace(/\\\//g, "/")

    text = next
  }

  return text
}

function normalizeMultilineText(value: unknown) {
  return decodeEscapedMultilineText(String(value || "")).trim()
}

function mergeUniqueNormalizedText(parts: unknown[], separator: string) {
  const seen = new Set<string>()
  const output: string[] = []

  parts.forEach((part) => {
    const normalized = normalizeMultilineText(part)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    output.push(normalized)
  })

  return output.join(separator)
}

function normalizeBooleanLike(value: unknown) {
  if (typeof value === "boolean") return value
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  return undefined
}

export function ensureStudioGenesisPlanCount(
  plans: StudioGenesisPlan[],
  requestedCount: number,
  targetLanguage: string,
  workflowMode: StudioGenesisWorkflowMode = "product"
) {
  const desiredCount = clampStudioGenesisImageCount(requestedCount)
  const normalized: Array<{
    id: string
    title: string
    description: string
    designContent: string
    promptHint: string
  }> = plans
    .map((plan, index) => {
      const fallback = buildStudioGenesisFallbackPlan(index, targetLanguage, workflowMode)
      const forceKnowledgePreset = workflowMode === "knowledge" && index < 13

      return {
        id: String(plan.id || "").trim() || createStudioGenesisPlanId(index),
        title:
          forceKnowledgePreset
            ? fallback.title
            : normalizeSingleLineText(plan.title) || fallback.title,
        description:
          forceKnowledgePreset
            ? fallback.description
            : normalizeSingleLineText(plan.description) || fallback.description,
        designContent:
          forceKnowledgePreset
            ? mergeUniqueNormalizedText([fallback.designContent, plan.designContent], "\n\n")
            : normalizeMultilineText(plan.designContent) || fallback.designContent,
        promptHint:
          forceKnowledgePreset
            ? mergeUniqueNormalizedText([fallback.promptHint, plan.promptHint], "\n")
            : normalizeMultilineText(plan.promptHint) || (fallback.promptHint || ""),
      }
    })
    .slice(0, desiredCount)

  while (normalized.length < desiredCount) {
    const fallback = buildStudioGenesisFallbackPlan(normalized.length, targetLanguage, workflowMode)
    normalized.push({
      id: fallback.id,
      title: fallback.title,
      description: fallback.description,
      designContent: fallback.designContent,
      promptHint: String(fallback.promptHint || ""),
    })
  }

  return normalized.map((plan, index) => ({
    ...plan,
    id: String(plan.id || "").trim() || createStudioGenesisPlanId(index),
  }))
}

export function normalizeStudioGenesisAnalysisResult(
  input: any,
  options?: {
    imageCount?: number
    targetLanguage?: string
    workflowMode?: StudioGenesisWorkflowMode
  }
): StudioGenesisAnalysisResult {
  const targetLanguage = String(options?.targetLanguage || DEFAULT_STUDIO_GENESIS_SETTINGS.targetLanguage).trim()
  const imageCount = clampStudioGenesisImageCount(options?.imageCount)
  const workflowMode: StudioGenesisWorkflowMode = options?.workflowMode === "knowledge" ? "knowledge" : "product"
  const rawPlans = Array.isArray(input?.images) ? input.images : []

  return {
    isComplexProduct: normalizeBooleanLike(input?.isComplexProduct ?? input?.is_complex_product),
    designSpecs: normalizeMultilineText(input?.designSpecs || input?.design_specs || ""),
    images: ensureStudioGenesisPlanCount(
      rawPlans.map((item: any, index: number) => ({
        id: String(item?.id || "").trim() || createStudioGenesisPlanId(index),
        title: String(item?.title || "").trim(),
        description: String(item?.description || "").trim(),
        designContent: normalizeMultilineText(item?.designContent || item?.design_content || ""),
        promptHint: normalizeMultilineText(item?.promptHint || item?.prompt_hint || ""),
      })),
      imageCount,
      targetLanguage,
      workflowMode
    ),
    imageUnderstandingText: normalizeMultilineText(input?.imageUnderstandingText || input?.image_understanding_text || ""),
    modelId: String(input?.modelId || input?.model_id || "").trim(),
    provider: String(input?.provider || "").trim(),
  }
}

export function buildStudioGenesisGeneratedPlaceholders(plans: StudioGenesisPlan[]) {
  return plans.map((plan, index): StudioGenesisGeneratedImage => ({
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
  }))
}

export function buildStudioGenesisImageFilename(index: number, title: string) {
  const safeTitle = String(title || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48)
  return `studio-genesis-${String(index + 1).padStart(2, "0")}${safeTitle ? `-${safeTitle}` : ""}.png`
}
