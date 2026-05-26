"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import {
  AlertCircle,
  Download,
  Eye,
  Gauge,
  Layers3,
  Loader2,
  Package,
  Palette,
  PencilLine,
  Plus,
  RefreshCcw,
  Replace,
  Rocket,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { openImageInCanvas } from "@/lib/canvas/open-image-in-canvas"
import { cn } from "@/lib/utils"
import { fetchAndDownload, resolveImageDownloadUrl } from "@/lib/url/download-url"
import { toImageProxyUrlWithParams } from "@/lib/url/image-proxy-policy"
import {
  AESTHETIC_MIRROR_ASPECT_RATIOS,
  AESTHETIC_MIRROR_IMAGE_SIZES,
  AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES,
  AESTHETIC_MIRROR_MAX_REFERENCE_IMAGES,
  AESTHETIC_MIRROR_SPEED_MODES,
  AESTHETIC_MIRROR_STORAGE_KEY,
  DEFAULT_AESTHETIC_MIRROR_SETTINGS,
  buildAestheticMirrorFilename,
  buildAestheticMirrorJobs,
  buildAestheticMirrorPlaceholders,
  clampAestheticMirrorImageCount,
  type AestheticMirrorGeneratedImage,
  type AestheticMirrorJobRecord,
  type AestheticMirrorMode,
  type AestheticMirrorModelOption,
  type AestheticMirrorModelSettingsPayload,
} from "@/lib/aesthetic-mirror"

type AestheticMirrorModeState = {
  referenceImages: string[]
  productImages: string[]
  prompt: string
  skuText: string
  settings: typeof DEFAULT_AESTHETIC_MIRROR_SETTINGS
  generatedImages: AestheticMirrorGeneratedImage[]
}

type PersistedWorkspaceState = {
  mode: AestheticMirrorMode
  workspaces: Record<AestheticMirrorMode, AestheticMirrorModeState>
}

type WorkspaceErrorState = {
  reference: string
  product: string
  generation: string
}

type StreamEvent =
  | {
      type: "batch_start"
      requestId: string
      total: number
      concurrency: number
      mode: AestheticMirrorMode
    }
  | {
      type: "image_status"
      requestId: string
      jobId: string
      serverJobId?: string
      index: number
      title: string
      status: "prompting"
    }
  | {
      type: "prompt_ready"
      requestId: string
      jobId: string
      index: number
      prompt: string
    }
  | {
      type: "image_done"
      requestId: string
      jobId: string
      index: number
      title: string
      url: string
      prompt: string
      modelId: string
      provider: string
    }
  | {
      type: "image_error"
      requestId: string
      jobId: string
      index: number
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

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function extractAestheticMirrorJobRecord(input: unknown): AestheticMirrorJobRecord | null {
  const direct = input as AestheticMirrorJobRecord | null | undefined
  if (
    direct &&
    typeof direct === "object" &&
    typeof direct.id === "string" &&
    (direct.type === "STYLE_REPLICATE" || direct.type === "SKU_REPLACE")
  ) {
    return direct
  }

  const nested = (input as { job?: AestheticMirrorJobRecord } | null | undefined)?.job
  if (
    nested &&
    typeof nested === "object" &&
    typeof nested.id === "string" &&
    (nested.type === "STYLE_REPLICATE" || nested.type === "SKU_REPLACE")
  ) {
    return nested
  }

  return null
}

function createDefaultModeState(): AestheticMirrorModeState {
  return {
    referenceImages: [],
    productImages: [],
    prompt: "",
    skuText: "",
    settings: {
      ...DEFAULT_AESTHETIC_MIRROR_SETTINGS,
    },
    generatedImages: [],
  }
}

function createDefaultPersistedState(): PersistedWorkspaceState {
  return {
    mode: "single",
    workspaces: {
      single: createDefaultModeState(),
      batch: createDefaultModeState(),
      sku: createDefaultModeState(),
    },
  }
}

function createDefaultWorkspaceErrors(): Record<AestheticMirrorMode, WorkspaceErrorState> {
  return {
    single: { reference: "", product: "", generation: "" },
    batch: { reference: "", product: "", generation: "" },
    sku: { reference: "", product: "", generation: "" },
  }
}

function normalizeGeneratedImageMode(mode: unknown): AestheticMirrorMode {
  if (mode === "batch") return "batch"
  if (mode === "sku") return "sku"
  return "single"
}

function restoreModeState(raw: Partial<AestheticMirrorModeState> | null | undefined): AestheticMirrorModeState {
  const generatedImages = Array.isArray(raw?.generatedImages)
    ? raw.generatedImages.map((item) => {
        const nextItem: AestheticMirrorGeneratedImage = {
          ...item,
          mode: normalizeGeneratedImageMode(item.mode),
          referenceIndex: Number.isFinite(Number(item.referenceIndex)) ? Math.max(0, Math.round(Number(item.referenceIndex))) : 0,
          referenceImage: String(item.referenceImage || "").trim(),
          productIndex: Number.isFinite(Number(item.productIndex)) ? Math.max(0, Math.round(Number(item.productIndex))) : 0,
          productImage: String(item.productImage || "").trim(),
          variantIndex: Number.isFinite(Number(item.variantIndex)) ? Math.max(0, Math.round(Number(item.variantIndex))) : 0,
        }
        return item.status === "prompting" || item.status === "generating"
          ? { ...nextItem, status: "cancelled" as const, error: "上次生成已中断，请重新开始。" }
          : nextItem
      })
    : []

  return {
    referenceImages: Array.isArray(raw?.referenceImages)
      ? raw.referenceImages.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 1)
      : String((raw as { referenceImage?: unknown } | null | undefined)?.referenceImage || "").trim()
        ? [String((raw as { referenceImage?: unknown }).referenceImage || "").trim()]
        : [],
    productImages: Array.isArray(raw?.productImages)
      ? raw.productImages.map((item) => String(item || "").trim()).filter(Boolean).slice(0, AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES)
      : [],
    prompt: String(raw?.prompt || ""),
    skuText: String((raw as { skuText?: unknown } | null | undefined)?.skuText || ""),
    settings: {
      ...DEFAULT_AESTHETIC_MIRROR_SETTINGS,
      ...(raw?.settings || {}),
      imageCount: clampAestheticMirrorImageCount(raw?.settings?.imageCount),
    },
    generatedImages,
  }
}

