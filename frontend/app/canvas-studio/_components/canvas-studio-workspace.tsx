"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Crop,
  Download,
  Eraser,
  Hand,
  ImagePlus,
  Layers,
  Loader2,
  MousePointer2,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchAndDownload } from "@/lib/url/download-url"

type LayerKind = "image" | "text"

type CanvasLayer = {
  id: string
  kind: LayerKind
  name: string
  x: number
  y: number
  width: number
  height: number
  src?: string
  text?: string
  fontSize?: number
  color?: string
  placeholder?: boolean
  loadingLabel?: string
}

type DragState = {
  id: string
  startX: number
  startY: number
  originX: number
  originY: number
}

type ResizeCorner = "nw" | "ne" | "sw" | "se"

type ResizeState = {
  id: string
  corner: ResizeCorner
  startX: number
  startY: number
  originX: number
  originY: number
  originWidth: number
  originHeight: number
}

type PanState = {
  startX: number
  startY: number
  originX: number
  originY: number
}

type TouchPinchState = {
  distance: number
  zoom: number
  midpointX: number
  midpointY: number
  panX: number
  panY: number
}

type CanvasTool = "select" | "hand"
type OcrBlock = {
  text: string
  box: number[]
}
type SmartLayerResult = {
  success?: boolean
  error?: string
  jobId?: string
  status?: "queued" | "running" | "succeeded" | "failed"
  result?: SmartLayerResult | null
  manifest?: {
    layers?: unknown[]
  }
  files?: {
    psd?: string
    preview?: string
    editablePackage?: string
    jsx?: string
    manifest?: string
    layersZip?: string
    notes?: string
  }
  psd?: {
    ok?: boolean
    stderr?: string
  }
}
type ContextMenuMode = "canvas" | "layer"
type ContextMenuState = {
  x: number
  y: number
  mode: ContextMenuMode
  targetLayerId?: string | null
} | null

const STORAGE_KEY = "picset:canvas-studio:free-canvas"
const SELECTION_COLOR = "#147DFF"
const UI_STAGE_BOUNDS = { left: -6000, top: -6000, width: 12000, height: 12000 }
const bottomToolButtonClass =
  "flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
const activeBottomToolButtonClass = "flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 text-white"

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function buildLongRunningApiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const configuredBackendUrl = String(process.env.NEXT_PUBLIC_BACKEND_URL || "").trim().replace(/\/$/, "")
  if (configuredBackendUrl) return `${configuredBackendUrl}${normalizedPath}`
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return `http://localhost:3001${normalizedPath}`
  }
  return normalizedPath
}

function normalizeLayers(input: unknown): CanvasLayer[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item): CanvasLayer | null => {
      if (!item || typeof item !== "object") return null
      const raw = item as Partial<CanvasLayer>
      const kind = raw.kind === "text" ? "text" : "image"
      return {
        id: String(raw.id || createId(kind)),
        kind,
        name: String(raw.name || (kind === "text" ? "文字" : "图片")),
        x: readNumber(raw.x, 0),
        y: readNumber(raw.y, 0),
        width: Math.max(40, readNumber(raw.width, 360)),
        height: Math.max(40, readNumber(raw.height, 280)),
        src: String(raw.src || ""),
        text: String(raw.text || "输入文字"),
        fontSize: Math.max(10, readNumber(raw.fontSize, 56)),
        color: String(raw.color || "#18181b"),
        placeholder: Boolean(raw.placeholder),
        loadingLabel: String(raw.loadingLabel || ""),
      }
    })
    .filter(Boolean) as CanvasLayer[]
}

function buildSeedLayer(seed: any): CanvasLayer {
  const sourceWidth = Math.max(1, readNumber(seed?.width, 960))
  const sourceHeight = Math.max(1, readNumber(seed?.height, 1280))
  const scale = Math.min(520 / sourceWidth, 520 / sourceHeight, 1)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  return {
    id: createId("image"),
    kind: "image",
    name: String(seed?.layerName || "图片"),
    x: -Math.round(width / 2),
    y: -Math.round(height / 2),
    width,
    height,
    src: String(seed?.imageUrl || ""),
  }
}

function exportStage(layers: CanvasLayer[]) {
  if (layers.length === 0) throw new Error("画布里还没有可导出的内容")
  const bounds = getStageBounds(layers)
  const serialized = buildExportSvg(layers, bounds)
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const image = document.createElement("img")
  return new Promise<string>((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = bounds.width
      canvas.height = bounds.height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error("当前浏览器不支持导出"))
        return
      }
      ctx.fillStyle = "#fafafa"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL("image/png"))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("导出失败，请检查跨域图片"))
    }
    image.src = url
  })
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (match) => {
    if (match === "<") return "&lt;"
    if (match === ">") return "&gt;"
    if (match === "&") return "&amp;"
    if (match === '"') return "&quot;"
    return "&#39;"
  })
}

function buildExportSvg(layers: CanvasLayer[], bounds: ReturnType<typeof getStageBounds>) {
  const content = layers
    .filter((layer) => !layer.placeholder)
    .map((layer) => {
      if (layer.kind === "image" && layer.src) {
        return `<image href="${escapeXml(layer.src)}" x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="xMidYMid slice" />`
      }
      const x = layer.x + layer.width / 2
      const y = layer.y + layer.height / 2
      return `<text x="${x}" y="${y}" fill="${escapeXml(layer.color || "#18181b")}" font-size="${layer.fontSize || 56}" font-weight="800" text-anchor="middle" dominant-baseline="middle">${escapeXml(layer.text || "")}</text>`
    })
    .join("")

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}"><rect x="${bounds.left}" y="${bounds.top}" width="${bounds.width}" height="${bounds.height}" fill="#fafafa" />${content}</svg>`
}

