import { readFileSync } from "node:fs"
import path from "node:path"
import { OpenAICompatibleProvider } from "@/lib/models/openai-compatible"
import { buildModelRuntimeId, parseModelRuntimeId } from "@/lib/models/runtime-id"
import { getEffectiveModelConfig, listEnvModelConfigs, resolveMerchantSceneRuntimeModel } from "@/lib/models/fetcher"
import { resolveProviderCredentials } from "@/lib/models/provider-credentials"
import { createZenmuxChatProvider, isZenmuxProvider } from "@/lib/models/zenmux"
import { modelRouter } from "@/lib/models/router"
import { analyzeReferenceImagesWithGemini, buildImageUnderstandingPromptContext } from "@/lib/ai/gemini-image-understanding"
import { persistImageDataUrlToLocalUploads } from "@/lib/server/local-uploads"
import { normalizeModelImageInputUrls } from "@/lib/server/model-image-input"
import {
  clampStudioGenesisImageCount,
  DEFAULT_STUDIO_GENESIS_SETTINGS,
  STUDIO_GENESIS_MAX_PRODUCT_IMAGES,
  ensureStudioGenesisPlanCount,
  normalizeStudioGenesisAnalysisResult,
  resolveStudioGenesisLanguageLabel,
  type StudioGenesisAnalysisResult,
  type StudioGenesisModelOption,
  type StudioGenesisPlan,
  type StudioGenesisSettings,
  type StudioGenesisSpeedMode,
  type StudioGenesisWorkflowMode,
} from "@/lib/studio-genesis"

const PROMPTS_DIR = path.join(process.cwd(), "app/api/studio-genesis/prompts")
const TEXT_SCENES = ["STUDIO_GENESIS_TEXT", "GENERAL"] as const
const IMAGE_SCENES = ["STUDIO_GENESIS_IMAGE", "GENERAL"] as const

type ChatModelCandidate = {
  runtimeId: string
  modelId: string
  provider: any
}

type ChatMultimodalContentItem = {
  type: string
  text?: string
  image_url?: { url: string }
}

type AnalysisProgressReporter = (message: string, step?: string) => void

function absolutizeWithRequestOrigin(url: string, requestOrigin?: string) {
  const normalized = String(url || "").trim()
  if (!normalized) return ""
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("data:")) return normalized
  const origin = String(requestOrigin || "").trim().replace(/\/$/, "")
  if (!origin) return normalized
  return normalized.startsWith("/") ? `${origin}${normalized}` : `${origin}/${normalized}`
}

async function normalizeGenerationReferenceImages(referenceImages: string[], requestOrigin?: string) {
  const publicImages = Array.from(
    new Set(
      (Array.isArray(referenceImages) ? referenceImages : [])
        .map((item) => absolutizeWithRequestOrigin(item, requestOrigin))
        .filter(Boolean)
    )
  ).slice(0, STUDIO_GENESIS_MAX_PRODUCT_IMAGES)
  return normalizeModelImageInputUrls(publicImages, {
    requestOrigin,
    max: STUDIO_GENESIS_MAX_PRODUCT_IMAGES,
  })
}

