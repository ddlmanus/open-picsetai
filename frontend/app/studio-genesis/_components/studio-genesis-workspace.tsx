"use client"

import Image from "next/image"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import JSZip from "jszip"
import {
  AlertCircle,
  BookOpen,
  Check,
  CircleCheck,
  CircleHelp,
  ChevronDown,
  Download,
  Eye,
  Gauge,
  Image as ImageIcon,
  Loader2,
  PencilLine,
  Plus,
  RefreshCcw,
  Rocket,
  Sparkles,
  Upload,
  Zap,
  Wand2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  PICSET_DIALOG_CANVAS_CLASS,
  PICSET_DIALOG_COMPACT_PANEL_CLASS,
  PICSET_DIALOG_PANEL_CLASS,
  PICSET_FONT_FAMILY,
  PICSET_MAIN_CLASS,
  PICSET_OVERLAY_ACTION_BUTTON_CLASS,
  PICSET_TEXTAREA_CLASS,
  PICSET_THEME_STYLE,
} from "@/components/picset/picset-theme"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { fetchAndDownload, resolveImageDownloadUrl, triggerBrowserDownload } from "@/lib/url/download-url"
import { toImageProxyUrlWithParams } from "@/lib/url/image-proxy-policy"
import {
  DEFAULT_STUDIO_GENESIS_SETTINGS,
  STUDIO_GENESIS_ASPECT_RATIOS,
  type StudioGenesisAiWriteJobRecord,
  type StudioGenesisAiWriteOption,
  STUDIO_GENESIS_IMAGE_SIZES,
  STUDIO_GENESIS_MAX_PLAN_COUNT,
  STUDIO_GENESIS_SPEED_MODES,
  STUDIO_GENESIS_STORAGE_KEY,
  STUDIO_GENESIS_TARGET_LANGUAGES,
  STUDIO_GENESIS_MAX_PRODUCT_IMAGES,
  buildStudioGenesisGeneratedPlaceholders,
  buildStudioGenesisImageFilename,
  clampStudioGenesisImageCount,
  normalizeStudioGenesisAnalysisResult,
  type StudioGenesisAnalysisJobRecord,
  type StudioGenesisAnalysisNotification,
  type StudioGenesisAnalysisResult,
  type StudioGenesisGeneratedImage,
  type StudioGenesisJobRecord,
  type StudioGenesisModelOption,
  type StudioGenesisModelSettingsPayload,
  type StudioGenesisPlan,
  type StudioGenesisStep,
  type StudioGenesisWorkflowMode,
} from "@/lib/studio-genesis"
import { openImageInCanvas } from "@/lib/canvas/open-image-in-canvas"

const KNOWLEDGE_STUDIO_DEFAULT_IMAGE_COUNT = 6
const KNOWLEDGE_STUDIO_DEFAULT_REQUIREMENTS = ""
const KNOWLEDGE_STUDIO_IMAGE_COUNT_OPTIONS = [6]
const KNOWLEDGE_STUDIO_MAX_REFERENCE_IMAGES = 13
const KNOWLEDGE_STUDIO_STORAGE_KEY = "picset:knowledge-studio"

const PRODUCT_STEP_ITEMS: Array<{ id: StudioGenesisStep; label: string; subtitle: string }> = [
  { id: "input", label: "输入", subtitle: "上传商品图并填写需求" },
  { id: "analyzing", label: "分析中", subtitle: "抽取设计规范和画面规划" },
  { id: "preview", label: "确认规划", subtitle: "编辑方案后开始批量生成" },
  { id: "generating", label: "生成中", subtitle: "逐张出图并回传结果" },
  { id: "complete", label: "完成", subtitle: "下载、重做或继续编辑" },
]

const KNOWLEDGE_STEP_ITEMS: Array<{ id: StudioGenesisStep; label: string; subtitle: string }> = [
  { id: "input", label: "输入", subtitle: "上传老师图、课堂参考图并填写课程文案" },
  { id: "analyzing", label: "分析中", subtitle: "抽取课程主视觉和固定海报结构" },
  { id: "preview", label: "确认规划", subtitle: "确认系列风格后开始批量生成" },
  { id: "generating", label: "生成中", subtitle: "逐张生成课程主图与招生海报" },
  { id: "complete", label: "完成", subtitle: "下载、重做或继续编辑" },
]

const PRODUCT_PLATFORM_OPTIONS = [
  "智能匹配",
  "淘宝",
  "天猫",
  "拼多多",
  "京东",
  "抖音",
  "亚马逊",
  "TEMU",
  "eBay",
  "SHEIN",
  "Shopee",
  "Lazada",
  "TikTok",
  "Ozon",
] as const

const PRODUCT_PLATFORM_CODE_MAP: Record<string, string> = {
  智能匹配: "none",
  淘宝: "taobao",
  天猫: "tmall",
  拼多多: "pinduoduo",
  京东: "jd",
  抖音: "douyin",
  亚马逊: "amazon",
  TEMU: "temu",
  eBay: "ebay",
  SHEIN: "shein",
  Shopee: "shopee",
  Lazada: "lazada",
  TikTok: "tiktok",
  Ozon: "ozon",
}

const PRODUCT_ASSET_MODE_OPTIONS = [
  { value: "main", label: "主图" },
  { value: "detail", label: "详情图" },
] as const

type PersistedWorkspaceState = {
  currentStep: StudioGenesisStep
  productImages: string[]
  portraitImage?: string
  referenceImages?: string[]
  requirements: string
  settings: typeof DEFAULT_STUDIO_GENESIS_SETTINGS
  analysisJobId?: string
  analysisStatusText?: string
  analysisNotifications?: StudioGenesisAnalysisNotification[]
  analysisResult: StudioGenesisAnalysisResult | null
  analysisSignature: string
  generatedImages: StudioGenesisGeneratedImage[]
}

type StreamEvent =
  | {
      type: "batch_start"
      requestId: string
      total: number
      concurrency: number
    }
  | {
      type: "image_status"
      requestId: string
      planId: string
      index: number
      jobId?: string
      title: string
      status: "prompting"
    }
  | {
      type: "prompt_ready"
      requestId: string
      planId: string
      index: number
      jobId?: string
      prompt: string
    }
  | {
      type: "image_done"
      requestId: string
      planId: string
      index: number
      jobId?: string
      title: string
      url: string
      prompt: string
      modelId: string
      provider: string
    }
  | {
      type: "image_error"
      requestId: string
      planId: string
      index: number
      jobId?: string
      title: string
      error: string
    }
  | {
      type: "batch_complete"
      requestId: string
      completed: number
      failed: number
      haltedByError?: string
    }
  | {
      type: "batch_cancelled"
      requestId: string
      completed: number
      failed: number
    }

const STUDIO_GENESIS_PAGE_STYLE = {
  ...PICSET_THEME_STYLE,
  fontFamily: PICSET_FONT_FAMILY,
}

const STUDIO_GENESIS_MAIN_CLASS = `${PICSET_MAIN_CLASS} min-h-screen bg-[#f5f4f5] pb-12 text-[#18181b] sm:px-6`
const STUDIO_GENESIS_CONTAINER_CLASS = "mx-auto w-full max-w-6xl"
const STUDIO_GENESIS_GRID_CLASS = "grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6 lg:gap-8"
const STUDIO_GENESIS_CARD_CLASS = "bg-surface border border-border rounded-3xl shadow-sm"
const STUDIO_GENESIS_FIELD_CLASS =
  "flex h-8 w-full appearance-none items-center justify-between rounded-lg border border-input bg-background px-3 py-1 pr-8 text-[12px] text-foreground outline-none transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
const STUDIO_GENESIS_TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
const STUDIO_GENESIS_SOFT_BUTTON_CLASS =
  "border border-border bg-surface text-foreground hover:bg-surface-hover"
const STUDIO_GENESIS_ICON_DISC_CLASS = "bg-secondary text-muted-foreground"
const STUDIO_GENESIS_MUTED_TEXT_CLASS = "text-muted-foreground"
const STUDIO_GENESIS_MUTED_STRONG_TEXT_CLASS = "text-muted-foreground"
const STUDIO_GENESIS_SELECT_CONTENT_CLASS =
  "w-[var(--radix-select-trigger-width)] max-h-[240px] overflow-y-auto rounded-[18px] border-border bg-white p-1 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
const STUDIO_GENESIS_SELECT_ITEM_CLASS =
  "min-h-7 rounded-lg py-1 pr-2.5 font-normal text-foreground hover:bg-secondary focus:bg-secondary text-[12px]"

const PICSET_CARD = STUDIO_GENESIS_CARD_CLASS
const PICSET_FIELD = STUDIO_GENESIS_FIELD_CLASS
const PICSET_SOFT_BUTTON = STUDIO_GENESIS_SOFT_BUTTON_CLASS

type StudioGenesisWorkspaceVariant = StudioGenesisWorkflowMode

function createDefaultSettingsForVariant(workflowMode: StudioGenesisWorkspaceVariant) {
  if (workflowMode === "knowledge") {
    return {
      ...DEFAULT_STUDIO_GENESIS_SETTINGS,
      aspectRatio: "3:4",
      imageCount: KNOWLEDGE_STUDIO_DEFAULT_IMAGE_COUNT,
      targetLanguage: "zh-CN",
    }
  }

  return {
    ...DEFAULT_STUDIO_GENESIS_SETTINGS,
  }
}

