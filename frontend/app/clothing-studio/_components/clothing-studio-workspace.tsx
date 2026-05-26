"use client"

import Image from "next/image"
import { useEffect, useRef, useState, type ReactNode } from "react"
import JSZip from "jszip"
import {
  AlertCircle,
  ArrowLeft,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  Focus,
  Gauge,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Minus,
  Palette,
  Pencil,
  PencilLine,
  Plus,
  RefreshCcw,
  Rocket,
  Settings2,
  Shirt,
  Sparkles,
  Target,
  Trash2,
  Upload,
  User,
  Zap,
} from "lucide-react"
import {
  PICSET_CARD_CLASS,
  PICSET_CONTAINER_CLASS,
  PICSET_FIELD_CLASS,
  PICSET_FONT_FAMILY,
  PICSET_GRID_CLASS,
  PICSET_MAIN_CLASS,
  PICSET_OVERLAY_ACTION_BUTTON_CLASS,
  PICSET_PAGE_BACKGROUND_CLASS,
  PICSET_SEGMENTED_TRAY_CLASS,
  PICSET_SEGMENTED_TRIGGER_ACTIVE_CLASS,
  PICSET_SEGMENTED_TRIGGER_CLASS,
  PICSET_SEGMENTED_TRIGGER_INACTIVE_CLASS,
  PICSET_THUMB_SURFACE_CLASS,
  PICSET_TEXTAREA_CLASS,
  PICSET_THEME_STYLE,
  PICSET_UPLOAD_ACTIVE_SURFACE_CLASS,
  PICSET_UPLOAD_SURFACE_CLASS,
} from "@/components/picset/picset-theme"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { openImageInCanvas } from "@/lib/canvas/open-image-in-canvas"
import { cn } from "@/lib/utils"
import { fetchAndDownload, resolveImageDownloadUrl, triggerBrowserDownload } from "@/lib/url/download-url"
import { toImageProxyUrlWithParams } from "@/lib/url/image-proxy-policy"
import {
  CLOTHING_STUDIO_ASPECT_RATIOS,
  CLOTHING_STUDIO_IMAGE_SIZES,
  CLOTHING_STUDIO_MAX_PRODUCT_IMAGES,
  CLOTHING_STUDIO_MAX_TRYON_OUTPUT_COUNT,
  CLOTHING_STUDIO_SPEED_MODES,
  CLOTHING_STUDIO_STORAGE_KEY,
  CLOTHING_STUDIO_TARGET_LANGUAGES,
  DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS,
  DEFAULT_CLOTHING_STUDIO_SETTINGS,
  DEFAULT_CLOTHING_STUDIO_TRYON_SELECTIONS,
  buildClothingStudioGeneratedPlaceholders,
  buildClothingStudioImageFilename,
  buildClothingStudioPlanBlueprint,
  clampClothingStudioOutputCount,
  clampClothingStudioTryOnOutputCount,
  mapClothingStudioPlanCategoryToPromptType,
  normalizeClothingStudioAnalysisResult,
  normalizeClothingStudioBasicSelections,
  normalizeClothingStudioTryOnSelections,
  type ClothingStudioAnalysisResult,
  type ClothingStudioBasicSelections,
  type ClothingStudioGeneratedImage,
  type ClothingStudioImageJobRecord,
  type ClothingStudioJobRecord,
  type ClothingStudioMode,
  type ClothingStudioModelOption,
  type ClothingStudioModelSettingsPayload,
  type ClothingStudioPlan,
  type ClothingStudioPromptGenerationResponse,
  type ClothingStudioStep,
  type ClothingStudioTryOnSelections,
} from "@/lib/clothing-studio"

const STEP_ITEMS: Array<{ id: ClothingStudioStep; label: string }> = [
  { id: "input", label: "上传图片" },
  { id: "analyzing", label: "AI 分析" },
  { id: "preview", label: "预览方案" },
  { id: "generating", label: "生成中" },
  { id: "complete", label: "完成" },
]