function normalizeRequirementsPlainText(input: string, workflowMode: StudioGenesisWorkflowMode) {
  const maxChars = workflowMode === "knowledge" ? 5200 : 2600
  const maxLines = workflowMode === "knowledge" ? 90 : 48

  const normalized = String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\u00a0/g, " ")
    .replace(/[“”"]/g, "“")
    .replace(/[‘’]/g, "'")
    .replace(/[`´]/g, "'")
    .replace(/\\/g, "／")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/\[/g, "［")
    .replace(/\]/g, "］")
    .replace(/</g, "＜")
    .replace(/>/g, "＞")

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cleaned = line
        .replace(/^[•·▪●○◦‣\-–—]+\s*/, "- ")
        .replace(/\s{2,}/g, " ")
        .trim()
      return cleaned
    })
    .slice(0, maxLines)

  const compact = lines.join("\n").slice(0, maxChars).trim()
  return compact
}

function normalizeAiWritePromptText(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .trim()
}

function dedupeOrderedLines(lines: string[], limit: number) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const line of lines) {
    const normalized = String(line || "").trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
    if (output.length >= limit) break
  }
  return output
}

function isKnowledgeSectionHeading(line: string) {
  const value = String(line || "").trim()
  return (
    /^核心修学亮点/.test(value) ||
    /^课程架构/.test(value) ||
    /^DAY\s*\d+/i.test(value) ||
    /^授课导师/.test(value) ||
    /^这趟认证培训/.test(value) ||
    /^适合人群/.test(value) ||
    /^课程细节/.test(value) ||
    /^课程信息/.test(value) ||
    /^配套服务/.test(value) ||
    /^认证方式/.test(value) ||
    /^完成培训/.test(value)
  )
}

function collectKnowledgeSection(
  lines: string[],
  startMatchers: RegExp[],
  options?: {
    stopMatchers?: RegExp[]
    limit?: number
    includeHeading?: boolean
  }
) {
  const startIndex = lines.findIndex((line) => startMatchers.some((matcher) => matcher.test(line)))
  if (startIndex === -1) return []

  const output: string[] = []
  if (options?.includeHeading) {
    output.push(lines[startIndex])
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (
      (options?.stopMatchers && options.stopMatchers.some((matcher) => matcher.test(line))) ||
      (!options?.stopMatchers && isKnowledgeSectionHeading(line))
    ) {
      break
    }
    output.push(line)
    if (output.length >= (options?.limit || 6)) break
  }

  return output
}

function buildKnowledgeRequirementsDigest(input: string) {
  const normalized = normalizeRequirementsPlainText(input, "knowledge")
  if (!normalized) return ""

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean)
  const title = String(lines[0] || "").replace(/^[0-9]+[⃣.、]?\s*/, "").trim()
  const subtitle = lines.find((line) => /^副标题[:：]/.test(line))?.replace(/^副标题[:：]\s*/, "").trim() || ""
  const highlights = collectKnowledgeSection(lines, [/^核心修学亮点/], {
    stopMatchers: [/^课程架构/, /^DAY\s*\d+/i, /^授课导师/, /^这趟认证培训/, /^适合人群/, /^课程信息/],
    limit: 8,
  })
  const mentorSection = collectKnowledgeSection(lines, [/^授课导师/, /^导师介绍/, /^讲师介绍/], {
    stopMatchers: [/^这趟认证培训/, /^适合人群/, /^课程细节/, /^课程信息/, /^配套服务/, /^认证方式/],
    limit: 6,
  })
  const audience = collectKnowledgeSection(lines, [/^这趟认证培训/, /^适合人群/], {
    stopMatchers: [/^课程细节/, /^课程信息/, /^配套服务/, /^认证方式/, /^完成培训/],
    limit: 6,
  })
  const services = dedupeOrderedLines([
    ...collectKnowledgeSection(lines, [/^配套服务/], {
      stopMatchers: [/^认证方式/, /^完成培训/],
      limit: 5,
    }),
    ...collectKnowledgeSection(lines, [/^认证方式/], {
      stopMatchers: [/^完成培训/],
      limit: 3,
    }),
  ], 6)
  const outcomes = collectKnowledgeSection(lines, [/^完成培训/], {
    limit: 6,
  })

  const proofLines = dedupeOrderedLines(
    [
      ...lines.filter((line) => /(创始人|导师|全程亲授|专业背书|深耕|教学兼具|手把手教学)/.test(line)),
      ...lines.filter((line) => /(\d+\+?\s*年|\d+\+\s*专业疗愈师|\d+\+\s*期|\d+\+\s*都市学员|\d+\+\s*学员)/.test(line)),
      ...lines.filter((line) => /(认证证书|资源对接|工具包|执业路径图|一对一指导纠错)/.test(line)),
    ],
    8
  )

  const curriculumLines = dedupeOrderedLines(
    lines.filter((line) => /^DAY\s*\d+/i.test(line) || /^\d+\.\s*/.test(line)),
    10
  )

  return [
    "以下为面向课程招生海报的结构化摘要，请优先提炼这些信息，而不是逐字复述原始长文：",
    title ? `课程标题：${title}` : "",
    subtitle ? `课程副标题：${subtitle}` : "",
    "",
    "讲师主图海报表达重点：",
    "- 讲师主图必须作为整套海报的身份锚点，优先建立“可信、专业、可跟学”的第一印象。",
    "- 首屏优先突出：课程名称、副标题、讲师身份标签、1-2条最强成果数据。",
    "- 讲师优势表达应聚焦：从业年限、创始人/导师身份、培训规模、教学风格、全程亲授。",
    "- 案例或成果证明优先做成数据徽章、案例卡片、图中图或结果标签，不要把大段原文直接塞进画面。",
    "- 整套图应优先拆成短标题、短卖点、编号条、胶囊卡片、图标模块和场景拼图，不要逐字铺满长文。",
    "- 只有封面和导师页建议老师大面积强出镜，其余页面可以由信息结构、课堂氛围或器物场景承担主画面。",
    "",
    proofLines.length > 0 ? "讲师优势与权威背书：" : "",
    ...proofLines.map((line) => `- ${line}`),
    "",
    highlights.length > 0 ? "课程核心亮点：" : "",
    ...highlights.map((line) => `- ${line}`),
    "",
    curriculumLines.length > 0 ? "课程讲解结构 / 可视化案例素材：" : "",
    ...curriculumLines.map((line) => `- ${line}`),
    "",
    audience.length > 0 ? "适合人群：" : "",
    ...audience.map((line) => `- ${line}`),
    "",
    services.length > 0 ? "交付权益与转化抓手：" : "",
    ...services.map((line) => `- ${line}`),
    "",
    outcomes.length > 0 ? "学员完成课程后可获得的成果：" : "",
    ...outcomes.map((line) => `- ${line}`),
  ].filter(Boolean).join("\n")
}

function buildRequirementsBlockForPrompt(
  input: string,
  workflowMode: StudioGenesisWorkflowMode,
  fallback: string
) {
  const normalized = normalizeRequirementsPlainText(input, workflowMode)
  if (!normalized) return fallback

  if (workflowMode === "knowledge") {
    return buildKnowledgeRequirementsDigest(normalized) || fallback
  }

  return [
    "以下内容已经做过规范化清洗，请只提炼语义与视觉要点，不要逐字照抄原文。",
    "严禁把原文中的引号、括号、长句、编号或特殊符号原样复制进输出 JSON 字符串。",
    normalized,
  ].join("\n")
}

function stripMarkdownDecorators(input: string) {
  return String(input || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\[(.*?)\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function escapeRegExp(input: string) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function extractInlineField(source: string, label: string) {
  const escaped = escapeRegExp(label)
  const patterns = [
    new RegExp(`\\*\\*${escaped}\\*\\*[:：]\\s*(.+)`, "i"),
    new RegExp(`(?:^|\\n)${escaped}[:：]\\s*(.+)`, "i"),
    new RegExp(`(?:^|\\n)-\\s*${escaped}[:：]\\s*(.+)`, "i"),
  ]

  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (match?.[1]) return stripMarkdownDecorators(match[1])
  }

  return ""
}

function extractSection(source: string, heading: string) {
  const escaped = escapeRegExp(heading)
  const pattern = new RegExp(`##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i")
  const match = source.match(pattern)
  return String(match?.[1] || "").trim()
}

function collapseSectionToSentence(source: string) {
  const lines = String(source || "")
    .split("\n")
    .map((line) => stripMarkdownDecorators(line.replace(/^[\-\*]\s*/, "")))
    .filter(Boolean)
  return lines.join("; ")
}

function extractBulletValues(source: string) {
  return String(source || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-/.test(line))
    .map((line) => stripMarkdownDecorators(line.replace(/^-+\s*/, "")))
    .filter(Boolean)
}

function extractColorSpec(source: string, label: "主色调" | "辅助色" | "点缀色") {
  const escaped = escapeRegExp(label)
  const match = source.match(new RegExp(`(?:^|\\n)-\\s*\\*\\*${escaped}\\*\\*[:：]\\s*(.+)`, "i"))
  return stripMarkdownDecorators(match?.[1] || "")
}

function extractHexColor(source: string) {
  const match = String(source || "").match(/#(?:[0-9a-fA-F]{6})/)
  return String(match?.[0] || "").trim()
}

function normalizeFrameRatio(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized) return "60%"
  if (/%$/.test(normalized)) return normalized
  return normalized
}

function inferTextPosition(textRegion: string) {
  const value = String(textRegion || "").trim()
  if (!value) return "the reserved typography area"
  if (/左/.test(value)) return "the left side"
  if (/右/.test(value)) return "the right side"
  if (/上/.test(value)) return "the upper area"
  if (/下/.test(value)) return "the lower area"
  if (/中/.test(value)) return "the center area"
  return value
}

function inferProductPlacement(layout: string) {
  const value = String(layout || "").trim()
  if (!value) return "positioned near the center for a stable commercial layout"
  if (/偏右|右侧|右/.test(value)) return "positioned slightly to the right of center to allow for balanced typography"
  if (/偏左|左侧|左/.test(value)) return "positioned slightly to the left of center to allow for balanced typography"
  if (/居中/.test(value)) return "positioned centrally with a clean and stable hero composition"
  return value
}

function inferEnvironmentStyle(visualStyle: string) {
  const value = String(visualStyle || "").trim()
  if (/医学|医研|实验室|专业/.test(value)) return "laboratory-style"
  if (/清新|夏日|清透|水润/.test(value)) return "fresh skincare-style"
  if (/高端|奢感|高级/.test(value)) return "premium editorial-style"
  return "commercial product-style"
}

function inferForegroundDecor(decorativeElements: string) {
  const value = String(decorativeElements || "").trim()
  if (!value || /^N\/A$/i.test(value)) {
    return "subtle reflective details on a clean surface"
  }
  return value
}

function inferMidground(mainColorHex: string, displayFocus: string) {
  if (displayFocus) return displayFocus
  if (mainColorHex) return `a premium clean surface in ${mainColorHex}`
  return "a premium clean surface supporting the product"
}

function inferBackgroundScene(backgroundElements: string, accentHex: string, backgroundColor: string) {
  const parts: string[] = []
  if (backgroundElements) parts.push(backgroundElements)
  if (backgroundColor) parts.push(`with a background tone of ${backgroundColor}`)
  if (accentHex) parts.push(`with subtle ${accentHex} highlight refractions`)
  return parts.join(", ") || "a clean and layered commercial background"
}

function inferLightingSentence(primary: string, fallback: string) {
  const first = String(primary || "").trim()
  const second = String(fallback || "").trim()
  return first || second || "Bright commercial lighting with soft side-backlighting to define the silhouette and maintain clean packaging readability."
}

function inferMaterialSentence(productSummary: string, keyDetails: string) {
  const value = [keyDetails, productSummary].filter(Boolean).join("；")
  return value || "The packaging must preserve realistic label printing, edge clarity, pump structure, surface finish, and material fidelity."
}

function buildMainImagePromptFromPlan(params: {
  requirements: string
  designSpecs: string
  plan: StudioGenesisPlan
  imageUnderstandingText: string
}) {
  const requirements = String(params.requirements || "").trim()
  const designSpecs = String(params.designSpecs || "").trim()
  const designContent = String(params.plan.designContent || "").trim()
  const imageUnderstandingText = stripMarkdownDecorators(params.imageUnderstandingText || "")

  const productName =
    extractInlineField(requirements, "产品名称") ||
    extractInlineField(requirements, "产品") ||
    stripMarkdownDecorators(params.plan.title || "参考商品")

  const visualStyle =
    extractInlineField(designSpecs, "风格定位") ||
    extractInlineField(requirements, "风格名称") ||
    extractSection(requirements, "视觉风格") ||
    "专业商业电商主图风格"

  const productParams = collapseSectionToSentence(extractSection(requirements, "产品参数"))
  const keyDetails = collapseSectionToSentence(extractSection(requirements, "关键细节"))
  const functionList = extractBulletValues(extractSection(requirements, "功能清单")).join("; ")
  const productSummaryParts = [productParams, keyDetails, functionList, imageUnderstandingText].filter(Boolean)
  const productSummary = productSummaryParts.join(" ")

  const selectedView = extractInlineField(designContent, "选用视角")
  const productRatio = extractInlineField(designContent, "产品占比")
  const layout = extractInlineField(designContent, "布局方式")
  const textRegion = extractInlineField(designContent, "文字区域")
  const displayFocus = extractInlineField(designContent, "展示重点")
  const sellingPoint = extractInlineField(designContent, "突出卖点")
  const painPoint = extractInlineField(designContent, "痛点场景")
  const backgroundElements = extractInlineField(designContent, "背景元素")
  const decorativeElements = extractInlineField(designContent, "装饰元素")
  const lightingEffect = extractInlineField(designContent, "光影效果")
  const emotionKeywords = extractInlineField(designContent, "情绪关键词")
  const insetImages = collapseSectionToSentence(extractSection(designContent, "图中图元素"))

  const designLight = extractInlineField(designSpecs, "光线")
  const designDepth = extractInlineField(designSpecs, "景深")
  const cameraParams = extractInlineField(designSpecs, "相机参数参考")
  const titleFont = extractInlineField(designSpecs, "标题字体")
  const bodyFont = extractInlineField(designSpecs, "正文字体")
  const mainColor = extractColorSpec(requirements, "主色调") || extractColorSpec(designSpecs, "主色调")
  const secondaryColor = extractColorSpec(requirements, "辅助色") || extractColorSpec(designSpecs, "辅助色")
  const accentColor = extractColorSpec(requirements, "点缀色") || extractColorSpec(designSpecs, "点缀色")
  const backgroundColor = extractInlineField(designSpecs, "背景色")
  const mainColorHex = extractHexColor(mainColor)
  const secondaryColorHex = extractHexColor(secondaryColor)
  const accentColorHex = extractHexColor(accentColor)

  const mainTitle = extractInlineField(designContent, "主标题")
  const subTitle = extractInlineField(designContent, "副标题")
  const bodyText = extractInlineField(designContent, "说明文字")
  const hasOverlayText = [mainTitle, subTitle, bodyText].some((item) => item && item.toLowerCase() !== "none")
  const compositionPlacement = inferProductPlacement(layout)
  const typographyPosition = inferTextPosition(textRegion)
  const environmentStyle = inferEnvironmentStyle(visualStyle)
  const foregroundDecor = inferForegroundDecor(decorativeElements)
  const midgroundDetail = inferMidground(mainColorHex, displayFocus)
  const backgroundScene = inferBackgroundScene(backgroundElements, accentColorHex, backgroundColor)
  const lightingSentence = inferLightingSentence(designLight, lightingEffect)
  const materialSentence = inferMaterialSentence(productSummary, keyDetails)
  const qualitySentence = cameraParams
    ? `${cameraParams}.`
    : "4K resolution, shot with commercial-grade product photography settings."

  return [
    `Subject: 本图中的主体必须与参考图中的 ${productName || "参考商品"} 严格一致,产品的形态、外形、颜色、材质、零件数量、连接关系、机械结构必须与参考图完全一致，不得做任何改变。 严格还原参考图中产品的所有色彩，不做任何修改。产品本体、各组件、表面及质感的颜色必须与参考图完全一致。 禁止对参考物品进行任何变形和机械结构改变。严格保留参考图中肉眼可见的所有产品细节。禁止对参考图中未直接呈现的任何功能、内部结构或产品特征进行推断或假设， 禁止在描述中加入参考图中不存在的结构、零件或形态特征。 ${productSummary || "The product details must stay fully faithful to the reference image."}`,
    `Composition: The product occupies ${normalizeFrameRatio(productRatio || "60%")} of the frame, ${compositionPlacement}. The layout follows a professional commercial aesthetic with ample white space.${textRegion ? ` Typography is reserved for ${typographyPosition}.` : ""}`,
    selectedView ? `本张图的构图视角为:${selectedView}.` : "",
    `Background: A multi-layered ${environmentStyle} environment. The foreground features ${foregroundDecor}. The midground consists of ${midgroundDetail}. The background is ${backgroundScene}.`,
    `Lighting: ${lightingSentence}${designDepth ? ` Depth of field: ${designDepth}.` : ""}`,
    `Color Scheme: A professional palette of ${[mainColorHex || mainColor, secondaryColorHex || secondaryColor, accentColorHex || accentColor].filter(Boolean).join(", ")}.`,
    `Material Details: ${materialSentence}`,
    hasOverlayText
      ? `Text Layout: The text is positioned on ${typographyPosition} with a clear hierarchy. Main title: ${mainTitle || "N/A"}. Subtitle: ${subTitle || "N/A"}. Description: ${bodyText || "N/A"}. The typography uses ${titleFont || "a bold sans-serif Chinese typeface"} for titles and ${bodyFont || "a regular sans-serif Chinese typeface"} for descriptions.`
      : "Text Layout: No additional overlay typography should be added. Only the product's native packaging text may appear.",
    insetImages && insetImages.toUpperCase() !== "N/A" ? `Inset Images: ${insetImages}.` : "",
    `Atmosphere: ${emotionKeywords || visualStyle || "Professional, premium, trustworthy, and conversion-focused."}${painPoint && painPoint !== "N/A" ? ` Pain point emphasis: ${painPoint}.` : ""}`,
    `Style: ${visualStyle || "High-end commercial product photography for e-commerce hero image generation."}`,
    `Quality: ${qualitySentence} Ultra-high-definition, commercial-grade product photography, crisp details, clean edges, realistic materials.`,
    "严格复制参考图中产品的精确物理结构，匹配所有组件的精确数量、位置、比例和空间关系，每个元素必须在几何上精确且在现实世界中物理可实现，不得添加、移除、合并或变形任何结构元素。",
  ].filter(Boolean).join(" ")
}

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

function loadPromptTemplate(filename: string, fallback: string) {
  try {
    return readFileSync(path.join(PROMPTS_DIR, filename), "utf-8")
  } catch {
    return fallback
  }
}

function renderPromptTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(variables[key] ?? ""))
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
  if (first === -1) return cleaned

  let inString = false
  let escaped = false
  let depth = 0

  for (let index = first; index < cleaned.length; index += 1) {
    const char = cleaned[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === "\"") {
        inString = false
      }
      continue
    }

    if (char === "\"") {
      inString = true
      continue
    }

    if (char === "{") {
      depth += 1
      continue
    }

    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return cleaned.slice(first, index + 1)
      }
    }
  }

  return cleaned.slice(first)
}