function restorePersistedState(raw: PersistedWorkspaceState | (Partial<AestheticMirrorModeState> & { mode?: AestheticMirrorMode })) {
  const mode = normalizeGeneratedImageMode(raw?.mode)

  if (raw && typeof raw === "object" && "workspaces" in raw && raw.workspaces) {
    return {
      mode,
      workspaces: {
        single: restoreModeState(raw.workspaces.single),
        batch: restoreModeState(raw.workspaces.batch),
        sku: restoreModeState(raw.workspaces.sku),
      },
    }
  }

  const legacyWorkspace = restoreModeState(raw as Partial<AestheticMirrorModeState>)
  return {
    mode,
    workspaces: {
      single: mode === "single" ? legacyWorkspace : createDefaultModeState(),
      batch: mode === "batch" ? legacyWorkspace : createDefaultModeState(),
      sku: mode === "sku" ? legacyWorkspace : createDefaultModeState(),
    },
  }
}

function InlineAlert({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[#f1c5c7] bg-[#fff2f3] px-4 py-3 text-xs leading-6 text-[#a83b43]">
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
    <div className="space-y-1.5 w-full">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          disabled={disabled}
          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ReferenceUploadCard({
  image,
  isUploading,
  error,
  disabled,
  maxCount,
  onFile,
  onRemove,
}: {
  image: string
  isUploading: boolean
  error: string
  disabled?: boolean
  maxCount: number
  onFile: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <article className="bg-surface border border-border rounded-3xl p-5 sm:p-6 shadow-sm">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-full bg-secondary flex items-center justify-center shrink-0">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-foreground">参考设计图</h3>
              <p className="text-xs text-muted-foreground mt-0.5">上传具有明确风格的参考图</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground font-medium">{image ? 1 : 0}/{maxCount}</span>
        </div>

        <div className="flex flex-wrap gap-3 items-start">
          {image ? (
            <div className="relative group w-[124px] sm:w-[132px] aspect-square overflow-hidden rounded-[18px] border border-border bg-muted/10 shrink-0">
              <Image
                src={toImageProxyUrlWithParams(image, { w: 420 })}
                alt="参考设计图"
                fill
                unoptimized
                sizes="180px"
                className="object-cover"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={onRemove}
                className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 disabled:opacity-50"
                aria-label="删除参考设计图"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-[10px] font-medium text-white">
                1
              </div>
            </div>
          ) : null}

          <label
            onClick={() => !disabled && inputRef.current?.click()}
            className={cn(
              "flex w-[124px] sm:w-[132px] aspect-square shrink-0 items-center justify-center rounded-[18px] border-2 border-dashed transition-all duration-200",
              disabled ? "cursor-not-allowed opacity-60 border-border" : "cursor-pointer border-border hover:border-primary/50 hover:bg-surface-hover"
            )}
          >
            {isUploading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <Plus className="w-7 h-7 text-muted-foreground" />}
          </label>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFile(file)
            event.currentTarget.value = ""
          }}
        />

        {error ? <InlineAlert>{error}</InlineAlert> : null}
      </div>
    </article>
  )
}

function ProductUploadCard({
  images,
  isUploading,
  error,
  disabled,
  onFiles,
  onRemove,
}: {
  images: string[]
  isUploading: boolean
  error: string
  disabled?: boolean
  onFiles: (files: File[]) => void
  onRemove: (index: number) => void
}) {
  const canAddMore = images.length < AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES

  return (
    <article className="bg-surface border border-border rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">产品素材图</h3>
            <p className="text-xs text-muted-foreground mt-0.5">上传产品图片</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {images.length}/{AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 items-start">
        {images.length > 0 ? (
          <>
            {images.map((image, index) => (
              <div key={`${image}-${index}`} className="relative group w-[124px] sm:w-[132px] aspect-square overflow-hidden rounded-[18px] border border-border bg-muted/10 shrink-0">
                <Image
                  src={toImageProxyUrlWithParams(image, { w: 420 })}
                  alt={`产品素材图 ${index + 1}`}
                  fill
                  unoptimized
                  sizes="180px"
                  className="object-cover"
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(index)}
                  className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 disabled:opacity-50"
                  aria-label={`删除第 ${index + 1} 张产品素材图`}
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-[10px] font-medium text-white">
                  {index + 1}
                </div>
              </div>
            ))}
          </>
        ) : null}

        {canAddMore ? (
          <label
            className={cn(
              "relative flex w-[124px] sm:w-[132px] aspect-square shrink-0 items-center justify-center rounded-[18px] border-2 border-dashed transition-all duration-200",
              disabled ? "cursor-not-allowed opacity-60 border-border" : "cursor-pointer border-border hover:border-primary/50 hover:bg-surface-hover"
            )}
          >
            <input
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              disabled={disabled || isUploading}
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files || [])
                if (files.length > 0) onFiles(files)
                event.currentTarget.value = ""
              }}
            />
            {isUploading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <Plus className="w-7 h-7 text-muted-foreground" />}
          </label>
        ) : null}
      </div>

      {error ? <InlineAlert>{error}</InlineAlert> : null}
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
    <div className="rounded-3xl border border-border bg-card p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground tracking-tight">生图速度</p>
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-[1px] rounded-full leading-tight">
              推荐
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {AESTHETIC_MIRROR_SPEED_MODES.find((item) => item.value === value)?.description || "快速生成，积分消耗适中"}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {AESTHETIC_MIRROR_SPEED_MODES.map((item) => {
          const active = value === item.value
          const Icon = item.value === "standard" ? Zap : item.value === "fast" ? Gauge : Rocket
          return (
            <div key={item.value} className="relative flex-1">
              {item.value === "fast" ? (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 bg-red-500 text-white text-[8px] font-bold px-2 py-[1px] rounded-full whitespace-nowrap shadow-sm">
                  限时优惠
                </span>
              ) : null}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(item.value)}
                className={cn(
                  "w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300 hover:text-zinc-800",
                  disabled ? "opacity-50 cursor-not-allowed" : ""
                )}
              >
                <Icon className="w-3 h-3" />
                {item.label}
              </button>
            </div>
          )
        })}
      </div>
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

