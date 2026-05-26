"use client"

import Image from "next/image"
import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlertCircle,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Gauge,
  Image as ImageIcon,
  Loader2,
  PencilLine,
  Plus,
  RefreshCcw,
  Rocket,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react"
import {
  PICSET_CARD_CLASS,
  PICSET_CONTAINER_CLASS,
  PICSET_DIALOG_CANVAS_CLASS,
  PICSET_DIALOG_PANEL_CLASS,
  PICSET_FIELD_CLASS,
  PICSET_GRID_CLASS,
  PICSET_MAIN_CLASS,
  PICSET_OVERLAY_ACTION_BUTTON_CLASS,
  PICSET_SOFT_BUTTON_CLASS,
  PICSET_THUMB_SURFACE_CLASS,
  PICSET_TEXTAREA_CLASS,
  PICSET_UPLOAD_ACTIVE_SURFACE_CLASS,
  PICSET_UPLOAD_SURFACE_CLASS,
} from "@/components/picset/picset-theme"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { openImageInCanvas } from "@/lib/canvas/open-image-in-canvas"
import { cn } from "@/lib/utils"
import { fetchAndDownload, resolveImageDownloadUrl } from "@/lib/url/download-url"
import { toImageProxyUrlWithParams } from "@/lib/url/image-proxy-policy"
import {
  DEFAULT_REFINEMENT_STUDIO_SETTINGS,
  REFINEMENT_STUDIO_ASPECT_RATIOS,
  REFINEMENT_STUDIO_BACKGROUND_OPTIONS,
  REFINEMENT_STUDIO_IMAGE_SIZES,
  REFINEMENT_STUDIO_MAX_PRODUCT_IMAGES,
  REFINEMENT_STUDIO_SPEED_MODES,
  REFINEMENT_STUDIO_STORAGE_KEY,
  buildRefinementStudioFilename,
  buildRefinementStudioJobs,
  buildRefinementStudioPlaceholders,
  normalizeRefinementStudioBackgroundSetting,
  type RefinementStudioGeneratedImage,
  type RefinementStudioJobRecord,
  type RefinementStudioModelOption,
  type RefinementStudioModelSettingsPayload,
  resolveBatchConcurrencyFromSpeedMode,
} from "@/lib/refinement-studio"

type PersistedWorkspaceState = {
  productImages: string[]
  requirements: string
  settings: typeof DEFAULT_REFINEMENT_STUDIO_SETTINGS
  generatedImages: RefinementStudioGeneratedImage[]
}