function findNextNonWhitespace(input: string, start: number) {
  for (let index = start; index < input.length; index += 1) {
    if (!/\s/.test(input[index])) return input[index]
  }
  return ""
}

function repairJsonObjectText(input: string) {
  const source = extractJsonObject(input)
  const output: string[] = []
  const closingStack: string[] = []
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) {
        output.push(char)
        escaped = false
        continue
      }

      if (char === "\\") {
        const nextChar = source[index + 1] || ""
        if (nextChar && !["\"", "\\", "/", "b", "f", "n", "r", "t", "u"].includes(nextChar)) {
          output.push("\\\\")
          continue
        }
        output.push(char)
        escaped = true
        continue
      }

      if (char === "\"") {
        const nextNonWhitespace = findNextNonWhitespace(source, index + 1)
        if (nextNonWhitespace && ![",", "}", "]", ":"].includes(nextNonWhitespace)) {
          output.push("\\\"")
          continue
        }
        output.push(char)
        inString = false
        continue
      }

      if (char === "\n") {
        output.push("\\n")
        continue
      }

      if (char === "\r") {
        output.push("\\r")
        continue
      }

      if (char === "\t") {
        output.push("\\t")
        continue
      }

      if (char < " ") {
        output.push(" ")
        continue
      }

      output.push(char)
      continue
    }

    if (char === "\"") {
      output.push(char)
      inString = true
      continue
    }

    if (char === "{") {
      output.push(char)
      closingStack.push("}")
      continue
    }

    if (char === "[") {
      output.push(char)
      closingStack.push("]")
      continue
    }

    if (char === "}" || char === "]") {
      while (output.length > 0 && /\s/.test(output[output.length - 1])) {
        const last = output[output.length - 1]
        if (last === "\n" || last === "\r" || last === "\t" || last === " ") {
          output.pop()
          continue
        }
        break
      }
      if (output[output.length - 1] === ",") {
        output.pop()
      }
      output.push(char)
      if (closingStack[closingStack.length - 1] === char) {
        closingStack.pop()
      }
      continue
    }

    if (char === ",") {
      const nextNonWhitespace = findNextNonWhitespace(source, index + 1)
      if (nextNonWhitespace === "}" || nextNonWhitespace === "]") {
        continue
      }
      output.push(char)
      continue
    }

    output.push(char)
  }

  if (inString) {
    output.push("\"")
  }

  while (closingStack.length > 0) {
    output.push(closingStack.pop() as string)
  }

  return output.join("")
}

function parseJsonObjectWithRepair(input: string) {
  const extracted = extractJsonObject(input)
  try {
    return JSON.parse(extracted)
  } catch (originalError) {
    const repaired = repairJsonObjectText(extracted)
    try {
      return JSON.parse(repaired)
    } catch (repairError: any) {
      const detail = repairError?.message
        || (originalError instanceof Error ? originalError.message : "JSON parse failed")
      throw new Error(`分析结果 JSON 格式异常，自动修复后仍失败：${detail}`)
    }
  }
}

async function repairAnalysisJsonWithModel(params: {
  merchantId: string | null
  requestedRuntimeId?: string
  malformedContent: string
  imageCount: number
  workflowMode: StudioGenesisWorkflowMode
}) {
  const repairPrompt = [
    "下面是一段接近合法 JSON 的分析结果，但其中包含未转义引号、非法换行、尾逗号或字符串截断等问题。",
    "请在不改变原始语义的前提下，将它修复成严格合法的 JSON 对象。",
    `images 数组必须保留且最终数量必须为 ${clampStudioGenesisImageCount(params.imageCount)} 个。`,
    params.workflowMode === "knowledge"
      ? "这是知识付费课程海报分析结果，必须保留课程主视觉、导师介绍、亮点页、课程架构、转化页等页面角色。"
      : "这是商品详情图分析结果，必须保留商品图组规划语义。",
    "要求：只输出修复后的纯 JSON 对象，不要解释，不要代码块，不要额外文本。",
    "",
    "待修复内容：",
    stripCodeFences(params.malformedContent),
  ].join("\n")

  const completion = await chatTextCompletion({
    merchantId: params.merchantId,
    requestedRuntimeId: params.requestedRuntimeId,
    systemPrompt: [
      "你是 JSON 修复器。",
      "你的唯一任务是把输入修复为严格合法的 JSON 对象。",
      "禁止解释，禁止补充无关文本。",
    ].join("\n"),
    userPrompt: repairPrompt,
    temperature: 0.1,
    maxTokens: Math.min(9000, Math.max(2600, params.malformedContent.length)),
    responseFormat: { type: "json_object" },
  })

  return parseJsonObjectWithRepair(completion.content)
}

function normalizeChatModelCandidate(model: any): ChatModelCandidate | null {
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

async function resolveSceneModelCandidate(
  merchantId: string | null,
  requestedRuntimeId: string | undefined,
  type: "CHAT" | "IMAGE",
  scenes: readonly string[]
): Promise<ChatModelCandidate | null> {
  const requested = String(requestedRuntimeId || "").trim()
  if (requested) {
    const config = await getEffectiveModelConfig(requested, merchantId)
    const modelId = String(config?.modelId || parseModelRuntimeId(requested).modelId || "").trim()
    const provider = config?.provider
    if (config && provider && modelId) {
      return {
        runtimeId: buildModelRuntimeId(modelId, provider.key || config.providerId || config.id),
        modelId,
        provider,
      }
    }
  }

  for (const usageScene of scenes) {
    const resolved = await resolveMerchantSceneRuntimeModel({
      merchantId,
      usageScene,
      type,
    })
    const candidate = normalizeChatModelCandidate(resolved?.modelConfig)
    if (type === "IMAGE" && resolved?.modelConfig?.provider && resolved?.modelId) {
      return {
        runtimeId: buildModelRuntimeId(
          resolved.modelId,
          resolved.modelConfig.provider.key || resolved.modelConfig.providerId || resolved.modelConfig.id
        ),
        modelId: resolved.modelId,
        provider: resolved.modelConfig.provider,
      }
    }
    if (candidate) return candidate
  }

  return null
}

async function chatTextCompletion(params: {
  merchantId: string | null
  requestedRuntimeId?: string
  systemPrompt: string
  userPrompt: string
  userContent?: string | ChatMultimodalContentItem[]
  temperature?: number
  maxTokens?: number
  responseFormat?: unknown
  extraBody?: Record<string, unknown>
}) {
  const candidate = await resolveSceneModelCandidate(params.merchantId, params.requestedRuntimeId, "CHAT", TEXT_SCENES)
  if (!candidate?.provider) {
    throw new Error("未配置【产品分析模型】，请先配置“产品分析模型”聊天模型")
  }

  const credentials = resolveProviderCredentials(candidate.provider)
  const apiKey = credentials.apiKey
  const baseUrl = credentials.baseUrl || candidate.provider?.baseUrl || undefined

  if (!apiKey) {
    throw new Error(`文本模型服务商(${candidate.provider?.name || candidate.provider?.key || "未命名服务商"})未配置可用凭证`)
  }

  const provider = isZenmuxProvider(candidate.provider)
    ? createZenmuxChatProvider({
        baseUrl,
        apiKey,
        modelId: candidate.modelId,
        providerName: candidate.provider?.name || candidate.provider?.key || "ZenMux",
        providerConfig: {
          key: candidate.provider?.key,
          isThirdParty: Boolean(candidate.provider?.isThirdParty),
          baseUrl: candidate.provider?.baseUrl || null,
          supportOpenAI: candidate.provider?.supportOpenAI,
        },
      })
    : new OpenAICompatibleProvider({
        baseUrl,
        apiKey,
        modelId: candidate.modelId,
        providerName: candidate.provider?.name || candidate.provider?.key || "OpenAI Compatible",
      })

  const response = await provider.chat(
    [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userContent || params.userPrompt },
    ],
    {
      model: candidate.modelId,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      response_format: params.responseFormat,
      extraBody: params.extraBody,
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
    usage: response?.usage || response?.usageMetadata || null,
  }
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
    preferredDir: "studio-genesis",
    filenameHint: "studio-genesis-generated",
    maxBytes: 60 * 1024 * 1024,
  })
  return stored?.url || normalized
}

function resolveQualityFromSpeedMode(speedMode: StudioGenesisSpeedMode) {
  if (speedMode === "turbo") return "standard"
  if (speedMode === "fast") return "hd"
  return "ultra"
}

export function resolveBatchConcurrencyFromSpeedMode(speedMode: StudioGenesisSpeedMode) {
  if (speedMode === "turbo") return 3
  if (speedMode === "fast") return 2
  return 1
}

function buildAnalysisSystemPrompt() {
  return [
    "严格执行用户提示词。",
    "只输出合法 JSON 字符串，不要解释，不要代码块，不要额外文本。",
    "先对用户文案做语义提炼和改写，再写入 JSON；不要逐字复制用户原文。",
    "所有字符串都必须是合法 JSON 字符串内容，禁止输出未转义的双引号、非法反斜杠或未闭合字符串。",
  ].join("\n")
}