function sortGeneratedImages(images: AestheticMirrorGeneratedImage[]) {
  return [...images].sort((left, right) => {
    if (left.referenceIndex !== right.referenceIndex) return left.referenceIndex - right.referenceIndex
    if (left.productIndex !== right.productIndex) return left.productIndex - right.productIndex
    return left.variantIndex - right.variantIndex
  })
}

function GeneratingPreview({
  images,
  aspectRatio,
  statusText,
}: {
  images: AestheticMirrorGeneratedImage[]
  aspectRatio: string
  statusText: string
}) {
  const mediaStyle = resolveAspectRatioStyle(aspectRatio)

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-4 space-y-2">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className="studio-genesis-loading-bar absolute inset-y-0 w-full bg-primary" />
        </div>
        <p className="text-center text-xs font-medium text-muted-foreground">{statusText}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {sortGeneratedImages(images).map((image) => (
          <div key={image.id} className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            <div className="relative bg-gradient-to-br from-muted/30 to-muted/50" style={mediaStyle}>
              {image.status === "done" && image.url ? (
                <Image
                  src={toImageProxyUrlWithParams(image.url, { w: 720 })}
                  alt={image.title || "生成结果"}
                  fill
                  unoptimized
                  sizes="(max-width: 768px) 50vw, 33vw"
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary/70" />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {image.status === "prompting" || image.status === "pending" ? "正在准备生成..." : "生成中..."}
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultGallery({
  images,
  aspectRatio,
  openingCanvasImageId,
  onPreview,
  onDownload,
  onRetry,
  onEdit,
  isGenerating,
}: {
  images: AestheticMirrorGeneratedImage[]
  aspectRatio: string
  openingCanvasImageId: string | null
  onPreview: (image: AestheticMirrorGeneratedImage) => void
  onDownload: (image: AestheticMirrorGeneratedImage) => void
  onRetry: (image: AestheticMirrorGeneratedImage) => void
  onEdit: (image: AestheticMirrorGeneratedImage) => void
  isGenerating: boolean
}) {
  const mediaStyle = resolveAspectRatioStyle(aspectRatio)

  return (
    <div className="grid grid-cols-2 gap-4">
      {sortGeneratedImages(images).map((image) => {
        const isDone = image.status === "done" && image.url
        const isOpeningCanvas = openingCanvasImageId === image.id
        const canRetry = image.status === "done" || image.status === "error" || image.status === "cancelled"

        return (
          <div key={image.id} className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            <div className="relative bg-zinc-50" style={mediaStyle}>
              {isDone ? (
                <div className="group relative h-full w-full overflow-hidden">
                  <Image
                    src={toImageProxyUrlWithParams(image.url, { w: 900 })}
                    alt={image.title || "图片"}
                    fill
                    unoptimized
                    sizes="(max-width: 768px) 50vw, 33vw"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <button type="button" onClick={() => onPreview(image)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-900">
                      <Eye className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => onDownload(image)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-900">
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(image)}
                      disabled={isOpeningCanvas}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-900 disabled:opacity-50"
                    >
                      {isOpeningCanvas ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRetry(image)}
                      disabled={isGenerating}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-900 disabled:opacity-50"
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  {image.status === "error" ? (
                    <AlertCircle className="h-8 w-8 text-[#b6464f]" />
                  ) : image.status === "cancelled" ? (
                    <X className="h-8 w-8 text-[#8f6c42]" />
                  ) : (
                    <Sparkles className="h-8 w-8 text-primary/60" />
                  )}
                  <p className="text-xs font-medium text-muted-foreground">
                    {image.status === "error"
                      ? image.error || "生成失败"
                      : image.status === "cancelled"
                        ? image.error || "已取消"
                        : image.status === "generating"
                          ? "生成中..."
                          : image.status === "prompting"
                            ? "正在准备生成..."
                            : "等待生成"}
                  </p>
                  {canRetry ? (
                    <button
                      type="button"
                      disabled={isGenerating}
                      onClick={() => onRetry(image)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border bg-white px-4 text-xs font-medium text-foreground disabled:opacity-50"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      重试
                    </button>
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

export default function AestheticMirrorWorkspace({
  embeddedInToolbox = false,
}: {
  embeddedInToolbox?: boolean
}) {
  const [mode, setMode] = useState<AestheticMirrorMode>("single")
  const [workspaces, setWorkspaces] = useState<Record<AestheticMirrorMode, AestheticMirrorModeState>>(() => createDefaultPersistedState().workspaces)
  const [imageModels, setImageModels] = useState<AestheticMirrorModelOption[]>([])
  const [isHydrated, setIsHydrated] = useState(false)
  const [isUploadingReference, setIsUploadingReference] = useState(false)
  const [isUploadingProducts, setIsUploadingProducts] = useState(false)
  const [workspaceErrors, setWorkspaceErrors] = useState<Record<AestheticMirrorMode, WorkspaceErrorState>>(() => createDefaultWorkspaceErrors())
  const [isGenerating, setIsGenerating] = useState(false)
  const [previewImageId, setPreviewImageId] = useState<string | null>(null)
  const [openingCanvasImageId, setOpeningCanvasImageId] = useState<string | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)

  const currentWorkspace = workspaces[mode]
  const { referenceImages, productImages, prompt, skuText, settings, generatedImages } = currentWorkspace
  const referenceImage = referenceImages[0] || ""
  const referenceError = workspaceErrors[mode].reference
  const productError = workspaceErrors[mode].product
  const generationError = workspaceErrors[mode].generation
  const previewImage = generatedImages.find((item) => item.id === previewImageId) || null
  const disabledInputs = isGenerating || isUploadingReference || isUploadingProducts

  const updateWorkspace = (targetMode: AestheticMirrorMode, updater: (workspace: AestheticMirrorModeState) => AestheticMirrorModeState) => {
    setWorkspaces((previous) => ({
      ...previous,
      [targetMode]: updater(previous[targetMode]),
    }))
  }

  const updateWorkspaceErrors = (targetMode: AestheticMirrorMode, updater: (errors: WorkspaceErrorState) => WorkspaceErrorState) => {
    setWorkspaceErrors((previous) => ({
      ...previous,
      [targetMode]: updater(previous[targetMode]),
    }))
  }

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(AESTHETIC_MIRROR_STORAGE_KEY) : null
    if (raw) {
      const restored = restorePersistedState(safeJsonParse(raw, {} as PersistedWorkspaceState))
      setMode(restored.mode)
      setWorkspaces(restored.workspaces)
    }
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return
    window.localStorage.setItem(
      AESTHETIC_MIRROR_STORAGE_KEY,
      JSON.stringify({
        mode,
        workspaces,
      } satisfies PersistedWorkspaceState)
    )
  }, [isHydrated, mode, workspaces])

  useEffect(() => {
    let cancelled = false

    const loadModels = async () => {
      try {
        const response = await fetch("/api/aesthetic-mirror/model-settings", { cache: "no-store" , credentials: "include"})
        const payload = safeJsonParse<AestheticMirrorModelSettingsPayload>(await response.text(), {
          imageModel: null,
          imageModels: [],
        })
        if (!response.ok || cancelled) return
        setImageModels(payload.imageModels || [])
        setWorkspaces((previous) => ({
          single: {
            ...previous.single,
            settings: {
              ...previous.single.settings,
              imageModelId: previous.single.settings.imageModelId || payload.imageModel?.runtimeId || "",
            },
          },
          batch: {
            ...previous.batch,
            settings: {
              ...previous.batch.settings,
              imageModelId: previous.batch.settings.imageModelId || payload.imageModel?.runtimeId || "",
            },
          },
          sku: {
            ...previous.sku,
            settings: {
              ...previous.sku.settings,
              imageModelId: previous.sku.settings.imageModelId || payload.imageModel?.runtimeId || "",
            },
          },
        }))
      } catch (error) {
        console.warn("[aesthetic-mirror] model-settings failed", error)
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setPreviewImageId(null)
    setOpeningCanvasImageId(null)
  }, [mode])

  const imageModelOptions = imageModels.length > 0
    ? imageModels.map((item) => ({ value: item.runtimeId, label: item.name }))
    : [{ value: "", label: "未配置可用模型" }]

  const totalJobs = buildAestheticMirrorJobs({
    mode,
    referenceImages,
    productImages,
    imageCount: settings.imageCount,
  }).length
  const doneCount = generatedImages.filter((item) => item.status === "done" && item.url).length
  const generatingCount = generatedImages.filter((item) => item.status === "generating").length
  const promptingCount = generatedImages.filter((item) => item.status === "prompting" || item.status === "pending").length
  const canGenerate = Boolean(referenceImage && productImages.length > 0 && settings.imageModelId)
  const actionLabel = totalJobs > 0 ? `生成 ${totalJobs} 张详情图` : "生成 1 张详情图"
  const generationStatusText =
    generatingCount > 0
      ? doneCount > 0
        ? `已完成 ${doneCount}/${generatedImages.length} 张，正在继续渲染中...`
        : "正在解析风格并开始生成..."
      : promptingCount > 0
        ? "正在准备生成任务..."
        : "正在生成详情图..."
  const pointsCost = Math.max(5, totalJobs * 5)
  const pointsOriginalCost = Math.max(8, totalJobs * 8)

  const uploadFile = async (file: File) => {
    const formData = new FormData()
    formData.append("file", file)
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,

      credentials: "include"
    })
    const payload = safeJsonParse<{ url?: string; error?: string }>(await response.text(), {})
    if (!response.ok || !payload.url) {
      throw new Error(payload.error || "上传失败")
    }
    return payload.url
  }

  const handleReferenceFile = async (file: File) => {
    const targetMode = mode
    updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, reference: "" }))
    setIsUploadingReference(true)
    try {
      const url = await uploadFile(file)
      updateWorkspace(targetMode, (previous) => ({
        ...previous,
        referenceImages: [url],
      }))
    } catch (error: any) {
      updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, reference: String(error?.message || "上传失败") }))
    } finally {
      setIsUploadingReference(false)
    }
  }

  const handleProductFiles = async (files: File[]) => {
    if (files.length === 0) return
    const targetMode = mode
    const room = Math.max(0, AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES - workspaces[targetMode].productImages.length)
    if (room <= 0) {
      updateWorkspaceErrors(targetMode, (previous) => ({
        ...previous,
        product: `最多上传 ${AESTHETIC_MIRROR_MAX_PRODUCT_IMAGES} 张产品素材图`,
      }))
      return
    }

    updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, product: "" }))
    setIsUploadingProducts(true)
    try {
      const nextFiles = files.slice(0, room)
      const uploaded: string[] = []
      for (const file of nextFiles) {
        uploaded.push(await uploadFile(file))
      }
      updateWorkspace(targetMode, (previous) => ({
        ...previous,
        productImages: [...previous.productImages, ...uploaded],
      }))
    } catch (error: any) {
      updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, product: String(error?.message || "上传失败") }))
    } finally {
      setIsUploadingProducts(false)
    }
  }

  const updateGeneratedImage = (
    targetMode: AestheticMirrorMode,
    id: string,
    updater: (image: AestheticMirrorGeneratedImage) => AestheticMirrorGeneratedImage
  ) => {
    updateWorkspace(targetMode, (previous) => ({
      ...previous,
      generatedImages: previous.generatedImages.map((image) => (image.id === id ? updater(image) : image)),
    }))
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const fetchJobSnapshot = async (jobId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/aesthetic-mirror/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal,
      credentials: "include",
    })
    const payload = safeJsonParse<unknown>(await response.text(), null)
    const job = extractAestheticMirrorJobRecord(payload)

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
    while (true) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }
      const job = await fetchJobSnapshot(jobId, signal)
      if (job.status !== "processing") {
        return job
      }
      await sleep(1200)
    }
  }

  const syncGeneratedImageWithJob = (
    targetMode: AestheticMirrorMode,
    imageId: string,
    job: AestheticMirrorJobRecord
  ) => {
    const prompt = String(job.payload.prompt || "").trim()
    const providerMeta = job.provider_meta as { model?: unknown; source?: unknown } | null
    updateGeneratedImage(targetMode, imageId, (image) => ({
      ...image,
      status: job.status === "success" ? "done" : job.status === "failed" ? "error" : "generating",
      url: job.status === "success" ? String(job.result_url || image.url || "").trim() : image.url,
      prompt: prompt || image.prompt || "",
      model: String(providerMeta?.model || image.model || "").trim(),
      provider: String(providerMeta?.source || image.provider || "").trim(),
      error: job.status === "failed" ? String(job.error_message || "生成失败").trim() : "",
    }))
  }

  const handleGenerationStreamEvent = (event: StreamEvent, targetMode: AestheticMirrorMode) => {
    if (event.type === "image_status") {
      updateGeneratedImage(targetMode, event.jobId, (image) => ({
        ...image,
        title: event.title,
        status: "prompting",
        error: "",
      }))
      return
    }

    if (event.type === "prompt_ready") {
      updateGeneratedImage(targetMode, event.jobId, (image) => ({
        ...image,
        status: "generating",
        prompt: event.prompt,
        error: "",
      }))
      return
    }

    if (event.type === "image_done") {
      updateGeneratedImage(targetMode, event.jobId, (image) => ({
        ...image,
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
      updateGeneratedImage(targetMode, event.jobId, (image) => ({
        ...image,
        title: event.title,
        status: "error",
        error: event.error,
      }))
      return
    }

    if (event.type === "batch_complete" && event.haltedByError) {
      updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, generation: event.haltedByError || "" }))
      return
    }

    if (event.type === "batch_cancelled") {
      updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, generation: "本次生成已取消" }))
      updateWorkspace(targetMode, (previous) => ({
        ...previous,
        generatedImages: previous.generatedImages.map((image) =>
          image.status === "prompting" || image.status === "generating"
            ? { ...image, status: "cancelled", error: "本次生成已取消" }
            : image
        ),
      }))
    }
  }

  const runGeneration = async () => {
    const targetMode = mode
    const targetWorkspace = workspaces[targetMode]

    if (targetWorkspace.referenceImages.length === 0) {
      updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, generation: "请先上传参考设计图" }))
      return
    }
    if (targetWorkspace.productImages.length === 0) {
      updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, generation: "请先上传至少一张产品素材图" }))
      return
    }

    const targetImages = buildAestheticMirrorPlaceholders(
      buildAestheticMirrorJobs({
        mode: targetMode,
        referenceImages: targetWorkspace.referenceImages,
        productImages: targetWorkspace.productImages,
        imageCount: targetWorkspace.settings.imageCount,
      })
    )

    updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, generation: "" }))
    setIsGenerating(true)
    updateWorkspace(targetMode, (previous) => ({ ...previous, generatedImages: targetImages }))

    const controller = new AbortController()
    generationAbortRef.current = controller

    try {
      const response = await fetch("/api/aesthetic-mirror/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: targetMode,
          referenceImage: targetWorkspace.referenceImages[0] || "",
          referenceImages: targetWorkspace.referenceImages,
          productImages: targetWorkspace.productImages,
          prompt: targetWorkspace.prompt,
          skuText: targetWorkspace.skuText,
          imageModelId: targetWorkspace.settings.imageModelId,
          aspectRatio: targetWorkspace.settings.aspectRatio,
          imageSize: targetWorkspace.settings.imageSize,
          imageCount: targetWorkspace.settings.imageCount,
          speedMode: targetWorkspace.settings.speedMode,
        }),
        signal: controller.signal,

        credentials: "include"
      })

      if (!response.ok) {
        const payload = safeJsonParse<{ error?: string }>(await response.text(), {})
        throw new Error(payload.error || "生成失败")
      }

      const payload = safeJsonParse<{ events?: StreamEvent[]; error?: string }>(await response.text(), {})
      if (!Array.isArray(payload.events)) {
        throw new Error(payload.error || "生成返回格式异常")
      }
      const watchPromises: Array<Promise<void>> = []
      for (const event of payload.events) {
        handleGenerationStreamEvent(event, targetMode)
        if (event.type === "image_status" && event.serverJobId) {
          const imageId = event.jobId
          const serverJobId = event.serverJobId
          watchPromises.push(
            pollJobUntilFinished(serverJobId, controller.signal).then((job) => {
              syncGeneratedImageWithJob(targetMode, imageId, job)
            })
          )
        }
      }
      await Promise.all(watchPromises)
    } catch (error: any) {
      if (error?.name === "AbortError") {
        updateWorkspace(targetMode, (previous) => ({
          ...previous,
          generatedImages: previous.generatedImages.map((image) =>
            image.status === "prompting" || image.status === "generating"
              ? { ...image, status: "cancelled", error: "本次生成已取消" }
              : image
          ),
        }))
      } else {
        updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, generation: String(error?.message || "生成失败") }))
        updateWorkspace(targetMode, (previous) => ({
          ...previous,
          generatedImages: previous.generatedImages.map((image) =>
            image.status === "prompting" || image.status === "generating"
              ? { ...image, status: "error", error: String(error?.message || "生成失败") }
              : image
          ),
        }))
      }
    } finally {
      generationAbortRef.current = null
      setIsGenerating(false)
    }
  }

  const handleRetryImage = async (image: AestheticMirrorGeneratedImage) => {
    const targetMode = mode
    const targetWorkspace = workspaces[targetMode]
    const jobs = buildAestheticMirrorJobs({
      mode: targetMode,
      referenceImages: targetWorkspace.referenceImages,
      productImages: targetWorkspace.productImages,
      imageCount: targetWorkspace.settings.imageCount,
    })
    const matched = jobs.find((item) => item.id === image.id)
    if (!matched) return

    updateWorkspace(targetMode, (previous) => ({
      ...previous,
      generatedImages: previous.generatedImages.map((item) =>
        item.id === image.id
          ? { ...item, status: "prompting", url: "", error: "", prompt: "", model: "", provider: "" }
          : item
      ),
    }))

    const controller = new AbortController()
    generationAbortRef.current = controller
    setIsGenerating(true)
    updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, generation: "" }))

    try {
      const response = await fetch("/api/aesthetic-mirror/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds: [image.id],
          mode: targetMode,
          referenceImage: targetWorkspace.referenceImages[0] || "",
          referenceImages: targetWorkspace.referenceImages,
          productImages: targetWorkspace.productImages,
          prompt: targetWorkspace.prompt,
          skuText: targetWorkspace.skuText,
          imageModelId: targetWorkspace.settings.imageModelId,
          aspectRatio: targetWorkspace.settings.aspectRatio,
          imageSize: targetWorkspace.settings.imageSize,
          imageCount: targetWorkspace.settings.imageCount,
          speedMode: targetWorkspace.settings.speedMode,
        }),
        signal: controller.signal,

        credentials: "include"
      })

      if (!response.ok) {
        const payload = safeJsonParse<{ error?: string }>(await response.text(), {})
        throw new Error(payload.error || "重试失败")
      }

      const payload = safeJsonParse<{ events?: StreamEvent[]; error?: string }>(await response.text(), {})
      if (!Array.isArray(payload.events)) {
        throw new Error(payload.error || "重试返回格式异常")
      }
      const watchPromises: Array<Promise<void>> = []
      for (const event of payload.events) {
        if ("jobId" in event && event.jobId !== image.id) continue
        handleGenerationStreamEvent(event, targetMode)
        if (event.type === "image_status" && event.serverJobId) {
          const imageId = event.jobId
          const serverJobId = event.serverJobId
          watchPromises.push(
            pollJobUntilFinished(serverJobId, controller.signal).then((job) => {
              syncGeneratedImageWithJob(targetMode, imageId, job)
            })
          )
        }
      }
      await Promise.all(watchPromises)
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        updateWorkspaceErrors(targetMode, (previous) => ({ ...previous, generation: String(error?.message || "重试失败") }))
      }
    } finally {
      generationAbortRef.current = null
      setIsGenerating(false)
    }
  }

  const handleDownloadImage = async (image: AestheticMirrorGeneratedImage) => {
    if (!image.url) return
    try {
      await fetchAndDownload(resolveImageDownloadUrl(image.url), buildAestheticMirrorFilename(image))
    } catch (error: any) {
      updateWorkspaceErrors(mode, (previous) => ({ ...previous, generation: String(error?.message || "下载失败") }))
    }
  }

  const openEditDialog = (image: AestheticMirrorGeneratedImage) => {
    if (!image.url || openingCanvasImageId === image.id || typeof window === "undefined") return

    setOpeningCanvasImageId(image.id)
    void (async () => {
      try {
        const pageNumber = image.variantIndex + 1
        const baseTitle = String(image.title || "风格复刻成图").trim() || "风格复刻成图"
        await openImageInCanvas({
          imageUrl: image.url,
          projectTitle: `${baseTitle} · 画布编辑`,
          layerName: `${baseTitle} 第${pageNumber}张`,
          thumbnail: image.url,
        })
      } catch (error: any) {
        updateWorkspaceErrors(mode, (previous) => ({ ...previous, generation: String(error?.message || "打开画布失败") }))
      } finally {
        setOpeningCanvasImageId((current) => (current === image.id ? null : current))
      }
    })()
  }

  return (
    <>
      <main className="px-4 sm:px-6 pb-12" role="main">
        <div className={cn("max-w-6xl mx-auto", embeddedInToolbox && "toolbox-product-detail-workspace")}>
          <section className={cn("text-center py-4 sm:py-12", embeddedInToolbox && "toolbox-product-detail-hero")} aria-labelledby="hero-title">
            <div className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface border border-border shadow-sm mb-6">
              <Sparkles className="w-4 h-4 text-primary" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">AI 驱动</span>
            </div>
            <h1 id="hero-title" className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-2 sm:mb-4">
              一键复刻爆款详情页风格
            </h1>
            <p className="hidden sm:block text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
              上传您喜欢的设计参考图和产品素材，AI 将智能融合风格与产品特性，生成专属于您的高转化详情图
            </p>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6 lg:gap-8" aria-label="图片上传与生成区域">
            <div className="flex flex-col gap-5">
              <div dir="ltr" data-orientation="horizontal" className="w-full">
                <Tabs value={mode} onValueChange={(value) => setMode(normalizeGeneratedImageMode(value))} className="w-full">
                  <TabsList className="justify-center rounded-md text-muted-foreground grid h-auto min-h-10 w-full grid-cols-3 items-stretch gap-0.5 bg-muted p-1">
                    <TabsTrigger
                      value="single"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium ring-offset-background transition-all data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 gap-1.5 data-[state=active]:bg-foreground data-[state=active]:text-background min-w-0 px-1.5 py-2 text-center lg:flex-col lg:gap-1 lg:px-1 lg:py-2 lg:text-[11px] lg:leading-tight lg:whitespace-normal"
                    >
                      <Sparkles className="w-4 h-4" />
                      单图复刻
                    </TabsTrigger>
                    <TabsTrigger
                      value="batch"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium ring-offset-background transition-all data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 gap-1.5 data-[state=active]:bg-foreground data-[state=active]:text-background min-w-0 px-1.5 py-2 text-center lg:flex-col lg:gap-1 lg:px-1 lg:py-2 lg:text-[11px] lg:leading-tight lg:whitespace-normal"
                    >
                      <Layers3 className="w-4 h-4" />
                      批量复刻
                    </TabsTrigger>
                    <TabsTrigger
                      value="sku"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-medium ring-offset-background transition-all data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 gap-1.5 data-[state=active]:bg-foreground data-[state=active]:text-background min-w-0 px-1.5 py-2 text-center lg:flex-col lg:gap-1 lg:px-1 lg:py-2 lg:text-[11px] lg:leading-tight lg:whitespace-normal"
                    >
                      <Replace className="w-4 h-4" />
                      SKU 替换
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="flex flex-col gap-5">
                <ReferenceUploadCard
                  image={referenceImage}
                  isUploading={isUploadingReference}
                  error={referenceError}
                  disabled={disabledInputs}
                  maxCount={mode === "single" ? 1 : AESTHETIC_MIRROR_MAX_REFERENCE_IMAGES}
                  onFile={(file) => void handleReferenceFile(file)}
                  onRemove={() => updateWorkspace(mode, (previous) => ({ ...previous, referenceImages: [], generatedImages: [] }))}
                />

                <ProductUploadCard
                  images={productImages}
                  isUploading={isUploadingProducts}
                  error={productError}
                  disabled={disabledInputs}
                  onFiles={(files) => void handleProductFiles(files)}
                  onRemove={(index) =>
                    updateWorkspace(mode, (previous) => ({
                      ...previous,
                      productImages: previous.productImages.filter((_, itemIndex) => itemIndex !== index),
                      generatedImages: [],
                    }))
                  }
                />
              </div>

              <article className="bg-surface border border-border rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground tracking-tight mb-1">补充提示词（可选）</h2>
                  <textarea
                    value={mode === "sku" ? skuText : prompt}
                    disabled={disabledInputs}
                    onChange={(event) =>
                      updateWorkspace(mode, (previous) => ({
                        ...previous,
                        ...(mode === "sku" ? { skuText: event.target.value } : { prompt: event.target.value }),
                      }))
                    }
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] text-sm resize-vertical"
                    placeholder={mode === "sku" ? "例如：输入需要替换到参考图中的文字，留空则保留原文不变..." : "例如：添加「限时特惠」文字，使用红色主题..."}
                    aria-label="补充提示词（可选）"
                  />
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <SelectField
                    label="模型"
                    value={settings.imageModelId}
                    disabled={disabledInputs}
                    onChange={(value) =>
                      updateWorkspace(mode, (previous) => ({
                        ...previous,
                        settings: { ...previous.settings, imageModelId: value },
                      }))
                    }
                    options={imageModelOptions}
                  />
                  <SelectField
                    label="尺寸比例"
                    value={settings.aspectRatio}
                    disabled={disabledInputs}
                    onChange={(value) =>
                      updateWorkspace(mode, (previous) => ({
                        ...previous,
                        settings: { ...previous.settings, aspectRatio: value },
                      }))
                    }
                    options={AESTHETIC_MIRROR_ASPECT_RATIOS.map((item) => ({ value: item.value, label: item.label }))}
                  />
                  <SelectField
                    label="清晰度"
                    value={settings.imageSize}
                    disabled={disabledInputs}
                    onChange={(value) =>
                      updateWorkspace(mode, (previous) => ({
                        ...previous,
                        settings: { ...previous.settings, imageSize: value },
                      }))
                    }
                    options={AESTHETIC_MIRROR_IMAGE_SIZES.map((item) => ({ value: item.value, label: item.label }))}
                  />
                  <SelectField
                    label="生成数量"
                    value={String(settings.imageCount)}
                    disabled={disabledInputs}
                    onChange={(value) =>
                      updateWorkspace(mode, (previous) => ({
                        ...previous,
                        settings: { ...previous.settings, imageCount: clampAestheticMirrorImageCount(value) },
                      }))
                    }
                    options={Array.from({ length: 8 }, (_, index) => ({
                      value: String(index + 1),
                      label: `${index + 1} 张`,
                    }))}
                  />
                </div>
              </article>

              <SpeedModePicker
                value={settings.speedMode}
                disabled={disabledInputs}
                onChange={(value) =>
                  updateWorkspace(mode, (previous) => ({
                    ...previous,
                    settings: { ...previous.settings, speedMode: value as typeof previous.settings.speedMode },
                  }))
                }
              />

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => void runGeneration()}
                  disabled={!canGenerate || disabledInputs}
                  aria-label={actionLabel}
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg font-semibold rounded-2xl h-14 px-10 text-base w-full"
                >
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" aria-hidden="true" />}
                  {isGenerating ? "生成中..." : actionLabel}
                </button>
                <p className="text-[10px] text-center font-medium text-muted-foreground">
                  消耗 {pointsCost} 积分<span className="ml-0.5">（原价：<span className="line-through">{pointsOriginalCost}</span>积分）</span>
                </p>
                {generationError ? <InlineAlert>{generationError}</InlineAlert> : null}
              </div>
            </div>

            <article className="bg-surface border border-border rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col min-h-[600px]" aria-labelledby="result-title">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center" aria-hidden="true">
                    <Sparkles className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h2 id="result-title" className="text-sm font-semibold text-foreground tracking-tight">生成结果</h2>
                  </div>
                </div>
              </div>

              {generatedImages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-secondary mx-auto mb-4 flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-line text-center">
                      上传参考图和产品素材后{"\n"}点击&apos;生成&apos;开始
                    </p>
                  </div>
                </div>
              ) : isGenerating ? (
                <GeneratingPreview images={generatedImages} aspectRatio={settings.aspectRatio} statusText={generationStatusText} />
              ) : (
                <div className="flex-1">
                  <ResultGallery
                    images={generatedImages}
                    aspectRatio={settings.aspectRatio}
                    openingCanvasImageId={openingCanvasImageId}
                    onPreview={(image) => setPreviewImageId(image.id)}
                    onDownload={(image) => void handleDownloadImage(image)}
                    onRetry={(image) => void handleRetryImage(image)}
                    onEdit={openEditDialog}
                    isGenerating={isGenerating}
                  />
                </div>
              )}
            </article>
          </section>

          <section className={cn("mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4", embeddedInToolbox && "hidden")} aria-labelledby="features-title">
            <h2 id="features-title" className="sr-only">产品特性</h2>
            <article className="bg-surface border border-border rounded-2xl p-5 hover:shadow-sm transition-shadow duration-200">
              <h3 className="text-sm font-semibold text-foreground mb-1">智能风格融合</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">AI 精准提取参考图的设计语言和视觉风格</p>
            </article>
            <article className="bg-surface border border-border rounded-2xl p-5 hover:shadow-sm transition-shadow duration-200">
              <h3 className="text-sm font-semibold text-foreground mb-1">产品特性保留</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">完整保留产品细节和卖点，突出商品优势</p>
            </article>
            <article className="bg-surface border border-border rounded-2xl p-5 hover:shadow-sm transition-shadow duration-200">
              <h3 className="text-sm font-semibold text-foreground mb-1">一键生成导出</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">快速生成高清大图，支持多种尺寸导出</p>
            </article>
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
        .studio-genesis-loading-bar {
          animation: studioGenesisLoadingBar 1.8s ease-in-out infinite;
        }
      `}</style>

      <Dialog open={Boolean(previewImageId && previewImage)} onOpenChange={(open) => (!open ? setPreviewImageId(null) : undefined)}>
        <DialogContent className="max-w-[1100px] rounded-[30px]">
          <DialogTitle className="sr-only">风格复刻结果预览</DialogTitle>
          <DialogDescription className="sr-only">查看当前生成结果的大图预览。</DialogDescription>
          <div className="relative min-h-[320px] overflow-hidden rounded-[30px] bg-black/5">
            {previewImage?.url ? (
              <Image
                src={toImageProxyUrlWithParams(previewImage.url, { w: 1400 })}
                alt={previewImage.title || "图片预览"}
                fill
                unoptimized
                sizes="90vw"
                className="object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