function ContextMenuItem({
  icon,
  label,
  shortcut,
  danger,
  disabled,
  onClick,
}: {
  icon?: ReactNode
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm font-medium transition-colors",
        disabled && "cursor-not-allowed text-zinc-400",
        !disabled && !danger && "text-zinc-800 hover:bg-zinc-50",
        !disabled && danger && "text-red-600 hover:bg-red-50"
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-500">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <span className="text-xs font-normal text-zinc-400">{shortcut}</span> : null}
    </button>
  )
}

function getStageBounds(layers: CanvasLayer[]) {
  if (layers.length === 0) {
    return { left: -800, top: -500, right: 800, bottom: 500, width: 1600, height: 1000 }
  }

  const left = Math.min(...layers.map((layer) => layer.x))
  const top = Math.min(...layers.map((layer) => layer.y))
  const right = Math.max(...layers.map((layer) => layer.x + layer.width))
  const bottom = Math.max(...layers.map((layer) => layer.y + layer.height))
  const padding = 240
  return {
    left: left - padding,
    top: top - padding,
    right: right + padding,
    bottom: bottom + padding,
    width: Math.max(1600, right - left + padding * 2),
    height: Math.max(1000, bottom - top + padding * 2),
  }
}

export default function CanvasStudioWorkspace() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [layers, setLayers] = useState<CanvasLayer[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)
  const [panState, setPanState] = useState<PanState | null>(null)
  const [pinchState, setPinchState] = useState<TouchPinchState | null>(null)
  const [activeTool, setActiveTool] = useState<CanvasTool>("select")
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [textEditLayerId, setTextEditLayerId] = useState("")
  const [isDetectingText, setIsDetectingText] = useState(false)
  const [isApplyingTextEdit, setIsApplyingTextEdit] = useState(false)
  const [isSmartLayering, setIsSmartLayering] = useState(false)
  const [textBlocks, setTextBlocks] = useState<OcrBlock[]>([])
  const [editedTexts, setEditedTexts] = useState<Record<number, string>>({})
  const [noTextFound, setNoTextFound] = useState(false)
  const [notice, setNotice] = useState("")

  const hasContent = layers.length > 0
  const selectedLayer = layers.find((layer) => layer.id === selectedId) || null
  const textEditLayer = layers.find((layer) => layer.id === textEditLayerId) || null

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const seedKey = params.get("seed")
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        setLayers(normalizeLayers(JSON.parse(saved)?.layers))
      } catch {
        // Ignore invalid cached canvas.
      }
    }

    if (seedKey) {
      const rawSeed = window.localStorage.getItem(`picset:canvas-seed:${seedKey}`)
      if (rawSeed) {
        try {
          const layer = buildSeedLayer(JSON.parse(rawSeed))
          setLayers([layer])
          setSelectedId(layer.id)
          window.localStorage.removeItem(`picset:canvas-seed:${seedKey}`)
        } catch {
          // Ignore malformed seed.
        }
      }
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ layers }))
  }, [layers])

  const updateLayer = (id: string, updater: (layer: CanvasLayer) => CanvasLayer) => {
    setLayers((previous) => previous.map((layer) => (layer.id === id ? updater(layer) : layer)))
  }

  const closeContextMenu = () => setContextMenu(null)

  const duplicateLayer = (id: string) => {
    setLayers((previous) => {
      const source = previous.find((layer) => layer.id === id)
      if (!source) return previous
      const duplicate: CanvasLayer = {
        ...source,
        id: createId(source.kind),
        name: `${source.name} 副本`,
        x: source.x + 32,
        y: source.y + 32,
      }
      setSelectedId(duplicate.id)
      return [...previous, duplicate]
    })
  }

  const deleteLayer = (id: string) => {
    setLayers((previous) => previous.filter((layer) => layer.id !== id))
    if (selectedId === id) setSelectedId("")
    if (textEditLayerId === id) closeTextEditPanel()
  }

  const moveLayer = (id: string, direction: "up" | "down" | "front" | "back") => {
    setLayers((previous) => {
      const index = previous.findIndex((layer) => layer.id === id)
      if (index < 0) return previous
      const next = [...previous]
      const [layer] = next.splice(index, 1)
      if (!layer) return previous
      if (direction === "front") next.push(layer)
      if (direction === "back") next.unshift(layer)
      if (direction === "up") next.splice(Math.min(next.length, index + 1), 0, layer)
      if (direction === "down") next.splice(Math.max(0, index - 1), 0, layer)
      return next
    })
  }

  const fitAllLayers = () => {
    if (layers.length === 0) {
      setPan({ x: 0, y: 0 })
      setZoom(1)
      return
    }
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const bounds = getStageBounds(layers)
    const nextZoom = clamp(Math.min((rect.width - 160) / bounds.width, (rect.height - 160) / bounds.height), 0.1, 5)
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    setZoom(nextZoom)
    setPan({
      x: Math.round(-centerX * nextZoom),
      y: Math.round(-centerY * nextZoom),
    })
  }

  const closeTextEditPanel = () => {
    setTextEditLayerId("")
    setTextBlocks([])
    setEditedTexts({})
    setNoTextFound(false)
    setIsDetectingText(false)
    setIsApplyingTextEdit(false)
  }

  const createLayerImageDataUrl = (layer: CanvasLayer) => {
    if (layer.kind === "image" && layer.src) return Promise.resolve(layer.src)
    return new Promise<string>((resolve) => {
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(layer.width))
      canvas.height = Math.max(1, Math.round(layer.height))
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve("")
        return
      }
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = layer.color || "#18181b"
      ctx.font = `800 ${Math.max(10, layer.fontSize || 56)}px sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(layer.text || "", canvas.width / 2, canvas.height / 2, canvas.width - 24)
      resolve(canvas.toDataURL("image/png"))
    })
  }

  const beginTextEdit = async (layer: CanvasLayer) => {
    if (layer.kind !== "image" || !layer.src || layer.placeholder) return
    closeContextMenu()
    setSelectedId(layer.id)
    setTextEditLayerId(layer.id)
    setTextBlocks([])
    setEditedTexts({})
    setNoTextFound(false)
    setIsDetectingText(true)
    try {
      const imageUrl = await createLayerImageDataUrl(layer)
      const response = await fetch(buildLongRunningApiUrl("/api/ocr"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || "文字识别失败")
      }
      const blocks = Array.isArray(data?.blocks)
        ? data.blocks
            .map((item: any) => ({
              text: String(item?.text || "").trim(),
              box: Array.isArray(item?.box) ? item.box.map((value: unknown) => Number(value)).slice(0, 4) : [0, 0, 1000, 1000],
            }))
            .filter((item: OcrBlock) => item.text)
        : []
      setTextBlocks(blocks)
      const initialTexts: Record<number, string> = {}
      blocks.forEach((block: OcrBlock, index: number) => {
        initialTexts[index] = block.text
      })
      setEditedTexts(initialTexts)
      if (blocks.length === 0) {
        setNoTextFound(true)
        setTimeout(() => setNoTextFound(false), 1800)
      }
    } catch (error: any) {
      setNotice(error?.message || "文字识别失败")
      setNoTextFound(true)
      setTimeout(() => setNoTextFound(false), 1800)
    } finally {
      setIsDetectingText(false)
    }
  }

  const removeTextBlock = (removeIndex: number) => {
    setTextBlocks((previous) => previous.filter((_, index) => index !== removeIndex))
    setEditedTexts((previous) => {
      const next: Record<number, string> = {}
      Object.keys(previous)
        .map((key) => Number(key))
        .sort((a, b) => a - b)
        .forEach((key) => {
          if (key === removeIndex) return
          next[key > removeIndex ? key - 1 : key] = previous[key]
        })
      return next
    })
  }

  const generateBatchTextMask = (layer: CanvasLayer, changes: Array<{ block: OcrBlock }>) => {
    if (!changes.length || !layer.width || !layer.height) return ""
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(layer.width))
    canvas.height = Math.max(1, Math.round(layer.height))
    const ctx = canvas.getContext("2d")
    if (!ctx) return ""
    ctx.fillStyle = "black"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "white"
    changes.forEach(({ block }) => {
      const [yMin, xMin, yMax, xMax] = Array.isArray(block.box) && block.box.length === 4 ? block.box : [0, 0, 1000, 1000]
      const x = (Number(xMin) / 1000) * canvas.width
      const y = (Number(yMin) / 1000) * canvas.height
      const width = ((Number(xMax) - Number(xMin)) / 1000) * canvas.width
      const height = ((Number(yMax) - Number(yMin)) / 1000) * canvas.height
      const padding = 6
      ctx.fillRect(x - padding, y - padding, width + padding * 2, height + padding * 2)
    })
    return canvas.toDataURL("image/png")
  }

  const applyTextEdit = async () => {
    const layer = textEditLayer
    if (!layer || layer.kind !== "image" || !layer.src) return
    const changes = textBlocks
      .map((block, index) => ({
        block,
        originalText: block.text,
        newText: String(editedTexts[index] ?? block.text).trim(),
      }))
      .filter((item) => item.newText && item.newText !== item.originalText)
    if (changes.length === 0) {
      closeTextEditPanel()
      return
    }

    const placeholderId = createId("text-edit")
    const gap = 40
    const placeholder: CanvasLayer = {
      ...layer,
      id: placeholderId,
      name: "文字修改生成中",
      x: layer.x + layer.width + gap,
      y: layer.y,
      src: "",
      placeholder: true,
      loadingLabel: "修改文字中...",
    }
    setLayers((previous) => [...previous, placeholder])
    setSelectedId(placeholderId)
    closeTextEditPanel()

    try {
      const imageUrl = await createLayerImageDataUrl(layer)
      const maskImage = generateBatchTextMask(layer, changes)
      const response = await fetch(buildLongRunningApiUrl("/api/edit-text"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          maskImage,
          changes: changes.map((item) => ({ originalText: item.originalText, newText: item.newText })),
          naturalWidth: layer.width,
          naturalHeight: layer.height,
          aspectRatio: "auto",
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false || !data?.url) {
        throw new Error(data?.error || "文字修改失败")
      }
      updateLayer(placeholderId, (current) => ({
        ...current,
        name: "文字修改结果",
        src: String(data.url),
        placeholder: false,
        loadingLabel: "",
      }))
      closeTextEditPanel()
    } catch (error: any) {
      setLayers((previous) => previous.filter((item) => item.id !== placeholderId))
      setSelectedId(layer.id)
      setNotice(error?.message || "文字修改失败")
    } finally {
      setIsApplyingTextEdit(false)
    }
  }

  const resolveBackendFileUrl = (url: string) => {
    const value = String(url || "").trim()
    if (!value) return ""
    if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:") || value.startsWith("blob:")) return value
    return buildLongRunningApiUrl(value)
  }

  const downloadBackendFile = async (url: string, filename: string) => {
    const resolved = resolveBackendFileUrl(url)
    if (!resolved) return false
    await fetchAndDownload(resolved, filename)
    return true
  }

  const waitForSmartLayerJob = async (jobId: string) => {
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
      const response = await fetch(buildLongRunningApiUrl(`/api/canvas-studio/smart-layer?jobId=${encodeURIComponent(jobId)}`), {
        method: "GET",
      })
      const data = (await response.json().catch(() => ({}))) as SmartLayerResult
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || "智能分层任务查询失败")
      }
      if (data.status === "failed") {
        throw new Error(data.error || "智能分层失败")
      }
      if (data.status === "succeeded" && data.result) {
        return data.result
      }
    }
  }

  const handleSmartLayer = async (layer: CanvasLayer) => {
    if (layer.kind !== "image" || !layer.src || layer.placeholder || isSmartLayering) return
    closeContextMenu()
    setIsSmartLayering(true)
    const placeholderId = createId("smart-layer")
    const gap = 40
    const placeholder: CanvasLayer = {
      ...layer,
      id: placeholderId,
      name: "智能分层生成中",
      x: layer.x + layer.width + gap,
      y: layer.y,
      src: "",
      placeholder: true,
      loadingLabel: "生成 PSD 分层中...",
    }
    setLayers((previous) => [...previous, placeholder])
    setSelectedId(placeholderId)

    try {
      const imageUrl = await createLayerImageDataUrl(layer)
      if (!String(imageUrl || "").trim()) {
        throw new Error("当前图层没有可用于智能分层的图片")
      }
      const response = await fetch(buildLongRunningApiUrl("/api/canvas-studio/smart-layer"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          naturalWidth: layer.width,
          naturalHeight: layer.height,
        }),
      })
      const data = (await response.json().catch(() => ({}))) as SmartLayerResult
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || "智能分层失败")
      }
      if (!data.jobId) {
        throw new Error("智能分层任务创建失败")
      }
      updateLayer(placeholderId, (current) => ({
        ...current,
        loadingLabel: "智能分层处理中...",
      }))
      const result = await waitForSmartLayerJob(data.jobId)

      const previewUrl = resolveBackendFileUrl(result.files?.preview || "")
      const layerCount = Array.isArray(result.manifest?.layers) ? result.manifest.layers.length : 0
      if (previewUrl) {
        updateLayer(placeholderId, (current) => ({
          ...current,
          name: `PSD 分层预览${layerCount ? ` ${layerCount}层` : ""}`,
          src: previewUrl,
          placeholder: false,
          loadingLabel: "",
        }))
      } else {
        setLayers((previous) => previous.filter((item) => item.id !== placeholderId))
        setSelectedId(layer.id)
      }

      const timestamp = Date.now()
      let downloaded = false
      if (result.files?.editablePackage) {
        downloaded = await downloadBackendFile(result.files.editablePackage, `canvas-smart-layer-editable-${timestamp}.zip`)
      }
      if (!downloaded && result.files?.jsx) {
        downloaded = await downloadBackendFile(result.files.jsx, `run-in-photoshop-${timestamp}.jsx`)
      }
      if (!downloaded && result.files?.psd) {
        downloaded = await downloadBackendFile(result.files.psd, `canvas-smart-layer-raster-fallback-${timestamp}.psd`)
      }
      if (!downloaded && result.files?.manifest) {
        await downloadBackendFile(result.files.manifest, `canvas-smart-layer-manifest-${timestamp}.json`)
      }

      setNotice(
        result.files?.editablePackage
          ? `可编辑 PSD 工程包已生成${layerCount ? `，共 ${layerCount} 层` : ""}`
          : `已生成分层脚本，服务端 PSD 兜底失败：${result.psd?.stderr || "请检查 Python 依赖"}`
      )
    } catch (error: any) {
      setLayers((previous) => previous.filter((item) => item.id !== placeholderId))
      setSelectedId(layer.id)
      setNotice(error?.message || "智能分层失败")
    } finally {
      setIsSmartLayering(false)
    }
  }

  const zoomAtViewportPoint = (clientX: number, clientY: number, nextZoom: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) {
      setZoom(nextZoom)
      return
    }
    const pointX = clientX - rect.left
    const pointY = clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const worldX = (pointX - centerX - pan.x) / zoom
    const worldY = (pointY - centerY - pan.y) / zoom
    setZoom(nextZoom)
    setPan({
      x: Math.round(pointX - centerX - worldX * nextZoom),
      y: Math.round(pointY - centerY - worldY * nextZoom),
    })
  }

  const zoomAtCenter = (nextZoom: number) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) {
      setZoom(nextZoom)
      return
    }
    zoomAtViewportPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, nextZoom)
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const stopBrowserPageZoom = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (!viewport.contains(event.target as Node | null)) return
      event.preventDefault()
    }

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault()

      if (event.ctrlKey || event.metaKey) {
        const nextZoom = clamp(zoom * Math.exp(-event.deltaY * 0.002), 0.1, 5)
        zoomAtViewportPoint(event.clientX, event.clientY, nextZoom)
        return
      }

      setPan((current) => ({
        x: Math.round(current.x - event.deltaX),
        y: Math.round(current.y - event.deltaY),
      }))
    }

    window.addEventListener("wheel", stopBrowserPageZoom, { capture: true, passive: false })
    viewport.addEventListener("wheel", handleNativeWheel, { passive: false })
    return () => {
      window.removeEventListener("wheel", stopBrowserPageZoom, { capture: true })
      viewport.removeEventListener("wheel", handleNativeWheel)
    }
  }, [pan.x, pan.y, zoom])

  const addImageFromFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result || "")
      const image = document.createElement("img")
      image.onload = () => {
        const scale = Math.min(520 / image.naturalWidth, 520 / image.naturalHeight, 1)
        const width = Math.round(image.naturalWidth * scale)
        const height = Math.round(image.naturalHeight * scale)
        const layer: CanvasLayer = {
          id: createId("image"),
          kind: "image",
          name: file.name.replace(/\.[^.]+$/, "") || "图片",
          x: -Math.round(width / 2),
          y: -Math.round(height / 2),
          width,
          height,
          src,
        }
        setLayers((previous) => [...previous, layer])
        setSelectedId(layer.id)
      }
      image.src = src
    }
    reader.readAsDataURL(file)
  }

  const addText = () => {
    const layer: CanvasLayer = {
      id: createId("text"),
      kind: "text",
      name: "文字",
      x: -180,
      y: -48,
      width: 360,
      height: 96,
      text: "输入文字",
      fontSize: 56,
      color: "#18181b",
    }
    setLayers((previous) => [...previous, layer])
    setSelectedId(layer.id)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizeState) {
      const dx = (event.clientX - resizeState.startX) / zoom
      const dy = (event.clientY - resizeState.startY) / zoom
      updateLayer(resizeState.id, (layer) => {
        const aspect = resizeState.originWidth / Math.max(1, resizeState.originHeight)
        const horizontalDelta = resizeState.corner.includes("w") ? -dx : dx
        const verticalDelta = resizeState.corner.includes("n") ? -dy : dy
        const dominantDelta = Math.abs(horizontalDelta) > Math.abs(verticalDelta) ? horizontalDelta : verticalDelta * aspect
        const nextWidth = Math.max(40, Math.round(resizeState.originWidth + dominantDelta))
        const nextHeight = Math.max(40, Math.round(nextWidth / aspect))
        return {
          ...layer,
          x: resizeState.corner.includes("w") ? Math.round(resizeState.originX + resizeState.originWidth - nextWidth) : resizeState.originX,
          y: resizeState.corner.includes("n") ? Math.round(resizeState.originY + resizeState.originHeight - nextHeight) : resizeState.originY,
          width: nextWidth,
          height: nextHeight,
        }
      })
      return
    }

    if (dragState) {
      const dx = (event.clientX - dragState.startX) / zoom
      const dy = (event.clientY - dragState.startY) / zoom
      updateLayer(dragState.id, (layer) => ({
        ...layer,
        x: Math.round(dragState.originX + dx),
        y: Math.round(dragState.originY + dy),
      }))
      return
    }

    if (panState) {
      setPan({
        x: Math.round(panState.originX + event.clientX - panState.startX),
        y: Math.round(panState.originY + event.clientY - panState.startY),
      })
    }
  }

  const stopPointerAction = () => {
    setDragState(null)
    setResizeState(null)
    setPanState(null)
  }

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof HTMLElement && target.closest("button,input,textarea,[data-layer-hit],[data-floating-ui]")) return
    event.preventDefault()
    closeContextMenu()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId("")
    setPanState({
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    })
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.target
    if (target instanceof HTMLElement && target.closest("[data-floating-ui]")) return
    const layerElement = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-layer-id]") : null
    const layerId = layerElement?.dataset.layerId || ""
    if (layerId && layers.some((layer) => layer.id === layerId)) {
      setSelectedId(layerId)
      setContextMenu({ x: event.clientX, y: event.clientY, mode: "layer", targetLayerId: layerId })
      return
    }
    setSelectedId("")
    setContextMenu({ x: event.clientX, y: event.clientY, mode: "canvas", targetLayerId: null })
  }

  useEffect(() => {
    if (!contextMenu) return
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu()
    }
    window.addEventListener("keydown", closeOnKey)
    window.addEventListener("resize", closeContextMenu)
    return () => {
      window.removeEventListener("keydown", closeOnKey)
      window.removeEventListener("resize", closeContextMenu)
    }
  }, [contextMenu])

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return
    const [first, second] = Array.from(event.touches)
    const midpointX = (first.clientX + second.clientX) / 2
    const midpointY = (first.clientY + second.clientY) / 2
    setPinchState({
      distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
      zoom,
      midpointX,
      midpointY,
      panX: pan.x,
      panY: pan.y,
    })
    setDragState(null)
    setPanState(null)
  }

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!pinchState || event.touches.length !== 2) return
    event.preventDefault()
    const [first, second] = Array.from(event.touches)
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
    const nextZoom = clamp(pinchState.zoom * (distance / Math.max(1, pinchState.distance)), 0.1, 5)
    const midpointX = (first.clientX + second.clientX) / 2
    const midpointY = (first.clientY + second.clientY) / 2
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) {
      setZoom(nextZoom)
      return
    }
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const startPointX = pinchState.midpointX - rect.left
    const startPointY = pinchState.midpointY - rect.top
    const worldX = (startPointX - centerX - pinchState.panX) / pinchState.zoom
    const worldY = (startPointY - centerY - pinchState.panY) / pinchState.zoom
    const nextPointX = midpointX - rect.left
    const nextPointY = midpointY - rect.top
    setZoom(nextZoom)
    setPan({
      x: Math.round(nextPointX - centerX - worldX * nextZoom),
      y: Math.round(nextPointY - centerY - worldY * nextZoom),
    })
  }

  const handleTouchEnd = () => {
    setPinchState(null)
  }

  const handleExport = async () => {
    try {
      const dataUrl = await exportStage(layers)
      await fetchAndDownload(dataUrl, `canvas-studio-${Date.now()}.png`)
      setNotice("已导出")
    } catch (error: any) {
      setNotice(String(error?.message || "导出失败"))
    }
  }

  const uploadButton = (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50"
    >
      <ImagePlus className="h-4 w-4 text-zinc-500" />
      上传图片
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(event) => {
          Array.from(event.target.files || []).forEach(addImageFromFile)
          event.currentTarget.value = ""
        }}
      />
      <style jsx>{`
        @keyframes textSweep {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(260%);
          }
        }
      `}</style>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={viewportRef}
          className="relative h-full min-w-[600px] flex-1 overflow-hidden"
          style={{
            cursor: panState ? "grabbing" : activeTool === "hand" ? "grab" : "default",
            touchAction: "none",
          }}
          onPointerDown={beginPan}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPointerAction}
          onPointerCancel={stopPointerAction}
          onPointerLeave={stopPointerAction}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onDoubleClick={() => {
            if (!hasContent) addText()
          }}
        >
          <div
            className="absolute inset-0 h-full w-full"
            style={{
              backgroundColor: "#fafafa",
              backgroundImage: "radial-gradient(circle, #d4d4d8 1px, transparent 1px)",
              backgroundPosition: `${pan.x}px ${pan.y}px`,
              backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            }}
          >
            <div className="relative z-[1] h-full w-full" aria-label="拖拽或点击上传素材">
              <svg
                data-free-canvas-svg
                width={UI_STAGE_BOUNDS.width}
                height={UI_STAGE_BOUNDS.height}
                viewBox={`${UI_STAGE_BOUNDS.left} ${UI_STAGE_BOUNDS.top} ${UI_STAGE_BOUNDS.width} ${UI_STAGE_BOUNDS.height}`}
                className="absolute left-1/2 top-1/2 overflow-visible"
                style={{
                  width: UI_STAGE_BOUNDS.width * zoom,
                  height: UI_STAGE_BOUNDS.height * zoom,
                  transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                }}
              >
                {layers.map((layer) => {
                  if (layer.placeholder) {
                    return (
                      <g key={layer.id} transform={`translate(${layer.x} ${layer.y})`}>
                        <rect width={layer.width} height={layer.height} rx="14" fill="#f4f4f5" stroke="#e4e4e7" strokeDasharray="10 8" />
                        <foreignObject width={layer.width} height={layer.height}>
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              color: "#71717a",
                              fontSize: 14,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              textAlign: "center",
                            }}
                          >
                            {layer.loadingLabel || "生成中..."}
                          </div>
                        </foreignObject>
                      </g>
                    )
                  }
                  if (layer.kind === "image" && layer.src) {
                    return (
                      <g key={layer.id} transform={`translate(${layer.x} ${layer.y})`}>
                        <image href={layer.src} width={layer.width} height={layer.height} preserveAspectRatio="xMidYMid slice" />
                      </g>
                    )
                  }
                  return (
                    <g key={layer.id} transform={`translate(${layer.x} ${layer.y})`}>
                      <foreignObject width={layer.width} height={layer.height}>
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            color: layer.color,
                            fontSize: layer.fontSize,
                            fontWeight: 800,
                            lineHeight: 1.12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textAlign: "center",
                          }}
                        >
                          {layer.text}
                        </div>
                      </foreignObject>
                    </g>
                  )
                })}
              </svg>

              {layers.map((layer) => (
                <button
                  key={layer.id}
                  type="button"
                  data-layer-hit
                  data-layer-id={layer.id}
                  aria-label={`选择 ${layer.name}`}
                  className="absolute left-1/2 top-1/2 z-10 bg-transparent"
                  style={{
                    cursor: activeTool === "hand" ? "grab" : "default",
                    width: layer.width * zoom,
                    height: layer.height * zoom,
                    transform: `translate(calc(-50% + ${pan.x + (layer.x + layer.width / 2) * zoom}px), calc(-50% + ${pan.y + (layer.y + layer.height / 2) * zoom}px))`,
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    closeContextMenu()
                    event.currentTarget.setPointerCapture(event.pointerId)
                    if (activeTool === "hand") {
                      setPanState({
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: pan.x,
                        originY: pan.y,
                      })
                      return
                    }
                    setSelectedId(layer.id)
                    setDragState({
                      id: layer.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: layer.x,
                      originY: layer.y,
                    })
                  }}
                />
              ))}

              {selectedLayer ? (
                <div
                  data-layer-id={selectedLayer.id}
                  className="pointer-events-none absolute z-20"
                  style={{
                    left: `calc(50% + ${pan.x + selectedLayer.x * zoom}px)`,
                    top: `calc(50% + ${pan.y + selectedLayer.y * zoom}px)`,
                    width: selectedLayer.width * zoom,
                    height: selectedLayer.height * zoom,
                  }}
                >
                  <div data-floating-ui className="absolute -top-24 left-1/2 flex -translate-x-1/2 items-center justify-center pointer-events-auto">
                    <div className="flex h-11 items-center gap-1 rounded-2xl border border-zinc-200 bg-white/95 p-1 text-zinc-500 shadow-xl backdrop-blur-md">
                      <button
                        type="button"
                        disabled={selectedLayer.kind !== "image" || !selectedLayer.src || selectedLayer.placeholder || isDetectingText}
                        onClick={() => void beginTextEdit(selectedLayer)}
                        className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-medium transition-all hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Type className="h-3.5 w-3.5" />
                        编辑文字
                      </button>
                      <button type="button" className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-medium transition-all hover:bg-zinc-100" title="裁剪">
                        <Crop className="h-3.5 w-3.5" />
                        裁剪
                      </button>
                      <button type="button" className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-medium transition-all hover:bg-zinc-100" title="分割图片">
                        <Scissors className="h-3.5 w-3.5" />
                        分割图片
                      </button>
                      <button
                        type="button"
                        disabled={selectedLayer.kind !== "image" || !selectedLayer.src || selectedLayer.placeholder || isSmartLayering}
                        onClick={() => void handleSmartLayer(selectedLayer)}
                        className="relative flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-medium transition-all hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {isSmartLayering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                        {isSmartLayering ? "分层中" : "智能分层"}
                        <span className="absolute -right-2 -top-2 origin-bottom-left scale-90 rounded-full bg-[#ff4d4f] px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">限免</span>
                      </button>
                      <button type="button" className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-medium transition-all hover:bg-zinc-100">
                        <Eraser className="h-3.5 w-3.5" />
                        去除背景
                      </button>
                      <button type="button" onClick={handleExport} className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 transition-all hover:bg-zinc-100" title="导出图片">
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          deleteLayer(selectedLayer.id)
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-xl text-red-500 transition-all hover:bg-red-50"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="absolute inset-0" style={{ border: `1.5px solid ${SELECTION_COLOR}` }} />
                  {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                    <button
                      key={corner}
                      type="button"
                      data-floating-ui
                      aria-label="缩放图层"
                      className={cn(
                        "pointer-events-auto absolute h-2.5 w-2.5 rounded-full border bg-white",
                        corner === "nw" && "-left-[5px] -top-[5px] cursor-nwse-resize",
                        corner === "ne" && "-right-[5px] -top-[5px] cursor-nesw-resize",
                        corner === "sw" && "-bottom-[5px] -left-[5px] cursor-nesw-resize",
                        corner === "se" && "-bottom-[5px] -right-[5px] cursor-nwse-resize"
                      )}
                      style={{ borderColor: SELECTION_COLOR, borderWidth: 1.5 }}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        event.currentTarget.setPointerCapture(event.pointerId)
                        setResizeState({
                          id: selectedLayer.id,
                          corner,
                          startX: event.clientX,
                          startY: event.clientY,
                          originX: selectedLayer.x,
                          originY: selectedLayer.y,
                          originWidth: selectedLayer.width,
                          originHeight: selectedLayer.height,
                        })
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {textEditLayer ? (
                <>
                  <div
                    data-floating-ui
                    className="pointer-events-none absolute z-[32]"
                    style={{
                      left: `calc(50% + ${pan.x + textEditLayer.x * zoom}px)`,
                      top: `calc(50% + ${pan.y + textEditLayer.y * zoom}px)`,
                      width: textEditLayer.width * zoom,
                      height: textEditLayer.height * zoom,
                    }}
                  >
                    {isDetectingText ? (
                      <div className="relative h-full w-full overflow-hidden">
                        <div className="absolute inset-0 bg-white/55" />
                        <div
                          className="absolute inset-y-0 left-[-65%] w-[65%] animate-[textSweep_1.25s_ease-in-out_infinite]"
                          style={{
                            background:
                              "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.72) 44%, rgba(255,255,255,0.35) 57%, rgba(255,255,255,0.04) 74%, rgba(255,255,255,0) 100%)",
                          }}
                        />
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                          <div className="flex items-center gap-2 rounded-full bg-[rgba(126,126,126,0.48)] px-4 py-2 text-white backdrop-blur-sm">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-[12px] font-medium leading-none">提取文字...</span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {noTextFound ? (
                      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-red-500 px-6 py-3 text-white shadow-xl">
                        <X className="h-5 w-5" />
                        <span className="text-sm font-medium">未检测到文字</span>
                      </div>
                    ) : null}
                  </div>

                  {!isDetectingText && textBlocks.length > 0 ? (
                    <div
                      data-floating-ui
                      className="pointer-events-auto absolute z-[55] w-[240px] animate-in slide-in-from-left-2 duration-200"
                      style={{
                        left: `calc(50% + ${pan.x + (textEditLayer.x + textEditLayer.width) * zoom + 16}px)`,
                        top: `calc(50% + ${pan.y + textEditLayer.y * zoom}px)`,
                        maxHeight: Math.max(220, textEditLayer.height * zoom),
                      }}
                    >
                      <div className="flex max-h-[354px] w-[240px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white/95 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur">
                        <div className="flex h-11 w-full items-center gap-2.5 px-4 py-3">
                          <p className="flex-1 text-xs font-semibold text-zinc-900">编辑文字</p>
                          <button type="button" onClick={closeTextEditPanel} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="min-h-0 flex-1 px-3">
                          <div className="flex max-h-[238px] flex-col gap-2 overflow-y-auto pb-1">
                            {textBlocks.map((block, index) => (
                              <div key={`${index}-${block.text}`} className="group relative">
                                <div className="flex w-full items-start gap-1 rounded-lg bg-zinc-100 px-2 py-1.5 text-sm transition-colors hover:bg-zinc-200/70 focus-within:bg-zinc-200/70">
                                  <textarea
                                    value={editedTexts[index] ?? block.text}
                                    onChange={(event) => setEditedTexts((previous) => ({ ...previous, [index]: event.target.value }))}
                                    className="min-h-5 max-h-[88px] min-w-0 flex-1 resize-none bg-transparent px-0.5 text-zinc-900 outline-none placeholder:text-zinc-400"
                                    rows={1}
                                    onInput={(event) => {
                                      const target = event.currentTarget
                                      target.style.height = "20px"
                                      target.style.height = `${Math.min(target.scrollHeight, 88)}px`
                                    }}
                                  />
                                </div>
                                <div className="absolute bottom-0 right-0 top-0 hidden items-center rounded-r-lg bg-white pl-1.5 group-hover:flex">
                                  <button type="button" onClick={() => removeTextBlock(index)} className="flex h-5 w-5 items-center justify-center text-zinc-500 hover:text-red-500" aria-label="删除文字块">
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex w-full items-center gap-2 px-3 pb-3 pt-3">
                          <button type="button" onClick={closeTextEditPanel} className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-transparent px-2.5 text-sm font-normal text-zinc-700 transition-colors hover:bg-zinc-100">
                            取消
                          </button>
                          <button
                            type="button"
                            disabled={!textBlocks.some((block, index) => String(editedTexts[index] ?? block.text).trim() !== block.text)}
                            onClick={() => void applyTextEdit()}
                            className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-zinc-950 px-2.5 text-sm font-normal text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                          >
                            <span>应用</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {layers
                .filter((layer) => layer.placeholder)
                .map((layer) => (
                  <div
                    key={`placeholder-overlay-${layer.id}`}
                    className="pointer-events-none absolute z-[26] flex items-center justify-center"
                    style={{
                      left: `calc(50% + ${pan.x + layer.x * zoom}px)`,
                      top: `calc(50% + ${pan.y + layer.y * zoom}px)`,
                      width: layer.width * zoom,
                      height: layer.height * zoom,
                    }}
                  >
                    <div className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-zinc-600 shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{layer.loadingLabel || "生成中..."}</span>
                    </div>
                  </div>
                ))}

              {!hasContent ? (
                <div className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-10 px-4 pt-[8vh]">
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <div className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm" aria-hidden="true">
                      <MousePointer2 className="h-4 w-4 shrink-0 text-zinc-900" />
                      <span>双击屏幕</span>
                    </div>
                    <p className="select-none text-sm font-medium text-zinc-500">画布自由生成</p>
                  </div>
                  <div className="pointer-events-auto flex max-w-[920px] flex-wrap items-center justify-center gap-3">
                    {uploadButton}
                    <button type="button" onClick={addText} className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50">
                      <Sparkles className="h-4 w-4 text-zinc-500" />
                      生成图片
                    </button>
                    <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-zinc-100 bg-white px-4 py-3 text-sm font-medium text-zinc-300 shadow-sm">
                      <Video className="h-4 w-4 opacity-40" />
                      上传视频
                    </button>
                    <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-zinc-100 bg-white px-4 py-3 text-sm font-medium text-zinc-300 shadow-sm">
                      <Sparkles className="h-4 w-4 opacity-40" />
                      生成视频
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {notice ? (
            <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-md bg-white/95 px-3 py-2 text-xs font-medium text-zinc-600 shadow-sm">
              {notice}
            </div>
          ) : null}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-6">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-zinc-200 bg-white/95 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.12)] backdrop-blur">
            <button type="button" onClick={() => setActiveTool("select")} className={activeTool === "select" ? activeBottomToolButtonClass : bottomToolButtonClass}>
              <MousePointer2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setActiveTool("hand")} className={activeTool === "hand" ? activeBottomToolButtonClass : bottomToolButtonClass}>
              <Hand className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} className={bottomToolButtonClass}>
              <ImagePlus className="h-4 w-4" />
            </button>
            <button type="button" onClick={addText} className={bottomToolButtonClass}>
              <Type className="h-4 w-4" />
            </button>
            <button type="button" onClick={handleExport} className="flex h-8 items-center justify-center rounded-lg px-3 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
              导出
            </button>
          </div>
        </div>

        {contextMenu ? (
          <>
            <button
              type="button"
              aria-label="关闭菜单"
              className="fixed inset-0 z-40 cursor-default bg-transparent"
              onClick={closeContextMenu}
              onContextMenu={(event) => {
                event.preventDefault()
                closeContextMenu()
              }}
            />
            <div
              data-floating-ui
              className="fixed z-50 w-[248px] overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 py-1 shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur"
              style={{
                left: Math.min(contextMenu.x, window.innerWidth - 268),
                top: Math.min(contextMenu.y, window.innerHeight - 360),
              }}
              onContextMenu={(event) => event.preventDefault()}
            >
              {contextMenu.mode === "layer" && contextMenu.targetLayerId ? (
                <>
                  <div className="px-3 pb-1 pt-2 text-xs font-medium text-zinc-400">图层操作</div>
                  <ContextMenuItem
                    icon={<Copy className="h-4 w-4" />}
                    label="复制图层"
                    shortcut="⌘D"
                    onClick={() => {
                      duplicateLayer(contextMenu.targetLayerId!)
                      closeContextMenu()
                    }}
                  />
                  <ContextMenuItem
                    icon={<ArrowUp className="h-4 w-4" />}
                    label="上移一层"
                    onClick={() => {
                      moveLayer(contextMenu.targetLayerId!, "up")
                      closeContextMenu()
                    }}
                  />
                  <ContextMenuItem
                    icon={<ArrowDown className="h-4 w-4" />}
                    label="下移一层"
                    onClick={() => {
                      moveLayer(contextMenu.targetLayerId!, "down")
                      closeContextMenu()
                    }}
                  />
                  <ContextMenuItem
                    icon={<ChevronsUp className="h-4 w-4" />}
                    label="移动至顶层"
                    onClick={() => {
                      moveLayer(contextMenu.targetLayerId!, "front")
                      closeContextMenu()
                    }}
                  />
                  <ContextMenuItem
                    icon={<ChevronsDown className="h-4 w-4" />}
                    label="移动至底层"
                    onClick={() => {
                      moveLayer(contextMenu.targetLayerId!, "back")
                      closeContextMenu()
                    }}
                  />
                  <div className="my-1 h-px bg-zinc-100" />
                  <ContextMenuItem
                    icon={<Download className="h-4 w-4" />}
                    label="导出 PNG"
                    onClick={() => {
                      closeContextMenu()
                      void handleExport()
                    }}
                  />
                  <ContextMenuItem
                    icon={<Trash2 className="h-4 w-4" />}
                    label="删除"
                    shortcut="Del"
                    danger
                    onClick={() => {
                      deleteLayer(contextMenu.targetLayerId!)
                      closeContextMenu()
                    }}
                  />
                </>
              ) : (
                <>
                  <div className="px-3 pb-1 pt-2 text-xs font-medium text-zinc-400">画布操作</div>
                  <ContextMenuItem
                    icon={<ZoomIn className="h-4 w-4" />}
                    label="放大"
                    onClick={() => {
                      zoomAtCenter(clamp(zoom * 1.2, 0.1, 5))
                      closeContextMenu()
                    }}
                  />
                  <ContextMenuItem
                    icon={<ZoomOut className="h-4 w-4" />}
                    label="缩小"
                    onClick={() => {
                      zoomAtCenter(clamp(zoom / 1.2, 0.1, 5))
                      closeContextMenu()
                    }}
                  />
                  <ContextMenuItem
                    icon={<MousePointer2 className="h-4 w-4" />}
                    label="缩放至100%"
                    onClick={() => {
                      zoomAtCenter(1)
                      closeContextMenu()
                    }}
                  />
                  <ContextMenuItem
                    icon={<Layers className="h-4 w-4" />}
                    label="显示画布所有图片"
                    onClick={() => {
                      fitAllLayers()
                      closeContextMenu()
                    }}
                  />
                  <div className="my-1 h-px bg-zinc-100" />
                  <ContextMenuItem icon={<Copy className="h-4 w-4" />} label="粘贴" shortcut="⌘V" disabled />
                  <ContextMenuItem
                    icon={<Download className="h-4 w-4" />}
                    label="导出 PNG"
                    onClick={() => {
                      closeContextMenu()
                      void handleExport()
                    }}
                  />
                </>
              )}
            </div>
          </>
        ) : null}

      </div>
    </div>
  )
}