export function buildStudioGenesisAnalysisPromptPreview(params: {
  imageType?: "main" | "detail"
  targetPlatform?: string
  workflowMode?: StudioGenesisWorkflowMode
  requirements: string
  targetLanguage: string
  imageCount: number
  imageUnderstandingText: string
}) {
  const workflowMode: StudioGenesisWorkflowMode = params.workflowMode === "knowledge" ? "knowledge" : "product"
  const imageType = params.imageType === "detail" ? "detail" : "main"
  const rawPlatform = String(params.targetPlatform || "").trim()
  const platformDisplayMap: Record<string, string> = {
    none: "未明确",
    taobao: "淘宝",
    tmall: "天猫",
    pinduoduo: "拼多多",
    jd: "京东",
    douyin: "抖音",
  }
  const platformLabel =
    !rawPlatform || rawPlatform.toLowerCase() === "none"
      ? "未明确"
      : platformDisplayMap[rawPlatform.toLowerCase()] || rawPlatform
  const requirementsBlock = buildRequirementsBlockForPrompt(
    params.requirements,
    workflowMode,
    "无额外要求，请补齐完整商业详情页方案。"
  )
  const productFallback = imageType === "detail" ? [
    `【核心指令】所有 design_content 中的"文字内容"必须使用目标输出语言：${resolveStudioGenesisLanguageLabel(params.targetLanguage)}。`,
    "",
    `目标电商平台：${platformLabel}`,
    "",
    "用户需求描述：",
    "{requirements}",
    "",
    "你是一位资深电商视觉策划专家，精通国内电商平台（淘宝/天猫、京东、拼多多、抖音）的详情图设计与视觉规范制定。请务必为 **正好 {image_count} 张** 图片制定独立且互不重复的设计计划。",
    "",
    "  你的任务是：",
    "  1. 分析用户提供的产品图片。",
    "  2. 判断产品是否为复杂品类。",
    '  3. 结合用户的需求描述（特别注意用户是否要求"无文字/纯净版"设计）。',
    "  4. 制定整体设计规范（design_specs）。",
    "  5. 为每张图片制定详细的设计计划。",
    "",
    "  ---",
    "",
    "  ## 适用平台",
    "",
    "  淘宝/天猫、京东、拼多多，抖音或未明确平台时默认适用。",
    "",
    "  --",
    "",
    "  复杂结构判断：产品符合以下任一条件即判定为 true：",
    "  （1）含可折叠/伸缩/旋转的机械关节或活动部件",
    "  （2）由多个独立零件组合，零件数量、位置、比例有明确物理约束",
    "  （3）存在精密结构（螺纹、卡扣、铰链、导轨、齿轮等）",
    "",
    "  若判定为 true，执行以下约束：",
    "",
    "  1. 参考图视角分析：规划每张图前，先分析参考图中实际存在的拍摄角度，为每张图选定一个具体视角（正面、侧面、45度斜角、俯视或局部特写等），写入该图 design_content 的 **选用视角**字段。只能选用参考图中实际存在的角度；允许在已有视角基础上做局部特写放大，但不得改变拍摄方向。严禁：第一人称视角、使用者主观视角、透过产品任何部件的内视角、参考图中不存在的纵深透视构图。",
    "  2. 产品形态锁定：形态、外形、颜色、材质、零件数量、连接关系、机械结构必须与参考图完全一致，不得改变。",
    "  3. 创意边界：仅限场景选择、光影设计、背景氛围、装饰道具。",
    "",
    "  若判定为 false：不执行上述任何约束，保持正常创意自由度。",
    "",
    "  判断结果写入：① JSON 顶层字段 is_complex_product（布尔值，不加引号）；② 每张图 design_content 第一行 **产品复杂结构判定** 字段。当is_complex_product 为 true 时，在 design_content 第二行写入 **选用视角**：[从参考图视角分析得出的视角]。",
    "",
    "  ---",
    "",
    "  其他逻辑规则：",
    "  - 配色覆盖：上游 prompt_text 中包含主题配色（hex色值）时，必须严格使用，不得自行另选配色。",
    '  - 冲突优先级：用户文字描述 > prompt_text 中的内容 > 自行分析。',
    '  - 文案区分原则：区分"设计文案"（后期排版加入的标题/卖点）与"产品文字"（产品瓶身/包装上固有的 Logo、成分、标签）。',
    '  - 无文案处理逻辑：若用户需求为"无文案"设计，则 文字内容 下的所有字段填入 "None"，并在 展示重点中强调"通过纯视觉、构图和光影展现产品，不添加任何排版文案"。design_specs 中的 ## 字体系统 部分必须输出为："无(纯视觉设计，不涉及排版文案)"，不提供具体的字体推荐。',
    '  - 尺码对照表规则：**默认 size_chart = null**。三条件同时满足方可生成：①参数/规格图 ②用户原文出现尺码/尺寸范围字符串（如 90-140cm、S-XL、35-42码；功能性尺寸和纯产品描述不算） ③产品可尺码化（服装/鞋/帽/袜/手套等）。生成要求：单表；码数列由用户范围线性派生且严格单调递增；列头按品类固定（童装套装=上长/胸围/袖长/腰围/臀围/裤长；鞋=脚长/EU/US/UK 等）；每列随码数单调递增，禁止同码多值、跳序、区间矛盾；底部免责文字"参考示意，以实物为准"（使用 {target_language}）；布局方式须显式含"尺码对照表区域"且占比 ≥40%。降级：参数/规格图改单行尺寸文字或纯视觉展示，严禁自造表格。',
    "  ---",
    "",
    "  输出必须是严格的 JSON 格式，包含以下结构：",
    "",
    "  {",
    ' "is_complex_product":布尔值，根据复杂结构判断规则动态填写，true 或 false，不加引号,',
    '    "design_specs": "（使用中文编写）# 整体设计规范\\n\\n> 所有图片必须遵循以下统一规范，确保视觉连贯性\\n\\n## 视觉风格\\n- **风格定位**：[根据用户提示词中的风格名称/设计风格描述确定；若无则根据产品分析确定]\\n\\n## 色彩系统\\n> 以下 hex 取值：提示词含主题配色则直接使用，否则由产品分析推断\\n- **主色调**：[hex]（背景/大面积色块）\\n- **辅助色**：[hex]（文字/装饰/图标）\\n- **点缀色**：[hex]（高光/强调元素）\\n- **背景色**：[由主色调+产品分析确定]\\n\\n## 字体系统\\n- **标题字体**：[推荐中文字体类型]\\n- **正文字体**：[推荐中文字体类型]\\n- **字号层级**：大标题:副标题:正文 = 3:1.8:1\\n\\n## 视觉语言\\n- **装饰元素**：[根据产品类型推荐]\\n- **图标风格**：[推荐风格]\\n- **留白原则**：[具体说明]\\n\\n## 摄影风格\\n- **光线**：[具体说明]\\n- **景深**：[具体说明]\\n- **相机参数参考**：[具体参数]\\n\\n## 品质要求\\n- 分辨率：4K/高清\\n- 风格：专业产品摄影/商业广告级\\n- 真实感：超写实/照片级",',
    '    "images": [',
    "      {",
    '    "title": "[中文标题，简洁有力，4-8个字]",',
    '        "description": "[中文描述，说明这张图的设计目标和定位，1-2句话]",',
    '        "design_content": "**产品复杂结构判定**：[true/false]\\n**选用视角**：[true 时填写从参考图分析选定的具体视角，如\\\\\\"正侧面45度\\\\\\"；false时删除此行]\\n\\n## 图[N]：[图片类型]\\n\\n**设计目标**：[具体目标]\\n\\n**产品出现**：[是/否]\\n\\n**图中图元素**：\\n- [如有，详细说明每个图中图的类型、形状、位置、尺寸、内容]\\n\\n**构图方案**：\\n- 产品占比：[百分比]\\n- 布局方式：[详细说明]\\n- 文字区域：[具体位置，若无文案则填写\\\\\\"无文案区域\\\\\\"]\\n\\n**内容要素**：\\n- 展示重点：[具体说明]\\n- 突出卖点：[具体卖点]\\n- 痛点场景：[该图聚焦的用户痛点及\\\\\\"问题→解决\\\\\\"逻辑，若非痛点图则填 N/A]\\n- 背景元素：[详细描述]\\n- 装饰元素：[详细描述]\\n\\n**文字内容**（使用 {target_language}）：\\n- 主标题：[具体文字 / 若用户要求无文案则填 None]\\n- 副标题：[具体文字 / 若用户要求无文案则填 None]\\n- 说明文字：[具体文字 / 若用户要求无文案则填 None]\\n\\n**尺码表 size_chart**：[非参数/规格图或不满足生成条件填 null；否则按\\\\\\"尺码对照表规则\\\\\\"给出码数列、列头、数据行 Markdown 表格、免责文字]\\n\\n**氛围营造**：\\n- 情绪关键词：[3-5个关键词]\\n- 光影效果：[详细说明]"',
    "      }",
    "    ]",
    "  }",
    "",
    "  重要规则：",
    "  1. images 数组必须包含 **正好 {image_count} 个** 元素。",
    "  2. 每张图的设计内容必须独特，覆盖不同角度和场景。",
    "  3. 设计规范必须基于产品图片的实际特征。",
    '  4. design_content 中的文字内容必须使用目标输出语言：{target_language}。',
    '  5. 核心指令：整体设计规范 (design_specs)、图片计划中的 title 和 description 必须使用中文编写；只有 design_content 中的"文字内容"部分必须根据目标输出语言 ({target_language}) 编写。',
    "  6. 输出限制：只输出纯 JSON 字符串，禁止包含任何 Markdown 代码块标签（如 ```json）、禁止包含任何前导或后置的解释性文字。确保 JSON 格式合法。",
    "  7. is_complex_product 与每张图 design_content 第一行的 **产品复杂结构判定** 必须保持一致，均根据判断结果动态输出，不得写死。",
  ].join("\n") : [
    "你是一位资深电商视觉策划专家，精通多品类产品的视觉设计规范制定。请务必为 **正好 {image_count} 张** 图片制定独立且互不重复的设计计划。",
    "",
    "你的任务是：",
    "1. 分析用户提供的产品图片。",
    "2. 判断商品是否为复杂品类。",
    '3. 结合用户的需求描述（特别注意用户是否要求"无文字/纯净版"设计）。',
    "4. 制定整体设计规范（design_specs）。",
    "5. 为每张图片制定详细的设计计划。",
    "",
    "---",
    "复杂结构判断：产品符合以下任一条件即判定为 true：",
    "（1）含可折叠/伸缩/旋转的机械关节或活动部件",
    "（2）由多个独立零件组合，零件数量、位置、比例有明确物理约束",
    "（3）存在精密结构（螺纹、卡扣、铰链、导轨、齿轮等）",
    "",
    "若判定为 true，执行以下约束：",
    "",
    "1. 参考图视角分析：规划每张图前，先分析参考图中实际存在的拍摄角度，为每张图选定一个具体视角（正面、侧面、45度斜角、俯视或局部特写等），写入该图 design_content 的 **选用视角**字段。只能选用参考图中实际存在的角度；允许在已有视角基础上做局部特写放大，但不得改变拍摄方向。严禁：第一人称视角、使用者主观视角、透过产品任何部件的内视角、参考图中不存在的纵深透视构图。",
    "2. 产品形态锁定：形态、外形、颜色、材质、零件数量、连接关系、机械结构必须与参考图完全一致，不得改变。",
    "3. 创意边界：仅限场景选择、光影设计、背景氛围、装饰道具。",
    "",
    "若判定为 false：不执行上述任何约束，保持正常创意自由度。",
    "",
    "判断结果写入：① JSON 顶层字段 is_complex_product（布尔值，不加引号）；② 每张图 design_content 第一行 **产品复杂结构判定** 字段。  当is_complex_product 为 true 时，在 design_content 第二行写入 **选用视角**：[从参考图视角分析得出的视角]。",
    "",
    "---",
    "其他逻辑规则：",
    '- 文案区分原则：区分"设计文案"（后期排版加入的标题/卖点）与"产品文字"（产品瓶身/包装上固有的 Logo、成分、标签）。',
    '- 无文案处理逻辑：若用户需求为"无文案"设计，则 文字内容 下的所有字段填入 "None"，并在 展示重点中强调"通过纯视觉、构图和光影展现产品，不添加任何排版文案"。design_specs 中的 ## 字体系统 部分必须输出为："无(纯视觉设计，不涉及排版文案)"，不提供具体的字体推荐。',
    "",
    "用户补充要求：",
    "{requirements}",
    "",
    "参考图理解：",
    "{image_understanding}",
    "",
    "---",
    "输出必须是严格的 JSON 格式，包含以下结构：",
    "",
    "{",
    '  "is_complex_product":布尔值，根据复杂结构判断规则动态填写，true 或 false，不加引号,',
    '  "design_specs": "（使用中文编写）# 整体设计规范\\n\\n> 所有图片必须遵循以下统一规范，确保视觉连贯性\\n\\n## 色彩系统\\n-**主色调**：[根据产品分析确定]（所有图片的文字 and 装饰主色）\\n- **辅助色**：[根据产品分析确定]（点缀和高光使用）\\n-**背景色**：[根据产品分析确定]\\n\\n## 字体系统\\n- **标题字体**：[推荐字体类型]\\n- **正文字体**：[推荐字体类型]\\n-**字号层级**：大标题:副标题:正文 = 3:1.8:1\\n\\n## 视觉语言\\n- **装饰元素**：[根据产品类型推荐]\\n- **图标风格**：[推荐风格]\\n-**留白原则**：[具体说明]\\n\\n## 摄影风格\\n- **光线**：[具体说明]\\n- **景深**：[具体说明]\\n- **相机参数参考**：[具体参数]\\n\\n## 品质要求\\n-分辨率：4K/高清\\n- 风格：专业产品摄影/商业广告级\\n- 真实感：超写实/照片级",',
    '  "images": [',
    '    {',
    '      "title": "[中文标题，简洁有力，4-8个字]",',
    '      "description": "[中文描述，说明这张图的设计目标和定位，1-2句话]",',
    '      "design_content": "**产品复杂结构判定**：[true/false]\\n**选用视角**：[true 时填写从参考图分析选定的具体视角，如\\\\\\"正侧面45度\\\\\\"；false时删除此行]\\n\\n##图[N]：[图片类型]\\n\\n**设计目标**：[具体目标]\\n\\n**产品出现**：[是/否]\\n\\n**图中图元素**：\\n-[如有，详细说明每个图中图的类型、形状、位置、尺寸、内容]\\n\\n**构图方案**：\\n- 产品占比：[百分比]\\n- 布局方式：[详细说明]\\n-文字区域：[具体位置，若无文案则填写\\\\\\"无文案区域\\\\\\"]\\n\\n**内容要素**：\\n- 展示重点：[具体说明]\\n- 突出卖点：[具体卖点]\\n- 背景元素：[详细描述]\\n-装饰元素：[详细描述]\\n\\n**文字内容**（使用 {target_language}）：\\n- 主标题：[具体文字 / 若用户要求无文案则填 None]\\n- 副标题：[具体文字 /若用户要求无文案则填 None]\\n- 说明文字：[具体文字 / 若用户要求无文案则填 None]\\n\\n**氛围营造**：\\n- 情绪关键词：[3-5个关键词]\\n-光影效果：[详细说明]"',
    "    }",
    "  ]",
    "}",
    "",
    "重要规则：",
    "1. images 数组必须包含用户指定数量的元素。",
    "2. 每张图的设计内容必须独特，覆盖不同角度和场景。",
    "3. 设计规范必须基于产品图片的实际特征。",
    "4. design_content 中的文字内容必须使用目标输出语言：{target_language}。",
    '5. 核心指令：整体设计规范 (design_specs)、图片计划中的 title 和 description 必须使用中文编写；只有 design_content中的"文字内容"部分必须根据目标输出语言 ({target_language}) 编写。',
    "6. 输出限制：只输出纯 JSON 字符串，禁止包含任何 Markdown 代码块标签（如 ```json）、禁止包含任何前导或后置的解释性文字。确保 JSON 格式合法。",
    "7. is_complex_product 与每张图 design_content 第一行的 **产品复杂结构判定** 必须保持一致，均根据判断结果动态输出，不得写死。",
    "",
  ].join("\n")

  const knowledgeFallback = [
    "你是一位资深的知识付费课程视觉总监，擅长设计课程主海报、导师介绍页、课程亮点页与招生转化海报。请务必为 **正好 {image_count} 张** 图片制定独立且互不重复的设计计划。",
    "",
    "输入说明：",
    "1. 第 1 张参考图默认为老师人物锚点图，是最高优先级身份参考。",
    "2. 其余参考图为课堂/空间/器物/海报气质参考，用于统一场景氛围、构图语言与色调。",
    "3. 用户会提供完整课程文案，需要你拆解成可用于知识付费海报套图的结构化页面方案。",
    "",
    "你的任务是：",
    "1. 分析老师人物图与课堂参考图。",
    "2. 固定老师身份一致性，确保整套画面中的人物脸部、发型、肤色、气质统一。",
    "3. 结合用户文案，为整套课程海报制定统一色调、统一版式语言和固定页面结构。",
    "4. 先将用户文案拆解为：课程定位、讲师优势、权威背书/案例成果、课程亮点、课程架构、适合人群、权益转化。",
    "5. 如果用户上传了讲师主图，优先围绕讲师本人建立课程信任感与专业背书，不要把封面做成纯排版海报。",
    "6. 制定整体设计规范（design_specs）。",
    "7. 为每张图片制定详细的设计计划。",
    "",
    "---",
    "硬性规则：",
    "1. is_complex_product 固定输出 false。",
    "2. 不要把课堂参考图中的其他人物当成主角老师；老师必须始终与人物锚点图保持同一人。",
    "3. 整套海报需要保持统一的课程品牌感、统一色调、统一字体气质和统一场景语言。",
    "4. 页面结构顺序固定为：图1=课程主视觉封面，图2=导师介绍页，图3=核心亮点页，图4=课程架构页，图5=招生转化页。",
    "5. 当 image_count 大于 5 时，再补充沉浸式课堂场景海报、适合人群海报、结业成果海报等；当 image_count 小于 5 时，按优先级保留最核心页面。",
    "6. 每张图的 design_content 必须明确说明该页承担的内容角色，并突出“老师介绍的人脸一致性”与“课程场景一致性”。",
    "7. 如果用户要求无文案，则文字内容字段填 None，但仍需通过构图、场景和人物姿态体现课程价值。",
    "8. 课程主视觉海报必须优先突出：老师人物形象、课程名称、副标题、课程核心价值。",
    "9. 导师介绍海报必须优先突出：老师身份标签、从业年限、培训规模、教学风格、成果数据。",
    "10. 如果文案中存在学员人数、开课期数、服务人次、结业成果、资源对接、认证证书等内容，应优先提炼为“案例背书/成果证明”，用于数据卡、徽章、图中图或卖点标签。",
    "11. 前 5 张图的 title 必须依次贴合固定页面角色，不得随意改成别的页面类型。",
    "",
    "用户补充要求：",
    "{requirements}",
    "",
    "参考图理解：",
    "{image_understanding}",
    "",
    "---",
    "输出必须是严格的 JSON 格式，包含以下结构：",
    "",
    "{",
    '  "is_complex_product": false,',
    '  "design_specs": "（使用中文编写）# 整体设计规范\\n\\n> 所有图片必须遵循以下统一规范，确保知识付费课程海报为同一系列\\n\\n## 色彩系统\\n- **主色调**：[根据课程主题、人物气质和课堂氛围确定]\\n- **辅助色**：[用于高光、卖点标签和按钮强调]\\n- **背景色**：[用于保证整组海报统一氛围]\\n\\n## 字体系统\\n- **标题字体**：[适合疗愈/东方/知识感/专业感的标题字体建议]\\n- **正文字体**：[适合长文案信息排布的正文字体建议]\\n- **字号层级**：大标题:副标题:正文 = 3:1.8:1\\n\\n## 视觉语言\\n- **装饰元素**：[根据课程主题推荐，如光晕、声波、铜锣、能量流线、自然虚化等]\\n- **图标风格**：[统一风格]\\n- **留白原则**：[具体说明]\\n\\n## 系列一致性\\n- **老师人物一致性**：[如何锁定脸部、发型、神态、妆容与服饰气质]\\n- **场景一致性**：[如何锁定课堂空间、光线、器物、色温与故事感]\\n- **页面结构节奏**：[封面、介绍、亮点、课程安排、转化页之间的视觉层级]\\n\\n## 摄影/海报风格\\n- **光线**：[具体说明]\\n- **景深**：[具体说明]\\n- **镜头语言**：[正面半身、侧身沉浸、课堂互动、器物特写等如何分配]\\n\\n## 品质要求\\n- 分辨率：4K/高清\\n- 风格：高端知识付费课程海报 / 商业招生主视觉\\n- 真实感：超写实/照片级",',
    '  "images": [',
    '    {',
    '      "title": "[中文标题，简洁有力，4-10个字]",',
    '      "description": "[中文描述，说明这张图是课程套图中的什么页面，1-2句话]",',
    '      "design_content": "**产品复杂结构判定**：false\\n\\n## 图[N]：[页面类型，例如课程主视觉海报/导师介绍海报/课程亮点海报/课程安排海报/招生转化海报]\\n\\n**设计目标**：[该页的具体目标]\\n\\n**老师出镜**：[是/否，若出镜说明姿态与景别]\\n\\n**讲师优势锚点**：[该页要优先强调的老师优势，例如身份标签/从业年限/教学风格/成果规模]\\n\\n**案例/成果证明**：[该页适合提炼的数据背书、学员成果、课程案例、培训规模等]\\n\\n**人脸一致性要求**：[如何保持老师与锚点图一致]\\n\\n**场景一致性要求**：[如何与整组海报保持统一空间感和氛围]\\n\\n**图中图元素**：\\n- [如有，详细说明每个图中图的类型、形状、位置、尺寸、内容]\\n\\n**构图方案**：\\n- 主体占比：[百分比]\\n- 布局方式：[详细说明]\\n- 文字区域：[具体位置，若无文案则填写\\"无文案区域\\"]\\n\\n**内容要素**：\\n- 展示重点：[具体说明]\\n- 页面卖点：[该页需要传达的课程信息]\\n- 背景元素：[课堂、器物、空间、自然元素等详细描述]\\n- 装饰元素：[详细描述]\\n\\n**文字内容**（使用 {target_language}）：\\n- 主标题：[具体文字 / 若用户要求无文案则填 None]\\n- 副标题：[具体文字 / 若用户要求无文案则填 None]\\n- 说明文字：[具体文字 / 若用户要求无文案则填 None]\\n\\n**氛围营造**：\\n- 情绪关键词：[3-5个关键词]\\n- 光影效果：[详细说明]"',
    "    }",
    "  ]",
    "}",
    "",
    "重要规则：",
    "1. images 数组必须包含用户指定数量的元素。",
    "2. 整体设计规范 (design_specs)、图片计划中的 title 和 description 必须使用中文编写；只有 design_content 中的“文字内容”部分必须根据目标输出语言 ({target_language}) 编写。",
    "3. 每张图必须承担不同页面角色，避免重复，仅允许在统一色调与统一人物身份下变化构图与信息层级。",
    "4. 每张图都要围绕知识付费课程转化目标来设计，不要按电商商品详情图思路输出。",
    "5. 输出限制：只输出纯 JSON 字符串，禁止包含任何 Markdown 代码块标签（如 ```json）、禁止包含任何前导或后置解释性文字。确保 JSON 格式合法。",
    "",
  ].join("\n")

  return renderPromptTemplate(
    loadPromptTemplate(
      workflowMode === "knowledge"
        ? "knowledge_analysis_prompt.txt"
        : imageType === "detail"
          ? "detail_analysis_prompt.txt"
          : "analysis_prompt.txt",
      workflowMode === "knowledge" ? knowledgeFallback : productFallback
    ),
    {
      requirements: requirementsBlock,
      target_platform: platformLabel,
      target_language: resolveStudioGenesisLanguageLabel(params.targetLanguage),
      image_count: String(params.imageCount),
      image_understanding: params.imageUnderstandingText || "未获取到额外视觉理解，请基于商品参考图自行推断。",
    }
  )
}