const PICSET_SOLID_DARK_BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap bg-[#1f1f23] text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition-all duration-200 hover:bg-[#18181c] hover:shadow-[0_16px_34px_rgba(15,23,42,0.22)]"

const PICSET_NEUTRAL_BUTTON_CLASS =
  "border border-[#e4e4e7] bg-white text-[#71717a] transition-all duration-200 hover:border-[#d4d4d8] hover:bg-[#fafafa] hover:text-[#18181b]"

type PersistedWorkspaceState = {
  mode: ClothingStudioMode
  currentStep: ClothingStudioStep
  productImages: string[]
  modelImage: string
  requirements: string
  settings: typeof DEFAULT_CLOTHING_STUDIO_SETTINGS
  basicSelections: ClothingStudioBasicSelections
  tryOnSelections: ClothingStudioTryOnSelections
  analysisResult: ClothingStudioAnalysisResult | null
  analysisSignature: string
  generatedImages: ClothingStudioGeneratedImage[]
  modelGeneratorForm?: ModelGeneratorFormState
  modelGenerationHistory?: ModelGenerationPreviewImage[]
  modelGenerationPreview?: ModelGenerationPreviewImage[]
  selectedGeneratedModelId?: string
}

type ModelGeneratorFormState = {
  gender: "female" | "male" | "androgynous"
  ageRange: string
  ethnicity: string
  requirements: string
  count: number
  turbo: boolean
}

type ModelGenerationPreviewImage = {
  id: string
  batchId: string
  url: string
  prompt: string
  summary: string
  createdAt: string
  modelId: string
  provider: string
  analysisModelId?: string
  analysisProvider?: string
}

const MODEL_GENERATOR_GENDER_OPTIONS: Array<{ value: ModelGeneratorFormState["gender"]; label: string }> = [
  { value: "female", label: "女性" },
  { value: "male", label: "男性" },
  { value: "androgynous", label: "中性" },
]

const MODEL_GENERATOR_AGE_OPTIONS = ["18-25岁", "26-35岁", "36-45岁", "46岁以上"] as const
const MODEL_GENERATOR_ETHNICITY_OPTIONS = ["亚洲人", "欧美人", "拉丁裔", "中东人", "非洲裔", "混血感"] as const

const DEFAULT_MODEL_GENERATOR_FORM: ModelGeneratorFormState = {
  gender: "female",
  ageRange: "26-35岁",
  ethnicity: "亚洲人",
  requirements: "",
  count: 2,
  turbo: false,
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function extractClothingStudioJobRecord(input: unknown): ClothingStudioJobRecord | null {
  const direct = input as ClothingStudioJobRecord | null | undefined
  if (
    direct &&
    typeof direct === "object" &&
    typeof direct.id === "string" &&
    (direct.type === "ANALYSIS" || direct.type === "IMAGE_GEN")
  ) {
    return direct
  }

  const nested = (input as { job?: ClothingStudioJobRecord } | null | undefined)?.job
  if (
    nested &&
    typeof nested === "object" &&
    typeof nested.id === "string" &&
    (nested.type === "ANALYSIS" || nested.type === "IMAGE_GEN")
  ) {
    return nested
  }

  return null
}

function createAbortError() {
  const error = new Error("AbortError")
  ;(error as Error & { name: string }).name = "AbortError"
  return error
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildPromptGenerationAnalysisJson(result: ClothingStudioAnalysisResult) {
  return {
    design_specs: String(result.summary || "").trim(),
    images: result.images.map((plan) => ({
      id: String(plan.id || "").trim(),
      category: plan.category,
      order: plan.order,
      type: mapClothingStudioPlanCategoryToPromptType(plan.category),
      title: String(plan.title || "").trim(),
      description: String(plan.description || "").trim(),
      design_content: String(plan.designContent || "").trim(),
      prompt_hint: String(plan.promptHint || "").trim(),
    })),
  }
}

function normalizePromptGenerationResponse(
  input: ClothingStudioPromptGenerationResponse | null,
  plans: ClothingStudioPlan[]
) {
  return plans.map((plan, index) => {
    const source = Array.isArray(input?.prompts) ? input.prompts[index] : null
    const prompt = String(source?.prompt || "").trim()
    if (!prompt) {
      throw new Error(`第 ${index + 1} 张图片缺少可用提示词`)
    }

    return {
      plan,
      title: String(source?.title || plan.title).trim() || plan.title,
      description: String(source?.description || plan.description).trim() || plan.description,
      prompt,
    }
  })
}

function clampModelGeneratorCount(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_MODEL_GENERATOR_FORM.count
  return Math.max(1, Math.min(4, Math.round(numeric)))
}

function normalizeModelGeneratorForm(
  input: Partial<ModelGeneratorFormState> | null | undefined
): ModelGeneratorFormState {
  return {
    gender:
      input?.gender === "male" || input?.gender === "androgynous"
        ? input.gender
        : DEFAULT_MODEL_GENERATOR_FORM.gender,
    ageRange:
      MODEL_GENERATOR_AGE_OPTIONS.find((item) => item === input?.ageRange) || DEFAULT_MODEL_GENERATOR_FORM.ageRange,
    ethnicity:
      MODEL_GENERATOR_ETHNICITY_OPTIONS.find((item) => item === input?.ethnicity) || DEFAULT_MODEL_GENERATOR_FORM.ethnicity,
    requirements: String(input?.requirements || ""),
    count: clampModelGeneratorCount(input?.count),
    turbo: typeof input?.turbo === "boolean" ? input.turbo : DEFAULT_MODEL_GENERATOR_FORM.turbo,
  }
}

function normalizeModelGenerationPreviewItem(input: any): ModelGenerationPreviewImage | null {
  const id = String(input?.id || "").trim()
  const batchId = String(input?.batchId || "").trim()
  const url = String(input?.url || "").trim()
  if (!id || !batchId || !url) return null

  return {
    id,
    batchId,
    url,
    prompt: String(input?.prompt || "").trim(),
    summary: String(input?.summary || "").trim(),
    createdAt: String(input?.createdAt || "").trim() || new Date().toISOString(),
    modelId: String(input?.modelId || "").trim(),
    provider: String(input?.provider || "").trim(),
    analysisModelId: String(input?.analysisModelId || "").trim(),
    analysisProvider: String(input?.analysisProvider || "").trim(),
  }
}

function normalizeModelGenerationPreviewList(input: unknown): ModelGenerationPreviewImage[] {
  return Array.isArray(input)
    ? input
        .map((item) => normalizeModelGenerationPreviewItem(item))
        .filter((item): item is ModelGenerationPreviewImage => Boolean(item))
    : []
}

function buildModelGenerationSummaryText(item: Pick<ModelGenerationPreviewImage, "summary">) {
  return String(item.summary || "").trim() || "模特生成记录"
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return "刚刚"

  const diff = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return "刚刚"
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))} 小时前`
  return `${Math.max(1, Math.floor(diff / day))} 天前`
}

function resolveDefaultModelGeneratorGender(modeGender: ClothingStudioTryOnSelections["modelGender"]): ModelGeneratorFormState["gender"] {
  if (modeGender === "male") return "male"
  if (modeGender === "androgynous") return "androgynous"
  return "female"
}

function buildAnalysisSignature(params: {
  mode: ClothingStudioMode
  productImages: string[]
  modelImage?: string
  requirements: string
  targetLanguage: string
  basicSelections: ClothingStudioBasicSelections
  tryOnSelections: ClothingStudioTryOnSelections
}) {
  return JSON.stringify({
    mode: params.mode,
    productImages: [...params.productImages].sort(),
    modelImage: String(params.modelImage || "").trim(),
    requirements: params.requirements.trim(),
    targetLanguage: params.targetLanguage.trim() || "none",
    basicSelections: normalizeClothingStudioBasicSelections(params.basicSelections),
    tryOnSelections: normalizeClothingStudioTryOnSelections(params.tryOnSelections),
  })
}

function formatPointsCost(value: number) {
  const normalized = Number(value || 0)
  if (!Number.isFinite(normalized) || normalized <= 0) return "0"
  return Number.isInteger(normalized) ? String(normalized) : String(Number(normalized.toFixed(2)))
}

function collapseTryOnSelectionsToSourceUi(
  selections: ClothingStudioTryOnSelections,
  preferredCount?: number
): ClothingStudioTryOnSelections {
  const totalCount = clampClothingStudioTryOnOutputCount(
    preferredCount ??
      selections.catalogCount +
        selections.lifestyleCount +
        selections.campaignCount +
        selections.detailCount
  )

  return {
    ...selections,
    catalogCount: Math.max(1, totalCount),
    lifestyleCount: 0,
    campaignCount: 0,
    detailCount: 0,
  }
}

function resolveTryOnOutputCount(selections: ClothingStudioTryOnSelections) {
  return Math.max(1, clampClothingStudioTryOnOutputCount(
    selections.catalogCount +
      selections.lifestyleCount +
      selections.campaignCount +
      selections.detailCount
  ))
}

function restorePersistedState(raw: PersistedWorkspaceState): PersistedWorkspaceState {
  const mode = raw.mode === "tryon" ? "tryon" : "basic"
  const basicSelections = normalizeClothingStudioBasicSelections(raw.basicSelections)
  const tryOnSelections = collapseTryOnSelectionsToSourceUi(normalizeClothingStudioTryOnSelections(raw.tryOnSelections))
  const modelGeneratorForm = normalizeModelGeneratorForm(raw.modelGeneratorForm)
  const modelGenerationHistory = normalizeModelGenerationPreviewList(raw.modelGenerationHistory)
  const modelGenerationPreview = normalizeModelGenerationPreviewList(raw.modelGenerationPreview)
  const selectedGeneratedModelId = String(raw.selectedGeneratedModelId || "").trim()
  const analysisResult = raw.analysisResult
    ? normalizeClothingStudioAnalysisResult(raw.analysisResult, {
        mode,
        basicSelections,
        tryOnSelections,
        targetLanguage: raw.settings?.targetLanguage || DEFAULT_CLOTHING_STUDIO_SETTINGS.targetLanguage,
      })
    : null

  let currentStep = raw.currentStep || "input"
  let generatedImages = Array.isArray(raw.generatedImages) ? raw.generatedImages : []

  if (currentStep === "generating") {
    generatedImages = generatedImages.map((item) =>
      item.status === "prompting" || item.status === "generating"
        ? { ...item, status: "cancelled", error: "上次批量生成已中断，请重新开始。" }
        : item
    )
    currentStep = generatedImages.some((item) => item.status === "done" || item.status === "error" || item.status === "cancelled")
      ? "complete"
      : analysisResult
        ? "preview"
        : "input"
  }

  if (!analysisResult && currentStep !== "input") {
    currentStep = "input"
  }

  return {
    mode,
    currentStep,
    productImages: Array.isArray(raw.productImages) ? raw.productImages.map((item) => String(item || "").trim()).filter(Boolean) : [],
    modelImage: String(raw.modelImage || "").trim(),
    requirements: String(raw.requirements || ""),
    settings: {
      ...DEFAULT_CLOTHING_STUDIO_SETTINGS,
      ...(raw.settings || {}),
    },
    basicSelections,
    tryOnSelections,
    analysisResult,
    analysisSignature: String(raw.analysisSignature || ""),
    generatedImages,
    modelGeneratorForm,
    modelGenerationHistory,
    modelGenerationPreview,
    selectedGeneratedModelId,
  }
}

function resolveStepIndex(step: ClothingStudioStep) {
  return STEP_ITEMS.findIndex((item) => item.id === step)
}

function resolveStepAfterGeneration(
  images: ClothingStudioGeneratedImage[],
  hasAnalysis: boolean
): ClothingStudioStep {
  if (images.some((item) => item.status === "done" || item.status === "error" || item.status === "cancelled")) {
    return "complete"
  }
  return hasAnalysis ? "preview" : "input"
}

function normalizePreviewText(value: string) {
  let text = String(value || "")

  for (let index = 0; index < 2; index += 1) {
    text = text
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
  }

  text = text
    .replace(/\s*(#{2,6}\s+)/g, "\n\n$1")
    .replace(/\s*-\s*(\*\*[^*\n]+?\*\*[：:])/g, "\n- $1")
    .replace(/([^\n])(\*\*(?:设计目标|模特要求|服饰工艺焦点|图中图元素|构图方案|内容要素|文字内容|视觉氛围|展示重点|突出卖点|背景元素|装饰元素|主标题|副标题|说明文字|情绪关键词|光影效果|人物占比|布局方式|文字区域)\*\*[：:])/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")

  return text
}

function splitPreviewLines(value: string) {
  const normalized = normalizePreviewText(value).trim()
  if (!normalized) return []
  return normalized.split("\n").map((line) => line.trimEnd())
}

function stripHeadingPrefix(value: string) {
  return value.replace(/^#{1,6}\s*/, "").trim()
}

function matchLabelValue(value: string) {
  const matched = value.match(/^([^：:]+?)([：:])\s*(.+)$/)
  if (!matched) return null

  const label = matched[1]?.trim()
  const separator = matched[2] || "："
  const content = matched[3]?.trim()

  if (!label || !content) return null

  return { label, separator, content }
}

function matchBoldLabelValue(value: string) {
  const matched = value.match(/^\*\*(.+?)\*\*([：:])\s*(.+)$/)
  if (!matched) return null

  const label = matched[1]?.trim()
  const separator = matched[2] || "："
  const content = matched[3]?.trim()

  if (!label || !content) return null

  return { label, separator, content }
}

function renderPreviewLabelRow(key: string, label: string, content: string) {
  return (
    <div key={key} className="mb-1 flex gap-2 text-xs">
      <span className="whitespace-nowrap font-medium text-foreground">{label}</span>
      <span className="text-muted-foreground">{content}</span>
    </div>
  )
}

function renderPreviewBulletRow(key: string, content: string) {
  return (
    <div key={key} className="mb-1 ml-2 flex gap-2 text-xs">
      <span className="text-muted-foreground">•</span>
      <span className="text-muted-foreground">{content}</span>
    </div>
  )
}

function isDesignSpecsSectionHeading(value: string) {
  const normalized = stripHeadingPrefix(value)
  if (!normalized) return false
  if (/^#{2,6}\s+/.test(value)) return true
  if (/^[>\-•]/.test(normalized)) return false
  if (normalized.includes("：") || normalized.includes(":")) return false
  return normalized.length <= 16
}

function renderDesignSpecsPreview(value: string) {
  const lines = splitPreviewLines(value)
  const firstContentIndex = lines.findIndex((line) => line.trim())

  return lines.map((line, index) => {
    const trimmed = line.trim()
    const key = `design-spec-${index}`

    if (!trimmed) {
      return <div key={key} className="h-2" />
    }

    if (index === firstContentIndex) {
      return (
        <h3 key={key} className="mb-3 mt-4 text-lg font-bold text-foreground first:mt-0">
          {stripHeadingPrefix(trimmed)}
        </h3>
      )
    }

    if (trimmed.startsWith(">")) {
      return (
        <blockquote key={key} className="mb-2 border-l-2 border-primary/30 pl-3 text-xs italic text-muted-foreground">
          {trimmed.replace(/^>\s*/, "")}
        </blockquote>
      )
    }

    if (isDesignSpecsSectionHeading(trimmed)) {
      return (
        <h4 key={key} className="mb-2 mt-4 text-sm font-semibold text-foreground">
          {stripHeadingPrefix(trimmed).replace(/[：:]$/, "")}
        </h4>
      )
    }

    if (/^[•●]\s*/.test(trimmed)) {
      return renderPreviewBulletRow(key, trimmed.replace(/^[•●]\s*/, ""))
    }

    const labelValue = matchLabelValue(trimmed)
    if (labelValue && !trimmed.startsWith("-") && !trimmed.startsWith("**") && !trimmed.startsWith("#")) {
      return renderPreviewLabelRow(key, `${labelValue.label}${labelValue.separator}`, labelValue.content)
    }

    return (
      <p key={key} className="mb-1 text-xs text-muted-foreground">
        {trimmed}
      </p>
    )
  })
}

function renderPlanContentPreview(value: string) {
  return splitPreviewLines(value).map((line, index) => {
    const trimmed = line.trim()
    const key = `plan-detail-${index}`

    if (!trimmed) {
      return <div key={key} className="h-1.5" />
    }

    if (/^[-•●]\s+/.test(trimmed)) {
      return renderPreviewBulletRow(key, trimmed.replace(/^[-•●]\s+/, ""))
    }

    const boldLabelValue = matchBoldLabelValue(trimmed)
    if (boldLabelValue) {
      return renderPreviewLabelRow(key, `${boldLabelValue.label}${boldLabelValue.separator}`, boldLabelValue.content)
    }

    const labelValue = matchLabelValue(trimmed)
    if (labelValue && !trimmed.startsWith("-") && !trimmed.startsWith("**") && !trimmed.startsWith("#")) {
      return renderPreviewLabelRow(key, `${labelValue.label}${labelValue.separator}`, labelValue.content)
    }

    return (
      <p key={key} className="mb-1 text-xs text-muted-foreground">
        {trimmed}
      </p>
    )
  })
}

function resolveAspectRatioStyle(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized.includes(":")) {
    return { aspectRatio: "3 / 4" as const }
  }
  return { aspectRatio: normalized.replace(":", " / ") }
}

function InlineAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "warning" | "success"
  children: ReactNode
}) {
  const styles =
    tone === "warning"
      ? "border-[#f5d8a8] bg-[#fff8ec] text-[#8a5d18]"
      : tone === "success"
        ? "border-[#b8dfca] bg-[#f1fbf4] text-[#21663d]"
        : "border-[#f1c5c7] bg-[#fff2f3] text-[#a83b43]"

  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-xs leading-6", styles)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function StepRail({ currentStep }: { currentStep: ClothingStudioStep }) {
  const activeIndex = resolveStepIndex(currentStep)
  const isAllComplete = currentStep === "complete"

  return (
    <div className="custom-scrollbar flex items-center justify-start gap-2 overflow-x-auto py-4 sm:justify-center">
      {STEP_ITEMS.map((item, index) => {
        const isActive = item.id === currentStep
        const isCompleted = index < activeIndex
        const isFinalComplete = isAllComplete && isActive
        const isReached = isActive || isCompleted
        return (
          <div key={item.id} className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium transition-all",
                  isFinalComplete
                    ? "border-emerald-500 bg-emerald-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.24)]"
                    : isCompleted
                      ? "border-[#1f1f23] bg-[#1f1f23] text-white shadow-[0_8px_20px_rgba(15,23,42,0.16)]"
                      : isActive
                        ? "border-[#1f1f23] bg-[#1f1f23] text-white shadow-[0_8px_20px_rgba(15,23,42,0.16)]"
                        : "border-transparent bg-[#f4f4f5] text-[#8b8b95]"
                )}
              >
                {isFinalComplete ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-xs font-medium transition-colors",
                  isFinalComplete ? "text-emerald-600" : isReached ? "text-[#18181b]" : "text-[#8b8b95]"
                )}
              >
                {item.label}
              </span>
            </div>
            {index < STEP_ITEMS.length - 1 ? (
              <div
                className={cn(
                  "h-px w-8 transition-colors",
                  index < activeIndex ? "bg-[#1f1f23]" : "bg-[#e7e5e4]"
                )}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <label className="w-full space-y-1">
      <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(PICSET_FIELD_CLASS, "h-11 rounded-2xl px-3.5 py-2 pr-10 text-[13px]")}
        >
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
      </div>
    </label>
  )
}

function ModelGeneratorSelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className="flex-1 space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="flex h-9 w-full appearance-none items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 pr-8 text-sm text-zinc-900 transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
      </div>
    </label>
  )
}

function SpeedModePicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className={cn("space-y-2.5 p-4", PICSET_CARD_CLASS)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold tracking-tight text-foreground">生图速度</p>
          <p className="text-[11px] text-muted-foreground">
            {CLOTHING_STUDIO_SPEED_MODES.find((item) => item.value === value)?.description || "标准速度，积分消耗最低"}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {CLOTHING_STUDIO_SPEED_MODES.map((item) => {
          const active = value === item.value
          const Icon = item.value === "standard" ? Zap : item.value === "fast" ? Gauge : Rocket
          return (
            <button
              key={item.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(item.value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-[11px] font-medium transition-all",
                active
                  ? "border-[#1f1f23] bg-[#1f1f23] text-white shadow-[0_10px_24px_rgba(15,23,42,0.14)]"
                  : PICSET_NEUTRAL_BUTTON_CLASS
              )}
            >
              <Icon className="h-3 w-3" />
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProductUploadCard({
  images,
  isUploading,
  error,
  onFiles,
  onRemove,
}: {
  images: string[]
  isUploading: boolean
  error: string
  onFiles: (files: File[]) => void
  onRemove: (index: number) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const canAddMore = images.length < CLOTHING_STUDIO_MAX_PRODUCT_IMAGES

  const openPicker = () => {
    if (isUploading || !canAddMore) return
    inputRef.current?.click()
  }

  return (
    <div className={cn("p-4", PICSET_CARD_CLASS)}>
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent">
            <ImageIcon className="h-4.5 w-4.5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">产品图</h3>
            <p className="text-xs text-muted-foreground">上传多角度产品图或细节图</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{images.length}/{CLOTHING_STUDIO_MAX_PRODUCT_IMAGES}</span>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith("image/"))
          if (files.length > 0) onFiles(files)
        }}
        className={cn(images.length === 0 ? "rounded-[24px] border-2 border-dashed transition-all duration-200" : "")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          disabled={isUploading || !canAddMore}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files || [])
            if (files.length > 0) onFiles(files)
            event.currentTarget.value = ""
          }}
        />
        {images.length === 0 ? (
          <button
            type="button"
            onClick={openPicker}
            disabled={isUploading || !canAddMore}
            className={cn(
              "relative flex w-full cursor-pointer flex-col items-center justify-center px-4 py-10",
              dragActive ? PICSET_UPLOAD_ACTIVE_SURFACE_CLASS : PICSET_UPLOAD_SURFACE_CLASS
            )}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
              {isUploading ? <Loader2 className="h-4.5 w-4.5 animate-spin text-muted-foreground" /> : <Upload className="h-4.5 w-4.5 text-muted-foreground" />}
            </div>
            <div className="mt-2.5 text-center">
              <p className="text-sm font-medium text-foreground">拖拽或点击上传</p>
              <p className="mt-1 text-[11px] text-muted-foreground">上传多角度产品图或细节图</p>
            </div>
          </button>
        ) : (
          <div className="max-h-[400px] overflow-y-auto overflow-x-hidden custom-scrollbar">
            <div className="grid grid-cols-4 gap-2.5 pt-2 pr-2 sm:grid-cols-5 md:grid-cols-6">
              {images.map((image, index) => (
                <div key={`${image}-${index}`} className="group relative">
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card shadow-sm opacity-0 transition-opacity hover:border-destructive hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                  <div className={cn("aspect-square overflow-hidden rounded-lg border", PICSET_THUMB_SURFACE_CLASS)}>
                    <Image
                      src={toImageProxyUrlWithParams(image, { w: 320 })}
                      alt={`产品图 ${index + 1}`}
                      width={140}
                      height={140}
                      unoptimized
                      sizes="(max-width: 640px) 25vw, 140px"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              ))}

              {canAddMore ? (
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={isUploading}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-xl border-2 border-dashed transition-all duration-200",
                    dragActive ? PICSET_UPLOAD_ACTIVE_SURFACE_CLASS : PICSET_UPLOAD_SURFACE_CLASS,
                    isUploading ? "cursor-not-allowed" : "cursor-pointer"
                  )}
                >
                  {isUploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Plus className="h-5 w-5 text-muted-foreground" />}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {error ? <div className="mt-3"><InlineAlert>{error}</InlineAlert></div> : null}
    </div>
  )
}

function ModelImageUploadCard({
  image,
  isUploading,
  error,
  disabled,
  onFile,
  onRemove,
  onAiGenerate,
}: {
  image: string
  isUploading: boolean
  error: string
  disabled?: boolean
  onFile: (file: File) => void
  onRemove: () => void
  onAiGenerate: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const openPicker = () => {
    if (disabled || isUploading) return
    inputRef.current?.click()
  }

  return (
    <div className={cn("p-4", PICSET_CARD_CLASS)}>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent">
          <User className="h-4.5 w-4.5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight">模特图</h3>
          <p className="text-xs text-muted-foreground">上传或生成模特全身图</p>
        </div>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith("image/"))
          const firstFile = files[0]
          if (firstFile) onFile(firstFile)
        }}
        className={cn(
          "relative mb-3 rounded-3xl border-2 border-dashed transition-all duration-200",
          disabled || isUploading ? "cursor-not-allowed opacity-80" : "cursor-pointer",
          dragActive ? "border-primary/60 bg-surface-hover" : "border-border hover:border-primary/50 hover:bg-surface-hover"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          disabled={disabled || isUploading}
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) onFile(file)
            event.currentTarget.value = ""
          }}
        />
        {image ? (
          <div className="relative mx-auto aspect-[3/4] w-full max-w-[320px] overflow-hidden rounded-[20px]" onClick={openPicker}>
            <Image
              src={toImageProxyUrlWithParams(image, { w: 720 })}
              alt="模特图"
              fill
              unoptimized
              sizes="(max-width: 1024px) 70vw, 320px"
              className="object-cover"
            />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRemove()
              }}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/70"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex min-h-[264px] flex-col items-center justify-center px-4 py-8" onClick={openPicker}>
            {isUploading ? <Loader2 className="mb-2.5 h-4.5 w-4.5 animate-spin text-muted-foreground" /> : <Upload className="mb-2.5 h-4.5 w-4.5 text-muted-foreground" />}
            <span className="text-center text-sm text-foreground">拖拽或点击上传模特照片</span>
            <span className="mt-1 text-[11px] text-muted-foreground">上传参考照片或使用AI生成</span>
          </div>
        )}

        <button
          type="button"
          disabled={disabled || isUploading}
          onClick={(event) => {
            event.stopPropagation()
            onAiGenerate()
          }}
          className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-[#f4f4f5] px-2.5 py-1.5 text-[11px] font-medium text-[#18181b] transition-all duration-200 hover:scale-105 hover:bg-[#ececf0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-3 w-3" />
          <span>AI 生成</span>
        </button>
      </div>

      {error ? <div className="mt-3"><InlineAlert>{error}</InlineAlert></div> : null}
    </div>
  )
}

function CounterControl({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || value <= 0}
        onClick={(event) => {
          event.stopPropagation()
          onChange(Math.max(0, value - 1))
        }}
        className={cn(
          "w-7 h-7 flex items-center justify-center rounded-md transition-colors border",
          disabled || value <= 0
            ? "cursor-not-allowed border-[#ececf0] bg-[#fafafa] text-[#b1b1ba]"
            : "border-[#e4e4e7] bg-white text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b]"
        )}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <div className="w-8 h-7 flex items-center justify-center rounded-md border border-border bg-background text-sm font-medium text-foreground">
        {value}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onChange(value + 1)
        }}
        className={cn(
          "w-7 h-7 flex items-center justify-center rounded-md transition-colors border",
          disabled
            ? "cursor-not-allowed opacity-40 border-[#e4e4e7] bg-white text-[#71717a]"
            : "border-[#e4e4e7] bg-white text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b]"
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function BasicGenerationTypeSelector({
  selections,
  disabled,
  onChange,
}: {
  selections: ClothingStudioBasicSelections
  disabled?: boolean
  onChange: (next: ClothingStudioBasicSelections) => void
}) {
  const selectedCount =
    (selections.whiteRefineEnabled ? 1 : 0) +
    (selections.threeDimensionalEnabled ? 1 : 0) +
    (selections.mannequinEnabled ? 1 : 0) +
    selections.detailCloseupCount +
    selections.sellingPointCount

  const renderCard = (params: {
    active: boolean
    icon: React.ReactNode
    title: string
    description: string
    onClick?: () => void
    right?: React.ReactNode
  }) => (
    <div
      role="button"
      tabIndex={params.onClick && !disabled ? 0 : -1}
      onClick={() => {
        if (disabled) return
        params.onClick?.()
      }}
      onKeyDown={(event) => {
        if (disabled || !params.onClick) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          params.onClick()
        }
      }}
      className={cn(
        "relative flex items-center gap-3 rounded-xl border p-2.5 transition-all duration-200 sm:p-3",
        params.onClick && !disabled ? "cursor-pointer" : "",
        params.active
          ? "border-[#1f1f23]/15 bg-[#fafafa] shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
          : "border-[#e4e4e7] bg-white hover:border-[#d4d4d8] hover:bg-[#fafafa]"
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors",
          params.active
            ? "bg-[#1f1f23] text-white shadow-[0_10px_24px_rgba(15,23,42,0.14)]"
            : "bg-[#f4f4f5] text-[#71717a]"
        )}
      >
        {params.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-[13px] font-medium transition-colors", params.active ? "text-foreground" : "text-foreground/80")}>
            {params.title}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground">{params.description}</p>
      </div>
      <div className="flex-shrink-0">{params.right}</div>
    </div>
  )

  return (
    <div className={cn("p-4", PICSET_CARD_CLASS)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground tracking-tight">选择生成类型</h3>
        <span className="text-xs text-muted-foreground">已选 {selectedCount} 项</span>
      </div>
      <div className="space-y-2">
        {renderCard({
          active: selections.whiteRefineEnabled,
          icon: <Sparkles className="h-5 w-5" />,
          title: "白底精修图",
          description: "纯白背景的产品精修展示图",
          onClick: () => onChange({ ...selections, whiteRefineEnabled: !selections.whiteRefineEnabled }),
          right: (
            <div className="flex gap-2">
              {(["front", "back"] as const).map((view) => {
                const active = selections.whiteRefineEnabled && selections.whiteRefineView === view
                return (
                  <button
                    key={view}
                    type="button"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation()
                      onChange({
                        ...selections,
                        whiteRefineEnabled: true,
                        whiteRefineView: view,
                      })
                    }}
                    className={cn(
                "rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                active
                  ? "border-[#1f1f23] bg-[#1f1f23] text-white"
                  : "border-[#e4e4e7] bg-white text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b]"
                    )}
                  >
                    {view === "front" ? "正面" : "背面"}
                  </button>
                )
              })}
            </div>
          ),
        })}

        {renderCard({
          active: selections.threeDimensionalEnabled,
          icon: <Box className="h-5 w-5" />,
          title: "3D立体效果图",
          description: "具有立体感和层次感的产品展示",
          onClick: () => onChange({ ...selections, threeDimensionalEnabled: !selections.threeDimensionalEnabled }),
          right: (
            <button
              type="button"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation()
                onChange({
                  ...selections,
                  threeDimensionalEnabled: true,
                  threeDimensionalWithWhiteBase: !selections.threeDimensionalWithWhiteBase,
                })
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                selections.threeDimensionalEnabled
                  ? "border-[#1f1f23] bg-[#1f1f23] text-white"
                  : "border-[#e4e4e7] bg-white text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b]"
              )}
            >
              <div
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded-sm border transition-colors",
                  selections.threeDimensionalEnabled ? "border-white bg-white" : "border-border bg-white"
                )}
              >
                {selections.threeDimensionalWithWhiteBase ? <CheckCircle2 className="h-2.5 w-2.5 text-foreground" /> : null}
              </div>
              白底图
            </button>
          ),
        })}

        {renderCard({
          active: selections.mannequinEnabled,
          icon: <User className="h-5 w-5" />,
          title: "人台图",
          description: "使用人台展示服装的专业效果图",
          onClick: () => onChange({ ...selections, mannequinEnabled: !selections.mannequinEnabled }),
          right: (
            <button
              type="button"
              disabled={disabled || !selections.mannequinEnabled}
              onClick={(event) => {
                event.stopPropagation()
                onChange({
                  ...selections,
                  mannequinEnabled: true,
                  mannequinWithWhiteBase: !selections.mannequinWithWhiteBase,
                })
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                !selections.mannequinEnabled
                  ? "cursor-not-allowed opacity-40 border-[#e4e4e7] bg-white text-[#71717a]"
                  : "border-[#1f1f23] bg-[#1f1f23] text-white"
              )}
            >
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-white bg-white">
                {selections.mannequinWithWhiteBase ? <CheckCircle2 className="h-2.5 w-2.5 text-foreground" /> : null}
              </div>
              白底图
            </button>
          ),
        })}

        {renderCard({
          active: selections.detailCloseupCount > 0,
          icon: <Focus className="h-5 w-5" />,
          title: "细节特写图",
          description: "展示产品细节和材质的特写图",
          onClick: () => {
            if (selections.detailCloseupCount === 0) {
              onChange({ ...selections, detailCloseupCount: 1 })
            }
          },
          right: (
            <CounterControl
              value={selections.detailCloseupCount}
              disabled={disabled}
              onChange={(value) => onChange({ ...selections, detailCloseupCount: clampClothingStudioOutputCount(value) })}
            />
          ),
        })}

        {renderCard({
          active: selections.sellingPointCount > 0,
          icon: <Target className="h-5 w-5" />,
          title: "卖点图",
          description: "突出产品核心卖点的营销展示图",
          onClick: () => {
            if (selections.sellingPointCount === 0) {
              onChange({ ...selections, sellingPointCount: 1 })
            }
          },
          right: (
            <CounterControl
              value={selections.sellingPointCount}
              disabled={disabled}
              onChange={(value) => onChange({ ...selections, sellingPointCount: clampClothingStudioOutputCount(value) })}
            />
          ),
        })}
      </div>
    </div>
  )
}

function DesignSpecsEditor({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const decodedValue = normalizePreviewText(value)

  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between p-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 text-left">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">整体设计规范</h3>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setEditing((previous) => !previous)
                    setExpanded(true)
                  }}
                  className="rounded p-1 transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={editing ? "完成编辑设计规范" : "编辑设计规范"}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">所有图片遵循的统一视觉标准</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((previous) => !previous)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-secondary"
            aria-label={expanded ? "收起整体设计规范" : "展开整体设计规范"}
          >
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded ? "rotate-180" : "")} />
          </button>
        </div>

        <div className={cn("overflow-hidden transition-all duration-300", expanded ? "max-h-[600px]" : "max-h-0")}>
          <div className="custom-scrollbar max-h-[440px] overflow-y-auto px-3.5 pb-3.5">
            <div className="rounded-xl bg-secondary/50 p-3.5">
              {editing ? (
                <textarea
                  value={decodedValue}
                  disabled={disabled}
                  onChange={(event) => onChange(event.target.value)}
                  className="min-h-[280px] w-full rounded-2xl border border-input bg-background px-3.5 py-3.5 text-sm leading-6 text-foreground outline-none transition focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                />
              ) : (
                <div>{renderDesignSpecsPreview(decodedValue || "尚未生成设计规范。")}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function PlanEditorCard({
  plan,
  index,
  disabled,
  onUpdate,
}: {
  plan: ClothingStudioPlan
  index: number
  disabled?: boolean
  onUpdate: (planId: string, key: "title" | "description" | "designContent", value: string) => void
}) {
  const [expanded, setExpanded] = useState(index === 0)
  const [editing, setEditing] = useState(false)
  const decodedTitle = normalizePreviewText(plan.title)
  const decodedDescription = normalizePreviewText(plan.description)
  const decodedDesignContent = normalizePreviewText(plan.designContent)
  const displayTitle = decodedTitle.trim()
  const displayDescription = decodedDescription.trim()
  const [draftTitle, setDraftTitle] = useState(decodedTitle)
  const [draftDescription, setDraftDescription] = useState(decodedDescription)
  const [draftDesignContent, setDraftDesignContent] = useState(decodedDesignContent)

  useEffect(() => {
    if (editing) return
    setDraftTitle(decodedTitle)
    setDraftDescription(decodedDescription)
    setDraftDesignContent(decodedDesignContent)
  }, [decodedDescription, decodedDesignContent, decodedTitle, editing])

  const handleStartEdit = () => {
    setDraftTitle(decodedTitle)
    setDraftDescription(decodedDescription)
    setDraftDesignContent(decodedDesignContent)
    setEditing(true)
    setExpanded(true)
  }

  const handleCancelEdit = () => {
    setDraftTitle(decodedTitle)
    setDraftDescription(decodedDescription)
    setDraftDesignContent(decodedDesignContent)
    setEditing(false)
  }

  const handleSaveEdit = () => {
    onUpdate(plan.id, "title", draftTitle)
    onUpdate(plan.id, "description", draftDescription)
    onUpdate(plan.id, "designContent", draftDesignContent)
    setEditing(false)
    setExpanded(true)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <span className="text-sm font-semibold text-foreground">{index + 1}</span>
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-2">
                <input
                  value={draftTitle}
                  disabled={disabled}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="图片标题"
                />
                <textarea
                  value={draftDescription}
                  disabled={disabled}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  className="flex min-h-[60px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="图片描述"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={handleSaveEdit}
                    className="inline-flex h-7 items-center justify-center rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={handleCancelEdit}
                    className="inline-flex h-7 items-center justify-center rounded-xl border border-border bg-surface px-4 text-xs font-medium text-foreground transition-all duration-200 hover:bg-secondary disabled:pointer-events-none disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <h4 className="truncate text-sm font-semibold text-foreground">{displayTitle || `画面 ${index + 1}`}</h4>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={handleStartEdit}
                    className="rounded p-1 transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="编辑标题和描述"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {displayDescription || "这张图的用途和卖点说明会展示在这里。"}
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((previous) => !previous)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-secondary"
            aria-label={expanded ? "收起详情" : "展开详情"}
          >
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded ? "rotate-180" : "")} />
          </button>
        </div>
      </div>

      <div className={cn("overflow-hidden transition-all duration-300", expanded ? "max-h-[720px]" : "max-h-0")}>
        <div className="px-3.5 pb-3.5">
          <div className="group/content relative rounded-lg bg-secondary/50 p-3">
            {editing ? (
              <textarea
                value={draftDesignContent}
                disabled={disabled}
                onChange={(event) => setDraftDesignContent(event.target.value)}
                className="min-h-[200px] w-full resize-none rounded-md border border-input bg-white px-3 py-2 text-xs font-mono text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="详细场景描述 (支持 Markdown 格式)"
              />
            ) : (
              <>
                <div className="custom-scrollbar max-h-[320px] overflow-y-auto">
                  <div>{renderPlanContentPreview(decodedDesignContent || "尚未生成详细规划。")}</div>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={handleStartEdit}
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-xl bg-background/50 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:bg-accent hover:text-accent-foreground group-hover/content:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                  aria-label="编辑详细规划"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlanEditor({
  plans,
  disabled,
  onUpdate,
}: {
  plans: ClothingStudioPlan[]
  disabled?: boolean
  onUpdate: (planId: string, key: "title" | "description" | "designContent", value: string) => void
}) {
  return (
    <section className="space-y-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <ImageIcon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">图片规划</h3>
          <p className="text-[11px] text-muted-foreground">共 {plans.length} 张图片，点击可编辑标题和描述</p>
        </div>
      </div>
      <div className="grid gap-3">
        {plans.map((plan, index) => (
          <PlanEditorCard key={plan.id} plan={plan} index={index} disabled={disabled} onUpdate={onUpdate} />
        ))}
      </div>
    </section>
  )
}

function GeneratingPreview({
  images,
  aspectRatio,
  statusText,
}: {
  images: ClothingStudioGeneratedImage[]
  aspectRatio: string
  statusText: string
}) {
  const mediaStyle = resolveAspectRatioStyle(aspectRatio)

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-3 space-y-2">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="生成进度"
          className="relative h-2 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div className="studio-genesis-loading-bar absolute inset-y-0 w-full flex-1 bg-primary transition-all" />
        </div>
        <p className="animate-pulse text-center text-xs font-medium text-muted-foreground">{statusText}</p>
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          {images.map((image) => {
            const isDone = image.status === "done" && image.url
            const isProcessing = image.status === "pending" || image.status === "prompting" || image.status === "generating"
            const isError = image.status === "error"
            const isCancelled = image.status === "cancelled"
            const shellClassName = cn(
              "overflow-hidden rounded-3xl border border-border bg-card shadow-sm animate-in fade-in duration-200",
              isProcessing ? "animate-pulse" : ""
            )
            const label = isDone ? "已完成" : isError ? "生成失败" : isCancelled ? "已取消" : "生成中..."

            return (
              <div key={image.id} className={shellClassName}>
                <div className="relative bg-gradient-to-br from-muted/30 to-muted/50" style={mediaStyle}>
                  {isDone ? (
                    <Image
                      src={toImageProxyUrlWithParams(image.url, { w: 720 })}
                      alt={image.title || `生成结果 ${image.index + 1}`}
                      fill
                      unoptimized
                      sizes="(max-width: 768px) 50vw, 33vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-full",
                          isError
                            ? "bg-destructive/10"
                            : isCancelled
                              ? "bg-muted"
                              : "bg-primary/10"
                        )}
                      >
                        {isError ? (
                          <AlertCircle className="h-4.5 w-4.5 text-destructive/80" />
                        ) : isCancelled ? (
                          <RefreshCcw className="h-4.5 w-4.5 text-muted-foreground" />
                        ) : (
                          <Sparkles className="h-4.5 w-4.5 text-primary/60" />
                        )}
                      </div>
                      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ResultGallery({
  images,
  aspectRatio,
  isGenerating,
  openingCanvasImageId,
  onDownload,
  onRetry,
  onCopyPrompt,
  onEdit,
}: {
  images: ClothingStudioGeneratedImage[]
  aspectRatio: string
  isGenerating: boolean
  openingCanvasImageId?: string | null
  onDownload: (image: ClothingStudioGeneratedImage) => void
  onRetry: (image: ClothingStudioGeneratedImage) => void
  onCopyPrompt: (prompt: string) => void
  onEdit: (image: ClothingStudioGeneratedImage) => void
}) {
  const mediaStyle = resolveAspectRatioStyle(aspectRatio)

  return (
    <div className="grid grid-cols-2 gap-3">
      {images.map((image) => {
        const isDone = image.status === "done" && image.url
        const canRetry = image.status === "done" || image.status === "error" || image.status === "cancelled"
        const isOpeningCanvas = openingCanvasImageId === image.id
        const placeholderText =
          image.status === "error"
            ? image.error || "生成失败"
            : image.status === "cancelled"
              ? image.error || "已取消"
              : image.status === "generating"
                ? "生成中..."
                : image.status === "prompting"
                  ? "正在准备生成..."
                  : "等待生成"

        return (
          <div key={image.id} className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm animate-in fade-in duration-200">
            <div className="relative bg-zinc-50" style={mediaStyle}>
              {isDone ? (
                <div className="group relative h-full w-full overflow-hidden rounded-2xl">
                  <Image
                    src={toImageProxyUrlWithParams(image.url, { w: 900 })}
                    alt={image.title || "图片"}
                    fill
                    unoptimized
                    sizes="(max-width: 768px) 50vw, 33vw"
                    className="object-cover transition-opacity duration-300"
                  />
                  <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onDownload(image)}
                      className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-8 w-8")}
                      title="下载"
                      aria-label="下载"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    {image.prompt ? (
                      <button
                        type="button"
                        onClick={() => onCopyPrompt(image.prompt || "")}
                        className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-8 w-8")}
                        title="复制提示词"
                        aria-label="复制提示词"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onEdit(image)}
                      disabled={isOpeningCanvas}
                      className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-8 w-8 disabled:opacity-50")}
                      title={isOpeningCanvas ? "正在打开画布" : "编辑"}
                      aria-label={isOpeningCanvas ? "正在打开画布" : "编辑"}
                    >
                      {isOpeningCanvas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PencilLine className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRetry(image)}
                      disabled={isGenerating}
                      className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-8 w-8 disabled:opacity-50")}
                      title="重新生成"
                      aria-label="重新生成"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="group relative h-full w-full overflow-hidden rounded-2xl">
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-5 text-center">
                    {image.status === "error" ? (
                      <AlertCircle className="h-7 w-7 text-[#b6464f]" />
                    ) : image.status === "cancelled" ? (
                      <RefreshCcw className="h-7 w-7 text-[#8f6c42]" />
                    ) : (
                      <Sparkles className="h-7 w-7 text-primary/60" />
                    )}
                    <p className="text-[11px] font-medium text-muted-foreground">{placeholderText}</p>
                  </div>
                  {canRetry ? (
                    <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onRetry(image)}
                        disabled={isGenerating}
                        className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-8 w-8 disabled:opacity-50")}
                        title="重新生成"
                        aria-label="重新生成"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ModelGeneratorDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  candidates,
  history,
  selectedId,
  isGenerating,
  error,
  onGenerate,
  onSelectCandidate,
  onDownloadCandidate,
  onDownloadBatch,
  onUseSelected,
  onPickHistoryBatch,
  onDeleteHistoryItem,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: ModelGeneratorFormState
  onFormChange: (updater: (previous: ModelGeneratorFormState) => ModelGeneratorFormState) => void
  candidates: ModelGenerationPreviewImage[]
  history: ModelGenerationPreviewImage[]
  selectedId: string
  isGenerating: boolean
  error: string
  onGenerate: () => void
  onSelectCandidate: (id: string) => void
  onDownloadCandidate: (item: ModelGenerationPreviewImage) => void
  onDownloadBatch: () => void
  onUseSelected: () => void
  onPickHistoryBatch: (item: ModelGenerationPreviewImage) => void
  onDeleteHistoryItem: (id: string) => void
}) {
  const hasCandidates = candidates.length > 0
  const loadingPreviewCount = isGenerating ? Math.max(1, form.count) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="z-50 bg-black/80 backdrop-blur-none"
        className="z-50 w-full max-w-lg gap-4 border border-[#e8e8e8] bg-white p-6 text-foreground shadow-[0_24px_80px_rgba(15,23,42,0.18)] duration-200 sm:max-w-4xl max-h-[95vh] overflow-hidden flex flex-col"
        style={{
          ...PICSET_THEME_STYLE,
          backgroundColor: "hsl(var(--background))",
          fontFamily: PICSET_FONT_FAMILY,
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-6 w-6 text-[#1f1f23]" />
            AI 生成模特图
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 gap-8 overflow-hidden p-1 max-md:flex-col">
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
            <div className="space-y-4">
              <div className="flex items-center gap-4 max-md:flex-col">
                <ModelGeneratorSelectField
                  label="性别"
                  value={form.gender}
                  onChange={(value) =>
                    onFormChange((previous) => ({ ...previous, gender: value as ModelGeneratorFormState["gender"] }))
                  }
                  options={MODEL_GENERATOR_GENDER_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                  disabled={isGenerating}
                />
                <ModelGeneratorSelectField
                  label="年龄"
                  value={form.ageRange}
                  onChange={(value) => onFormChange((previous) => ({ ...previous, ageRange: value }))}
                  options={MODEL_GENERATOR_AGE_OPTIONS.map((item) => ({ value: item, label: item }))}
                  disabled={isGenerating}
                />
                <ModelGeneratorSelectField
                  label="肤色"
                  value={form.ethnicity}
                  onChange={(value) => onFormChange((previous) => ({ ...previous, ethnicity: value }))}
                  options={MODEL_GENERATOR_ETHNICITY_OPTIONS.map((item) => ({ value: item, label: item }))}
                  disabled={isGenerating}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">模特的其他需求</label>
                <textarea
                  value={form.requirements}
                  disabled={isGenerating}
                  onChange={(event) => onFormChange((previous) => ({ ...previous, requirements: event.target.value }))}
                  className="flex min-h-[72px] w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
                  placeholder="可选：添加具体要求如姿势、表情、发型等..."
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="text-sm font-semibold text-foreground/80">生成张数</span>
                <div className="relative">
                  <select
                    value={String(form.count)}
                    disabled={isGenerating}
                    onChange={(event) =>
                      onFormChange((previous) => ({ ...previous, count: clampModelGeneratorCount(event.target.value) }))
                    }
                    className="flex h-9 w-[120px] appearance-none items-center justify-between rounded-lg border border-[#e4e4e7] bg-[#f4f4f5] px-3 py-2 pr-8 text-sm ring-offset-background transition-all focus:outline-none focus:ring-1 focus:ring-[#1f1f23]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {Array.from({ length: 4 }, (_, index) => (
                      <option key={index + 1} value={String(index + 1)}>
                        {index + 1} 张
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-2">
                  <div className={cn("rounded-lg p-1 transition-colors", form.turbo ? "bg-emerald-100 text-emerald-600" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700")}>
                    <Zap className="h-3.5 w-3.5 fill-current" />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold leading-tight text-zinc-900 dark:text-zinc-100">Turbo 加速模式</p>
                    <p className="text-[9px] leading-tight text-zinc-500">更快、更稳定</p>
                  </div>
                </div>
                <Switch
                  checked={form.turbo}
                  disabled={isGenerating}
                  onCheckedChange={(checked) => onFormChange((previous) => ({ ...previous, turbo: checked }))}
                  className="origin-right scale-75 data-[state=checked]:bg-emerald-500"
                />
              </div>

              <button
                type="button"
                disabled={isGenerating}
                onClick={onGenerate}
                className={cn(
                  "h-11 w-full rounded-xl px-5 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
                  PICSET_SOLID_DARK_BUTTON_CLASS
                )}
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                立即生成
              </button>
              <p className="text-center text-[10px] text-muted-foreground">消耗 {form.count * 3} 积分</p>
              {error ? <InlineAlert>{error}</InlineAlert> : null}
            </div>

            <div className="flex-1 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-foreground/80">预览</label>
                {hasCandidates ? (
                  <button
                    type="button"
                    onClick={onDownloadBatch}
                    className="flex h-9 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-5 text-xs font-bold text-zinc-900 shadow-sm transition-all hover:bg-zinc-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    批量下载
                  </button>
                ) : null}
              </div>

              <div className="flex min-h-[300px] flex-1 flex-col gap-4">
                {hasCandidates ? (
                  <div className="grid grid-cols-2 gap-3">
                    {candidates.map((item) => {
                      const selected = item.id === selectedId
                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectCandidate(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              onSelectCandidate(item.id)
                            }
                          }}
                          className={cn(
                            "group relative aspect-square cursor-pointer overflow-hidden rounded-xl border-2 transition-all",
                            selected
                              ? "border-primary shadow-md ring-2 ring-primary/20"
                              : "border-transparent hover:border-primary/40"
                          )}
                        >
                          <Image
                            src={toImageProxyUrlWithParams(item.url, { w: 720 })}
                            alt="生成的模特预览图"
                            fill
                            unoptimized
                            sizes="(max-width: 768px) 45vw, 240px"
                            className="object-cover"
                          />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                            <p className="text-center text-[10px] text-white">点击选择</p>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onDownloadCandidate(item)
                            }}
                            className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity hover:bg-black/60 group-hover:opacity-100"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ) : isGenerating ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: loadingPreviewCount }, (_, index) => (
                      <div
                        key={`loading-preview-${index}`}
                        className="relative aspect-square overflow-hidden rounded-xl border-2 border-dashed border-[#d6d3d1] bg-[#f5f4f6]"
                      >
                        <div className="absolute inset-0 animate-pulse bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(244,244,245,0.96))]" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#71717a]">
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 shadow-sm">
                            <Loader2 className="h-6 w-6 animate-spin text-[#1f1f23]" />
                          </div>
                          <div className="space-y-1 text-center">
                            <p className="text-sm font-semibold text-[#18181b]">正在生成模特图</p>
                            <p className="text-[11px] text-[#71717a]">第 {index + 1} 张预览马上出现</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex aspect-square flex-col items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-accent/30 text-muted-foreground">
                    <User className="mb-4 h-16 w-16 opacity-10" />
                    <p className="text-sm">预览将在此显示</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex w-80 flex-col border-l border-border/60 pl-8 max-md:w-full max-md:border-l-0 max-md:border-t max-md:pl-0 max-md:pt-6">
            <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold text-foreground/80">
              <Clock className="h-4 w-4" />
              生成历史
            </h3>
            <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto pr-3">
              {history.length > 0 ? (
                history.map((item) => (
                  <div
                    key={item.id}
                    className="group relative cursor-pointer rounded-xl border border-transparent bg-accent/30 p-2.5 transition-all hover:border-primary/10 hover:bg-primary/5 hover:ring-1 hover:ring-primary/20"
                    onClick={() => onPickHistoryBatch(item)}
                  >
                    <div className="flex gap-3">
                      <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg shadow-sm">
                        <Image
                          src={toImageProxyUrlWithParams(item.url, { w: 320 })}
                          alt="历史模特图片"
                          fill
                          unoptimized
                          sizes="80px"
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                        <p className="line-clamp-2 text-xs leading-relaxed text-foreground/70">{buildModelGenerationSummaryText(item)}</p>
                        <p className="text-[10px] font-medium text-muted-foreground/60">{formatRelativeTime(item.createdAt)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteHistoryItem(item.id)
                      }}
                      className="absolute -right-2 -top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-background p-0 text-xs text-muted-foreground opacity-0 shadow-sm transition-all hover:bg-destructive/5 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="flex h-full flex-col items-center justify-center py-12 text-muted-foreground/60">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent">
                    <Clock className="h-6 w-6 opacity-30" />
                  </div>
                  <p className="text-sm">暂无生成记录</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 gap-3 border-t border-border/60 pt-4 sm:gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-6 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-accent-foreground"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selectedId}
            onClick={onUseSelected}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-10 py-2 text-sm font-medium transition-all duration-200 disabled:pointer-events-none",
              selectedId
                ? "bg-[#1f1f23] text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] hover:bg-[#18181c]"
                : "bg-[#a7a7ac] text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]"
            )}
          >
            使用选中的模特
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ClothingStudioWorkspace({
  embeddedInToolbox = false,
}: {
  embeddedInToolbox?: boolean
}) {
  const [mode, setMode] = useState<ClothingStudioMode>("basic")
  const [currentStep, setCurrentStep] = useState<ClothingStudioStep>("input")
  const [productImages, setProductImages] = useState<string[]>([])
  const [modelImage, setModelImage] = useState("")
  const [requirements, setRequirements] = useState("")
  const [settings, setSettings] = useState(DEFAULT_CLOTHING_STUDIO_SETTINGS)
  const [basicSelections, setBasicSelections] = useState(DEFAULT_CLOTHING_STUDIO_BASIC_SELECTIONS)
  const [tryOnSelections, setTryOnSelections] = useState(() => collapseTryOnSelectionsToSourceUi(DEFAULT_CLOTHING_STUDIO_TRYON_SELECTIONS, 1))
  const [analysisResult, setAnalysisResult] = useState<ClothingStudioAnalysisResult | null>(null)
  const [analysisSignature, setAnalysisSignature] = useState("")
  const [generatedImages, setGeneratedImages] = useState<ClothingStudioGeneratedImage[]>([])
  const [textModels, setTextModels] = useState<ClothingStudioModelOption[]>([])
  const [imageModels, setImageModels] = useState<ClothingStudioModelOption[]>([])
  const [isHydrated, setIsHydrated] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState("")
  const [isModelUploading, setIsModelUploading] = useState(false)
  const [modelUploadError, setModelUploadError] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationError, setGenerationError] = useState("")
  const [notice, setNotice] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isBatchDownloading, setIsBatchDownloading] = useState(false)
  const [openingCanvasImageId, setOpeningCanvasImageId] = useState<string | null>(null)
  const [isModelGeneratorOpen, setIsModelGeneratorOpen] = useState(false)
  const [modelGeneratorForm, setModelGeneratorForm] = useState<ModelGeneratorFormState>(() => ({
    ...DEFAULT_MODEL_GENERATOR_FORM,
    gender: resolveDefaultModelGeneratorGender(DEFAULT_CLOTHING_STUDIO_TRYON_SELECTIONS.modelGender),
  }))
  const [generatedModelCandidates, setGeneratedModelCandidates] = useState<ModelGenerationPreviewImage[]>([])
  const [modelGenerationHistory, setModelGenerationHistory] = useState<ModelGenerationPreviewImage[]>([])
  const [selectedGeneratedModelId, setSelectedGeneratedModelId] = useState("")
  const [isGeneratingModelCandidates, setIsGeneratingModelCandidates] = useState(false)
  const [modelGenerationError, setModelGenerationError] = useState("")
  const analysisAbortRef = useRef<AbortController | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const generatedImagesRef = useRef<ClothingStudioGeneratedImage[]>([])
  const noticeTimeoutRef = useRef<number | null>(null)

  const setGeneratedImagesState = (
    updater:
      | ClothingStudioGeneratedImage[]
      | ((previous: ClothingStudioGeneratedImage[]) => ClothingStudioGeneratedImage[])
  ) => {
    const next = typeof updater === "function" ? updater(generatedImagesRef.current) : updater
    generatedImagesRef.current = next
    setGeneratedImages(next)
    return next
  }

  useEffect(() => {
    generatedImagesRef.current = generatedImages
  }, [generatedImages])

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(CLOTHING_STUDIO_STORAGE_KEY) : null
    if (raw) {
      const restored = restorePersistedState(safeJsonParse(raw, {} as PersistedWorkspaceState))
      setMode(restored.mode)
      setCurrentStep(restored.currentStep)
      setProductImages(restored.productImages)
      setModelImage(restored.modelImage)
      setRequirements(restored.requirements)
      setSettings(restored.settings)
      setBasicSelections(restored.basicSelections)
      setTryOnSelections(restored.tryOnSelections)
      setAnalysisResult(restored.analysisResult)
      setAnalysisSignature(restored.analysisSignature)
      setGeneratedImagesState(restored.generatedImages)
      setModelGeneratorForm(restored.modelGeneratorForm || DEFAULT_MODEL_GENERATOR_FORM)
      setModelGenerationHistory(restored.modelGenerationHistory || [])
      setGeneratedModelCandidates(restored.modelGenerationPreview || [])
      setSelectedGeneratedModelId(String(restored.selectedGeneratedModelId || "").trim())
    }
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return
    const payload: PersistedWorkspaceState = {
      mode,
      currentStep,
      productImages,
      modelImage,
      requirements,
      settings,
      basicSelections,
      tryOnSelections,
      analysisResult,
      analysisSignature,
      generatedImages,
      modelGeneratorForm,
      modelGenerationHistory,
      modelGenerationPreview: generatedModelCandidates,
      selectedGeneratedModelId,
    }
    window.localStorage.setItem(CLOTHING_STUDIO_STORAGE_KEY, JSON.stringify(payload))
  }, [
    analysisResult,
    analysisSignature,
    basicSelections,
    currentStep,
    generatedImages,
    isHydrated,
    mode,
    modelImage,
    modelGenerationHistory,
    modelGeneratorForm,
    generatedModelCandidates,
    productImages,
    requirements,
    selectedGeneratedModelId,
    settings,
    tryOnSelections,
  ])

  useEffect(() => {
    let cancelled = false

    const loadModels = async () => {
      try {
        const response = await fetch("/api/clothing-studio/model-settings", { cache: "no-store" , credentials: "include"})
        const payload = safeJsonParse<ClothingStudioModelSettingsPayload>(await response.text(), {
          textModel: null,
          imageModel: null,
          textModels: [],
          imageModels: [],
        })
        if (!response.ok || cancelled) return
        setTextModels(payload.textModels || [])
        setImageModels(payload.imageModels || [])
        setSettings((previous) => ({
          ...previous,
          textModelId: previous.textModelId || payload.textModel?.runtimeId || "",
          imageModelId: previous.imageModelId || payload.imageModel?.runtimeId || "",
        }))
      } catch (error) {
        console.warn("[clothing-studio] model-settings failed", error)
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const doneIds = generatedImages.filter((item) => item.status === "done" && item.url).map((item) => item.id)
    setSelectedIds((previous) => {
      const kept = previous.filter((item) => doneIds.includes(item))
      if (kept.length > 0 || doneIds.length === 0) return kept
      return doneIds
    })
  }, [generatedImages])

  useEffect(() => {
    if (generatedModelCandidates.length === 0) {
      if (selectedGeneratedModelId) {
        setSelectedGeneratedModelId("")
      }
      return
    }

    if (!generatedModelCandidates.some((item) => item.id === selectedGeneratedModelId)) {
      setSelectedGeneratedModelId(generatedModelCandidates[0]?.id || "")
    }
  }, [generatedModelCandidates, selectedGeneratedModelId])

  useEffect(() => {
    return () => {
      analysisAbortRef.current?.abort()
      generationAbortRef.current?.abort()
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current)
      }
    }
  }, [])

  const tryOnOutputCount = resolveTryOnOutputCount(tryOnSelections)
  const activePlans = buildClothingStudioPlanBlueprint({
    mode,
    basicSelections,
    tryOnSelections,
    targetLanguage: settings.targetLanguage,
  })
  const analysisNeedsRefresh = Boolean(analysisResult) &&
    analysisSignature !==
      buildAnalysisSignature({
        mode,
        productImages,
        modelImage,
        requirements,
        targetLanguage: settings.targetLanguage,
        basicSelections,
        tryOnSelections,
      })

  const doneCount = generatedImages.filter((item) => item.status === "done" && item.url).length
  const failedCount = generatedImages.filter((item) => item.status === "error" || item.status === "cancelled").length

  const imageModelOptions = imageModels.length > 0
    ? imageModels.map((item) => ({ value: item.runtimeId, label: item.name }))
    : [{ value: "", label: "未配置可用模型" }]
  const textModelOptions = textModels.length > 0
    ? textModels.map((item) => ({ value: item.runtimeId, label: item.name }))
    : [{ value: "", label: "未配置可用模型" }]
  const selectedImageModel =
    imageModels.find((item) => item.runtimeId === settings.imageModelId) ||
    imageModels[0] ||
    null
  const estimatedImageCount = Math.max(mode === "tryon" ? tryOnOutputCount : activePlans.length, 1)
  const estimatedGenerationCost = Math.max(0, Number(selectedImageModel?.cost || 0)) * estimatedImageCount
  const selectedGeneratedModel =
    generatedModelCandidates.find((item) => item.id === selectedGeneratedModelId) ||
    generatedModelCandidates[0] ||
    null

  const updateNotice = (message: string) => {
    setNotice(message)
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current)
    }
    noticeTimeoutRef.current = window.setTimeout(() => setNotice(""), 2400)
  }

  const uploadImages = async (files: File[]) => {
    const uploaded: string[] = []
    for (const file of files) {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,

        credentials: "include"
      })
      const payload = safeJsonParse<{ url?: string; localUrl?: string; error?: string }>(await response.text(), {})
      const uploadedUrl = String(payload.url || payload.localUrl || "").trim()
      if (!response.ok || !uploadedUrl) {
        throw new Error(payload.error || "上传失败")
      }
      uploaded.push(uploadedUrl)
    }
    return uploaded
  }

  const resetAnalysisAndResults = () => {
    setAnalysisResult(null)
    setAnalysisSignature("")
    setGeneratedImagesState([])
    setSelectedIds([])
    setOpeningCanvasImageId(null)
    setCurrentStep("input")
  }

  const handleModeChange = (nextMode: ClothingStudioMode) => {
    if (nextMode === mode) return
    setMode(nextMode)
    if (nextMode === "tryon") {
      setTryOnSelections((previous) => collapseTryOnSelectionsToSourceUi(previous, resolveTryOnOutputCount(previous)))
    }
    resetAnalysisAndResults()
    setAnalysisError("")
    setGenerationError("")
    updateNotice(`已切换到${nextMode === "basic" ? "基础套图" : "模特试穿"}模式`)
  }

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return
    const room = Math.max(0, CLOTHING_STUDIO_MAX_PRODUCT_IMAGES - productImages.length)
    if (room <= 0) {
      setUploadError(`最多上传 ${CLOTHING_STUDIO_MAX_PRODUCT_IMAGES} 张产品图`)
      return
    }

    setUploadError("")
    setIsUploading(true)
    try {
      const nextFiles = files.slice(0, room)
      const uploaded = await uploadImages(nextFiles)
      setProductImages((previous) => [...previous, ...uploaded])
      if (analysisResult) {
        setCurrentStep("input")
      }
    } catch (error: any) {
      setUploadError(String(error?.message || "上传失败"))
    } finally {
      setIsUploading(false)
    }
  }

  const handleModelFile = async (file: File) => {
    setModelUploadError("")
    setIsModelUploading(true)
    try {
      const uploaded = await uploadImages([file])
      setModelImage(uploaded[0] || "")
      if (analysisResult) {
        setCurrentStep("input")
      }
    } catch (error: any) {
      setModelUploadError(String(error?.message || "上传失败"))
    } finally {
      setIsModelUploading(false)
    }
  }

  const handleRemoveModelImage = () => {
    setModelImage("")
    if (analysisResult) {
      setCurrentStep("input")
    }
  }

  const handleGenerateModelImage = () => {
    setModelGeneratorForm((previous) =>
      normalizeModelGeneratorForm({
        ...previous,
        gender: resolveDefaultModelGeneratorGender(tryOnSelections.modelGender),
      })
    )
    if (generatedModelCandidates.length === 0 && modelGenerationHistory.length > 0) {
      const latestBatchId = modelGenerationHistory[0]?.batchId
      if (latestBatchId) {
        const latestBatch = modelGenerationHistory.filter((item) => item.batchId === latestBatchId)
        setGeneratedModelCandidates(latestBatch)
        setSelectedGeneratedModelId(latestBatch[0]?.id || "")
      }
    }
    setModelGenerationError("")
    setIsModelGeneratorOpen(true)
  }

  const handleGenerateModelCandidates = async () => {
    setModelGenerationError("")
    setIsGeneratingModelCandidates(true)
    setGeneratedModelCandidates([])
    setSelectedGeneratedModelId("")

    try {
      const response = await fetch("/api/clothing-studio/model-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gender: MODEL_GENERATOR_GENDER_OPTIONS.find((item) => item.value === modelGeneratorForm.gender)?.label || "女性",
          ageRange: modelGeneratorForm.ageRange,
          ethnicity: modelGeneratorForm.ethnicity,
          requirements: modelGeneratorForm.requirements,
          count: modelGeneratorForm.count,
          turbo: modelGeneratorForm.turbo,
          textModelId: settings.textModelId,
          imageModelId: settings.imageModelId,
          aspectRatio: settings.aspectRatio,
          imageSize: settings.imageSize,
        }),

        credentials: "include"
      })
      const payload = safeJsonParse<{
        items?: ModelGenerationPreviewImage[]
        error?: string
        warning?: string
      }>(await response.text(), {})

      if (!response.ok || !Array.isArray(payload.items) || payload.items.length === 0) {
        throw new Error(payload.error || "模特图生成失败")
      }

      const items = normalizeModelGenerationPreviewList(payload.items)
      setGeneratedModelCandidates(items)
      setSelectedGeneratedModelId(items[0]?.id || "")
      setModelGenerationHistory((previous) => {
        const merged = [...items, ...previous]
        const seen = new Set<string>()
        return merged.filter((item) => {
          if (seen.has(item.id)) return false
          seen.add(item.id)
          return true
        })
      })

      if (payload.warning) {
        setModelGenerationError(payload.warning)
      } else {
        updateNotice("AI 模特图已生成，可选择后回填")
      }
    } catch (error: any) {
      setModelGenerationError(String(error?.message || "模特图生成失败"))
    } finally {
      setIsGeneratingModelCandidates(false)
    }
  }

  const handleDownloadGeneratedModel = async (item: ModelGenerationPreviewImage) => {
    if (!item.url) return
    try {
      await fetchAndDownload(resolveImageDownloadUrl(item.url), `clothing-model-${item.id}.png`)
    } catch (error: any) {
      setModelGenerationError(String(error?.message || "下载失败"))
    }
  }

  const handleDownloadGeneratedModelBatch = async () => {
    if (generatedModelCandidates.length === 0) return

    if (generatedModelCandidates.length === 1) {
      await handleDownloadGeneratedModel(generatedModelCandidates[0])
      return
    }

    try {
      const zip = new JSZip()
      for (const item of generatedModelCandidates) {
        const response = await fetch(resolveImageDownloadUrl(item.url))
        if (!response.ok) {
          throw new Error("批量下载失败")
        }
        zip.file(`clothing-model-${item.id}.png`, await response.blob())
      }

      const blob = await zip.generateAsync({ type: "blob" })
      const objectUrl = URL.createObjectURL(blob)
      try {
        triggerBrowserDownload(objectUrl, `clothing-model-batch-${Date.now()}.zip`)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch (error: any) {
      setModelGenerationError(String(error?.message || "批量下载失败"))
    }
  }

  const handlePickModelHistoryBatch = (item: ModelGenerationPreviewImage) => {
    const batch = modelGenerationHistory.filter((historyItem) => historyItem.batchId === item.batchId)
    setGeneratedModelCandidates(batch)
    setSelectedGeneratedModelId(item.id)
  }

  const handleDeleteModelHistoryItem = (id: string) => {
    setModelGenerationHistory((previous) => previous.filter((item) => item.id !== id))
    const nextCandidates = generatedModelCandidates.filter((item) => item.id !== id)
    setGeneratedModelCandidates(nextCandidates)
    if (!nextCandidates.some((item) => item.id === selectedGeneratedModelId)) {
      setSelectedGeneratedModelId(nextCandidates[0]?.id || "")
    }
  }

  const handleUseSelectedGeneratedModel = () => {
    if (!selectedGeneratedModel?.url) return
    setModelImage(selectedGeneratedModel.url)
    setIsModelGeneratorOpen(false)
    setModelGenerationError("")
    if (analysisResult) {
      setCurrentStep("input")
    }
    updateNotice("已应用选中的 AI 模特图")
  }

  const handleRemoveProductImage = (index: number) => {
    setProductImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
    if (analysisResult) {
      setCurrentStep("input")
    }
  }

  const fetchJobSnapshot = async (jobId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/clothing-studio/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal,

      credentials: "include"
    })
    const payload = safeJsonParse<unknown>(await response.text(), null)
    const job = extractClothingStudioJobRecord(payload)

    if (!response.ok || !job) {
      const message =
        payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
          ? String((payload as { error?: string }).error || "").trim()
          : ""
      throw new Error(message || "查询任务状态失败")
    }

    return job
  }

  const pollJobUntilFinished = async (jobId: string, signal: AbortSignal) => {
    console.log(`🔍 [watchJob] Starting watch for job: ${jobId}`)
    console.log(`🔍 [watchJob] Starting polling for ${jobId}`)
    while (true) {
      if (signal.aborted) {
        throw createAbortError()
      }
      const job = await fetchJobSnapshot(jobId, signal)
      const resultHint = job.result_url ? job.result_url : "no URL"
      console.log(`🔍 [watchJob] Poll result for ${jobId}: ${job.status} ${resultHint}`)
      if (job.status !== "processing") {
        console.log(`✅ [watchJob] Job ${jobId} completed via Polling: ${job.status}`)
        return job
      }
      await sleep(1200)
    }
  }

  const handleAnalyze = async () => {
    if (productImages.length === 0) {
      setAnalysisError("请先上传至少一张产品图")
      return
    }

    if (activePlans.length === 0) {
      setAnalysisError("请至少选择一个生成类型")
      return
    }

    setAnalysisError("")
    setGenerationError("")
    setCurrentStep("analyzing")
    setIsAnalyzing(true)
    analysisAbortRef.current?.abort()
    const controller = new AbortController()
    analysisAbortRef.current = controller

    try {
      const response = await fetch("/api/clothing-studio/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          productImages,
          modelImage,
          requirements,
          imageCount: activePlans.length,
          uiLanguage: "zh-CN",
          targetLanguage: settings.targetLanguage,
          textModelId: settings.textModelId,
          imageModelId: settings.imageModelId,
          imageSize: settings.imageSize,
          speedMode: settings.speedMode === "standard" ? "normal" : settings.speedMode,
          basicSelections,
          tryOnSelections,
        }),

        credentials: "include"
      })
      const payload = safeJsonParse<unknown>(await response.text(), null)
      const analysisJob = extractClothingStudioJobRecord(payload)
      if (!response.ok || !analysisJob || analysisJob.type !== "ANALYSIS") {
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
            ? String((payload as { error?: string }).error || "").trim()
            : ""
        throw new Error(message || "分析任务创建失败")
      }

      const analysisSnapshot = await pollJobUntilFinished(analysisJob.id, controller.signal)
      if (
        analysisSnapshot.type !== "ANALYSIS" ||
        analysisSnapshot.status !== "success" ||
        !analysisSnapshot.result_data
      ) {
        throw new Error(analysisSnapshot.error_message || "分析失败")
      }

      const normalized = normalizeClothingStudioAnalysisResult(analysisSnapshot.result_data, {
        mode,
        basicSelections,
        tryOnSelections,
        targetLanguage: settings.targetLanguage,
      })

      setAnalysisResult(normalized)
      setAnalysisSignature(
        buildAnalysisSignature({
          mode,
          productImages,
          modelImage,
          requirements,
          targetLanguage: settings.targetLanguage,
          basicSelections,
          tryOnSelections,
        })
      )
      setGeneratedImagesState(buildClothingStudioGeneratedPlaceholders(normalized.images))
      setCurrentStep("preview")
    } catch (error: any) {
      if (error?.name === "AbortError") {
        return
      }
      setCurrentStep("input")
      setAnalysisError(String(error?.message || "分析失败"))
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null
        setIsAnalyzing(false)
      }
    }
  }

  const handlePlanUpdate = (planId: string, key: "title" | "description" | "designContent", value: string) => {
    setAnalysisResult((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        images: previous.images.map((plan) => (plan.id === planId ? { ...plan, [key]: value } : plan)),
      }
    })
    if (key === "title") {
      setGeneratedImagesState((previous) =>
        previous.map((item) => (item.planId === planId ? { ...item, title: value } : item))
      )
    }
  }

  const handleSummaryUpdate = (value: string) => {
    setAnalysisResult((previous) => (previous ? { ...previous, summary: value } : previous))
  }

  const updateGeneratedImage = (planId: string, updater: (image: ClothingStudioGeneratedImage) => ClothingStudioGeneratedImage) => {
    setGeneratedImagesState((previous) =>
      previous.map((image) => (image.planId === planId ? updater(image) : image))
    )
  }

  const resolveSelectedGenerationModel = () => selectedImageModel

  const runPromptBasedGeneration = async (
    plans: ClothingStudioPlan[],
    options: {
      replaceAll?: boolean
      clothingMode: "prompt_generation" | "model_prompt_generation"
      workflowMode: "product" | "model"
      promptErrorMessage: string
      creationErrorMessage: string
      generationErrorMessage: string
    }
  ) => {
    if (!analysisResult) return
    if (analysisNeedsRefresh) {
      setGenerationError("你已经改动了上传图片、需求或生成配置，请先重新分析后再生成。")
      return
    }

    const replaceAll = Boolean(options.replaceAll)
    const targetPlanIds = new Set(plans.map((item) => item.id))
    const selectedModel = resolveSelectedGenerationModel()
    const requestedModel = selectedModel?.modelId || selectedModel?.name || settings.imageModelId || "nano-banana2"

    setGenerationError("")
    setCurrentStep("generating")
    setIsGenerating(true)
    setGeneratedImagesState((previous) => {
      const base = replaceAll ? buildClothingStudioGeneratedPlaceholders(analysisResult.images) : previous
      return analysisResult.images.map((plan, index) => {
        const existing = base.find((item) => item.planId === plan.id)
        if (targetPlanIds.has(plan.id)) {
          return {
            id: plan.id,
            planId: plan.id,
            index,
            title: plan.title,
            status: "prompting",
            url: replaceAll ? "" : existing?.url || "",
            error: "",
            prompt: replaceAll ? "" : existing?.prompt || "",
            model: replaceAll ? "" : existing?.model || "",
            provider: replaceAll ? "" : existing?.provider || "",
            category: plan.category,
          }
        }
        return existing || {
          id: plan.id,
          planId: plan.id,
          index,
          title: plan.title,
          status: "pending",
          url: "",
          category: plan.category,
        }
      })
    })

    const controller = new AbortController()
    generationAbortRef.current = controller
    const batchId = globalThis.crypto?.randomUUID?.() || `clothing-batch-${Date.now()}`

    try {
      const promptResponse = await fetch("/api/clothing-studio/generate-prompts-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          clothingMode: options.clothingMode,
          analysisJson: buildPromptGenerationAnalysisJson({
            ...analysisResult,
            images: plans,
          }),
          targetLanguage: settings.targetLanguage,
          textModelId: settings.textModelId,
        }),

        credentials: "include"
      })
      const promptPayload = safeJsonParse<ClothingStudioPromptGenerationResponse & { error?: string }>(
        await promptResponse.text(),
        { prompts: [] }
      )

      if (!promptResponse.ok) {
        throw new Error(promptPayload.error || options.promptErrorMessage)
      }

      const promptItems = normalizePromptGenerationResponse(promptPayload, plans)
      const generationResults = await Promise.allSettled(
        promptItems.map(async (item) => {
          if (controller.signal.aborted) {
            throw createAbortError()
          }

          updateGeneratedImage(item.plan.id, (image) => ({
            ...image,
            title: item.title,
            status: "generating",
            prompt: item.prompt,
            error: "",
          }))

          try {
            const imageResponse = await fetch("/api/clothing-studio/generate-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                batchId,
                planId: item.plan.id,
                index: item.plan.order,
                title: item.title,
                description: item.description,
                productImage: productImages[0] || "",
                productImages,
                prompt: item.prompt,
                model: requestedModel,
                imageSize: settings.imageSize,
                aspectRatio: settings.aspectRatio,
                targetLanguage: settings.targetLanguage,
                requirements,
                workflowMode: options.workflowMode,
                turboEnabled: settings.speedMode === "turbo",
                speedMode: settings.speedMode === "standard" ? "normal" : settings.speedMode,
                fe_attempt: 1,
                ...(options.workflowMode === "model" ? { modelImage } : {}),
              }),

              credentials: "include"
            })
            const imagePayload = safeJsonParse<unknown>(await imageResponse.text(), null)
            const imageJob = extractClothingStudioJobRecord(imagePayload)

            if (!imageResponse.ok || !imageJob || imageJob.type !== "IMAGE_GEN") {
              const message =
                imagePayload &&
                typeof imagePayload === "object" &&
                "error" in imagePayload &&
                typeof (imagePayload as { error?: unknown }).error === "string"
                  ? String((imagePayload as { error?: string }).error || "").trim()
                  : ""
              throw new Error(message || options.creationErrorMessage)
            }

            const imageSnapshot = await pollJobUntilFinished(imageJob.id, controller.signal)
            if (imageSnapshot.type !== "IMAGE_GEN" || imageSnapshot.status !== "success") {
              throw new Error(imageSnapshot.error_message || options.generationErrorMessage)
            }

            const doneUrl =
              String(imageSnapshot.result_url || "").trim() ||
              String((imageSnapshot.result_data as ClothingStudioImageJobRecord["result_data"])?.result?.[0] || "").trim()
            if (!doneUrl) {
              throw new Error("图片任务已完成，但没有返回图片")
            }

            updateGeneratedImage(item.plan.id, (image) => ({
              ...image,
              title: item.title,
              status: "done",
              url: doneUrl,
              prompt: item.prompt,
              model:
                String((imageSnapshot.provider_meta as { model?: unknown } | null)?.model || imageJob.payload.model || "").trim(),
              provider:
                String((imageSnapshot.provider_meta as { source?: unknown } | null)?.source || "").trim(),
              error: "",
            }))
          } catch (error: any) {
            if (error?.name === "AbortError") {
              throw error
            }

            const message = String(error?.message || options.generationErrorMessage)
            updateGeneratedImage(item.plan.id, (image) => ({
              ...image,
              title: item.title,
              status: "error",
              error: message,
              prompt: item.prompt,
            }))

            throw error instanceof Error ? error : new Error(message)
          }
        })
      )

      if (controller.signal.aborted) {
        throw createAbortError()
      }

      const failedResult = generationResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected" && result.reason?.name !== "AbortError"
      )
      if (failedResult) {
        throw failedResult.reason
      }
      setCurrentStep("complete")
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setGeneratedImagesState((previous) =>
          previous.map((image) =>
            targetPlanIds.has(image.planId) && (image.status === "prompting" || image.status === "generating")
              ? { ...image, status: "cancelled", error: "本次生成已取消" }
              : image
          )
        )
      } else {
        setGenerationError(String(error?.message || options.generationErrorMessage))
        setGeneratedImagesState((previous) =>
          previous.map((image) =>
            targetPlanIds.has(image.planId) && (image.status === "prompting" || image.status === "generating")
              ? { ...image, status: "error", error: String(error?.message || options.generationErrorMessage) }
              : image
          )
        )
      }
    } finally {
      generationAbortRef.current = null
      setIsGenerating(false)
    }
  }

  const runTryOnGeneration = async (plans: ClothingStudioPlan[], options?: { replaceAll?: boolean }) => {
    await runPromptBasedGeneration(plans, {
      replaceAll: options?.replaceAll,
      clothingMode: "model_prompt_generation",
      workflowMode: "model",
      promptErrorMessage: "试穿提示词生成失败",
      creationErrorMessage: "创建试穿生成任务失败",
      generationErrorMessage: "试穿生成失败",
    })
  }

  const runGeneration = async (plans: ClothingStudioPlan[], options?: { replaceAll?: boolean }) => {
    await runPromptBasedGeneration(plans, {
      replaceAll: options?.replaceAll,
      clothingMode: "prompt_generation",
      workflowMode: "product",
      promptErrorMessage: "基础套图提示词生成失败",
      creationErrorMessage: "创建基础套图生成任务失败",
      generationErrorMessage: "基础套图生成失败",
    })
  }

  const handlePrimaryAction = async () => {
    if (currentStep === "complete") {
      resetAnalysisAndResults()
      setAnalysisError("")
      setGenerationError("")
      updateNotice("已重新开始，可继续新一轮生成")
      return
    }

    if (!analysisResult || analysisNeedsRefresh) {
      await handleAnalyze()
      return
    }
    if (mode === "tryon") {
      await runTryOnGeneration(analysisResult.images, { replaceAll: true })
      return
    }
    await runGeneration(analysisResult.images, { replaceAll: true })
  }

  const handleRetryImage = async (image: ClothingStudioGeneratedImage) => {
    if (!analysisResult) return
    const plan = analysisResult.images.find((item) => item.id === image.planId)
    if (!plan) return
    if (mode === "tryon") {
      await runTryOnGeneration([plan], { replaceAll: false })
      return
    }
    await runGeneration([plan], { replaceAll: false })
  }

  const handleCancelGeneration = () => {
    generationAbortRef.current?.abort()
  }

  const handleBackToPreviousStep = () => {
    resetAnalysisAndResults()
    setAnalysisError("")
    setGenerationError("")
    updateNotice("已返回上一步，请重新调整需求后分析")
  }

  const handleDownloadImage = async (image: ClothingStudioGeneratedImage) => {
    if (!image.url) return
    try {
      await fetchAndDownload(resolveImageDownloadUrl(image.url), buildClothingStudioImageFilename(image.index, image.title))
    } catch (error: any) {
      setGenerationError(String(error?.message || "下载失败"))
    }
  }

  const handleDownloadSelected = async () => {
    const selectedDoneItems = generatedImages.filter((item) => item.status === "done" && item.url && selectedIds.includes(item.id))
    const items = selectedDoneItems.length > 0
      ? selectedDoneItems
      : generatedImages.filter((item) => item.status === "done" && item.url)
    if (items.length === 0) {
      setGenerationError("当前还没有可下载的图片")
      return
    }

    if (items.length === 1) {
      await handleDownloadImage(items[0])
      return
    }

    setIsBatchDownloading(true)
    try {
      const zip = new JSZip()
      for (const image of items) {
        const response = await fetch(resolveImageDownloadUrl(image.url))
        if (!response.ok) {
          throw new Error(`下载素材失败：${image.title}`)
        }
        const blob = await response.blob()
        zip.file(buildClothingStudioImageFilename(image.index, image.title), blob)
      }

      const blob = await zip.generateAsync({ type: "blob" })
      const objectUrl = URL.createObjectURL(blob)
      try {
        triggerBrowserDownload(objectUrl, `clothing-studio-batch-${Date.now()}.zip`)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch (error: any) {
      setGenerationError(String(error?.message || "批量下载失败"))
    } finally {
      setIsBatchDownloading(false)
    }
  }

  const handleCopyPrompt = async (prompt: string) => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      updateNotice("提示词已复制")
    } catch {
      setGenerationError("复制失败，请手动复制")
    }
  }

  const handleOpenImageInCanvas = (image: ClothingStudioGeneratedImage) => {
    if (!image.url || openingCanvasImageId === image.id || typeof window === "undefined") return

    setOpeningCanvasImageId(image.id)
    void (async () => {
      try {
        const pageNumber = image.index + 1
        const baseTitle = String(image.title || (mode === "tryon" ? "模特试穿成图" : "服装组图成图")).trim()
          || (mode === "tryon" ? "模特试穿成图" : "服装组图成图")
        await openImageInCanvas({
          imageUrl: image.url,
          projectTitle: `${baseTitle} · 画布编辑`,
          layerName: `${baseTitle} 第${pageNumber}张`,
          thumbnail: image.url,
        })
      } catch (error: any) {
        setGenerationError(String(error?.message || "打开画布失败"))
      } finally {
        setOpeningCanvasImageId((current) => (current === image.id ? null : current))
      }
    })()
  }

  const doneImages = generatedImages.filter((item) => item.status === "done" && item.url)
  const generatingCount = generatedImages.filter((item) => item.status === "generating").length
  const promptingCount = generatedImages.filter((item) => item.status === "prompting" || item.status === "pending").length
  const generationStatusText =
    failedCount > 0 && doneCount + failedCount < generatedImages.length
      ? `已有 ${failedCount} 张处理异常，正在继续生成剩余图片...`
      : generatingCount > 0
        ? doneCount > 0
          ? `已完成 ${doneCount}/${generatedImages.length} 张，正在继续渲染中...`
          : "正在深度解析服装设计特征..."
        : promptingCount > 0
          ? doneCount > 0
            ? `已完成 ${doneCount}/${generatedImages.length} 张，正在准备下一张...`
            : "正在深度解析服装设计特征..."
          : "正在生成服装图组..."
  const resultPanelTitle =
    currentStep === "analyzing"
      ? "分析中..."
      : currentStep === "preview"
        ? "设计规划预览"
        : currentStep === "generating"
          ? "生成中..."
          : currentStep === "complete"
            ? "生成完成"
            : "设计规划预览"
  const resultPanelSubtitle =
    currentStep === "analyzing"
      ? "正在分析服装并生成设计规范"
      : currentStep === "preview"
        ? "请确认整体设计规范和图片规划"
        : currentStep === "generating"
          ? "正在生成服装图组"
          : currentStep === "complete"
            ? failedCount > 0
              ? `已完成 ${doneCount} 张，失败 ${failedCount} 张`
              : "所有图片已生成完成"
            : "上传产品图并点击分析开始"
  const primaryActionDisabled =
    isUploading ||
    isModelUploading ||
    isAnalyzing ||
    isGenerating ||
    productImages.length === 0 ||
    activePlans.length === 0
  const primaryButtonLabel = isAnalyzing
    ? "分析中..."
    : isGenerating
      ? "生成中..."
      : currentStep === "complete"
        ? "重新开始"
      : productImages.length === 0
        ? (mode === "tryon" ? "请上传衣服" : "请上传产品图")
        : analysisResult && !analysisNeedsRefresh
          ? (mode === "tryon" ? "开始模特试穿" : `生成 ${analysisResult.images.length} 张图组`)
          : "分析产品"

  return (
    <main
      className={cn(PICSET_MAIN_CLASS, PICSET_PAGE_BACKGROUND_CLASS)}
      style={{
        ...PICSET_THEME_STYLE,
        fontFamily: PICSET_FONT_FAMILY,
      }}
      role="main"
    >
      <div className={cn(PICSET_CONTAINER_CLASS, embeddedInToolbox && "toolbox-product-detail-workspace")}>
            <section className={cn("py-6 text-center sm:py-8", embeddedInToolbox && "toolbox-product-detail-hero")} aria-labelledby="hero-title">
              <h1 id="hero-title" className="mb-3 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                智能生成服装详情图组
              </h1>
              <p className="mx-auto max-w-2xl text-sm text-muted-foreground sm:text-base">
                上传服装产品图，AI 智能分析款式、面料与细节，自动生成白底精修、3D 立体展示及细节特写等电商级图组
              </p>
            </section>

            {!embeddedInToolbox ? <StepRail currentStep={currentStep} /> : null}

            <div className={cn("mt-5 pb-10", PICSET_GRID_CLASS)}>
              <div className="space-y-4">
                <div className={cn("flex items-center gap-1", PICSET_SEGMENTED_TRAY_CLASS)}>
                  <button
                    type="button"
                    disabled={isAnalyzing || isGenerating}
                    onClick={() => handleModeChange("tryon")}
                    className={cn(
                      PICSET_SEGMENTED_TRIGGER_CLASS,
                      "flex-1",
                      mode === "tryon" ? PICSET_SEGMENTED_TRIGGER_ACTIVE_CLASS : PICSET_SEGMENTED_TRIGGER_INACTIVE_CLASS
                    )}
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>模特试穿</span>
                  </button>
                  <button
                    type="button"
                    disabled={isAnalyzing || isGenerating}
                    onClick={() => handleModeChange("basic")}
                    className={cn(
                      PICSET_SEGMENTED_TRIGGER_CLASS,
                      "flex-1",
                      mode === "basic" ? PICSET_SEGMENTED_TRIGGER_ACTIVE_CLASS : PICSET_SEGMENTED_TRIGGER_INACTIVE_CLASS
                    )}
                  >
                    <Layers3 className="h-4 w-4" />
                    <span>基础套图</span>
                  </button>
                </div>

                <ProductUploadCard
                  images={productImages}
                  isUploading={isUploading}
                  error={uploadError}
                  onFiles={handleFiles}
                  onRemove={handleRemoveProductImage}
                />

                {mode === "tryon" ? (
                  <ModelImageUploadCard
                    image={modelImage}
                    isUploading={isModelUploading}
                    error={modelUploadError}
                    disabled={isAnalyzing || isGenerating}
                    onFile={(file) => void handleModelFile(file)}
                    onRemove={handleRemoveModelImage}
                    onAiGenerate={handleGenerateModelImage}
                  />
                ) : null}

                <div className={cn("p-4", PICSET_CARD_CLASS)}>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent">
                      <Settings2 className="h-4.5 w-4.5 text-foreground" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground tracking-tight">组图要求</h3>
                      <p className="text-xs text-muted-foreground">描述您的产品信息和期望的图片风格</p>
                    </div>
                  </div>
                  <div className="mb-3">
                    <textarea
                      value={requirements}
                      onChange={(event) => setRequirements(event.target.value)}
                      disabled={isAnalyzing || isGenerating}
                      className={cn(PICSET_TEXTAREA_CLASS, "min-h-[148px] text-[13px] leading-6")}
                      id="clothing-description"
                      placeholder={
                        mode === "basic"
                          ? "建议输入：款式名称、面料材质、设计亮点、适合人群、风格调性等\n\n例如：这是一款法式复古连衣裙，采用重磅真丝面料，特色是精致的蕾丝拼接和珍珠扣设计，适合25-35岁都市女性通勤或约会穿着。希望详情图呈现优雅浪漫的高级质感。"
                          : "建议输入：服装定位、适合人群、模特气质、场景氛围、搭配风格等\n\n例如：这是一件都市通勤风西装外套，希望使用高级感女模特完成棚拍和咖啡馆场景试穿，整体风格简洁克制，突出利落廓形和羊毛面料质感。"
                      }
                      aria-label="组图要求"
                    />
                  </div>
                  {mode === "tryon" ? (
                    <>
                      <div className="mb-3">
                        <SelectField
                          label="目标语言"
                          value={settings.targetLanguage}
                          onChange={(value) => setSettings((previous) => ({ ...previous, targetLanguage: value }))}
                          options={CLOTHING_STUDIO_TARGET_LANGUAGES.map((item) => ({ value: item.value, label: item.label }))}
                          disabled={isAnalyzing || isGenerating}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                        <SelectField
                          label="模型"
                          value={settings.imageModelId}
                          onChange={(value) => setSettings((previous) => ({ ...previous, imageModelId: value }))}
                          options={imageModelOptions}
                          disabled={isAnalyzing || isGenerating}
                        />
                        <SelectField
                          label="尺寸比例"
                          value={settings.aspectRatio}
                          onChange={(value) => setSettings((previous) => ({ ...previous, aspectRatio: value }))}
                          options={CLOTHING_STUDIO_ASPECT_RATIOS.map((item) => ({ value: item.value, label: item.label }))}
                          disabled={isAnalyzing || isGenerating}
                        />
                        <SelectField
                          label="清晰度"
                          value={settings.imageSize}
                          onChange={(value) => setSettings((previous) => ({ ...previous, imageSize: value }))}
                          options={CLOTHING_STUDIO_IMAGE_SIZES.map((item) => ({ value: item.value, label: item.label }))}
                          disabled={isAnalyzing || isGenerating}
                        />
                        <SelectField
                          label="生成数量"
                          value={String(tryOnOutputCount)}
                          onChange={(value) =>
                            setTryOnSelections((previous) =>
                              collapseTryOnSelectionsToSourceUi(previous, clampClothingStudioTryOnOutputCount(value))
                            )
                          }
                          options={Array.from({ length: CLOTHING_STUDIO_MAX_TRYON_OUTPUT_COUNT }, (_, index) => ({
                            value: String(index + 1),
                            label: `${index + 1} 张`,
                          }))}
                          disabled={isAnalyzing || isGenerating}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                      <SelectField
                        label="分析模型"
                        value={settings.textModelId}
                        onChange={(value) => setSettings((previous) => ({ ...previous, textModelId: value }))}
                        options={textModelOptions}
                        disabled={isAnalyzing || isGenerating}
                      />
                      <SelectField
                        label="目标语言"
                        value={settings.targetLanguage}
                        onChange={(value) => setSettings((previous) => ({ ...previous, targetLanguage: value }))}
                        options={CLOTHING_STUDIO_TARGET_LANGUAGES.map((item) => ({ value: item.value, label: item.label }))}
                        disabled={isAnalyzing || isGenerating}
                      />
                      <SelectField
                        label="模型"
                        value={settings.imageModelId}
                        onChange={(value) => setSettings((previous) => ({ ...previous, imageModelId: value }))}
                        options={imageModelOptions}
                        disabled={isAnalyzing || isGenerating}
                      />
                      <SelectField
                        label="尺寸比例"
                        value={settings.aspectRatio}
                        onChange={(value) => setSettings((previous) => ({ ...previous, aspectRatio: value }))}
                        options={CLOTHING_STUDIO_ASPECT_RATIOS.map((item) => ({ value: item.value, label: item.label }))}
                        disabled={isAnalyzing || isGenerating}
                      />
                      <SelectField
                        label="清晰度"
                        value={settings.imageSize}
                        onChange={(value) => setSettings((previous) => ({ ...previous, imageSize: value }))}
                        options={CLOTHING_STUDIO_IMAGE_SIZES.map((item) => ({ value: item.value, label: item.label }))}
                        disabled={isAnalyzing || isGenerating}
                      />
                    </div>
                  )}
                </div>

                {mode === "basic" ? (
                  <BasicGenerationTypeSelector
                    selections={basicSelections}
                    disabled={isAnalyzing || isGenerating}
                    onChange={setBasicSelections}
                  />
                ) : null}

                <div className="flex flex-col gap-2.5">
                  <SpeedModePicker
                    value={settings.speedMode}
                    onChange={(value) => setSettings((previous) => ({ ...previous, speedMode: value as typeof previous.speedMode }))}
                    disabled={isAnalyzing || isGenerating}
                  />
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={primaryActionDisabled}
                      onClick={() => void handlePrimaryAction()}
                      className={cn(
                        "h-11 w-full rounded-2xl px-6 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 active:scale-[0.98]",
                        PICSET_SOLID_DARK_BUTTON_CLASS
                      )}
                    >
                      {isAnalyzing || isGenerating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : mode === "tryon" ? (
                        <Shirt className="h-4 w-4" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                      {primaryButtonLabel}
                    </button>
                    {currentStep !== "complete" ? (
                      <p className="text-center text-[10px] font-medium text-muted-foreground">
                        预计消耗 {formatPointsCost(estimatedGenerationCost)} 积分
                      </p>
                    ) : null}
                    {analysisResult && !isGenerating && (currentStep === "preview" || currentStep === "complete") ? (
                      <button
                        type="button"
                        onClick={handleBackToPreviousStep}
                        className={cn(
                          "h-11 w-full rounded-2xl px-6 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                          PICSET_NEUTRAL_BUTTON_CLASS
                        )}
                      >
                        <ArrowLeft className="h-4 w-4" />
                        返回上一步
                      </button>
                    ) : null}
                    {isGenerating ? (
                      <button
                        type="button"
                        onClick={handleCancelGeneration}
                        className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-[13px] font-medium text-foreground transition hover:bg-muted/70"
                      >
                        取消当前批量生成
                      </button>
                    ) : null}
                  </div>
                </div>

                {analysisNeedsRefresh ? (
                  <InlineAlert tone="warning">
                    当前方案已经和最新输入不一致，请重新点击“分析产品”刷新方案后再生成。
                  </InlineAlert>
                ) : null}
                {analysisError ? <InlineAlert>{analysisError}</InlineAlert> : null}
                {generationError ? <InlineAlert>{generationError}</InlineAlert> : null}
                {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
              </div>

              <div className={cn("flex min-h-[560px] flex-col xl:min-h-[900px]", embeddedInToolbox && "toolbox-product-detail-result-column")}>
                {embeddedInToolbox ? <StepRail currentStep={currentStep} /> : null}
                <article
                  className={cn("flex min-h-[560px] flex-col p-4 sm:p-5 xl:min-h-[900px]", PICSET_CARD_CLASS)}
                  aria-labelledby="result-title"
                >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary" aria-hidden="true">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <h2 id="result-title" className="text-sm font-semibold tracking-tight text-foreground">{resultPanelTitle}</h2>
                      <p className="text-xs text-muted-foreground">{resultPanelSubtitle}</p>
                    </div>
                  </div>
                  {currentStep === "complete" && doneImages.length > 0 ? (
                    <button
                      type="button"
                      disabled={isBatchDownloading}
                      onClick={() => void handleDownloadSelected()}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 text-[11px] font-bold text-zinc-900 shadow-sm transition-all duration-200 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {isBatchDownloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      批量下载
                    </button>
                  ) : null}
                </div>

                <div className="custom-scrollbar flex-1 overflow-y-auto pr-1">
                  {currentStep === "input" && !analysisResult ? (
                    <div className="flex h-full items-center justify-center">
                      <div className="py-10 text-center">
                        <div className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#f3efea]">
                          <Sparkles className="h-7 w-7 text-muted-foreground" />
                        </div>
                        <p className="whitespace-pre-line text-[13px] text-muted-foreground">
                          上传产品图并填写要求后{"\n"}点击&apos;分析产品&apos;开始
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {currentStep === "analyzing" ? (
                    <div className="flex min-h-full flex-col">
                      <div className="mb-3 space-y-2">
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="分析进度"
                          className="relative h-2 w-full overflow-hidden rounded-full bg-secondary"
                        >
                          <div className="studio-genesis-loading-bar absolute inset-y-0 w-2/5 rounded-full bg-primary" />
                        </div>
                        <p className="animate-pulse text-center text-xs font-medium text-muted-foreground">
                          AI 正在分析服装特征并生成组图策略
                        </p>
                      </div>
                      <div className="flex-1" />
                    </div>
                  ) : null}

                  {analysisResult && currentStep === "preview" ? (
                    <div className="space-y-4">
                      <DesignSpecsEditor
                        value={analysisResult.summary}
                        disabled={isGenerating}
                        onChange={handleSummaryUpdate}
                      />
                      <PlanEditor plans={analysisResult.images} disabled={isGenerating} onUpdate={handlePlanUpdate} />
                    </div>
                  ) : null}

                  {currentStep === "generating" && generatedImages.length > 0 ? (
                    <GeneratingPreview
                      images={generatedImages}
                      aspectRatio={settings.aspectRatio}
                      statusText={generationStatusText}
                    />
                  ) : null}

                  {currentStep === "complete" && generatedImages.length > 0 ? (
                    <ResultGallery
                      images={generatedImages}
                      aspectRatio={settings.aspectRatio}
                      isGenerating={isGenerating}
                      openingCanvasImageId={openingCanvasImageId}
                      onDownload={(image) => void handleDownloadImage(image)}
                      onRetry={(image) => void handleRetryImage(image)}
                      onCopyPrompt={(prompt) => void handleCopyPrompt(prompt)}
                      onEdit={(image) => handleOpenImageInCanvas(image)}
                    />
                  ) : null}
                </div>
                </article>
              </div>
            </div>
      </div>

      <style jsx global>{`
        @keyframes studioGenesisLoadingBar {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(60%);
          }
          100% {
            transform: translateX(260%);
          }
        }
        .studio-genesis-loading-bar {
          animation: studioGenesisLoadingBar 1.8s ease-in-out infinite;
        }
      `}</style>

      <ModelGeneratorDialog
        open={isModelGeneratorOpen}
        onOpenChange={setIsModelGeneratorOpen}
        form={modelGeneratorForm}
        onFormChange={(updater) => setModelGeneratorForm((previous) => normalizeModelGeneratorForm(updater(previous)))}
        candidates={generatedModelCandidates}
        history={modelGenerationHistory}
        selectedId={selectedGeneratedModelId}
        isGenerating={isGeneratingModelCandidates}
        error={modelGenerationError}
        onGenerate={() => void handleGenerateModelCandidates()}
        onSelectCandidate={setSelectedGeneratedModelId}
        onDownloadCandidate={(item) => void handleDownloadGeneratedModel(item)}
        onDownloadBatch={() => void handleDownloadGeneratedModelBatch()}
        onUseSelected={handleUseSelectedGeneratedModel}
        onPickHistoryBatch={handlePickModelHistoryBatch}
        onDeleteHistoryItem={handleDeleteModelHistoryItem}
      />
    </main>
  )
}