function resolveWorkflowSourceImages(params: {
  workflowMode: StudioGenesisWorkspaceVariant
  productImages: string[]
  portraitImage?: string
  referenceImages?: string[]
}) {
  if (params.workflowMode === "knowledge") {
    return [String(params.portraitImage || "").trim(), ...(params.referenceImages || [])]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  }

  return params.productImages.map((item) => String(item || "").trim()).filter(Boolean)
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function extractStudioGenesisJobRecord(input: unknown): StudioGenesisJobRecord | null {
  const direct = input as StudioGenesisJobRecord | null | undefined
  if (
    direct &&
    typeof direct === "object" &&
    typeof direct.id === "string" &&
    (direct.type === "ANALYSIS" || direct.type === "AI_WRITE")
  ) {
    return direct
  }

  const nested = (input as { job?: StudioGenesisJobRecord } | null | undefined)?.job
  if (
    nested &&
    typeof nested === "object" &&
    typeof nested.id === "string" &&
    (nested.type === "ANALYSIS" || nested.type === "AI_WRITE")
  ) {
    return nested
  }

  return null
}

function extractAnalysisJobRecord(input: unknown): StudioGenesisAnalysisJobRecord | null {
  const job = extractStudioGenesisJobRecord(input)
  return job?.type === "ANALYSIS" ? job : null
}

function extractAiWriteJobRecord(input: unknown): StudioGenesisAiWriteJobRecord | null {
  const job = extractStudioGenesisJobRecord(input)
  return job?.type === "AI_WRITE" ? job : null
}

function resolveLatestAnalysisStatusText(
  notifications: StudioGenesisAnalysisNotification[] | null | undefined,
  fallback?: string
) {
  const latest = Array.isArray(notifications) ? notifications[notifications.length - 1] : null
  return latest?.message || fallback || "正在进行高保真像素渲染..."
}

function formatPoints(value: number) {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0
  if (Number.isInteger(normalized)) {
    return normalized.toLocaleString()
  }
  return normalized.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function buildAnalysisSignature(params: {
  workflowMode: StudioGenesisWorkspaceVariant
  productImages: string[]
  portraitImage?: string
  referenceImages?: string[]
  requirements: string
  imageCount: number
  targetLanguage: string
}) {
  const isKnowledgeMode = params.workflowMode === "knowledge"
  return JSON.stringify({
    workflowMode: params.workflowMode,
    productImages: isKnowledgeMode
      ? []
      : params.productImages.map((item) => String(item || "").trim()).filter(Boolean).sort(),
    portraitImage: isKnowledgeMode ? String(params.portraitImage || "").trim() : "",
    referenceImages: isKnowledgeMode
      ? (params.referenceImages || []).map((item) => String(item || "").trim()).filter(Boolean).sort()
      : [],
    requirements: params.requirements.trim(),
    imageCount: clampStudioGenesisImageCount(params.imageCount),
    targetLanguage: params.targetLanguage.trim() || "none",
  })
}

function normalizeRestoredAnalysisSignature(params: {
  storedSignature?: string
  workflowMode: StudioGenesisWorkspaceVariant
  productImages: string[]
  portraitImage?: string
  referenceImages?: string[]
  requirements: string
  imageCount: number
  targetLanguage: string
}) {
  const nextSignature = buildAnalysisSignature({
    workflowMode: params.workflowMode,
    productImages: params.productImages,
    portraitImage: params.portraitImage,
    referenceImages: params.referenceImages,
    requirements: params.requirements,
    imageCount: params.imageCount,
    targetLanguage: params.targetLanguage,
  })
  const storedSignature = String(params.storedSignature || "")
  if (!storedSignature || storedSignature === nextSignature || params.workflowMode !== "knowledge") {
    return storedSignature || nextSignature
  }

  const parsed = safeJsonParse<Record<string, unknown>>(storedSignature, {})
  const normalizedReferenceImages = (params.referenceImages || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .sort()
  const legacyProductImages = Array.isArray(parsed.productImages)
    ? parsed.productImages.map((item) => String(item || "").trim()).filter(Boolean).sort()
    : []
  const expectedLegacyProductImages = resolveWorkflowSourceImages({
    workflowMode: "knowledge",
    productImages: params.productImages,
    portraitImage: params.portraitImage,
    referenceImages: params.referenceImages,
  }).sort()

  const isLegacyKnowledgeSignature =
    String(parsed.workflowMode || "").trim() === "knowledge" &&
    String(parsed.portraitImage || "").trim() === String(params.portraitImage || "").trim() &&
    JSON.stringify(
      Array.isArray(parsed.referenceImages)
        ? parsed.referenceImages.map((item) => String(item || "").trim()).filter(Boolean).sort()
        : []
    ) === JSON.stringify(normalizedReferenceImages) &&
    String(parsed.requirements || "").trim() === params.requirements.trim() &&
    clampStudioGenesisImageCount(parsed.imageCount) === clampStudioGenesisImageCount(params.imageCount) &&
    String(parsed.targetLanguage || "").trim() === (params.targetLanguage.trim() || "none") &&
    JSON.stringify(legacyProductImages) === JSON.stringify(expectedLegacyProductImages)

  return isLegacyKnowledgeSignature ? nextSignature : storedSignature
}

function restorePersistedState(raw: PersistedWorkspaceState, workflowMode: StudioGenesisWorkspaceVariant): PersistedWorkspaceState {
  const defaultSettings = createDefaultSettingsForVariant(workflowMode)
  const analysisResult = raw.analysisResult
    ? normalizeStudioGenesisAnalysisResult(raw.analysisResult, {
        imageCount: raw.settings?.imageCount,
        targetLanguage: raw.settings?.targetLanguage,
        workflowMode,
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
    currentStep = raw.analysisJobId && currentStep === "analyzing" ? "analyzing" : "input"
  }

  if (currentStep === "analyzing" && !String(raw.analysisJobId || "").trim()) {
    currentStep = analysisResult ? "preview" : "input"
  }

  return {
    currentStep,
    productImages: Array.isArray(raw.productImages) ? raw.productImages.map((item) => String(item || "").trim()).filter(Boolean) : [],
    portraitImage: String(raw.portraitImage || "").trim(),
    referenceImages: Array.isArray(raw.referenceImages) ? raw.referenceImages.map((item) => String(item || "").trim()).filter(Boolean) : [],
    requirements: String(raw.requirements || ""),
    settings: {
      ...defaultSettings,
      ...(raw.settings || {}),
      imageCount: clampStudioGenesisImageCount(raw.settings?.imageCount ?? defaultSettings.imageCount),
    },
    analysisJobId: String(raw.analysisJobId || "").trim(),
    analysisStatusText: String(raw.analysisStatusText || "").trim(),
    analysisNotifications: Array.isArray(raw.analysisNotifications)
      ? raw.analysisNotifications
          .map((item): StudioGenesisAnalysisNotification => {
            const normalizedStatus = String(item?.status || "").trim()
            return {
              id: String(item?.id || "").trim(),
              step: String(item?.step || "").trim() || "processing",
              message: String(item?.message || "").trim(),
              status: normalizedStatus === "success"
                ? "success"
                : normalizedStatus === "failed"
                  ? "failed"
                  : "processing",
              createdAt: String(item?.createdAt || "").trim() || new Date().toISOString(),
            }
          })
          .filter((item) => item.id && item.message)
      : [],
    analysisResult,
    analysisSignature: normalizeRestoredAnalysisSignature({
      storedSignature: String(raw.analysisSignature || ""),
      workflowMode,
      productImages: Array.isArray(raw.productImages) ? raw.productImages.map((item) => String(item || "").trim()).filter(Boolean) : [],
      portraitImage: String(raw.portraitImage || "").trim(),
      referenceImages: Array.isArray(raw.referenceImages) ? raw.referenceImages.map((item) => String(item || "").trim()).filter(Boolean) : [],
      requirements: String(raw.requirements || ""),
      imageCount: raw.settings?.imageCount ?? defaultSettings.imageCount,
      targetLanguage: String(raw.settings?.targetLanguage || defaultSettings.targetLanguage || "none"),
    }),
    generatedImages,
  }
}

function resolveStepIndex(
  step: StudioGenesisStep,
  items: Array<{ id: StudioGenesisStep; label: string; subtitle: string }>
) {
  return items.findIndex((item) => item.id === step)
}

function resolveStepAfterGeneration(
  images: StudioGenesisGeneratedImage[],
  hasAnalysis: boolean
): StudioGenesisStep {
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
    <div key={key} className="mb-1 flex gap-2 text-xs ml-2">
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
  children: React.ReactNode
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

function StepRail({
  currentStep,
  onStepClick,
  canStepClick,
  items = PRODUCT_STEP_ITEMS,
}: {
  currentStep: StudioGenesisStep
  onStepClick: (step: StudioGenesisStep) => void
  canStepClick: (step: StudioGenesisStep) => boolean
  items?: Array<{ id: StudioGenesisStep; label: string; subtitle: string }>
}) {
  const activeIndex = resolveStepIndex(currentStep, items)

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-wrap items-center justify-center gap-x-2 gap-y-3 py-3 sm:py-4">
      {items.map((item, index) => {
        const isCurrent = item.id === currentStep
        const isReached = index <= activeIndex
        const isFinalComplete = item.id === "complete" && currentStep === "complete"
        const isClickable = canStepClick(item.id) && !isCurrent
        return (
          <div key={item.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (isClickable) onStepClick(item.id)
              }}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 bg-transparent p-0 text-left transition-all",
                isClickable ? "group cursor-pointer" : "cursor-default"
              )}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-[12px] transition-all",
                    isFinalComplete
                      ? "bg-emerald-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.24)]"
                      : isCurrent && (item.id === "analyzing" || item.id === "generating")
                        ? "bg-[#1f1f23] text-white shadow-[0_8px_20px_rgba(15,23,42,0.16)]"
                      : isReached
                        ? "bg-[#1f1f23] text-white shadow-[0_8px_20px_rgba(15,23,42,0.16)]"
                        : "bg-[#f4f4f5] text-[#8b8b95]",
                    isClickable && "group-hover:scale-110 group-hover:ring-2 group-hover:ring-primary/30"
                  )}
                >
                  {isFinalComplete ? (
                    <CircleCheck className="h-4 w-4" />
                  ) : isCurrent && (item.id === "analyzing" || item.id === "generating") ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isReached ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-xs font-medium">{index + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[13px] font-medium tracking-[-0.01em] transition-colors",
                    isFinalComplete ? "text-emerald-600" : isReached ? "text-foreground" : "text-muted-foreground",
                    isClickable && "group-hover:text-primary"
                  )}
                >
                  {item.label}
                </span>
              </div>
            </button>
            {index < items.length - 1 ? (
              <div className={cn("h-px w-6 transition-colors sm:w-8", index < activeIndex ? "bg-[#1f1f23]" : "bg-[#e7e5e4]")} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function DesktopStepRail({
  currentStep,
  items,
  compact = false,
}: {
  currentStep: StudioGenesisStep
  items: Array<{ id: StudioGenesisStep; label: string; subtitle: string }>
  compact?: boolean
}) {
  const activeIndex = resolveStepIndex(currentStep, items)

  return (
    <div className={cn(compact ? "flex items-center justify-center gap-2 py-4" : "hidden md:flex items-center justify-center gap-2 py-4")}>
      {items.map((item, index) => {
        const isActive = item.id === currentStep
        const isReached = index < activeIndex
        const circleClassName = isActive || isReached
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground"
        const textClassName = isActive || isReached ? "text-foreground" : "text-muted-foreground"

        return (
          <div key={item.id} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div className={cn("h-7 w-7 rounded-full flex items-center justify-center transition-all", circleClassName)}>
                {item.id === "complete" && currentStep === "complete" ? (
                  <CircleCheck className="h-4 w-4" />
                ) : (item.id === "analyzing" && currentStep === "analyzing") || (item.id === "generating" && currentStep === "generating") ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="text-xs font-medium">{index + 1}</span>
                )}
              </div>
              <span className={cn("text-xs font-medium", textClassName)}>{item.label}</span>
            </div>
            {index < items.length - 1 ? (
              <div className="h-px w-8 transition-colors bg-border" />
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
  const selectedLabel = options.find((item) => item.value === value)?.label || value

  return (
    <label className="space-y-1.5 w-full">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger disabled={disabled} className={cn(PICSET_FIELD, "border-input bg-background text-xs font-normal shadow-none")}>
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent
          className={STUDIO_GENESIS_SELECT_CONTENT_CLASS}
        >
          {options.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              className={cn(
                STUDIO_GENESIS_SELECT_ITEM_CLASS,
                item.value === value && "bg-secondary"
              )}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function UploadGrid({
  images,
  isUploading,
  disabled,
  onFiles,
  onRemove,
  helperText,
  imageAltPrefix,
  maxImages,
}: {
  images: string[]
  isUploading: boolean
  disabled?: boolean
  onFiles: (files: File[]) => void
  onRemove: (index: number) => void
  helperText?: string
  imageAltPrefix?: string
  maxImages?: number
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const limit = Math.max(1, Number(maxImages || STUDIO_GENESIS_MAX_PRODUCT_IMAGES) || STUDIO_GENESIS_MAX_PRODUCT_IMAGES)
  const canAddMore = images.length < limit

  const handleSelectFiles = (files: FileList | null) => {
    if (disabled) return
    const nextFiles = Array.from(files || [])
    if (nextFiles.length > 0) onFiles(nextFiles)
  }

  const handleDropFiles = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragActive(false)
    if (disabled) return
    const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith("image/"))
    if (files.length > 0) onFiles(files)
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(event) => {
          handleSelectFiles(event.target.files)
          event.currentTarget.value = ""
        }}
      />

      {images.length === 0 ? (
        <label
          onDragOver={(event) => {
            if (disabled) return
            event.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDropFiles}
          className={cn(
            "relative group flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer",
            disabled
              ? "cursor-not-allowed border-border bg-muted/20 opacity-60"
              : dragActive
                ? "border-primary/50 bg-surface-hover"
                : "border-border hover:border-primary/50 hover:bg-surface-hover"
          )}
          onClick={() => {
            if (disabled) return
            inputRef.current?.click()
          }}
        >
          <div className={cn("h-10 w-10 rounded-full flex items-center justify-center transition-colors", STUDIO_GENESIS_ICON_DISC_CLASS)}>
            {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          </div>
          <div className="text-center px-4">
            <p className="text-xs font-medium text-foreground">{helperText || "多图上传时建议仅上传必要的视角或sku图，图片不是越多越好"}</p>
          </div>
        </label>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {images.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted/10"
            >
              <div className="relative h-full w-full">
                <Image
                  src={toImageProxyUrlWithParams(image, { w: 360 })}
                  alt={`${imageAltPrefix || "商品图"} ${index + 1}`}
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 33vw, 120px"
                  className="h-full w-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (disabled) return
                  onRemove(index)
                }}
                aria-label={`删除第 ${index + 1} 张${imageAltPrefix || "商品图"}`}
                disabled={disabled}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 disabled:pointer-events-none"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="absolute bottom-1 left-1 rounded bg-black/40 px-1 text-[10px] text-white">
                {index + 1}
              </div>
            </div>
          ))}

          {canAddMore ? (
            <label
              onClick={() => {
                if (disabled) return
                inputRef.current?.click()
              }}
              onDragOver={(event) => {
                if (disabled) return
                event.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDropFiles}
              aria-label={`继续上传${imageAltPrefix || "商品图"}`}
              className={cn(
                "flex aspect-square cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-border bg-surface transition-colors",
                disabled
                  ? "cursor-not-allowed opacity-60"
                  : dragActive
                    ? "border-primary/40 bg-surface-hover"
                    : "hover:border-primary/35 hover:bg-surface-hover",
                isUploading ? "cursor-wait opacity-80" : ""
              )}
            >
              {isUploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Plus className="h-5 w-5 text-muted-foreground" />}
            </label>
          ) : null}
        </div>
      )}
    </div>
  )
}

function SingleImageUploadCard({
  image,
  isUploading,
  disabled,
  title,
  subtitle,
  helperText,
  emptyTitle,
  emptySubtitle,
  onFile,
  onRemove,
}: {
  image: string
  isUploading: boolean
  disabled?: boolean
  title: string
  subtitle: string
  helperText: string
  emptyTitle: string
  emptySubtitle: string
  onFile: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleSelectFile = (files: FileList | null) => {
    if (disabled) return
    const [file] = Array.from(files || []).filter((item) => item.type.startsWith("image/"))
    if (file) onFile(file)
  }

  const handleDropFile = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragActive(false)
    if (disabled) return
    const [file] = Array.from(event.dataTransfer.files || []).filter((item) => item.type.startsWith("image/"))
    if (file) onFile(file)
  }

  return (
    <article className={cn("space-y-4 p-5 sm:p-6", PICSET_CARD)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn("h-8 w-8 rounded-full flex items-center justify-center", STUDIO_GENESIS_ICON_DISC_CLASS)}>
            <ImageIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
            <p className={cn("text-xs", STUDIO_GENESIS_MUTED_TEXT_CLASS)}>{subtitle}</p>
          </div>
        </div>
        {image ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className={cn(PICSET_SOFT_BUTTON, "h-9 rounded-full px-4 text-xs font-medium")}
          >
            清除
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(event) => {
          handleSelectFile(event.target.files)
          event.currentTarget.value = ""
        }}
      />

      {image ? (
        <div className="group relative overflow-hidden rounded-[24px] border border-border bg-muted/10">
          <div className="relative aspect-[4/5]">
            <Image
              src={toImageProxyUrlWithParams(image, { w: 960 })}
              alt={title}
              fill
              unoptimized
              sizes="(max-width: 1024px) 100vw, 420px"
              className="object-cover"
            />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 via-black/25 to-transparent px-4 pb-4 pt-10 text-white">
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-white/80">{helperText}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (disabled) return
                inputRef.current?.click()
              }}
              disabled={disabled}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/70 disabled:pointer-events-none disabled:opacity-50"
              aria-label={`替换${title}`}
            >
              <Upload className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (disabled) return
              inputRef.current?.click()
            }}
            disabled={disabled}
            className="absolute inset-0"
            aria-label={`替换${title}`}
          />
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            if (disabled) return
            event.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDropFile}
          className={cn(
            "relative group flex flex-col items-center justify-center gap-2 py-6 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer min-h-[182px]",
            disabled
              ? "cursor-not-allowed border-border bg-muted/20 opacity-60"
              : dragActive
                ? "border-primary/40 bg-surface-hover"
                : "border-border hover:border-primary/35 hover:bg-surface-hover"
          )}
          onClick={() => {
            if (disabled) return
            inputRef.current?.click()
          }}
        >
          <div className={cn("h-10 w-10 rounded-full flex items-center justify-center transition-colors", STUDIO_GENESIS_ICON_DISC_CLASS)}>
            {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          </div>
          <div className="text-center px-4">
            <p className="text-xs font-medium text-foreground">{emptySubtitle || emptyTitle}</p>
          </div>
        </div>
      )}
    </article>
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
    <div className={cn("space-y-3 p-5 sm:p-6", PICSET_CARD)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">生图速度</p>
          <p className="text-[12px] text-muted-foreground">{STUDIO_GENESIS_SPEED_MODES.find((item) => item.value === value)?.description || "标准速度，积分消耗最低"}</p>
        </div>
      </div>
      <div className="flex gap-2">
        {STUDIO_GENESIS_SPEED_MODES.map((item) => {
        const active = value === item.value
        const Icon = item.value === "standard" ? Zap : item.value === "fast" ? Gauge : Rocket
        return (
          <button
            key={item.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-[16px] border px-3 py-2.5 text-[13px] font-medium transition-all",
              active
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : PICSET_SOFT_BUTTON
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
        <div className="flex items-center justify-between p-4">
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
                  <PencilLine className="h-3 w-3 text-muted-foreground" />
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
          <div className="custom-scrollbar max-h-[500px] overflow-y-auto px-4 pb-4">
            <div className="rounded-xl bg-secondary/50 p-4">
              {editing ? (
                <textarea
                  value={decodedValue}
                  disabled={disabled}
                  onChange={(event) => onChange(event.target.value)}
                  className="min-h-[320px] w-full rounded-2xl border border-input bg-background px-4 py-4 text-sm leading-7 text-foreground outline-none transition focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
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
  plan: StudioGenesisPlan
  index: number
  disabled?: boolean
  onUpdate: (planId: string, key: "title" | "description" | "designContent" | "promptHint", value: string) => void
}) {
  const [expanded, setExpanded] = useState(index === 0)
  const [editing, setEditing] = useState(false)
  const decodedTitle = normalizePreviewText(plan.title)
  const decodedDescription = normalizePreviewText(plan.description)
  const decodedDesignContent = normalizePreviewText(plan.designContent)
  const decodedPromptHint = normalizePreviewText(plan.promptHint || "")
  const displayTitle = decodedTitle.trim()
  const displayDescription = decodedDescription.trim()
  const displayPromptHint = decodedPromptHint.trim()
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
      <div className="p-4">
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
                    className="inline-flex h-7 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Check className="mr-1 h-3 w-3" />
                    保存
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={handleCancelEdit}
                    className="inline-flex h-7 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-xs font-medium text-foreground transition-all duration-200 hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                  >
                    <X className="mr-1 h-3 w-3" />
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
                    <PencilLine className="h-3 w-3 text-muted-foreground" />
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

      <div className={cn("overflow-hidden transition-all duration-300", expanded ? "max-h-[800px]" : "max-h-0")}>
        <div className="px-4 pb-4">
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
                <div className="custom-scrollbar max-h-[400px] overflow-y-auto">
                  <div>{renderPlanContentPreview(decodedDesignContent || "尚未生成详细规划。")}</div>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={handleStartEdit}
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-xl bg-background/50 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:bg-accent hover:text-accent-foreground group-hover/content:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                  aria-label="编辑详细规划"
                >
                  <PencilLine className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
          {displayPromptHint ? (
            <div className="mt-3 rounded-lg border border-[#e7ddd1] bg-[#fffaf3] px-3 py-3">
              <div className="mb-1 text-xs font-medium text-foreground">补充提示</div>
              <p className="whitespace-pre-line text-xs leading-6 text-muted-foreground">{displayPromptHint}</p>
            </div>
          ) : null}
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
  plans: StudioGenesisPlan[]
  disabled?: boolean
  onUpdate: (planId: string, key: "title" | "description" | "designContent" | "promptHint", value: string) => void
}) {
  return (
    <section className="space-y-3">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <ImageIcon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">图片规划</h3>
          <p className="text-xs text-muted-foreground">共 {plans.length} 张图片，点击可编辑标题和描述</p>
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
  images: StudioGenesisGeneratedImage[]
  aspectRatio: string
  statusText: string
}) {
  const mediaStyle = resolveAspectRatioStyle(aspectRatio)

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-4 space-y-2">
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
        <div className="grid grid-cols-2 gap-4">
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
                          "flex h-12 w-12 items-center justify-center rounded-full",
                          isError
                            ? "bg-destructive/10"
                            : isCancelled
                              ? "bg-muted"
                              : "bg-primary/10"
                        )}
                      >
                        {isError ? (
                          <AlertCircle className="h-5 w-5 text-destructive/80" />
                        ) : isCancelled ? (
                          <X className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <Sparkles className="h-5 w-5 text-primary/60" />
                        )}
                      </div>
                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
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

function CompletedGallery({
  images,
  aspectRatio,
  isGenerating,
  openingCanvasImageId,
  onPreview,
  onDownload,
  onRetry,
  onEdit,
}: {
  images: StudioGenesisGeneratedImage[]
  aspectRatio: string
  isGenerating: boolean
  openingCanvasImageId?: string | null
  onPreview: (image: StudioGenesisGeneratedImage) => void
  onDownload: (image: StudioGenesisGeneratedImage) => void
  onRetry: (image: StudioGenesisGeneratedImage) => void
  onEdit: (image: StudioGenesisGeneratedImage) => void
}) {
  const mediaStyle = resolveAspectRatioStyle(aspectRatio)

  return (
    <div className="grid grid-cols-2 gap-4">
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
                      onClick={() => onPreview(image)}
                      className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-9 w-9")}
                      title="查看"
                      aria-label="查看"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownload(image)}
                      className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-9 w-9")}
                      title="下载"
                      aria-label="下载"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(image)}
                      disabled={isOpeningCanvas}
                      className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-9 w-9")}
                      title={isOpeningCanvas ? "正在打开画布" : "编辑"}
                      aria-label={isOpeningCanvas ? "正在打开画布" : "编辑"}
                    >
                      {isOpeningCanvas ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRetry(image)}
                      disabled={isGenerating}
                      className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-9 w-9 disabled:opacity-50")}
                      title="重新生成"
                      aria-label="重新生成"
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="group relative h-full w-full overflow-hidden rounded-2xl">
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                    {image.status === "error" ? (
                      <AlertCircle className="h-8 w-8 text-[#b6464f]" />
                    ) : image.status === "cancelled" ? (
                      <X className="h-8 w-8 text-[#8f6c42]" />
                    ) : (
                      <Sparkles className="h-8 w-8 text-primary/60" />
                    )}
                    <p className="text-xs font-medium text-muted-foreground">{placeholderText}</p>
                  </div>
                  {canRetry ? (
                    <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onRetry(image)}
                        disabled={isGenerating}
                        className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-9 w-9 disabled:opacity-50")}
                        title="重新生成"
                        aria-label="重新生成"
                      >
                        <RefreshCcw className="h-4 w-4" />
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

export default function StudioGenesisWorkspace({
  variant = "product",
  embeddedInToolbox = false,
}: {
  variant?: StudioGenesisWorkspaceVariant
  embeddedInToolbox?: boolean
}) {
  const searchParams = useSearchParams()
  const workflowMode: StudioGenesisWorkspaceVariant = variant === "knowledge" ? "knowledge" : "product"
  const isKnowledgeMode = workflowMode === "knowledge"
  const defaultSettings = useMemo(() => createDefaultSettingsForVariant(workflowMode), [workflowMode])
  const workspaceStorageKey = isKnowledgeMode ? KNOWLEDGE_STUDIO_STORAGE_KEY : STUDIO_GENESIS_STORAGE_KEY
  const [currentStep, setCurrentStep] = useState<StudioGenesisStep>("input")
  const [productImages, setProductImages] = useState<string[]>([])
  const [portraitImage, setPortraitImage] = useState("")
  const [referenceImages, setReferenceImages] = useState<string[]>([])
  const [requirements, setRequirements] = useState(isKnowledgeMode ? KNOWLEDGE_STUDIO_DEFAULT_REQUIREMENTS : "")
  const [settings, setSettings] = useState(defaultSettings)
  const [analysisJobId, setAnalysisJobId] = useState("")
  const [analysisStatusText, setAnalysisStatusText] = useState("")
  const [analysisNotifications, setAnalysisNotifications] = useState<StudioGenesisAnalysisNotification[]>([])
  const [analysisResult, setAnalysisResult] = useState<StudioGenesisAnalysisResult | null>(null)
  const [analysisSignature, setAnalysisSignature] = useState("")
  const [generatedImages, setGeneratedImages] = useState<StudioGenesisGeneratedImage[]>([])
  const [textModels, setTextModels] = useState<StudioGenesisModelOption[]>([])
  const [imageModels, setImageModels] = useState<StudioGenesisModelOption[]>([])
  const [userPoints, setUserPoints] = useState<number | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationError, setGenerationError] = useState("")
  const [notice, setNotice] = useState("")
  const [isBatchDownloading, setIsBatchDownloading] = useState(false)
  const [previewImageId, setPreviewImageId] = useState<string | null>(null)
  const [openingCanvasImageId, setOpeningCanvasImageId] = useState<string | null>(null)
  const [editingImageId, setEditingImageId] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState("")
  const [editError, setEditError] = useState("")
  const [isEditingImage, setIsEditingImage] = useState(false)
  const [assetMode, setAssetMode] = useState<(typeof PRODUCT_ASSET_MODE_OPTIONS)[number]["value"]>("main")
  const [platform, setPlatform] = useState<(typeof PRODUCT_PLATFORM_OPTIONS)[number]>(PRODUCT_PLATFORM_OPTIONS[0])
  const [isAiWriting, setIsAiWriting] = useState(false)
  const [aiWriteError, setAiWriteError] = useState("")
  const [aiWriteJobId, setAiWriteJobId] = useState("")
  const [aiWriteOptions, setAiWriteOptions] = useState<StudioGenesisAiWriteOption[]>([])
  const [aiWriteSelectedIndex, setAiWriteSelectedIndex] = useState(0)
  const [isAiWriteDialogOpen, setIsAiWriteDialogOpen] = useState(false)
  const analysisPollAbortRef = useRef<AbortController | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const aiWriteAbortRef = useRef<AbortController | null>(null)
  const generationJobWatchersRef = useRef<Map<string, AbortController>>(new Map())
  const generatedImagesRef = useRef<StudioGenesisGeneratedImage[]>([])
  const noticeTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    generatedImagesRef.current = generatedImages
  }, [generatedImages])

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(workspaceStorageKey) : null
    if (raw) {
      const restored = restorePersistedState(safeJsonParse(raw, {} as PersistedWorkspaceState), workflowMode)
      setCurrentStep(restored.currentStep)
      setProductImages(restored.productImages)
      setPortraitImage(restored.portraitImage || "")
      setReferenceImages(restored.referenceImages || [])
      setRequirements(restored.requirements)
      setSettings(restored.settings)
      setAnalysisJobId(restored.analysisJobId || "")
      setAnalysisStatusText(restored.analysisStatusText || "")
      setAnalysisNotifications(restored.analysisNotifications || [])
      setAnalysisResult(restored.analysisResult)
      setAnalysisSignature(restored.analysisSignature)
      setGeneratedImages(restored.generatedImages)
    } else {
      setSettings(defaultSettings)
      setRequirements(isKnowledgeMode ? KNOWLEDGE_STUDIO_DEFAULT_REQUIREMENTS : "")
    }
    setIsHydrated(true)
  }, [defaultSettings, isKnowledgeMode, workspaceStorageKey, workflowMode])

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return
    const payload: PersistedWorkspaceState = {
      currentStep,
      productImages,
      portraitImage,
      referenceImages,
      requirements,
      settings,
      analysisJobId,
      analysisStatusText,
      analysisNotifications,
      analysisResult,
      analysisSignature,
      generatedImages,
    }
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(payload))
  }, [
    analysisJobId,
    analysisNotifications,
    analysisResult,
    analysisSignature,
    analysisStatusText,
    currentStep,
    generatedImages,
    isHydrated,
    portraitImage,
    productImages,
    referenceImages,
    requirements,
    settings,
    workspaceStorageKey,
  ])

  useEffect(() => {
    let cancelled = false

    const loadModels = async () => {
      try {
        const response = await fetch("/api/studio-genesis/model-settings", { cache: "no-store" , credentials: "include"})
        const payload = safeJsonParse<StudioGenesisModelSettingsPayload>(await response.text(), {
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
        console.warn("[studio-genesis] model-settings failed", error)
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (previewImageId && !generatedImages.some((item) => item.id === previewImageId)) {
      setPreviewImageId(null)
    }
  }, [generatedImages, previewImageId])

  const previewImage = previewImageId
    ? generatedImages.find((item) => item.id === previewImageId) || null
    : null

  const activeImage = editingImageId
    ? generatedImages.find((item) => item.id === editingImageId) || null
    : null

  const sourceImages = resolveWorkflowSourceImages({
    workflowMode,
    productImages,
    portraitImage,
    referenceImages,
  })
  const currentProjectId = String(searchParams?.get("projectId") || searchParams?.get("project_id") || "").trim() || null

  const analysisNeedsRefresh = Boolean(analysisResult) && analysisSignature !== buildAnalysisSignature({
    workflowMode,
    productImages,
    portraitImage,
    referenceImages,
    requirements,
    imageCount: settings.imageCount,
    targetLanguage: settings.targetLanguage,
  })

  const doneCount = generatedImages.filter((item) => item.status === "done" && item.url).length
  const failedCount = generatedImages.filter((item) => item.status === "error" || item.status === "cancelled").length

  const updateNotice = (message: string) => {
    setNotice(message)
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current)
    }
    noticeTimeoutRef.current = window.setTimeout(() => setNotice(""), 2400)
  }

  const clearAnalysisState = () => {
    analysisPollAbortRef.current?.abort()
    analysisPollAbortRef.current = null
    generationAbortRef.current?.abort()
    generationAbortRef.current = null
    generationJobWatchersRef.current.forEach((item) => item.abort())
    generationJobWatchersRef.current.clear()

    setAnalysisJobId("")
    setAnalysisStatusText("")
    setAnalysisNotifications([])
    setAnalysisResult(null)
    setAnalysisSignature("")
    setGeneratedImages([])
    setAnalysisError("")
    setGenerationError("")
    setPreviewImageId(null)
    setOpeningCanvasImageId(null)
    setEditingImageId(null)
    setEditingPrompt("")
    setEditError("")
    setIsAnalyzing(false)
    setIsGenerating(false)
  }

  const handleCreateNewProject = () => {
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current)
      noticeTimeoutRef.current = null
    }

    const defaultTextModelId = textModels.find((item) => item.isDefault)?.runtimeId || textModels[0]?.runtimeId || ""
    const defaultImageModelId = imageModels.find((item) => item.isDefault)?.runtimeId || imageModels[0]?.runtimeId || ""

    setCurrentStep("input")
    setProductImages([])
    setPortraitImage("")
    setReferenceImages([])
    setRequirements(isKnowledgeMode ? KNOWLEDGE_STUDIO_DEFAULT_REQUIREMENTS : "")
    setSettings({
      ...createDefaultSettingsForVariant(workflowMode),
      textModelId: defaultTextModelId,
      imageModelId: defaultImageModelId,
    })
    clearAnalysisState()
    setUploadError("")
    setIsUploading(false)
    setNotice("")
    setIsBatchDownloading(false)
    setIsEditingImage(false)

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(workspaceStorageKey)
    }
  }

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current)
      }
      if (analysisPollAbortRef.current) {
        analysisPollAbortRef.current.abort()
      }
      if (aiWriteAbortRef.current) {
        aiWriteAbortRef.current.abort()
      }
      generationJobWatchersRef.current.forEach((item) => item.abort())
      generationJobWatchersRef.current.clear()
    }
  }, [])

  const handleAnalysisJobSnapshot = (job: StudioGenesisAnalysisJobRecord) => {
    const notifications = Array.isArray(job.notifications) ? job.notifications : []
    setAnalysisNotifications(notifications)
    setAnalysisStatusText(resolveLatestAnalysisStatusText(notifications))

    if (job.status === "processing") {
      setCurrentStep("analyzing")
      setIsAnalyzing(true)
      setAnalysisError("")
      return false
    }

    if (job.status === "success" && job.result_data) {
      const normalized = normalizeStudioGenesisAnalysisResult(job.result_data, {
        imageCount: job.payload.imageCount,
        targetLanguage: job.payload.uiLanguage || settings.targetLanguage,
        workflowMode: (job.payload.workflowMode || workflowMode) === "knowledge" ? "knowledge" : "product",
      })
      setProductImages(job.payload.workflowMode === "knowledge" ? [] : job.payload.productImages)
      setPortraitImage(String(job.payload.portraitImage || "").trim())
      setReferenceImages(Array.isArray(job.payload.referenceImages) ? job.payload.referenceImages : [])
      setAnalysisResult(normalized)
      setAnalysisSignature(buildAnalysisSignature({
        workflowMode: (job.payload.workflowMode || workflowMode) === "knowledge" ? "knowledge" : "product",
        productImages: (job.payload.workflowMode || workflowMode) === "knowledge" ? [] : job.payload.productImages,
        portraitImage: job.payload.portraitImage,
        referenceImages: job.payload.referenceImages,
        requirements: job.payload.requirements,
        imageCount: job.payload.imageCount,
        targetLanguage: job.payload.uiLanguage || settings.targetLanguage,
      }))
      setGeneratedImages(buildStudioGenesisGeneratedPlaceholders(normalized.images))
      setAnalysisJobId("")
      setIsAnalyzing(false)
      setAnalysisError("")
      setCurrentStep("preview")
      return true
    }

    if (job.status === "failed") {
      setAnalysisJobId("")
      setIsAnalyzing(false)
      setCurrentStep("input")
      setAnalysisError(job.error_message || resolveLatestAnalysisStatusText(notifications, "分析失败"))
      return true
    }

    return false
  }

  useEffect(() => {
    if (!analysisJobId || currentStep !== "analyzing") return

    let cancelled = false

    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

    const poll = async () => {
      while (!cancelled) {
        const controller = new AbortController()
        analysisPollAbortRef.current = controller

        try {
          const response = await fetch(`/api/studio-genesis/analyze/${encodeURIComponent(analysisJobId)}`, {
            cache: "no-store",
            signal: controller.signal,

            credentials: "include"
          })
          const payload = safeJsonParse<any>(await response.text(), {})
          const job = extractAnalysisJobRecord(payload)

          if (!response.ok || !job) {
            throw new Error(payload?.error || "查询分析状态失败")
          }

          const finished = handleAnalysisJobSnapshot(job)
          if (finished) return
        } catch (error: any) {
          if (cancelled || controller.signal.aborted) return
          setAnalysisJobId("")
          setIsAnalyzing(false)
          setCurrentStep("input")
          setAnalysisError(String(error?.message || "查询分析状态失败"))
          return
        }

        await sleep(1200)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (analysisPollAbortRef.current) {
        analysisPollAbortRef.current.abort()
        analysisPollAbortRef.current = null
      }
    }
  }, [analysisJobId, currentStep, settings.targetLanguage])

  const canNavigateToStep = (step: StudioGenesisStep) => {
    return (
      step === "input" ||
      (step === "analyzing" && currentStep === "analyzing") ||
      (step === "preview" && Boolean(analysisResult)) ||
      (step === "generating" &&
        (currentStep === "generating" ||
          generatedImages.some((item) => item.status === "prompting" || item.status === "generating"))) ||
      (step === "complete" &&
        generatedImages.some((item) => item.status === "done" || item.status === "error" || item.status === "cancelled"))
    )
  }

  const requestStepChange = (step: StudioGenesisStep) => {
    const canJumpToStep = canNavigateToStep(step)

    if (!canJumpToStep) return
    if (step === currentStep) return
    setCurrentStep(step)
  }

  const handleReturnToInput = () => {
    clearAnalysisState()
    setCurrentStep("input")
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

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return
    const room = Math.max(0, STUDIO_GENESIS_MAX_PRODUCT_IMAGES - productImages.length)
    if (room <= 0) {
      setUploadError(`最多上传 ${STUDIO_GENESIS_MAX_PRODUCT_IMAGES} 张商品图`)
      return
    }

    setUploadError("")
    setIsUploading(true)
    try {
      const uploaded = await uploadImages(files.slice(0, room))
      setProductImages((previous) => [...previous, ...uploaded])
    } catch (error: any) {
      setUploadError(String(error?.message || "上传失败"))
    } finally {
      setIsUploading(false)
    }
  }

  const handlePortraitFile = async (file: File) => {
    setUploadError("")
    setIsUploading(true)
    try {
      const [uploaded] = await uploadImages([file])
      setPortraitImage(uploaded || "")
    } catch (error: any) {
      setUploadError(String(error?.message || "上传失败"))
    } finally {
      setIsUploading(false)
    }
  }

  const handleReferenceFiles = async (files: File[]) => {
    if (files.length === 0) return
    const room = Math.max(0, KNOWLEDGE_STUDIO_MAX_REFERENCE_IMAGES - referenceImages.length)
    if (room <= 0) {
      setUploadError(`最多上传 ${KNOWLEDGE_STUDIO_MAX_REFERENCE_IMAGES} 张课堂参考图`)
      return
    }

    setUploadError("")
    setIsUploading(true)
    try {
      const uploaded = await uploadImages(files.slice(0, room))
      setReferenceImages((previous) => [...previous, ...uploaded])
    } catch (error: any) {
      setUploadError(String(error?.message || "上传失败"))
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveProductImage = (index: number) => {
    setProductImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }

  const handleRemoveReferenceImage = (index: number) => {
    setReferenceImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }

  const handleAnalyze = async () => {
    if (sourceImages.length === 0) {
      setAnalysisError(isKnowledgeMode ? "请先上传老师人物图" : "请先上传至少一张商品图")
      return
    }

    if (isKnowledgeMode && !portraitImage) {
      setAnalysisError("请先上传老师人物图")
      return
    }

    if (userPoints !== null && userPoints < totalGenerationCost) {
      setAnalysisError(`当前积分不足，按已选模型生成 ${generationQuantity} 张需要 ${formatPoints(totalGenerationCost)} 积分，当前仅剩 ${formatPoints(userPoints)} 积分`)
      return
    }

    setAnalysisError("")
    setGenerationError("")
    setAnalysisJobId("")
    setAnalysisStatusText("正在创建分析任务...")
    setAnalysisNotifications([])
    setIsAnalyzing(true)
    setCurrentStep("analyzing")
    let keepAnalyzingState = false

    try {
      const response = await fetch("/api/studio-genesis/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          workflowMode,
          productImages: sourceImages,
          portraitImage,
          referenceImages,
          requirements,
          imageType: assetMode,
          targetPlatform: PRODUCT_PLATFORM_CODE_MAP[platform] || "none",
          project_id: currentProjectId,
          imageCount: settings.imageCount,
          imageModelId: settings.imageModelId,
          imageSize: settings.imageSize,
          speedMode: settings.speedMode,
          targetLanguage: settings.targetLanguage,
          uiLanguage: settings.targetLanguage,
          textModelId: settings.textModelId,
        }),
      })
      const payload = safeJsonParse<any>(await response.text(), {})
      const job = extractAnalysisJobRecord(payload)

      if (response.ok && job) {
        keepAnalyzingState = job.status === "processing"
        setAnalysisJobId(job.id)
        handleAnalysisJobSnapshot(job)
        return
      }

      if (!response.ok || !payload.analysisResult) {
        throw new Error(payload.error || "分析失败")
      }

      const normalized = normalizeStudioGenesisAnalysisResult(payload.analysisResult, {
        imageCount: settings.imageCount,
        targetLanguage: settings.targetLanguage,
        workflowMode,
      })
      setAnalysisResult(normalized)
      setAnalysisSignature(buildAnalysisSignature({
        workflowMode,
        productImages,
        portraitImage,
        referenceImages,
        requirements,
        imageCount: settings.imageCount,
        targetLanguage: settings.targetLanguage,
      }))
      setGeneratedImages(buildStudioGenesisGeneratedPlaceholders(normalized.images))
      setCurrentStep("preview")
    } catch (error: any) {
      setAnalysisJobId("")
      setCurrentStep("input")
      setAnalysisError(String(error?.message || "分析失败"))
    } finally {
      if (!keepAnalyzingState) {
        setIsAnalyzing(false)
      }
    }
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const fetchStudioGenesisJobSnapshot = async (jobId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/studio-genesis/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal,

      credentials: "include"
    })
    const payload = safeJsonParse<unknown>(await response.text(), null)
    const job = extractStudioGenesisJobRecord(payload)

    if (!response.ok || !job) {
      const message =
        payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
          ? String((payload as { error?: string }).error || "").trim()
          : ""
      throw new Error(message || "查询任务状态失败")
    }

    return job
  }

  const syncStudioGenesisJobSnapshot = async (jobId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/studio-genesis/jobs/${encodeURIComponent(jobId)}/sync`, {
      method: "POST",
      cache: "no-store",
      signal,
      credentials: "include",
    })
    const payload = safeJsonParse<unknown>(await response.text(), null)
    const job = extractStudioGenesisJobRecord(payload)
    if (!response.ok || !job) {
      return null
    }
    return job
  }

  const watchStudioGenesisJobUntilFinished = async (jobId: string, signal: AbortSignal) => {
    console.log(`🔍 [watchJob] Starting watch for job: ${jobId}`)
    console.log(`🔍 [watchJob] Starting polling for ${jobId}`)
    console.log(`🔍 [watchJob] Fetching initial state for job: ${jobId}`)

    let pollCount = 0
    while (true) {
      const initialJob = await fetchStudioGenesisJobSnapshot(jobId, signal)
      const initialResultHint = initialJob.result_url ? initialJob.result_url : "no URL"
      console.log(`🔍 [watchJob] Initial state for ${jobId}: ${initialJob.status} ${initialResultHint}`)

      if (initialJob.status !== "processing") {
        console.log(`✅ [watchJob] Job ${jobId} completed via Polling: ${initialJob.status}`)
        return initialJob
      }

      pollCount += 1
      if (pollCount >= 5 && pollCount % 3 === 2) {
        const syncedJob = await syncStudioGenesisJobSnapshot(jobId, signal)
        if (syncedJob && syncedJob.status !== "processing") {
          console.log(`✅ [watchJob] Job ${jobId} completed via sync: ${syncedJob.status}`)
          return syncedJob
        }
      }

      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }
      await sleep(1200)
    }
  }

  const handleAiWrite = async () => {
    if (isKnowledgeMode) return
    if (productImages.length === 0) {
      setAiWriteError("请先上传至少一张商品图")
      return
    }

    setAiWriteError("")
    setAiWriteOptions([])
    setAiWriteSelectedIndex(0)
    setIsAiWriteDialogOpen(true)
    setIsAiWriting(true)
    aiWriteAbortRef.current?.abort()
    const controller = new AbortController()
    aiWriteAbortRef.current = controller

    try {
      const response = await fetch("/api/studio-genesis/ai-write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          productImages,
          requirements,
          project_id: currentProjectId,
          targetPlatform: PRODUCT_PLATFORM_CODE_MAP[platform] || "none",
          imageType: assetMode,
          uiLanguage: "zh",
          textModelId: settings.textModelId,
          imageModelId: settings.imageModelId,
          imageSize: settings.imageSize,
          speedMode: settings.speedMode,
        }),

        credentials: "include"
      })
      const payload = safeJsonParse<any>(await response.text(), {})
      const job = extractAiWriteJobRecord(payload)

      if (!response.ok || !job) {
        throw new Error(payload?.error || "AI帮写失败")
      }

      setAiWriteJobId(job.id)
      const finishedJob =
        job.status === "processing"
          ? await watchStudioGenesisJobUntilFinished(job.id, controller.signal)
          : job

      const aiWriteJob = extractAiWriteJobRecord(finishedJob)
      if (!aiWriteJob) {
        throw new Error("AI帮写任务返回格式异常")
      }

      if (aiWriteJob.status !== "success" || !aiWriteJob.result_data?.options?.length) {
        throw new Error(aiWriteJob.error_message || "AI帮写未返回可用方案")
      }

      setAiWriteOptions(aiWriteJob.result_data.options)
      setAiWriteSelectedIndex(0)
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        setAiWriteError(String(error?.message || "AI帮写失败"))
      }
    } finally {
      setIsAiWriting(false)
      setAiWriteJobId("")
      if (aiWriteAbortRef.current === controller) {
        aiWriteAbortRef.current = null
      }
    }
  }

  const handleConfirmAiWrite = () => {
    const selected = aiWriteOptions[aiWriteSelectedIndex]
    if (!selected?.prompt_text) return
    setRequirements(selected.prompt_text)
    setIsAiWriteDialogOpen(false)
    updateNotice("已应用 AI 帮写方案")
  }

  const handlePlanUpdate = (planId: string, key: "title" | "description" | "designContent" | "promptHint", value: string) => {
    setAnalysisResult((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        images: previous.images.map((plan) => (plan.id === planId ? { ...plan, [key]: value } : plan)),
      }
    })
    if (key === "title") {
      setGeneratedImages((previous) =>
        previous.map((item) => (item.planId === planId ? { ...item, title: value } : item))
      )
    }
  }

  const updateGeneratedImage = (planId: string, updater: (image: StudioGenesisGeneratedImage) => StudioGenesisGeneratedImage) => {
    setGeneratedImages((previous) => previous.map((image) => (image.planId === planId ? updater(image) : image)))
  }

  const syncGeneratedImageWithJob = (planId: string, job: StudioGenesisJobRecord) => {
    if (job.type !== "IMAGE_GEN") return

    updateGeneratedImage(planId, (image) => ({
      ...image,
      jobId: job.id,
      prompt:
        String(job.payload.prompt || "").trim()
        || image.prompt
        || "",
      url:
        job.status === "success"
          ? String(job.result_url || image.url || "").trim()
          : image.url,
      error:
        job.status === "failed"
          ? String(job.error_message || image.error || "生成失败").trim()
          : "",
      model:
        String((job.provider_meta as { model?: unknown } | null)?.model || image.model || "").trim()
        || image.model,
      provider:
        String((job.provider_meta as { source?: unknown } | null)?.source || image.provider || "").trim()
        || image.provider,
      status:
        job.status === "success"
          ? "done"
          : job.status === "failed"
            ? "error"
            : image.status === "done"
              ? "done"
              : "generating",
    }))
  }

  const handleGenerationStreamEvent = (event: StreamEvent) => {
    if (event.type === "image_status") {
      updateGeneratedImage(event.planId, (image) => ({
        ...image,
        jobId: event.jobId || image.jobId,
        title: event.title,
        status: "prompting",
        error: "",
      }))
      return
    }

    if (event.type === "prompt_ready") {
      updateGeneratedImage(event.planId, (image) => ({
        ...image,
        jobId: event.jobId || image.jobId,
        status: "generating",
        prompt: event.prompt,
        error: "",
      }))
      return
    }

    if (event.type === "image_done") {
      updateGeneratedImage(event.planId, (image) => ({
        ...image,
        jobId: event.jobId || image.jobId,
        title: event.title,
        status: "done",
        url: event.url,
        prompt: event.prompt,
        model: event.modelId,
        provider: event.provider,
        error: "",
      }))
      return
    }

    if (event.type === "image_error") {
      updateGeneratedImage(event.planId, (image) => ({
        ...image,
        jobId: event.jobId || image.jobId,
        title: event.title,
        status: "error",
        error: event.error,
      }))
      return
    }

    if (event.type === "batch_complete" && event.haltedByError) {
      setGenerationError(event.haltedByError)
      return
    }

    if (event.type === "batch_cancelled") {
      setGenerationError("本次批量生成已取消")
      setGeneratedImages((previous) =>
        previous.map((image) =>
          image.status === "prompting" || image.status === "generating"
            ? { ...image, status: "cancelled", error: "本次生成已取消" }
            : image
        )
      )
    }
  }

  const runGeneration = async (plans: StudioGenesisPlan[], options?: { replaceAll?: boolean }) => {
    if (!analysisResult) return
    if (analysisNeedsRefresh) {
      setGenerationError(
        isKnowledgeMode
          ? "你已经改动了老师图、课堂参考图、课程文案、语言或出图数量，请先重新分析后再生成。"
          : "你已经改动了商品图、需求、语言或出图数量，请先重新分析后再生成。"
      )
      return
    }

    const replaceAll = Boolean(options?.replaceAll)
    const targetPlanIds = new Set(plans.map((item) => item.id))

    setGenerationError("")
    setCurrentStep("generating")
    setIsGenerating(true)
    setGeneratedImages((previous) => {
      const base = replaceAll ? buildStudioGenesisGeneratedPlaceholders(analysisResult.images) : previous
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
          }
        }
        return existing || {
          id: plan.id,
          planId: plan.id,
          index,
          title: plan.title,
          status: "pending",
          url: "",
        }
      })
    })

    const controller = new AbortController()
    generationAbortRef.current = controller
    generationJobWatchersRef.current.forEach((item) => item.abort())
    generationJobWatchersRef.current.clear()

    try {
      let hasQueuedGenerationJobs = false
        const response = await fetch("/api/studio-genesis/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          workflowMode,
          productImages: sourceImages,
          portraitImage,
          referenceImages,
          requirements,
          imageType: assetMode,
          project_id: currentProjectId,
          targetLanguage: settings.targetLanguage,
          imageModelId: settings.imageModelId,
          aspectRatio: settings.aspectRatio,
          imageSize: settings.imageSize,
          speedMode: settings.speedMode,
          plans,
          analysisResult,
        }),
        signal: controller.signal,

          credentials: "include"
        })

      if (!response.ok) {
        const payload = safeJsonParse<{ error?: string }>(await response.text(), {})
        throw new Error(payload.error || "批量生成失败")
      }

      const payload = safeJsonParse<{ events?: StreamEvent[]; error?: string }>(await response.text(), {})
      if (!Array.isArray(payload.events)) {
        throw new Error(payload.error || "批量生成返回格式异常")
      }
      const watchPromises: Array<Promise<{ planId: string; jobId: string; job: StudioGenesisJobRecord }>> = []
      const watchedJobIds = new Set<string>()
      for (const event of payload.events) {
        handleGenerationStreamEvent(event)
        if (
          "jobId" in event &&
          typeof event.jobId === "string" &&
          event.jobId &&
          (event.type === "image_status" || event.type === "prompt_ready")
        ) {
          if (!watchedJobIds.has(event.jobId)) {
            watchedJobIds.add(event.jobId)
            hasQueuedGenerationJobs = true
            watchPromises.push(
              watchStudioGenesisJobUntilFinished(event.jobId, controller.signal).then((job) => {
                syncGeneratedImageWithJob(event.planId, job)
                return { planId: event.planId, jobId: event.jobId || "", job }
              })
            )
          }
        }
      }
      const settledResults = await Promise.allSettled(watchPromises)
      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }

      const rejectedResult = settledResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected" && result.reason?.name !== "AbortError"
      )
      if (rejectedResult) {
        throw rejectedResult.reason
      }

      if (
        hasQueuedGenerationJobs &&
        settledResults.length === watchPromises.length &&
        settledResults.every((result) => result.status === "fulfilled")
      ) {
        setCurrentStep("complete")
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setGeneratedImages((previous) =>
          previous.map((image) =>
            targetPlanIds.has(image.planId) && (image.status === "prompting" || image.status === "generating")
              ? { ...image, status: "cancelled", error: "本次生成已取消" }
              : image
          )
        )
      } else {
        setGenerationError(String(error?.message || "批量生成失败"))
        setGeneratedImages((previous) =>
          previous.map((image) =>
            targetPlanIds.has(image.planId) && (image.status === "prompting" || image.status === "generating")
              ? { ...image, status: "error", error: String(error?.message || "批量生成失败") }
              : image
          )
        )
      }
    } finally {
      generationAbortRef.current = null
      generationJobWatchersRef.current.forEach((item) => item.abort())
      generationJobWatchersRef.current.clear()
      setIsGenerating(false)
    }
  }

  const startFullGeneration = async () => {
    if (!analysisResult) return
    await runGeneration(analysisResult.images, { replaceAll: true })
  }

  const handleRetryImage = async (image: StudioGenesisGeneratedImage) => {
    if (!analysisResult) return
    const plan = analysisResult.images.find((item) => item.id === image.planId)
    if (!plan) return
    await runGeneration([plan], { replaceAll: false })
  }

  const handleCancelGeneration = () => {
    generationAbortRef.current?.abort()
  }

  const handleDownloadImage = async (image: StudioGenesisGeneratedImage) => {
    if (!image.url) return
    try {
      await fetchAndDownload(resolveImageDownloadUrl(image.url), buildStudioGenesisImageFilename(image.index, image.title))
    } catch (error: any) {
      setGenerationError(String(error?.message || "下载失败"))
    }
  }

  const handleDownloadAll = async () => {
    const items = generatedImages.filter((item) => item.status === "done" && item.url)
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
        zip.file(buildStudioGenesisImageFilename(image.index, image.title), blob)
      }

      const blob = await zip.generateAsync({ type: "blob" })
      const objectUrl = URL.createObjectURL(blob)
      try {
        triggerBrowserDownload(objectUrl, `studio-genesis-batch-${Date.now()}.zip`)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch (error: any) {
      setGenerationError(String(error?.message || "批量下载失败"))
    } finally {
      setIsBatchDownloading(false)
    }
  }

  const openEditDialog = (image: StudioGenesisGeneratedImage) => {
    if (!image.url || openingCanvasImageId === image.id || typeof window === "undefined") return

    setOpeningCanvasImageId(image.id)
    void (async () => {
      try {
        const pageNumber = image.index + 1
        const baseTitle = String(image.title || (isKnowledgeMode ? "知识付费海报" : "组图成图")).trim()
          || (isKnowledgeMode ? "知识付费海报" : "组图成图")
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

  const handleApplyEdit = async () => {
    if (!activeImage?.url) return
    setEditError("")
    setIsEditingImage(true)
    try {
      const response = await fetch("/api/edit-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrls: [activeImage.url],
          prompt: editingPrompt,
          model: settings.imageModelId || activeImage.model || "",
        }),

        credentials: "include"
      })
      const payload = safeJsonParse<{ url?: string; error?: string }>(await response.text(), {})
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "编辑失败")
      }

      updateGeneratedImage(activeImage.planId, (image) => ({
        ...image,
        url: payload.url || image.url,
        status: "done",
        error: "",
      }))
      setEditingImageId(null)
      updateNotice("已生成新的编辑结果")
    } catch (error: any) {
      setEditError(String(error?.message || "编辑失败"))
    } finally {
      setIsEditingImage(false)
    }
  }

  const doneImages = generatedImages.filter((item) => item.status === "done" && item.url)

  const imageModelOptions = imageModels.length > 0
    ? imageModels.map((item) => ({ value: item.runtimeId, label: item.name }))
    : [{ value: "", label: "未配置可用模型" }]

  const generationQuantity = clampStudioGenesisImageCount(settings.imageCount)
  const activeImageModel = imageModels.find((item) => item.runtimeId === settings.imageModelId)
    || imageModels.find((item) => item.isDefault)
    || imageModels[0]
    || null
  const generationUnitCost = Math.max(0, Number(activeImageModel?.cost || 0))
  const totalGenerationCost = Math.max(0, generationUnitCost * generationQuantity)
  const analyzingStatusText = resolveLatestAnalysisStatusText(analysisNotifications, analysisStatusText)
  const generatingCount = generatedImages.filter((item) => item.status === "generating").length
  const promptingCount = generatedImages.filter((item) => item.status === "prompting" || item.status === "pending").length
  const activeGenerationCount = generatingCount + promptingCount
  const hasActiveGeneration = activeGenerationCount > 0
  const displayStep: StudioGenesisStep =
    hasActiveGeneration && (currentStep === "generating" || currentStep === "complete")
      ? "generating"
      : currentStep
  const generationStatusText =
    failedCount > 0 && doneCount + failedCount < generatedImages.length
      ? `已有 ${failedCount} 张处理异常，正在继续生成剩余图片...`
      : generatingCount > 0
        ? doneCount > 0
          ? `已完成 ${doneCount}/${generatedImages.length} 张，正在继续渲染中...`
          : "正在深度解析设计特征..."
        : promptingCount > 0
          ? doneCount > 0
            ? `已完成 ${doneCount}/${generatedImages.length} 张，正在准备下一张...`
            : "正在深度解析设计特征..."
          : isKnowledgeMode
            ? "正在生成知识付费海报套图..."
            : "正在生成详情图组..."
  const resultPanelTitle =
    displayStep === "analyzing"
      ? (isKnowledgeMode ? "课程分析中..." : "分析中...")
      : displayStep === "preview"
        ? "设计规划预览"
        : displayStep === "generating"
          ? "生成中..."
        : displayStep === "complete"
          ? "生成完成"
          : "设计规划预览"
  const resultPanelSubtitle =
    displayStep === "analyzing"
      ? (isKnowledgeMode ? "正在分析老师形象、课堂参考图并生成课程海报规范" : "正在分析产品并生成设计规范")
      : displayStep === "preview"
        ? "请确认整体设计规范和图片规划"
      : displayStep === "generating"
        ? generationStatusText
        : displayStep === "complete"
          ? failedCount > 0
            ? `已完成 ${doneCount} 张，失败 ${failedCount} 张`
            : "所有图片已生成完成"
          : isKnowledgeMode
            ? "上传老师人物图、课堂参考图并填写课程文案后，点击“分析课程”开始"
            : "上传产品图并填写要求后，点击“分析产品”开始"

  const heroTitle = isKnowledgeMode ? "一键生成知识付费海报套图" : "一键生成详情图组"
  const heroSubtitle = isKnowledgeMode
    ? "上传老师人物图与课堂参考图，AI 自动规划统一色调、固定结构的课程主图、招生海报与介绍页"
    : "上传产品图，AI 智能分析产品特征，自动生成多角度、多场景的电商详情图组"
  const inputPanelLabel = isKnowledgeMode ? "知识付费海报上传与生成区域" : "图片上传与生成区域"
  const requirementsLabel = isKnowledgeMode ? "课程文案要求" : "组图要求"
  const requirementsSubtitle = isKnowledgeMode
    ? "粘贴课程介绍、导师信息、课程亮点和转化信息，系统会按固定海报结构拆解方案"
    : "描述您的产品信息和期望的图片风格"
  const requirementsPlaceholder = isKnowledgeMode
    ? "建议输入：课程名称、副标题、导师介绍、课程亮点、课程架构、适合人群、配套服务、认证方式、转化卖点等。"
    : `建议输入：产品名称、卖点、目标人群、详情图风格等\n\n例如：这是一款日式抹茶沐浴露，主打天然成分和舒缓放松功效，目标人群为25-40岁女性白领，希望详情图风格简约高级...`
  const analyzeButtonText = isKnowledgeMode ? "分析课程" : "分析产品"
  const analyzeButtonAriaLabel =
    currentStep === "preview" && analysisResult
      ? (isKnowledgeMode ? `确认生成 ${generationQuantity} 张图片` : `确认生成 ${generationQuantity} 张图片`)
      : (isKnowledgeMode ? "分析课程" : "分析产品")
  const isInputLocked = displayStep === "preview" || displayStep === "analyzing" || displayStep === "generating" || displayStep === "complete"
  const primaryButtonText =
    displayStep === "preview" && analysisResult
      ? `确认生成 ${generationQuantity} 张图片`
      : displayStep === "analyzing"
        ? "分析中..."
        : displayStep === "generating"
          ? "生成中..."
          : displayStep === "complete"
            ? "新建项目"
            : analyzeButtonText
  const primaryButtonIcon =
    displayStep === "preview" && analysisResult
      ? Wand2
      : displayStep === "analyzing" || displayStep === "generating"
        ? Loader2
        : displayStep === "complete"
          ? Plus
          : Sparkles
  const PrimaryButtonIcon = primaryButtonIcon
  const generationNoticeText = isKnowledgeMode
    ? "你已经改动了老师图、课堂参考图、课程文案、目标语言或计划图数，请先重新分析，否则生成结果仍会沿用旧方案。"
    : "你已经改动了商品图、需求、目标语言或计划图数，请先重新分析，否则生成结果仍会沿用旧方案。"
  const emptyStateText = isKnowledgeMode
    ? `上传老师人物图、课堂参考图并填写课程文案后\n点击“分析课程”开始`
    : `上传产品图并填写要求后\n点击“分析产品”开始`

  return (
    <>
      <main className={STUDIO_GENESIS_MAIN_CLASS} role="main" style={STUDIO_GENESIS_PAGE_STYLE}>
        <div className={cn(STUDIO_GENESIS_CONTAINER_CLASS, embeddedInToolbox && "toolbox-product-detail-workspace")}>
          <section className={cn("text-center py-4 sm:py-12", embeddedInToolbox && "toolbox-product-detail-hero")} aria-labelledby="hero-title">
            {!isKnowledgeMode ? (
              <div className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface border border-border shadow-sm mb-6">
                <Sparkles className="w-4 h-4 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">AI 全品类商品图</span>
              </div>
            ) : null}
            <h1 id="hero-title" className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-2 sm:mb-4">
              {isKnowledgeMode ? "一键生成知识付费海报套图" : "一键生成主图 & 详情图组"}
            </h1>
            <p className="hidden sm:block text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
              {isKnowledgeMode
                ? "上传老师人物图与课堂参考图，AI 自动规划统一色调、固定结构的课程主图、招生海报与介绍页"
                : "上传产品图，AI 智能分析产品特征，自动生成电商主图及多角度、多场景的详情图组"}
            </p>
          </section>

          {!embeddedInToolbox ? <DesktopStepRail currentStep={displayStep} items={isKnowledgeMode ? KNOWLEDGE_STEP_ITEMS : PRODUCT_STEP_ITEMS} /> : null}
          <div className={embeddedInToolbox ? "hidden" : "md:hidden"}>
            <StepRail
              currentStep={displayStep}
              onStepClick={requestStepChange}
              canStepClick={canNavigateToStep}
              items={isKnowledgeMode ? KNOWLEDGE_STEP_ITEMS : PRODUCT_STEP_ITEMS}
            />
          </div>

          {notice ? (
            <div className="mx-auto mb-4 max-w-[860px] rounded-[22px] border border-[#b8dfca] bg-[#f1fbf4] px-4 py-3 text-[13px] leading-6 text-[#21663d]">
              {notice}
            </div>
          ) : null}

          <section className={STUDIO_GENESIS_GRID_CLASS} aria-label={inputPanelLabel}>
            <div className="flex flex-col gap-5">
              {isKnowledgeMode ? (
                <>
                  <SingleImageUploadCard
                    image={portraitImage}
                    isUploading={isUploading}
                    disabled={isInputLocked}
                    title="老师人物图"
                    subtitle="上传清晰正脸人物图，锁定老师身份一致性"
                    helperText="人物图已上传，可随时替换以更新老师身份锚点"
                    emptyTitle="上传老师人物图"
                    emptySubtitle="建议上传 1 张清晰正脸半身或全身照，用于锁定老师脸部、发型、肤色和整体气质"
                    onFile={handlePortraitFile}
                    onRemove={() => setPortraitImage("")}
                  />
                  <article className="bg-surface border border-border rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                          <BookOpen className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-foreground tracking-tight">课堂参考图</h3>
                          <p className="text-xs text-muted-foreground">上传课堂空间、器物、光影或完整课程样张参考图</p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">{referenceImages.length}/{KNOWLEDGE_STUDIO_MAX_REFERENCE_IMAGES}</span>
                    </div>
                    <UploadGrid
                      images={referenceImages}
                      isUploading={isUploading}
                      disabled={isInputLocked}
                      onFiles={handleReferenceFiles}
                      onRemove={handleRemoveReferenceImage}
                      helperText="可上传整套课程样张，重点让 AI 学到统一色调、曲线背景、圆角信息块、标题层级与摄影气质"
                      imageAltPrefix="课堂参考图"
                      maxImages={KNOWLEDGE_STUDIO_MAX_REFERENCE_IMAGES}
                    />
                  </article>
                </>
              ) : (
                <article className={cn("p-5 sm:p-6 space-y-4", PICSET_CARD)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn("h-8 w-8 rounded-full flex items-center justify-center", STUDIO_GENESIS_ICON_DISC_CLASS)}>
                        <ImageIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground tracking-tight">产品图</h3>
                        <p className={cn("text-xs", STUDIO_GENESIS_MUTED_TEXT_CLASS)}>上传清晰的产品图片</p>
                      </div>
                    </div>
                    <span className={cn("text-xs font-medium", STUDIO_GENESIS_MUTED_TEXT_CLASS)}>{productImages.length}/{STUDIO_GENESIS_MAX_PRODUCT_IMAGES}</span>
                  </div>
                  <UploadGrid
                    images={productImages}
                    isUploading={isUploading}
                    disabled={isInputLocked}
                    onFiles={handleFiles}
                    onRemove={handleRemoveProductImage}
                  />
                </article>
              )}

              <article className={cn("p-5 sm:p-6 space-y-4", PICSET_CARD)}>
                {!isKnowledgeMode ? (
                  <div className="flex gap-2">
                    {PRODUCT_ASSET_MODE_OPTIONS.map((option) => {
                      const active = assetMode === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setAssetMode(option.value)}
                          className={cn(
                            "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] rounded-xl px-4 flex-1 text-xs h-8",
                            active && !isInputLocked
                              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                              : "border border-border bg-surface text-foreground hover:bg-surface-hover",
                            isInputLocked && "cursor-not-allowed opacity-60"
                          )}
                          disabled={isInputLocked}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
                {!isKnowledgeMode ? (
                  <div className="space-y-1.5">
                    <label className={cn("text-xs font-medium", STUDIO_GENESIS_MUTED_STRONG_TEXT_CLASS)}>目标平台</label>
                    <Select
                      value={platform}
                      onValueChange={(value) => setPlatform(value as (typeof PRODUCT_PLATFORM_OPTIONS)[number])}
                    >
                      <SelectTrigger disabled={isInputLocked} className={cn(STUDIO_GENESIS_FIELD_CLASS, "shadow-none")}>
                        <SelectValue>{platform}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className={STUDIO_GENESIS_SELECT_CONTENT_CLASS}>
                        {PRODUCT_PLATFORM_OPTIONS.map((option) => (
                          <SelectItem
                            key={option}
                            value={option}
                            className={cn(
                              STUDIO_GENESIS_SELECT_ITEM_CLASS,
                              option === platform && "bg-secondary"
                            )}
                          >
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <label className={cn("text-xs font-medium", STUDIO_GENESIS_MUTED_STRONG_TEXT_CLASS)}>{isKnowledgeMode ? "课程文案要求" : assetMode === "main" ? "主图要求" : "详情图要求"}</label>
                  <div className="relative">
                    <textarea
                      value={requirements}
                      onChange={(event) => setRequirements(event.target.value)}
                      disabled={isInputLocked}
                      className={cn(STUDIO_GENESIS_TEXTAREA_CLASS, "min-h-[120px] resize-vertical pb-10")}
                      placeholder={isKnowledgeMode ? requirementsPlaceholder : "建议输入：产品名称、卖点、目标人群、目标电商平台、图片风格等"}
                      aria-label={requirementsLabel}
                    />
                    <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                      {isKnowledgeMode ? (
                        <button
                          type="button"
                          onClick={() => setRequirements(KNOWLEDGE_STUDIO_DEFAULT_REQUIREMENTS)}
                          disabled={isInputLocked}
                          className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] border border-border text-foreground hover:bg-surface-hover rounded-xl px-4 text-xs h-7 gap-1 bg-white shadow-sm"
                        >
                          填入示例
                        </button>
                      ) : (
                        <button
                          className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] border border-border text-foreground hover:bg-surface-hover rounded-xl px-4 text-xs h-7 gap-1 bg-white shadow-sm disabled:opacity-100"
                          disabled={isInputLocked || isAiWriting || isUploading || productImages.length === 0}
                          onClick={() => void handleAiWrite()}
                          type="button"
                        >
                          {isAiWriting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                          {isAiWriting ? "帮写中" : "AI帮写"}
                          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-foreground/30 text-muted-foreground hover:text-foreground">
                            <CircleHelp className="w-2.5 h-2.5" />
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  {aiWriteError ? <InlineAlert>{aiWriteError}</InlineAlert> : null}
                </div>
                <div className="space-y-1.5">
                  <label className={cn("text-xs font-medium", STUDIO_GENESIS_MUTED_STRONG_TEXT_CLASS)}>目标语言</label>
                  <Select
                    value={settings.targetLanguage}
                    onValueChange={(value) => setSettings((previous) => ({ ...previous, targetLanguage: value }))}
                  >
                    <SelectTrigger disabled={isInputLocked} className={cn(STUDIO_GENESIS_FIELD_CLASS, "shadow-none")}>
                      <SelectValue>{STUDIO_GENESIS_TARGET_LANGUAGES.find((item) => item.value === settings.targetLanguage)?.label || settings.targetLanguage}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className={STUDIO_GENESIS_SELECT_CONTENT_CLASS}>
                      {STUDIO_GENESIS_TARGET_LANGUAGES.map((item) => (
                        <SelectItem
                          key={item.value}
                          value={item.value}
                          className={cn(
                            STUDIO_GENESIS_SELECT_ITEM_CLASS,
                            item.value === settings.targetLanguage && "bg-secondary"
                          )}
                        >
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <SelectField
                    label="模型"
                    value={settings.imageModelId}
                    disabled={isInputLocked}
                    onChange={(value) => setSettings((previous) => ({ ...previous, imageModelId: value }))}
                    options={imageModelOptions}
                  />
                  <SelectField
                    label="尺寸比例"
                    value={settings.aspectRatio}
                    disabled={isInputLocked}
                    onChange={(value) => setSettings((previous) => ({ ...previous, aspectRatio: value }))}
                    options={STUDIO_GENESIS_ASPECT_RATIOS.map((item) => ({ value: item.value, label: item.label }))}
                  />
                  <SelectField
                    label="清晰度"
                    value={settings.imageSize}
                    disabled={isInputLocked}
                    onChange={(value) => setSettings((previous) => ({ ...previous, imageSize: value }))}
                    options={STUDIO_GENESIS_IMAGE_SIZES.map((item) => ({ value: item.value, label: item.label }))}
                  />
                  <SelectField
                    label="生成数量"
                    value={String(settings.imageCount)}
                    disabled={isInputLocked}
                    onChange={(value) => setSettings((previous) => ({ ...previous, imageCount: clampStudioGenesisImageCount(value) }))}
                    options={isKnowledgeMode
                      ? KNOWLEDGE_STUDIO_IMAGE_COUNT_OPTIONS.map((item) => ({
                          value: String(item),
                          label: `${item} 张`,
                        }))
                      : Array.from({ length: STUDIO_GENESIS_MAX_PLAN_COUNT }, (_, index) => ({
                          value: String(index + 1),
                          label: `${index + 1} 张`,
                        }))}
                  />
                </div>
              </article>

              <div className="sticky bottom-0 z-30 -mx-1 px-1 pt-2 pb-3 bg-background/95 backdrop-blur-sm lg:static lg:mx-0 lg:px-0 lg:pt-0 lg:pb-0 lg:bg-transparent lg:backdrop-blur-none lg:z-auto">
                <div className="flex flex-col gap-3">
                  <button
                    className={cn(
                      "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] font-semibold rounded-2xl h-14 px-10 text-base w-full",
                      displayStep === "preview"
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg"
                        : displayStep === "analyzing" || displayStep === "generating"
                          ? "bg-muted text-muted-foreground shadow-none"
                          : displayStep === "complete"
                            ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg"
                            : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg"
                    )}
                    disabled={displayStep === "preview" ? false : displayStep === "complete" ? false : isAnalyzing || isUploading || sourceImages.length === 0 || (isKnowledgeMode && !portraitImage) || displayStep === "generating" || displayStep === "analyzing"}
                    aria-label={analyzeButtonAriaLabel}
                    onClick={() => {
                      if (currentStep === "preview" && analysisResult) {
                        void startFullGeneration()
                        return
                      }
                      if (currentStep === "complete") {
                        handleCreateNewProject()
                        return
                      }
                      void handleAnalyze()
                    }}
                    type="button"
                  >
                    {PrimaryButtonIcon === Loader2 ? (
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <PrimaryButtonIcon className="w-5 h-5" aria-hidden="true" />
                    )}
                    {primaryButtonText}
                  </button>
                  {analysisResult && displayStep === "preview" ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleReturnToInput()
                      }}
                      disabled={isGenerating}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] border border-border bg-surface text-foreground hover:bg-surface-hover rounded-2xl h-12 px-6 text-sm w-full"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      返回上一步
                    </button>
                  ) : null}
                  {currentStep !== "complete" ? (
                    <p className="text-center text-[10px] font-medium text-muted-foreground">预计消耗 {formatPoints(totalGenerationCost)} 积分</p>
                  ) : null}
                  {isGenerating ? (
                    <button
                      type="button"
                      onClick={handleCancelGeneration}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] border border-border bg-surface text-foreground hover:bg-surface-hover rounded-2xl h-11 px-6 text-sm w-full"
                    >
                      <X className="h-4 w-4" />
                      取消
                    </button>
                  ) : null}
                  <div className="space-y-3">
                    {uploadError ? <InlineAlert>{uploadError}</InlineAlert> : null}
                    {analysisError ? <InlineAlert>{analysisError}</InlineAlert> : null}
                    {generationError ? <InlineAlert>{generationError}</InlineAlert> : null}
                    {analysisNeedsRefresh ? <InlineAlert tone="warning">{generationNoticeText}</InlineAlert> : null}
                  </div>
                </div>
              </div>
            </div>

            <div className={cn("flex min-h-[600px] flex-col", embeddedInToolbox && "toolbox-product-detail-result-column")}>
              {embeddedInToolbox ? (
                <DesktopStepRail currentStep={displayStep} items={isKnowledgeMode ? KNOWLEDGE_STEP_ITEMS : PRODUCT_STEP_ITEMS} compact />
              ) : null}
              <article className={cn("p-5 sm:p-6 flex flex-col min-h-[600px]", PICSET_CARD)} aria-labelledby="result-title">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-8 w-8 rounded-full flex items-center justify-center", STUDIO_GENESIS_ICON_DISC_CLASS)} aria-hidden="true">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 id="result-title" className="text-sm font-semibold text-foreground tracking-tight">{displayStep === "input" && !analysisResult ? "生成结果" : resultPanelTitle}</h2>
                      <p className={cn("text-xs", STUDIO_GENESIS_MUTED_TEXT_CLASS)}>
                        {displayStep === "input" && !analysisResult
                          ? (isKnowledgeMode ? "上传老师图与参考图并点击分析开始" : "上传产品图并点击分析开始")
                          : resultPanelSubtitle}
                      </p>
                    </div>
                  </div>
                  {displayStep === "complete" && doneImages.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handleDownloadAll()}
                      disabled={isBatchDownloading}
                      className="flex h-10 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-5 text-[12px] font-semibold text-zinc-900 shadow-sm transition-all duration-200 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {isBatchDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      批量下载
                    </button>
                  ) : null}
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {displayStep === "input" && !analysisResult ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center py-12">
                        <div className="w-[88px] h-[88px] rounded-full bg-secondary mx-auto mb-4 flex items-center justify-center">
                          <Sparkles className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-line">{emptyStateText.replace(/“|”/g, "'")}</p>
                      </div>
                    </div>
                  ) : null}

                  {displayStep === "analyzing" ? (
                    <div className="flex min-h-full flex-col">
                      <div className="mb-4 space-y-2">
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="分析进度"
                          className="relative h-2 w-full overflow-hidden rounded-full bg-secondary"
                        >
                          <div className="studio-genesis-loading-bar absolute inset-y-0 w-2/5 rounded-full bg-primary" />
                        </div>
                        <p className="text-center text-xs font-medium text-muted-foreground animate-pulse">
                          {analyzingStatusText}
                        </p>
                      </div>
                      <div className="flex-1" />
                    </div>
                  ) : null}

                  {analysisResult && displayStep === "preview" ? (
                    <div className="space-y-4">
                      <DesignSpecsEditor
                        value={analysisResult.designSpecs}
                        disabled={isGenerating}
                        onChange={(value) => setAnalysisResult((previous) => (previous ? { ...previous, designSpecs: value } : previous))}
                      />
                      <PlanEditor plans={analysisResult.images} disabled={isGenerating} onUpdate={handlePlanUpdate} />
                    </div>
                  ) : null}

                  {displayStep === "generating" && generatedImages.length > 0 ? (
                    <GeneratingPreview
                      images={generatedImages}
                      aspectRatio={settings.aspectRatio}
                      statusText={generationStatusText}
                    />
                  ) : null}

                  {displayStep === "complete" && generatedImages.length > 0 ? (
                    <CompletedGallery
                        images={generatedImages}
                        aspectRatio={settings.aspectRatio}
                        isGenerating={isGenerating}
                        openingCanvasImageId={openingCanvasImageId}
                        onPreview={(image) => setPreviewImageId(image.id)}
                        onDownload={(image) => void handleDownloadImage(image)}
                        onRetry={(image) => void handleRetryImage(image)}
                        onEdit={openEditDialog}
                      />
                  ) : null}
                </div>
              </article>
            </div>
          </section>
        </div>
      </main>

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
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.12);
          border-radius: 999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.2);
        }
        .studio-genesis-loading-bar {
          animation: studioGenesisLoadingBar 1.8s ease-in-out infinite;
        }
      `}</style>

      <Dialog open={Boolean(previewImageId && previewImage)} onOpenChange={(open) => (!open ? setPreviewImageId(null) : undefined)}>
        <DialogContent className={cn("max-w-[1100px] rounded-[30px]", PICSET_DIALOG_PANEL_CLASS)}>
          <DialogDescription className="sr-only">图片预览弹框，用于查看生成结果的大图。</DialogDescription>
          <div className={cn("relative min-h-[320px] overflow-hidden rounded-[30px]", PICSET_DIALOG_CANVAS_CLASS)}>
            {previewImage?.url ? (
              <Image
                src={toImageProxyUrlWithParams(previewImage.url, { w: 1400 })}
                alt={previewImage.title}
                fill
                unoptimized
                sizes="90vw"
                className="object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAiWriteDialogOpen} onOpenChange={setIsAiWriteDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg rounded-3xl sm:max-w-2xl border border-border bg-surface shadow-sm p-0 gap-0 overflow-hidden max-h-[85vh]">
          <DialogDescription className="sr-only">
            AI 帮写方案选择弹框，支持等待生成、切换三套方案并确认使用。
          </DialogDescription>
          <div className="px-5 pt-5 sm:px-6 sm:pt-6">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <Wand2 className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">AI帮写方案选择</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  选择方案后可自由编辑，确认即可使用
                </p>
              </div>
            </div>
            <div className="border-b border-border mt-4 -mx-5 sm:-mx-6" />
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-5 sm:px-6 pt-0 pb-5 sm:pb-6">
            <div className="flex items-center gap-2 pt-3">
              <span className="text-xs text-muted-foreground shrink-0">方案选择：</span>
              {aiWriteOptions.map((_, index) => {
                const active = index === aiWriteSelectedIndex
                return (
                  <button
                    key={`ai-write-option-${index}`}
                    type="button"
                    onClick={() => setAiWriteSelectedIndex(index)}
                    className={cn(
                      "px-2.5 py-0.5 text-xs font-medium rounded-lg h-6",
                      active
                        ? "bg-zinc-900 text-white shadow-sm"
                        : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {`方案${index + 1}`}
                  </button>
                )
              })}
            </div>
            <div className="h-[10px]" />
            <div className="space-y-4">
              {isAiWriting && aiWriteOptions.length === 0 ? (
                <div className="flex min-h-[260px] items-center justify-center rounded-md border border-border/60 bg-muted/20">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <p className="text-[13px] text-muted-foreground">AI 正在生成 3 套帮写方案，请稍候...</p>
                  </div>
                </div>
              ) : (
                <textarea
                  readOnly
                  value={normalizePreviewText(aiWriteOptions[aiWriteSelectedIndex]?.prompt_text || "")}
                  className="flex min-h-[80px] w-full border px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none text-[13px] rounded-md font-mono bg-muted/40 border-border/60 focus-visible:ring-0 focus-visible:ring-offset-0"
                  style={{ minHeight: "clamp(200px, -300px + 85vh, 480px)" }}
                />
              )}
              {aiWriteError && !isAiWriting ? <InlineAlert>{aiWriteError}</InlineAlert> : null}
              <div className="pt-1 space-y-3">
                <Button
                  type="button"
                  onClick={handleConfirmAiWrite}
                  disabled={isAiWriting || !aiWriteOptions[aiWriteSelectedIndex]?.prompt_text}
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium shadow-sm h-10 px-5 py-2 w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 active:scale-[0.98] transition-all duration-200 min-h-[44px]"
                >
                  确认选择
                </Button>
                <button
                  type="button"
                  onClick={() => void handleAiWrite()}
                  disabled={isAiWriting}
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] rounded-xl h-10 px-5 py-2 w-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted min-h-[44px]"
                >
                  {isAiWriting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCcw className="w-3 h-3 mr-1" />}
                  重新帮写
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingImageId && activeImage)} onOpenChange={(open) => (!open ? setEditingImageId(null) : undefined)}>
        <DialogContent className={cn("max-w-[1100px] rounded-[30px]", PICSET_DIALOG_PANEL_CLASS)}>
          <div className="grid max-h-[85vh] gap-0 overflow-hidden lg:grid-cols-[1.05fr_0.95fr]">
            <div className={cn("relative min-h-[320px]", PICSET_DIALOG_CANVAS_CLASS)}>
              {activeImage?.url ? (
                <Image
                  src={toImageProxyUrlWithParams(activeImage.url, { w: 1200 })}
                  alt={activeImage.title}
                  fill
                  unoptimized
                  sizes="50vw"
                  className="object-contain"
                />
              ) : null}
            </div>
            <div className="flex flex-col px-7 py-7">
              <DialogHeader className="text-left">
                <DialogTitle className="text-[24px] tracking-[-0.03em] text-foreground">编辑当前成图</DialogTitle>
                <DialogDescription className="mt-2 text-[14px] leading-7 text-muted-foreground">
                  使用你们系统已有的图片编辑能力，对当前结果继续精修。这里适合做道具替换、背景优化、材质微调和氛围强化。
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 flex-1">
                <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">编辑提示</label>
                <textarea
                  value={editingPrompt}
                  onChange={(event) => setEditingPrompt(event.target.value)}
                  className={cn(PICSET_TEXTAREA_CLASS, "min-h-[260px] rounded-[24px] text-[14px] leading-7")}
                  placeholder="例如：把背景改成更高级的米白色台面，增加玻璃折射高光，让金属边缘更精致。"
                />
                {editError ? <div className="mt-4"><InlineAlert>{editError}</InlineAlert></div> : null}
              </div>
              <DialogFooter className="mt-6 flex-row gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingImageId(null)}
                  className="h-11 flex-1 rounded-full border-border bg-white text-foreground"
                >
                  关闭
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleApplyEdit()}
                  disabled={isEditingImage || !editingPrompt.trim()}
                  className="h-11 flex-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isEditingImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PencilLine className="mr-2 h-4 w-4" />}
                  应用编辑
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