const STUDIO_GENESIS_MAIN_AI_WRITE_PROMPT = `目标电商平台：智能匹配

你是面向国内电商平台（淘宝/天猫、京东、拼多多,抖音）的产品主图提示词生成助手。
用户会提供产品图片 + 简单文字描述。

重要规则：
0. 拒绝回复一切和电商图片设计不相关的内容。拒绝生成一切涉及色情和涉及政治的内容。
1. 只识别和分析**产品本身**，完全忽略用户上传图片里的背景、场景、灯光、构图、模特、环境风格。
2. 不要被原图的场景影响，只根据产品属性和用户描述提炼信息。
3. 一次性生成 **3 套完整方案**（A/B/C），供用户三选一。产品客观事实一致，**卖点表达、痛点语气、视觉风格、色彩方向**跟随各自风格统一调整。三套色彩必须有明显区分，且基于产品本身颜色材质，不可冲突。
4. 信息不足时写"未明确"，不编造。
5. **平台识别：** 如果用户输入中提及了目标平台（如"淘宝""天猫""京东""拼多多"等），在输出中填写"目标平台"字段；未提及则填"未明确"。
6. 输出语言使用中文。
7. **用户需求原文处理：** 用户输入中能被结构化字段吸收的部分（如产品名称、平台、卖点等），正常提炼放进对应字段；无法被已有字段覆盖的部分（如特殊要求、额外说明、个性化描述等），原样保留写入"用户需求原文"。如果用户输入已全部被结构化字段覆盖，则"用户需求原文"填"无"。

输出 options 数组，每个元素只有 prompt_text 一个字段，所有信息以 Markdown 格式写在其中（输出3个）：

{
  "options": [
    {
      "prompt_text": "**目标平台：** [平台名称 或 未明确]\\n\\n**风格名称：** [名称]\\n\\n## 视觉风格\\n[风格描述一句话，不含具体色值]\\n\\n## 产品信息\\n**产品名称：** [名称]\\n\\n**核心卖点：** [单一核心卖点，该风格调性]\\n\\n## 用户痛点\\n- [痛点1]\\n- [痛点2]\\n- [痛点3]\\n\\n**适用人群：** [人群]\\n\\n## 产品参数\\n[材质、尺寸、颜色、功能等客观信息]\\n\\n## 关键细节\\n[该风格视角的工艺/材质亮点]\\n\\n## 功能清单\\n- [功能1]\\n- [功能2]\\n\\n## 主题配色\\n- **主色调：** [色彩名称] [#XXXXXX]（用于背景/大面积色块）\\n- **辅助色：** [色彩名称] [#XXXXXX]（用于文字/装饰/图标）\\n- **点缀色：** [色彩名称] [#XXXXXX]（用于高光/强调元素）\\n\\n## 用户需求原文\\n[将用户的原始输入文字原样保留，不做任何修改、总结或省略]"
    }
  ]
}

主题配色选色规则：
- 主色调：该方案的主色调，用于背景/大面积色块
- 辅助色：辅助色，用于文字/装饰/图标
- 点缀色：点缀色，用于高光/强调元素
- 色值必须具体精确（如 #2F4F4F），禁止模糊描述
- 三个色之间须有层次对比，形成可用的配色方案
- 三套方案色彩必须有明显区分，且基于产品本身颜色材质，不可冲突

只输出纯 JSON，禁止 Markdown 代码块标签和任何前后解释文字。`