function createDefaultPersistedState(): PersistedWorkspaceState {
  return {
    productImages: [],
    requirements: "",
    settings: {
      ...DEFAULT_REFINEMENT_STUDIO_SETTINGS,
    },
    generatedImages: [],
  }
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function restorePersistedState(raw: PersistedWorkspaceState): PersistedWorkspaceState {
  const generatedImages = Array.isArray(raw.generatedImages)
    ? raw.generatedImages.map((item) =>
        item.status === "prompting" || item.status === "generating"
          ? { ...item, status: "cancelled" as const, error: "上次精修已中断，请重新开始。" }
          : item
      )
    : []

  return {
    productImages: Array.isArray(raw.productImages) ? raw.productImages.map((item) => String(item || "").trim()).filter(Boolean) : [],
    requirements: String(raw.requirements || ""),
    settings: {
      ...DEFAULT_REFINEMENT_STUDIO_SETTINGS,
      ...(raw.settings || {}),
      backgroundSetting: normalizeRefinementStudioBackgroundSetting(raw.settings?.backgroundSetting),
    },
    generatedImages,
  }
}

function extractRefinementStudioJobRecord(input: unknown): RefinementStudioJobRecord | null {
  const direct = input as RefinementStudioJobRecord | null | undefined
  if (
    direct &&
    typeof direct === "object" &&
    typeof direct.id === "string" &&
    (direct.type === "ANALYSIS" || direct.type === "REFINE_IMAGE_GEN")
  ) {
    return direct
  }

  const nested = (input as { job?: RefinementStudioJobRecord } | null | undefined)?.job
  if (
    nested &&
    typeof nested === "object" &&
    typeof nested.id === "string" &&
    (nested.type === "ANALYSIS" || nested.type === "REFINE_IMAGE_GEN")
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
    <label className="space-y-1.5 w-full">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={PICSET_FIELD_CLASS}
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
    <div className={cn("space-y-3 p-5", PICSET_CARD_CLASS)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground tracking-tight">生图速度</p>
          <p className="text-xs text-muted-foreground">
            {REFINEMENT_STUDIO_SPEED_MODES.find((item) => item.value === value)?.description || "标准速度，积分消耗最低"}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {REFINEMENT_STUDIO_SPEED_MODES.map((item) => {
          const active = value === item.value
          const Icon = item.value === "standard" ? Zap : item.value === "fast" ? Gauge : Rocket
          return (
            <button
              key={item.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(item.value)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-all",
                active
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : PICSET_SOFT_BUTTON_CLASS
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
  const canAddMore = images.length < REFINEMENT_STUDIO_MAX_PRODUCT_IMAGES

  const openPicker = () => {
    if (isUploading || !canAddMore) return
    inputRef.current?.click()
  }

  const handleSelectFiles = (files: File[]) => {
    if (files.length > 0) onFiles(files)
  }

  return (
    <div className={cn("p-5", PICSET_CARD_CLASS)}>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">产品图</h3>
            <p className="text-sm text-muted-foreground">上传需要精修的产品图片</p>
          </div>
        </div>
        <span className="text-sm text-muted-foreground">{images.length}/{REFINEMENT_STUDIO_MAX_PRODUCT_IMAGES}</span>
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
          handleSelectFiles(files)
        }}
        className={cn(
          images.length === 0 ? "rounded-[28px] border-2 border-dashed transition-all duration-200" : "",
          images.length === 0 && dragActive ? PICSET_UPLOAD_ACTIVE_SURFACE_CLASS : "",
          images.length === 0 && !dragActive ? PICSET_UPLOAD_SURFACE_CLASS : ""
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          disabled={!canAddMore || isUploading}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files || [])
            handleSelectFiles(files)
            event.currentTarget.value = ""
          }}
        />
        {images.length === 0 ? (
          <button
            type="button"
            onClick={openPicker}
            disabled={isUploading || !canAddMore}
            className="flex w-full flex-col items-center justify-center px-4 py-20 text-center disabled:cursor-not-allowed"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
              {isUploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Upload className="h-5 w-5 text-foreground" />}
            </div>
            <div className="mt-5">
              <p className="text-[15px] font-semibold text-foreground">点击上传或拖拽图片到此区域</p>
              <p className="mt-2 text-sm text-muted-foreground">支持 JPG、PNG 格式，最多 50 张</p>
            </div>
          </button>
        ) : (
          <div className="max-h-[400px] overflow-y-auto overflow-x-hidden custom-scrollbar">
            <div className="grid grid-cols-4 gap-3 pt-2 pr-2 sm:grid-cols-5 md:grid-cols-6">
              {images.map((image, index) => (
                <div key={`${image}-${index}`} className="relative group">
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="absolute -top-1.5 -right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card shadow-sm opacity-0 transition-opacity hover:border-destructive hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
                    aria-label={`删除第 ${index + 1} 张产品图`}
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
                  aria-label="继续上传产品图"
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

function resolveAspectRatioStyle(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized.includes(":")) {
    return { aspectRatio: "1 / 1" as const }
  }
  return { aspectRatio: normalized.replace(":", " / ") }
}

function GeneratingPreview({
  images,
  aspectRatio,
  statusText,
}: {
  images: RefinementStudioGeneratedImage[]
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
          aria-label="精修进度"
          className="relative h-2 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div className="refinement-studio-loading-bar absolute inset-y-0 w-full flex-1 bg-primary transition-all" />
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
            const label = isDone ? "已完成" : isError ? "精修失败" : isCancelled ? "已取消" : "精修中..."

            return (
              <div
                key={image.id}
                className={cn(
                  "overflow-hidden rounded-3xl border border-border bg-card shadow-sm animate-in fade-in duration-200",
                  isProcessing ? "animate-pulse" : ""
                )}
              >
                <div className="relative bg-gradient-to-br from-muted/30 to-muted/50" style={mediaStyle}>
                  {isDone ? (
                    <Image
                      src={toImageProxyUrlWithParams(image.url, { w: 720 })}
                      alt={image.title || `精修结果 ${image.sourceIndex + 1}`}
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
  images: RefinementStudioGeneratedImage[]
  aspectRatio: string
  isGenerating: boolean
  openingCanvasImageId?: string | null
  onPreview: (image: RefinementStudioGeneratedImage) => void
  onDownload: (image: RefinementStudioGeneratedImage) => void
  onRetry: (image: RefinementStudioGeneratedImage) => void
  onEdit: (image: RefinementStudioGeneratedImage) => void
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
            ? image.error || "精修失败"
            : image.status === "cancelled"
              ? image.error || "已取消"
              : image.status === "generating"
                ? "精修中..."
                : image.status === "prompting"
                  ? "正在准备精修..."
                  : "等待精修"

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
                      className={cn(PICSET_OVERLAY_ACTION_BUTTON_CLASS, "h-9 w-9 disabled:opacity-50")}
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

export default function RefinementStudioWorkspace({
  embeddedInToolbox = false,
}: {
  embeddedInToolbox?: boolean
}) {
  const [productImages, setProductImages] = useState<string[]>([])
  const [requirements, setRequirements] = useState("")
  const [settings, setSettings] = useState(DEFAULT_REFINEMENT_STUDIO_SETTINGS)
  const [imageModels, setImageModels] = useState<RefinementStudioModelOption[]>([])
  const [generatedImages, setGeneratedImages] = useState<RefinementStudioGeneratedImage[]>([])
  const [isHydrated, setIsHydrated] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationError, setGenerationError] = useState("")
  const [notice, setNotice] = useState("")
  const [previewImageId, setPreviewImageId] = useState<string | null>(null)
  const [openingCanvasImageId, setOpeningCanvasImageId] = useState<string | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const noticeTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(REFINEMENT_STUDIO_STORAGE_KEY) : null
    if (raw) {
      const restored = restorePersistedState(safeJsonParse(raw, {} as PersistedWorkspaceState))
      setProductImages(restored.productImages)
      setRequirements(restored.requirements)
      setSettings(restored.settings)
      setGeneratedImages(restored.generatedImages)
    }
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return
    const payload: PersistedWorkspaceState = {
      productImages,
      requirements,
      settings,
      generatedImages,
    }
    window.localStorage.setItem(REFINEMENT_STUDIO_STORAGE_KEY, JSON.stringify(payload))
  }, [generatedImages, isHydrated, productImages, requirements, settings])

  useEffect(() => {
    let cancelled = false

    const loadModels = async () => {
      try {
        const response = await fetch("/api/refinement-studio/model-settings", { cache: "no-store" , credentials: "include"})
        const payload = safeJsonParse<RefinementStudioModelSettingsPayload>(await response.text(), {
          imageModel: null,
          imageModels: [],
        })
        if (!response.ok || cancelled) return
        setImageModels(payload.imageModels || [])
        setSettings((previous) => ({
          ...previous,
          imageModelId: previous.imageModelId || payload.imageModel?.runtimeId || "",
        }))
      } catch (error) {
        console.warn("[refinement-studio] model-settings failed", error)
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (previewImageId && !generatedImages.some((item) => item.id === previewImageId)) {
      setPreviewImageId(null)
    }
  }, [generatedImages, previewImageId])

  useEffect(() => {
    if (openingCanvasImageId && !generatedImages.some((item) => item.id === openingCanvasImageId)) {
      setOpeningCanvasImageId(null)
    }
  }, [generatedImages, openingCanvasImageId])

  const previewImage = previewImageId
    ? generatedImages.find((item) => item.id === previewImageId) || null
    : null

  const doneImages = generatedImages.filter((item) => item.status === "done" && item.url)
  const doneCount = doneImages.length
  const failedCount = generatedImages.filter((item) => item.status === "error" || item.status === "cancelled").length
  const generatingCount = generatedImages.filter((item) => item.status === "generating").length
  const promptingCount = generatedImages.filter((item) => item.status === "prompting" || item.status === "pending").length
  const estimatedCost = Math.max(productImages.length, 1) * 5
  const generationStatusText =
    failedCount > 0 && doneCount + failedCount < generatedImages.length
      ? `已有 ${failedCount} 张处理异常，正在继续完成其余精修结果...`
      : generatingCount > 0
        ? doneCount > 0
          ? `已完成 ${doneCount}/${generatedImages.length} 张，正在继续精修中...`
          : "正在分析产品细节并执行精修..."
        : promptingCount > 0
          ? doneCount > 0
            ? `已完成 ${doneCount}/${generatedImages.length} 张，正在准备下一张...`
            : "正在分析产品细节并执行精修..."
          : "正在批量精修图片..."
  const resultPanelTitle = "精修结果"
  const resultPanelSubtitle =
    isGenerating
      ? "正在逐张精修并回传结果"
      : doneImages.length > 0
        ? failedCount > 0
          ? `已完成 ${doneCount} 张，失败 ${failedCount} 张`
          : "所有图片已精修完成"
        : "上传产品图片后查看精修效果"

  const imageModelOptions = imageModels.length > 0
    ? imageModels.map((item) => ({ value: item.runtimeId, label: item.name }))
    : [{ value: "", label: "未配置可用模型" }]

  const updateNotice = (message: string) => {
    setNotice(message)
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current)
    }
    noticeTimeoutRef.current = window.setTimeout(() => setNotice(""), 2400)
  }

  const handleCreateNewProject = () => {
    generationAbortRef.current?.abort()
    generationAbortRef.current = null

    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current)
      noticeTimeoutRef.current = null
    }

    const defaultImageModelId = imageModels.find((item) => item.isDefault)?.runtimeId || imageModels[0]?.runtimeId || ""
    const nextState = createDefaultPersistedState()

    setProductImages(nextState.productImages)
    setRequirements(nextState.requirements)
    setSettings({
      ...nextState.settings,
      imageModelId: defaultImageModelId,
    })
    setGeneratedImages(nextState.generatedImages)
    setIsUploading(false)
    setUploadError("")
    setIsGenerating(false)
    setGenerationError("")
    setNotice("")
    setPreviewImageId(null)
    setOpeningCanvasImageId(null)

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(REFINEMENT_STUDIO_STORAGE_KEY)
    }
  }

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return
    const room = Math.max(0, REFINEMENT_STUDIO_MAX_PRODUCT_IMAGES - productImages.length)
    if (room <= 0) {
      setUploadError(`最多上传 ${REFINEMENT_STUDIO_MAX_PRODUCT_IMAGES} 张产品图`)
      return
    }

    setUploadError("")
    setIsUploading(true)
    try {
      const nextFiles = files.slice(0, room)
      const uploaded: string[] = []
      for (const file of nextFiles) {
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
      setProductImages((previous) => [...previous, ...uploaded])
    } catch (error: any) {
      setUploadError(String(error?.message || "上传失败"))
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveProductImage = (index: number) => {
    setProductImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }

  const updateGeneratedImage = (jobId: string, updater: (image: RefinementStudioGeneratedImage) => RefinementStudioGeneratedImage) => {
    setGeneratedImages((previous) => previous.map((image) => (image.id === jobId ? updater(image) : image)))
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const fetchJobSnapshot = async (jobId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/refinement-studio/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal,

      credentials: "include"
    })
    const payload = safeJsonParse<unknown>(await response.text(), null)
    const job = extractRefinementStudioJobRecord(payload)

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

  const runGeneration = async (jobIds?: string[]) => {
    if (productImages.length === 0) {
      setGenerationError("请先上传至少一张产品图")
      return
    }

    const allJobs = buildRefinementStudioJobs(productImages)
    const filteredJobs = Array.isArray(jobIds) && jobIds.length > 0
      ? allJobs.filter((job) => jobIds.includes(job.id))
      : allJobs

    if (filteredJobs.length === 0) {
      setGenerationError("缺少有效的精修任务")
      return
    }

    setGenerationError("")
    setIsGenerating(true)
    setGeneratedImages((previous) => {
      const placeholders = buildRefinementStudioPlaceholders(allJobs)
      return placeholders.map((placeholder) => {
        const existing = previous.find((item) => item.id === placeholder.id)
        if (filteredJobs.some((job) => job.id === placeholder.id)) {
          return {
            ...placeholder,
            status: "prompting" as const,
            url: "",
            prompt: "",
            error: "",
          }
        }
        return existing || placeholder
      })
    })

    const controller = new AbortController()
    generationAbortRef.current = controller
    const selectedImageModel = imageModels.find((item) => item.runtimeId === settings.imageModelId) || imageModels[0] || null
    const requestedModelValue = String(
      selectedImageModel?.modelId || selectedImageModel?.name || settings.imageModelId || ""
    ).trim()
    const speedModeForApi = settings.speedMode === "standard" ? "normal" : settings.speedMode
    const concurrency = resolveBatchConcurrencyFromSpeedMode(settings.speedMode)
    const batchId = globalThis.crypto?.randomUUID?.() || `refinement-batch-${Date.now()}`

    try {
      let nextIndex = 0
      let haltedByError = ""

      const claimNext = () => {
        if (haltedByError || controller.signal.aborted) return -1
        if (nextIndex >= filteredJobs.length) return -1
        const current = nextIndex
        nextIndex += 1
        return current
      }

      const worker = async () => {
        while (!controller.signal.aborted) {
          const currentIndex = claimNext()
          if (currentIndex < 0) return

          const job = filteredJobs[currentIndex]
          updateGeneratedImage(job.id, (image) => ({
            ...image,
            title: job.title,
            status: "prompting",
            error: "",
            prompt: "",
            url: "",
          }))

          try {
            const analysisResponse = await fetch("/api/refinement-studio/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productImage: job.sourceUrl,
                clothingMode: "refinement_analysis",
                whiteBackground: settings.backgroundSetting === "white",
                backgroundSetting: settings.backgroundSetting,
                requirements,
                imageCount: 1,
                uiLanguage: "zh-CN",
                imageModelId: settings.imageModelId,
                model: requestedModelValue,
                imageSize: settings.imageSize,
                speedMode: speedModeForApi,
                feAttempt: 1,
              }),
              signal: controller.signal,

              credentials: "include"
            })

            const analysisPayload = safeJsonParse<unknown>(await analysisResponse.text(), null)
            const analysisJob = extractRefinementStudioJobRecord(analysisPayload)
            if (!analysisResponse.ok || !analysisJob || analysisJob.type !== "ANALYSIS") {
              const message =
                analysisPayload && typeof analysisPayload === "object" && "error" in analysisPayload
                  ? String((analysisPayload as { error?: unknown }).error || "").trim()
                  : ""
              throw new Error(message || "创建分析任务失败")
            }

            const analysisSnapshot = await pollJobUntilFinished(analysisJob.id, controller.signal)
            if (analysisSnapshot.type !== "ANALYSIS") {
              throw new Error("分析任务返回类型异常")
            }

            if (analysisSnapshot.status !== "success" || !analysisSnapshot.result_data?.text) {
              throw new Error(analysisSnapshot.error_message || "产品分析失败")
            }

            const prompt = String(analysisSnapshot.result_data.text || "").trim()
            updateGeneratedImage(job.id, (image) => ({
              ...image,
              status: "generating",
              prompt,
              error: "",
            }))

            const refineResponse = await fetch("/api/refinement-studio/refine", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                aspectRatio: settings.aspectRatio,
                batchId,
                index: job.sourceIndex,
                title: job.title,
                description: "图片精修",
                imageModelId: settings.imageModelId,
                imageSize: settings.imageSize,
                jobType: "REFINE_IMAGE_GEN",
                model: requestedModelValue,
                productImage: job.sourceUrl,
                prompt,
                requirements,
                speedMode: speedModeForApi,
                turboEnabled: settings.speedMode === "turbo",
                workflowMode: "product",
                backgroundSetting: settings.backgroundSetting,
                feAttempt: 1,
              }),
              signal: controller.signal,

              credentials: "include"
            })

            const refinePayload = safeJsonParse<unknown>(await refineResponse.text(), null)
            const refineJob = extractRefinementStudioJobRecord(refinePayload)
            if (!refineResponse.ok || !refineJob || refineJob.type !== "REFINE_IMAGE_GEN") {
              const message =
                refinePayload && typeof refinePayload === "object" && "error" in refinePayload
                  ? String((refinePayload as { error?: unknown }).error || "").trim()
                  : ""
              throw new Error(message || "创建精修任务失败")
            }

            const refineSnapshot = await pollJobUntilFinished(refineJob.id, controller.signal)
            if (refineSnapshot.type !== "REFINE_IMAGE_GEN") {
              throw new Error("精修任务返回类型异常")
            }

            if (refineSnapshot.status !== "success" || !refineSnapshot.result_url) {
              throw new Error(refineSnapshot.error_message || "产品精修失败")
            }

            updateGeneratedImage(job.id, (image) => ({
              ...image,
              title: job.title,
              status: "done",
              url: refineSnapshot.result_url || "",
              prompt,
              model: refineSnapshot.payload.model,
              provider:
                typeof refineSnapshot.provider_meta?.source === "string"
                  ? String(refineSnapshot.provider_meta.source || "").trim()
                  : "",
              error: "",
            }))
          } catch (error: any) {
            if (error?.name === "AbortError") {
              return
            }

            const message = String(error?.message || "批量精修失败")
            updateGeneratedImage(job.id, (image) => ({
              ...image,
              title: job.title,
              status: "error",
              error: message,
            }))

            if (/积分不足|仅限会员/.test(message)) {
              haltedByError = message
              return
            }
          }
        }
      }

      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))

      if (haltedByError) {
        setGenerationError(haltedByError)
        setGeneratedImages((previous) =>
          previous.map((image) =>
            filteredJobs.some((job) => job.id === image.id) && (image.status === "prompting" || image.status === "generating")
              ? { ...image, status: "error", error: haltedByError }
              : image
          )
        )
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setGenerationError("本次批量精修已取消")
        setGeneratedImages((previous) =>
          previous.map((image) =>
            filteredJobs.some((job) => job.id === image.id) && (image.status === "prompting" || image.status === "generating")
              ? { ...image, status: "cancelled", error: "本次精修已取消" }
              : image
          )
        )
      } else {
        setGenerationError(String(error?.message || "批量精修失败"))
        setGeneratedImages((previous) =>
          previous.map((image) =>
            filteredJobs.some((job) => job.id === image.id) && (image.status === "prompting" || image.status === "generating")
              ? { ...image, status: "error", error: String(error?.message || "批量精修失败") }
              : image
          )
        )
      }
    } finally {
      generationAbortRef.current = null
      setIsGenerating(false)
    }
  }

  const handleRetryImage = async (image: RefinementStudioGeneratedImage) => {
    await runGeneration([image.id])
  }

  const handleDownloadImage = async (image: RefinementStudioGeneratedImage) => {
    if (!image.url) return
    try {
      await fetchAndDownload(resolveImageDownloadUrl(image.url), buildRefinementStudioFilename(image))
    } catch (error: any) {
      setGenerationError(String(error?.message || "下载失败"))
    }
  }

  const openEditDialog = (image: RefinementStudioGeneratedImage) => {
    if (!image.url || openingCanvasImageId === image.id || typeof window === "undefined") return

    setOpeningCanvasImageId(image.id)
    void (async () => {
      try {
        const pageNumber = image.sourceIndex + 1
        const baseTitle = String(image.title || "图片精修结果").trim() || "图片精修结果"
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

  const handleCancelGeneration = () => {
    generationAbortRef.current?.abort()
  }

  const handleRetryAll = async () => {
    await runGeneration()
  }

  return (
    <>
      <main className={PICSET_MAIN_CLASS} role="main">
        <div className={cn(PICSET_CONTAINER_CLASS, embeddedInToolbox && "toolbox-product-detail-workspace")}>
            <section className={cn("py-8 text-center sm:py-12", embeddedInToolbox && "toolbox-product-detail-hero")} aria-labelledby="hero-title">
              <h1 id="hero-title" className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-4">
                一键智能产品精修
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
                上传产品图片，AI 自动分析并优化画质、去除瑕疵、增强细节，让您的产品图更专业
              </p>
            </section>

            <section className={PICSET_GRID_CLASS}>
              <div className="flex flex-col gap-5">
                <ProductUploadCard
                  images={productImages}
                  isUploading={isUploading}
                  error={uploadError}
                  onFiles={handleFiles}
                  onRemove={handleRemoveProductImage}
                />

                <div className={cn("p-5", PICSET_CARD_CLASS)}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-foreground" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground tracking-tight">精修要求</h3>
                      <p className="text-sm text-muted-foreground">描述您对图片精修的特殊需求（可选）</p>
                    </div>
                  </div>
                  <div className="mb-4">
                    <textarea
                      value={requirements}
                      onChange={(event) => setRequirements(event.target.value)}
                      disabled={isGenerating}
                      className={cn(PICSET_TEXTAREA_CLASS, "min-h-[164px] leading-7")}
                      placeholder="例如：去除背景杂物、增强产品光泽、修复划痕、提升整体清晰度..."
                      aria-label="精修需求"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <SelectField
                      label="模型"
                      value={settings.imageModelId}
                      onChange={(value) => setSettings((previous) => ({ ...previous, imageModelId: value }))}
                      options={imageModelOptions}
                      disabled={isGenerating}
                    />
                    <SelectField
                      label="背景设置"
                      value={settings.backgroundSetting}
                      onChange={(value) => setSettings((previous) => ({ ...previous, backgroundSetting: normalizeRefinementStudioBackgroundSetting(value) }))}
                      options={REFINEMENT_STUDIO_BACKGROUND_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                      disabled={isGenerating}
                    />
                    <SelectField
                      label="尺寸比例"
                      value={settings.aspectRatio}
                      onChange={(value) => setSettings((previous) => ({ ...previous, aspectRatio: value }))}
                      options={REFINEMENT_STUDIO_ASPECT_RATIOS.map((item) => ({ value: item.value, label: item.label }))}
                      disabled={isGenerating}
                    />
                    <SelectField
                      label="清晰度"
                      value={settings.imageSize}
                      onChange={(value) => setSettings((previous) => ({ ...previous, imageSize: value }))}
                      options={REFINEMENT_STUDIO_IMAGE_SIZES.map((item) => ({ value: item.value, label: item.label }))}
                      disabled={isGenerating}
                    />
                  </div>
                </div>

                <SpeedModePicker
                  value={settings.speedMode}
                  onChange={(value) => setSettings((previous) => ({ ...previous, speedMode: value as typeof previous.speedMode }))}
                  disabled={isGenerating}
                />

                <button
                  type="button"
                  disabled={isGenerating || isUploading || productImages.length === 0}
                  onClick={() => void runGeneration()}
                  className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-primary px-10 text-base font-semibold text-primary-foreground shadow-[0_10px_25px_rgba(15,23,42,0.12)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_14px_34px_rgba(15,23,42,0.16)] disabled:pointer-events-none disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                  {isGenerating ? "精修中..." : "开始一键精修"}
                </button>

                {isGenerating ? (
                  <button
                    type="button"
                    onClick={handleCancelGeneration}
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted/70"
                  >
                    取消当前批量精修
                  </button>
                ) : null}

                {generationError ? <InlineAlert>{generationError}</InlineAlert> : null}
                {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
                {productImages.length > 0 && !isGenerating && doneImages.length === 0 ? (
                  <InlineAlert tone="warning">预计本次将处理 {productImages.length} 张图片，预计消耗约 {estimatedCost} 积分。</InlineAlert>
                ) : null}
              </div>

              <article className={cn("flex min-h-[600px] flex-col p-5", PICSET_CARD_CLASS)} aria-labelledby="result-title">
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent" aria-hidden="true">
                      <Sparkles className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h2 id="result-title" className="text-sm font-semibold tracking-tight text-foreground">{resultPanelTitle}</h2>
                      <p className="text-sm text-muted-foreground">{resultPanelSubtitle}</p>
                    </div>
                  </div>
                </div>

                <div className="custom-scrollbar flex flex-1 flex-col overflow-y-auto">
                  {generatedImages.length > 0 ? (
                    isGenerating ? (
                      <GeneratingPreview
                        images={generatedImages}
                        aspectRatio={settings.aspectRatio}
                        statusText={generationStatusText}
                      />
                    ) : (
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
                    )
                  ) : (
                    <div className="flex flex-1 items-center justify-center py-12 text-center">
                      <p className="text-sm text-muted-foreground">上传产品图片后查看精修效果</p>
                    </div>
                  )}
                </div>

                {generatedImages.length > 0 && !isGenerating ? (
                  <div className="mt-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRetryAll()}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 py-2 text-sm font-medium text-foreground transition-all duration-200 hover:bg-surface-hover"
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        全部重新精修
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateNewProject}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 py-2 text-sm font-medium text-foreground transition-all duration-200 hover:bg-muted/70"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        新建项目
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            </section>
        </div>
      </main>

      <Dialog open={Boolean(previewImageId && previewImage)} onOpenChange={(open) => (!open ? setPreviewImageId(null) : undefined)}>
        <DialogContent className={cn("max-w-[1100px] rounded-[30px]", PICSET_DIALOG_PANEL_CLASS)}>
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

      <style jsx global>{`
        @keyframes refinementStudioLoadingBar {
          0% {
            transform: translateX(-60%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        .refinement-studio-loading-bar {
          animation: refinementStudioLoadingBar 1.4s ease-in-out infinite;
        }
      `}</style>
    </>
  )
}