const STUDIO_GENESIS_DETAIL_AI_WRITE_PROMPT = `目标电商平台：淘宝

你是面向国内电商平台（淘宝/天猫、京东、拼多多,抖音）的产品详情图组提示词生成助手。
用户会提供产品图片 + 简单文字描述。

重要规则：
0. 拒绝回复一切和电商图片设计不相关的内容。拒绝生成一切涉及色情和涉及政治的内容。
1. 只识别和分析**产品本身**，完全忽略用户上传图片里的背景、场景、灯光、构图、模特、环境风格。
2. 不要被原图的场景影响，只根据产品属性和用户描述提炼信息。
3. 输出内容用于生成一组**风格统一、视觉连贯**的产品详情图。
4. 一次性生成 **3 套完整方案**（A/B/C），供用户三选一。产品客观事实一致，**场景设定、卖点表达、视觉风格、色彩方向**跟随各自风格统一调整。三套色彩必须有明显区分，且基于产品本身颜色材质，不可冲突。
5. 信息不足时写"未明确"，不编造。
6. **平台识别：** 如果用户输入中提及了目标平台（如"淘宝""天猫""京东""拼多多"等），在输出中填写"目标平台"字段；未提及则填"未明确"。
7. 输出语言使用中文。
8. **用户需求原文处理：** 用户输入中能被结构化字段吸收的部分（如产品名称、平台、卖点等），正常提炼放进对应字段；无法被已有字段覆盖的部分（如特殊要求、额外说明、个性化描述等），原样保留写入"用户需求原文"。如果用户输入已全部被结构化字段覆盖，则"用户需求原文"填"无"。

输出 options 数组，每个元素只有 prompt_text 一个字段，所有信息以 Markdown 格式写在其中（输出3个）：

{
  "options": [
    {
      "prompt_text": "**目标平台：** [平台名称 或 未明确]\\n\\n**风格名称：** [名称]\\n\\n## 视觉风格\\n[风格描述一句话]\\n\\n## 整组图统一场景\\n[整组详情图共用的场景（例如：运动，户外等）确保多张图视觉连贯]\\n\\n## 产品信息\\n**产品名称：** [名称]\\n\\n**核心卖点：** [该风格调性的核心卖点]\\n\\n## 用户痛点\\n- [痛点1：用该风格语气描述用户的具体困扰]\\n- [痛点2]\\n- [痛点3]\\n\\n**适用人群：** [人群]\\n\\n## 产品参数\\n[材质、尺寸、颜色、功能等客观信息]\\n\\n## 设计风格\\n[视觉风格标签：简约/高级/清新/科技/国风/ins/日系/韩系/电商质感等]\\n\\n## 主题配色\\n- **主色调：** [色彩名称] [#XXXXXX]（用于背景/大面积色块）\\n- **辅助色：** [色彩名称] [#XXXXXX]（用于文字/装饰/图标）\\n- **点缀色：** [色彩名称] [#XXXXXX]（用于高光/强调元素）\\n\\n## 用户需求原文\\n[将用户的原始输入文字原样保留，不做任何修改、总结或省略]"
    }
  ]
}

主题配色选色规则：
- 主色调：该方案的主色调，用于背景/大面积色块
- 辅助色：辅助色，用于文字/装饰/图标
- 点缀色：点缀色，用于高光/强调元素
- 色值必须具体精确（如 #2F4F4F），禁止模糊描述
- 三个色之间须有层次对比，形成可用的配色方案
- 三套方案色彩必须有明显区分，且基于产品本身颜色材质，不可冲突

只输出纯 JSON，禁止 Markdown 代码块标签和任何前后解释文字。`

export function buildStudioGenesisAiWritePrompt(params: {
  targetPlatform: string
  requirements: string
  imageType: "main" | "detail"
}) {
  const requirements = String(params.requirements || "").trim()
  const rawPlatform = String(params.targetPlatform || "").trim()
  const platformDisplayMap: Record<string, string> = {
    none: "智能匹配",
    taobao: "淘宝",
    tmall: "天猫",
    pinduoduo: "拼多多",
    jd: "京东",
    douyin: "抖音",
    amazon: "亚马逊",
    temu: "TEMU",
    ebay: "eBay",
    shein: "SHEIN",
    shopee: "Shopee",
    lazada: "Lazada",
    tiktok: "TikTok",
    ozon: "Ozon",
  }
  const normalizedPlatform =
    !rawPlatform || rawPlatform.toLowerCase() === "none" || rawPlatform === "智能匹配"
      ? "智能匹配"
      : platformDisplayMap[rawPlatform.toLowerCase()] || rawPlatform

  const basePrompt = params.imageType === "detail"
    ? STUDIO_GENESIS_DETAIL_AI_WRITE_PROMPT.replace("目标电商平台：淘宝", `目标电商平台：${normalizedPlatform || "未明确"}`)
    : STUDIO_GENESIS_MAIN_AI_WRITE_PROMPT.replace("目标电商平台：智能匹配", `目标电商平台：${normalizedPlatform || "智能匹配"}`)

  return [
    basePrompt,
    "",
    requirements ? `用户补充需求：${requirements}` : "用户补充需求：无",
  ].join("\n")
}

export async function generateStudioGenesisAiWriteOptions(params: {
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  requirements?: string
  targetPlatform?: string
  imageType?: "main" | "detail"
  requestedRuntimeId?: string
}) {
  const productImages = Array.from(
    new Set((Array.isArray(params.productImages) ? params.productImages : []).map((item) => String(item || "").trim()).filter(Boolean))
  ).slice(0, STUDIO_GENESIS_MAX_PRODUCT_IMAGES)
  const modelProductImages = await normalizeGenerationReferenceImages(productImages, params.requestOrigin)

  if (modelProductImages.length === 0) {
    throw new Error("请先上传至少一张商品图")
  }

  const imageType = params.imageType === "detail" ? "detail" : "main"
  const prompt = buildStudioGenesisAiWritePrompt({
    targetPlatform: String(params.targetPlatform || "").trim() || "智能匹配",
    requirements: String(params.requirements || "").trim(),
    imageType,
  })

  const completion = await chatTextCompletion({
    merchantId: params.merchantId,
    requestedRuntimeId: params.requestedRuntimeId,
    systemPrompt: buildAnalysisSystemPrompt(),
    userPrompt: prompt,
    userContent: [
      { type: "text", text: prompt },
      { type: "text", text: "This is the product image:" },
      ...modelProductImages.map((url) => ({ type: "image_url", image_url: { url } })),
    ],
    temperature: 0.4,
    maxTokens: 8192,
    responseFormat: { type: "json_object" },
    extraBody: {
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  })

  let parsed: any
  try {
    parsed = parseJsonObjectWithRepair(completion.content)
  } catch {
    parsed = { options: [] }
  }

  const options = Array.isArray(parsed?.options)
    ? parsed.options
        .map((item: any) => ({
          prompt_text: normalizeAiWritePromptText(item?.prompt_text || item?.promptText || ""),
        }))
        .filter((item: { prompt_text: string }) => item.prompt_text)
        .slice(0, 3)
    : []

  if (options.length === 0) {
    throw new Error("AI帮写未返回可用方案")
  }

  return {
    options,
    modelId: completion.modelId,
    provider: completion.provider,
    usage: completion.usage,
    prompt,
  }
}

export function resolveStudioGenesisAnalysisMaxTokens(imageCount: number) {
  return Math.min(9000, Math.max(3200, 1800 + clampStudioGenesisImageCount(imageCount) * 420))
}

function buildGenerationPrompt(params: {
  imageType?: "main" | "detail"
  workflowMode?: StudioGenesisWorkflowMode
  requirements: string
  targetLanguage: string
  designSpecs: string
  plan: StudioGenesisPlan
  imageUnderstandingText: string
}) {
  const workflowMode: StudioGenesisWorkflowMode = params.workflowMode === "knowledge" ? "knowledge" : "product"
  const imageType = params.imageType === "detail" ? "detail" : "main"
  const requirementsBlock = buildRequirementsBlockForPrompt(
    params.requirements,
    workflowMode,
    "请按方案完成商业级商品详情页创作。"
  )
  const productFallback = imageType === "main" ? [
    "你是一名电商主图商业视觉导演，需要基于商品参考图生成一张高转化、高识别度的商品主图。",
    "",
    "Subject:",
    "The central focus of this image is the referenced product itself. The product identity, silhouette, packaging version, label layout, material finish and visible details must remain exactly consistent with the reference images.",
    "",
    "整体设计规范：",
    "{design_specs}",
    "",
    "当前画面标题：{plan_title}",
    "画面目标：{plan_description}",
    "设计内容：{plan_design_content}",
    "补充提示：{plan_prompt_hint}",
    "",
    "用户要求：",
    "{requirements}",
    "",
    "输出语言偏好：{target_language}",
    "参考图理解：",
    "{image_understanding}",
    "",
    "Composition:",
    "主图必须优先服务电商点击转化。产品主体清晰、构图集中、视觉层级强，优先建立单一核心卖点，不做多联画，不做杂乱拼贴。",
    "",
    "Background:",
    "背景、氛围、道具、色块和辅助元素必须围绕当前方案的风格定位与配色系统展开，但不能喧宾夺主。",
    "",
    "Lighting:",
    "光线必须服务产品材质与卖点表达，突出主体轮廓、标签信息、关键工艺和商业质感。",
    "",
    "Color Scheme:",
    "必须优先继承 design_specs 与方案中已经确定的主题配色；如果上游给了 hex 色值，必须严格使用，不得自行改色。",
    "",
    "Material Details:",
    "必须真实呈现产品表面材质、边缘、印刷、透明度、反光和纹理，不得出现塑料感错乱、标签文字错位或材质误判。",
    "",
    "Text Layout:",
    "如方案允许文案，画面中的排版区域必须干净、层级清晰、位置明确；如方案要求无文案，则不要添加任何排版文案，只保留产品本身固有包装文字。",
    "",
    "Atmosphere:",
    "整体氛围必须贴合当前主图方案的目标人群、痛点表达和卖点语气，优先建立专业、可信、可购买的商业感。",
    "",
    "Style:",
    "Professional commercial product hero image for e-commerce conversion, with high-end advertising quality.",
    "",
    "Quality:",
    "Ultra-high-definition, crisp details, realistic materials, clean edges, commercial-grade product photography.",
    "",
    "硬性要求：",
    "1. 必须输出单张完整主图，不要做多联画、九宫格、拼贴海报或详情页长图。",
    "2. 产品必须是绝对主角，不能被背景、道具、人物或排版模块压过。",
    "3. 优先突出单一核心卖点；除非方案明确要求，不要堆砌过多信息点。",
    "4. 如 design_content 中提供了选用视角、构图方式、文字区域、痛点场景或装饰元素，必须严格执行。",
    "5. 除非方案明确要求，否则不要添加大段文案拼贴、AI 水印或无关装饰。",
  ].join("\n") : [
    "你是一名商品详情页商业视觉导演，需要基于商品参考图生成一张高转化、高识别度的商品详情页视觉。",
    "",
    "整体设计规范：",
    "{design_specs}",
    "",
    "当前画面标题：{plan_title}",
    "画面目标：{plan_description}",
    "设计内容：{plan_design_content}",
    "补充提示：{plan_prompt_hint}",
    "",
    "用户要求：",
    "{requirements}",
    "",
    "输出语言偏好：{target_language}",
    "参考图理解：",
    "{image_understanding}",
    "",
    "硬性要求：",
    "1. 必须是同一款商品，同一外观，同一包装与关键识别特征。",
    "2. 允许变化背景、镜头、道具、氛围与构图，但不能改变商品身份。",
    "3. 画面要达到商业广告与详情页质感，主体清晰、层次干净、细节真实。",
    "4. 除非方案明确要求，否则不要添加大段文案拼贴、AI 水印或无关装饰。",
    "5. 输出单张完整成图，不要做多联画。",
  ].join("\n")

  const knowledgeFallback = [
    "你是一名知识付费课程海报视觉导演，需要基于老师人物锚点图和课堂参考图，生成一张统一色调、统一课程品牌感的招生海报或主图。",
    "",
    "整体设计规范：",
    "{design_specs}",
    "",
    "当前画面标题：{plan_title}",
    "画面目标：{plan_description}",
    "设计内容：{plan_design_content}",
    "补充提示：{plan_prompt_hint}",
    "",
    "用户要求：",
    "{requirements}",
    "",
    "输出语言偏好：{target_language}",
    "参考图理解：",
    "{image_understanding}",
    "",
    "硬性要求：",
    "1. 老师人物必须与人物锚点图保持同一人，锁定脸型、五官、发型、肤色、神态与整体气质。",
    "2. 课堂/空间/器物参考图仅用于统一场景氛围、色调、动作和构图感，不得替换老师身份。",
    "3. 画面必须具有知识付费课程封面或招生海报的商业感，允许有清晰排版区域和课程转化信息层级。",
    "4. 整体风格要与整套系列海报统一，不要随机切换成完全不同的摄影棚、服饰风格或色温。",
    "5. 输出单张完整成图，不要做多联画，不要随机新增无关主角人物。",
  ].join("\n")

  return renderPromptTemplate(
    loadPromptTemplate(
      workflowMode === "knowledge" ? "knowledge_image_prompt.txt" : "image_prompt.txt",
      workflowMode === "knowledge" ? knowledgeFallback : productFallback
    ),
    {
      design_specs: params.designSpecs,
      plan_title: params.plan.title,
      plan_description: params.plan.description,
      plan_design_content: params.plan.designContent,
      plan_prompt_hint: params.plan.promptHint || "无",
      requirements: requirementsBlock,
      target_language: resolveStudioGenesisLanguageLabel(params.targetLanguage),
      image_understanding: params.imageUnderstandingText || "未额外提供。",
    }
  )
}

function buildGenerationAnchoringPrompt(params: {
  workflowMode?: StudioGenesisWorkflowMode
  prompt: string
  referenceCount: number
  imageUnderstandingText?: string
}) {
  const safePrompt = String(params.prompt || "").trim()
  if (!safePrompt || params.referenceCount <= 0) return safePrompt
  const workflowMode: StudioGenesisWorkflowMode = params.workflowMode === "knowledge" ? "knowledge" : "product"

  if (workflowMode === "knowledge") {
    const classroomReferenceCount = Math.max(0, params.referenceCount - 1)
    return [
      safePrompt,
      "",
      `你会同时收到 ${params.referenceCount} 张参考图：第 1 张是老师人物锚点图，后续 ${classroomReferenceCount} 张是课堂/空间/器物/海报风格参考图。`,
      params.imageUnderstandingText
        ? `高优先级老师与课程锚点（必须严格继承）：\n${params.imageUnderstandingText}`
        : "",
      "知识付费课程海报一致性硬约束：",
      "1. 第 1 张人物锚点图中的老师必须保持为同一人，不得换脸、变年龄、变发型、变气质，也不要削弱老师主角性。",
      "2. 后续参考图只用于学习课堂空间、器物、配色、光线、情绪和构图语言，不能让参考图中的其他人物替代老师身份。",
      "3. 必须保持整套课程海报的系列感：统一主色调、统一光线方向、统一版式气质、统一知识付费高级感。",
      "4. 允许根据当前页面目标调整姿态、景别、背景层次和文案排版，但不能破坏老师身份一致性与课程氛围一致性。",
      "5. 不要生成抢主角的无关人物群像，不要出现与课程主题无关的道具和场景。",
      "6. 封面页和导师页适合老师强出镜，其余页面可以主要使用课堂场景、器物局部、图标模块或信息板，不要强行每页都做成人像封面。",
    ].filter(Boolean).join("\n")
  }

  return [
    safePrompt,
    "",
    `你会同时收到 ${params.referenceCount} 张商品参考图。它们是强约束参考，不是普通灵感图。`,
    params.imageUnderstandingText
      ? `高优先级商品锚点（必须严格继承）：\n${params.imageUnderstandingText}`
      : "",
    "商品一致性硬约束：",
    "1. 必须保持为同一款产品，不能生成成其他品牌、其他包装版本、其他瓶型或其他标签设计。",
    "2. 要锁定商品轮廓、开盖结构、瓶身/盒身比例、主色、材质、标签区块、logo 位置、图案与文字区域。",
    "3. 允许扩展背景、道具、氛围、光线、构图和景别，但商品主体不能漂移。",
    "4. 不允许为了追求好看而改变商品核心识别特征，也不允许把商品弱化成配角。",
    "5. 本图中的主体必须与参考图中的产品严格一致，产品的形态、外形、颜色、材质、零件数量、连接关系、机械结构必须与参考图完全一致，不得做任何改变。",
    "6. 严格还原参考图中产品的所有色彩，不做任何修改。产品本体、各组件、表面及质感的颜色必须与参考图完全一致。",
    "7. 禁止对参考物品进行任何变形和机械结构改变。严格保留参考图中肉眼可见的所有产品细节。",
    "8. 禁止对参考图中未直接呈现的任何功能、内部结构或产品特征进行推断或假设，禁止加入参考图中不存在的结构、零件或形态特征。",
    "9. 颜色保真：必须生成参考图中颜色的产品。",
    "10. 结构保真度：严格复制参考图中产品的精确物理结构，匹配所有组件的精确数量、位置、比例和空间关系，每个元素必须在几何上精确且在现实世界中物理可实现，不得添加、移除、合并或变形任何结构元素。",
  ].filter(Boolean).join("\n")
}

export async function listStudioGenesisModels(merchantId: string | null) {
  const normalizeConfigs = (configs: ReturnType<typeof listEnvModelConfigs>, category: "chat" | "image") => {
    return configs.map((config) => {
      const providerKey = String(config.provider?.key || config.providerId || "").trim()
      const modelId = String(config.modelId || "").trim()
      const runtimeId = buildModelRuntimeId(modelId, providerKey)
      return {
        id: runtimeId,
        runtimeId,
        modelId,
        name: String(config.name || modelId).trim() || modelId,
        category,
        providerLabel: String(config.provider?.name || providerKey).trim(),
        cost: Number(config.cost || 0),
      } satisfies StudioGenesisModelOption
    })
  }

  const [textModels, imageModels, textModel, imageModel] = await Promise.all([
    Promise.resolve(normalizeConfigs(listEnvModelConfigs("CHAT"), "chat")),
    Promise.resolve(normalizeConfigs(listEnvModelConfigs("IMAGE"), "image")),
    resolveSceneModelCandidate(merchantId, undefined, "CHAT", TEXT_SCENES),
    resolveSceneModelCandidate(merchantId, undefined, "IMAGE", IMAGE_SCENES),
  ])

  const preferredTextRuntimeId = String(textModel?.runtimeId || "").trim()
  const preferredImageRuntimeId = String(imageModel?.runtimeId || "").trim()

  return {
    textModel: textModels.find((item) => item.runtimeId === preferredTextRuntimeId) || textModels[0] || null,
    imageModel: imageModels.find((item) => item.runtimeId === preferredImageRuntimeId) || imageModels[0] || null,
    textModels: textModels.map((item) => ({ ...item, isDefault: item.runtimeId === preferredTextRuntimeId })),
    imageModels: imageModels.map((item) => ({ ...item, isDefault: item.runtimeId === preferredImageRuntimeId })),
  }
}

export async function analyzeStudioGenesisProductSet(params: {
  productImages: string[]
  imageType?: "main" | "detail"
  targetPlatform?: string
  workflowMode?: StudioGenesisWorkflowMode
  portraitImage?: string
  referenceImages?: string[]
  requirements?: string
  targetLanguage?: string
  imageCount?: number
  textModelId?: string
  merchantId: string | null
  requestOrigin?: string
  onProgress?: AnalysisProgressReporter
}): Promise<StudioGenesisAnalysisResult> {
  const workflowMode: StudioGenesisWorkflowMode = params.workflowMode === "knowledge" ? "knowledge" : "product"
  const maxSourceImages = STUDIO_GENESIS_MAX_PRODUCT_IMAGES
  const productImages = Array.from(
    new Set((Array.isArray(params.productImages) ? params.productImages : []).map((item) => String(item || "").trim()).filter(Boolean))
  ).slice(0, maxSourceImages)
  const modelProductImages = await normalizeGenerationReferenceImages(productImages, params.requestOrigin)

  if (modelProductImages.length === 0) {
    throw new Error("请先上传至少一张商品图")
  }

  const imageCount = clampStudioGenesisImageCount(params.imageCount)
  const targetLanguage = String(params.targetLanguage || DEFAULT_STUDIO_GENESIS_SETTINGS.targetLanguage).trim()
  const normalizedRequirements = normalizeRequirementsPlainText(String(params.requirements || "").trim(), workflowMode)
  const requirementsForUnderstanding =
    workflowMode === "knowledge"
      ? buildKnowledgeRequirementsDigest(normalizedRequirements) || normalizedRequirements
      : normalizedRequirements
  let imageUnderstandingText = ""
  const reportProgress: AnalysisProgressReporter = (message, step = "processing") => {
    if (typeof params.onProgress === "function") {
      params.onProgress(message, step)
    }
  }

  reportProgress("正在校验参考图与任务参数...", "queued")
  reportProgress(
    workflowMode === "knowledge"
      ? "正在解析老师人物图、课堂参考图与讲师视觉锚点..."
      : "正在解析产品图片中的结构、材质和视觉锚点...",
    "image-understanding"
  )

  try {
    const understanding = await analyzeReferenceImagesWithGemini({
      images: productImages,
      locale: "zh-CN",
      userPrompt:
        workflowMode === "knowledge"
          ? `第1张图为老师人物锚点图，其余为课堂/空间/器物/课程样张参考图。请总结老师不可改变的人物特征，以及整套知识付费课程海报应继承的视觉系统。如果这些参考图明显是一整套成熟课程样张，请额外总结：页面顺序、每页承担的招生转化角色、人物出镜规律、哪些页面以信息模块为主、哪些页面以场景图为主、深浅底切换规律、常见模板（如圆角信息板、胶囊条、编号模块、图标四宫格、三联图、极简收尾页）。用户补充需求（已结构化）：${requirementsForUnderstanding || "无"}`
          : `请为商品详情页生成总结这组商品图的视觉锚点与不可更改特征。用户补充需求（已规范化）：${normalizedRequirements || "无"}`,
      requestOrigin: params.requestOrigin,
      preferredApiKey: process.env.GEMINI_IMAGE_UNDERSTANDING_API_KEY || undefined,
      preferredBaseUrl: process.env.GEMINI_IMAGE_UNDERSTANDING_BASE_URL || undefined,
      preferredModel: process.env.GEMINI_IMAGE_UNDERSTANDING_MODEL || undefined,
      requireRelayCredentials: true,
    })
    if (understanding.status === "ok") {
      imageUnderstandingText = String(understanding.summary || "").trim()
    }
  } catch (error) {
    console.warn("[studio-genesis] reference understanding failed", error)
  }

  reportProgress("正在整理用户需求、参考图理解和输出规则...", "prompt-build")

  const userPrompt = buildStudioGenesisAnalysisPromptPreview({
    imageType: params.imageType,
    targetPlatform: params.targetPlatform,
    workflowMode,
    requirements: normalizedRequirements,
    targetLanguage,
    imageCount,
    imageUnderstandingText,
  })

  const analysisMaxTokens = resolveStudioGenesisAnalysisMaxTokens(imageCount)

  reportProgress(
    workflowMode === "knowledge"
      ? "正在调用课程分析 Agent 生成讲师海报与课程套图规划..."
      : "正在调用产品分析 Agent 生成整体设计规范...",
    "model-run"
  )

  const completion = await chatTextCompletion({
    merchantId: params.merchantId,
    requestedRuntimeId: params.textModelId,
    systemPrompt: buildAnalysisSystemPrompt(),
    userPrompt,
    userContent: [
      { type: "text", text: userPrompt },
      ...modelProductImages.map((url) => ({ type: "image_url", image_url: { url } })),
    ],
    temperature: 0.4,
    maxTokens: analysisMaxTokens,
    responseFormat: { type: "json_object" },
  })

  reportProgress("正在校验返回格式并整理图片规划结果...", "result-normalize")

  let parsed: any
  try {
    parsed = parseJsonObjectWithRepair(completion.content)
  } catch (error) {
    reportProgress("首次结果存在格式问题，正在自动修复 JSON 结构...", "json-repair")
    parsed = await repairAnalysisJsonWithModel({
      merchantId: params.merchantId,
      requestedRuntimeId: params.textModelId,
      malformedContent: completion.content,
      imageCount,
      workflowMode,
    })
  }

  reportProgress("分析完成，正在加载设计规划...", "completed")

  return normalizeStudioGenesisAnalysisResult(
    {
      ...parsed,
      imageUnderstandingText,
      modelId: completion.modelId,
      provider: completion.provider,
    },
    {
      imageCount,
      targetLanguage,
      workflowMode,
    }
  )
}

export async function generateStudioGenesisPlanImage(params: {
  merchantId: string | null
  requestOrigin?: string
  productImages: string[]
  imageType?: "main" | "detail"
  workflowMode?: StudioGenesisWorkflowMode
  portraitImage?: string
  referenceImages?: string[]
  requirements?: string
  settings: Pick<StudioGenesisSettings, "imageModelId" | "aspectRatio" | "imageSize" | "speedMode" | "targetLanguage">
  analysisResult: Pick<StudioGenesisAnalysisResult, "designSpecs" | "imageUnderstandingText">
  plan: StudioGenesisPlan
  precomputedPrompt?: string
  onTaskSubmitted?: (task: {
    taskId: string
    endpointBase?: string
    modelId?: string
    provider?: string
  }) => void | Promise<void>
}) {
  const modelCandidate = await resolveSceneModelCandidate(
    params.merchantId,
    params.settings.imageModelId,
    "IMAGE",
    IMAGE_SCENES
  )
  if (!modelCandidate?.provider) {
    throw new Error("未配置【商品详情页生图】模型，请先配置“商品详情页生图”模型")
  }

  const workflowMode: StudioGenesisWorkflowMode = params.workflowMode === "knowledge" ? "knowledge" : "product"
  const sourceReferenceImages =
    workflowMode === "knowledge"
      ? [String(params.portraitImage || "").trim(), ...((params.referenceImages || []).map((item) => String(item || "").trim()))].filter(Boolean)
      : params.productImages
  const normalizedReferenceImages = await normalizeGenerationReferenceImages(sourceReferenceImages, params.requestOrigin)
  const prompt =
    String(params.precomputedPrompt || "").trim() ||
    buildStudioGenesisPlanImagePrompt({
      requestOrigin: params.requestOrigin,
      productImages: params.productImages,
      imageType: params.imageType,
      workflowMode,
      portraitImage: params.portraitImage,
      referenceImages: params.referenceImages,
      requirements: params.requirements,
      settings: params.settings,
      analysisResult: params.analysisResult,
      plan: params.plan,
      normalizedReferenceCount: normalizedReferenceImages.length,
    })

  const options = {
    aspectRatio: String(params.settings.aspectRatio || DEFAULT_STUDIO_GENESIS_SETTINGS.aspectRatio).trim(),
    imageSize: String(params.settings.imageSize || DEFAULT_STUDIO_GENESIS_SETTINGS.imageSize).trim(),
    referenceImages: normalizedReferenceImages,
    responseFormat: "url" as const,
    quality: resolveQualityFromSpeedMode(params.settings.speedMode || "standard"),
    optimizePromptMode: params.settings.speedMode === "turbo" ? "fast" : "standard",
    renderSpeed: params.settings.speedMode === "turbo" ? "turbo" : "fast",
    onTaskSubmitted: params.onTaskSubmitted,
  }

  const result = modelCandidate.provider
    ? await modelRouter.generateWithDbCredentials(
        prompt,
        modelCandidate.modelId,
        modelCandidate.provider,
        options,
        "image"
      )
    : await modelRouter.generate(prompt, modelCandidate.modelId, options)

  const rawUrl = normalizeImageResultUrl(result)
  if (!rawUrl) {
    throw new Error("图片模型返回了空结果")
  }

  const url = await persistGeneratedImageIfNeeded(rawUrl)

  return {
    url,
    prompt,
    modelId: modelCandidate.modelId,
    provider: String(modelCandidate.provider?.key || result.provider || "").trim(),
  }
}

export function buildStudioGenesisPlanImagePrompt(params: {
  requestOrigin?: string
  productImages: string[]
  imageType?: "main" | "detail"
  workflowMode?: StudioGenesisWorkflowMode
  portraitImage?: string
  referenceImages?: string[]
  requirements?: string
  settings: Pick<StudioGenesisSettings, "imageModelId" | "aspectRatio" | "imageSize" | "speedMode" | "targetLanguage">
  analysisResult: Pick<StudioGenesisAnalysisResult, "designSpecs" | "imageUnderstandingText">
  plan: StudioGenesisPlan
  normalizedReferenceCount: number
}) {
  const workflowMode: StudioGenesisWorkflowMode = params.workflowMode === "knowledge" ? "knowledge" : "product"
  const imageType = params.imageType === "detail" ? "detail" : "main"
  const basePrompt = imageType === "main" && workflowMode === "product"
    ? buildMainImagePromptFromPlan({
        requirements: String(params.requirements || "").trim(),
        designSpecs: String(params.analysisResult.designSpecs || "").trim(),
        plan: params.plan,
        imageUnderstandingText: String(params.analysisResult.imageUnderstandingText || "").trim(),
      })
    : buildGenerationPrompt({
        imageType,
        workflowMode,
        requirements: String(params.requirements || "").trim(),
        targetLanguage: String(params.settings.targetLanguage || DEFAULT_STUDIO_GENESIS_SETTINGS.targetLanguage).trim(),
        designSpecs: String(params.analysisResult.designSpecs || "").trim(),
        plan: params.plan,
        imageUnderstandingText: String(params.analysisResult.imageUnderstandingText || "").trim(),
      })
  const promptContext = buildImageUnderstandingPromptContext(
    String(params.analysisResult.imageUnderstandingText || "").trim(),
    "zh-CN"
  )

  return buildGenerationAnchoringPrompt({
    workflowMode,
    prompt: `${basePrompt}${promptContext ? `\n\n${promptContext}` : ""}`,
    referenceCount: params.normalizedReferenceCount,
    imageUnderstandingText: String(params.analysisResult.imageUnderstandingText || "").trim(),
  })
}
