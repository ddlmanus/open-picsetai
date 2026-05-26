import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { getEffectiveModelConfig, listEnvModelConfigs } from "@/lib/models/fetcher"
import { modelRouter } from "@/lib/models/router"
import { OpenAICompatibleProvider } from "@/lib/models/openai-compatible"
import { resolveProviderCredentials } from "@/lib/models/provider-credentials"

export const dynamic = "force-dynamic"

type SmartLayerType = "background" | "subject" | "decor" | "effect" | "text" | "image"

type SmartLayer = {
  id: string
  name: string
  type: SmartLayerType
  x: number
  y: number
  width: number
  height: number
  prompt?: string
  text?: string
  style?: Record<string, any>
  zIndex: number
}

type SmartLayerManifest = {
  canvas: {
    width: number
    height: number
    background?: string
  }
  layers: SmartLayer[]
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

type SmartLayerJobStatus = "queued" | "running" | "succeeded" | "failed"
type SmartLayerJob = {
  id: string
  status: SmartLayerJobStatus
  createdAt: number
  updatedAt: number
  result?: any
  error?: string
}

const globalJobStore = globalThis as typeof globalThis & {
  __picsetCanvasSmartLayerJobs?: Map<string, SmartLayerJob>
}
const smartLayerJobs = globalJobStore.__picsetCanvasSmartLayerJobs || new Map<string, SmartLayerJob>()
globalJobStore.__picsetCanvasSmartLayerJobs = smartLayerJobs

function absolutizeUrl(url: string, origin: string) {
  const value = String(url || "").trim()
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("data:")) return value
  const base = String(origin || "").replace(/\/$/, "")
  return value.startsWith("/") ? `${base}${value}` : `${base}/${value}`
}

function sanitizeFilename(value: string) {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "layer"
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function parseJsonFromText(text: string) {
  const raw = String(text || "").trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    if (fenced) {
      try {
        return JSON.parse(fenced.trim())
      } catch {
        // fall through
      }
    }
    const object = raw.match(/\{[\s\S]*\}/)?.[0]
    if (object) {
      try {
        return JSON.parse(object)
      } catch {
        // fall through
      }
    }
    return null
  }
}

async function readImageBuffer(imageUrl: string) {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
    if (!match) throw new Error("图片 Data URI 无效")
    const payload = match[3] || ""
    return match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload))
  }

  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`读取图片失败: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function normalizeManifest(input: unknown, fallbackWidth: number, fallbackHeight: number): SmartLayerManifest {
  const raw = input && typeof input === "object" ? (input as any) : {}
  const canvas = raw.canvas && typeof raw.canvas === "object" ? raw.canvas : {}
  const canvasWidth = Math.round(clamp(Number(canvas.width || fallbackWidth || 1024), 64, 8192))
  const canvasHeight = Math.round(clamp(Number(canvas.height || fallbackHeight || 1024), 64, 8192))
  const sourceLayers = Array.isArray(raw.layers) ? raw.layers : []
  const layers = sourceLayers
    .map((item: any, index: number): SmartLayer | null => {
      if (!item || typeof item !== "object") return null
      const type = String(item.type || "").trim().toLowerCase() as SmartLayerType
      const normalizedType: SmartLayerType =
        type === "background" || type === "subject" || type === "decor" || type === "effect" || type === "text" || type === "image"
          ? type
          : index === 0
            ? "background"
            : "image"
      const width = Math.round(clamp(Number(item.width || item.w || canvasWidth), 1, canvasWidth))
      const height = Math.round(clamp(Number(item.height || item.h || canvasHeight), 1, canvasHeight))
      const x = Math.round(clamp(Number(item.x || 0), 0, canvasWidth - 1))
      const y = Math.round(clamp(Number(item.y || 0), 0, canvasHeight - 1))
      return {
        id: sanitizeFilename(String(item.id || `${normalizedType}_${index + 1}`)),
        name: String(item.name || `${normalizedType}_${index + 1}`).trim() || `${normalizedType}_${index + 1}`,
        type: normalizedType,
        x,
        y,
        width: Math.max(1, Math.min(width, canvasWidth - x)),
        height: Math.max(1, Math.min(height, canvasHeight - y)),
        prompt: String(item.prompt || "").trim(),
        text: String(item.text || "").trim(),
        style: item.style && typeof item.style === "object" ? item.style : {},
        zIndex: Number.isFinite(Number(item.zIndex)) ? Number(item.zIndex) : index,
      }
    })
    .filter(Boolean) as SmartLayer[]

  if (!layers.some((layer) => layer.type === "background")) {
    layers.unshift({
      id: "background",
      name: "Background",
      type: "background",
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      prompt: "原始背景层",
      style: {},
      zIndex: -1000,
    })
  }

  return {
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
      background: String(canvas.background || "#ffffff"),
    },
    layers: layers.sort((a, b) => a.zIndex - b.zIndex),
  }
}

async function analyzeImage(params: {
  imageUrl: string
  width: number
  height: number
  requestedModelId?: string
}) {
  const fallbackModel = listEnvModelConfigs("CHAT")[0] || null
  const modelConfig = (params.requestedModelId ? await getEffectiveModelConfig(params.requestedModelId, "default") : null) || fallbackModel
  const modelId = String(modelConfig?.modelId || params.requestedModelId || "").trim()
  const credentials = resolveProviderCredentials(modelConfig?.provider || {})

  if (!modelId || !credentials.apiKey) {
    return normalizeManifest(null, params.width, params.height)
  }

  const client = new OpenAICompatibleProvider({
    baseUrl: credentials.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: credentials.apiKey,
    modelId,
    providerName: modelConfig?.provider?.name || credentials.providerKey || "Canvas Smart Layer",
    providerConfig: modelConfig?.provider || {},
  })

  const prompt = [
    "你是电商设计图 PSD 分层规划器。分析参考图，输出可用于 Photoshop 分层重建的严格 JSON。",
    `画布尺寸必须使用 ${params.width}x${params.height}。坐标单位是像素，原点在左上角。`,
    "识别背景、主体商品/人物、装饰、光效/阴影/氛围特效、文字区域。",
    "每层必须给出 name/type/x/y/width/height/prompt/text/style/zIndex。",
    "type 只能是 background、subject、decor、effect、text、image。",
    "主体/装饰/特效层的 prompt 要描述如何基于参考图生成透明背景 PNG，并强调不改变位置、大小、朝向、光影和风格。",
    "文字层必须写出 text；style 中写 fontFamily、fontSize、color、fontWeight、align、lineHeight、shadow 等可观察样式。",
    "层级按从底到顶 zIndex 递增；不要漏掉主要可编辑元素。",
    "只返回 JSON，格式：{\"canvas\":{\"width\":数字,\"height\":数字,\"background\":\"#ffffff\"},\"layers\":[...]}。",
  ].join("\n")

  const result = await client.chat(
    [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: params.imageUrl } },
        ],
      },
    ],
    {
      model: modelId,
      temperature: 0,
      max_tokens: 3600,
      response_format: { type: "json_object" },
    }
  )
  const parsed = parseJsonFromText(String(result?.choices?.[0]?.message?.content || ""))
  return normalizeManifest(parsed, params.width, params.height)
}

async function saveFullCanvasImage(params: {
  source: Buffer
  outputPath: string
  canvasWidth: number
  canvasHeight: number
  layer: SmartLayer
  fit?: "cover" | "contain"
}) {
  const layer = params.layer
  if (layer.type === "background") {
    await sharp(params.source)
      .resize(params.canvasWidth, params.canvasHeight, { fit: "cover" })
      .png()
      .toFile(params.outputPath)
    return
  }

  const resized = await sharp(params.source)
    .resize(Math.max(1, layer.width), Math.max(1, layer.height), {
      fit: params.fit || "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  await sharp({
    create: {
      width: params.canvasWidth,
      height: params.canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left: layer.x, top: layer.y }])
    .png()
    .toFile(params.outputPath)
}

async function cropFallbackLayer(params: {
  source: Buffer
  outputPath: string
  canvasWidth: number
  canvasHeight: number
  layer: SmartLayer
}) {
  const layer = params.layer
  const left = clamp(layer.x, 0, params.canvasWidth - 1)
  const top = clamp(layer.y, 0, params.canvasHeight - 1)
  const width = Math.max(1, Math.min(layer.width, params.canvasWidth - left))
  const height = Math.max(1, Math.min(layer.height, params.canvasHeight - top))
  const crop = await sharp(params.source)
    .resize(params.canvasWidth, params.canvasHeight, { fit: "cover" })
    .extract({ left, top, width, height })
    .png()
    .toBuffer()
  await saveFullCanvasImage({
    source: crop,
    outputPath: params.outputPath,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    layer,
  })
}

async function generateElementPng(params: {
  layer: SmartLayer
  referenceImageUrl: string
  outputPath: string
  sourceBuffer: Buffer
  canvasWidth: number
  canvasHeight: number
  imageModelId?: string
}) {
  const fallbackModel = listEnvModelConfigs("IMAGE")[0] || null
  const modelConfig = (params.imageModelId ? await getEffectiveModelConfig(params.imageModelId, "default") : null) || fallbackModel
  const imageModelId = String(modelConfig?.modelId || params.imageModelId || "").trim()

  if (!imageModelId) {
    await cropFallbackLayer({
      source: params.sourceBuffer,
      outputPath: params.outputPath,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      layer: params.layer,
    })
    return { generated: false, reason: "未配置图片生成模型" }
  }

  const prompt = [
    params.layer.prompt || `从参考图中重建 ${params.layer.name}`,
    "输出必须是透明背景 PNG，只包含该单独元素，不要背景、画布边框、水印或额外文字。",
    `元素对应原图区域：x=${params.layer.x}, y=${params.layer.y}, width=${params.layer.width}, height=${params.layer.height}，保持原始位置、比例、角度、光影、材质和风格。`,
    "如果是光效、阴影、装饰或氛围元素，只生成该特效本身的透明图层。",
  ].join("\n")

  try {
    const result = await withTimeout(
      modelRouter.generateWithDbCredentials(prompt, imageModelId, modelConfig?.provider || {}, {
        referenceImages: [params.referenceImageUrl],
        imageUrls: [params.referenceImageUrl],
        image_urls: [params.referenceImageUrl],
        aspectRatio: "auto",
        size: "auto",
        imageSize: "1K",
        resolution: "1K",
        background: "transparent",
      }),
      Number(process.env.CANVAS_SMART_LAYER_ELEMENT_TIMEOUT_MS || 20000),
      `元素图层 ${params.layer.name} 生成超时，已使用原图区域兜底`
    )
    const url = String(result?.imageUrl || result?.url || "").trim()
    const imageBase64 = String(result?.imageBase64 || "").trim()
    const buffer = url ? await readImageBuffer(url) : Buffer.from(imageBase64, "base64")
    if (!buffer.length) throw new Error("图片模型未返回元素图")
    await saveFullCanvasImage({
      source: buffer,
      outputPath: params.outputPath,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      layer: params.layer,
    })
    return { generated: true, model: imageModelId }
  } catch (error: any) {
    await cropFallbackLayer({
      source: params.sourceBuffer,
      outputPath: params.outputPath,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      layer: params.layer,
    })
    return { generated: false, reason: error?.message || "元素生成失败，已使用原图区域兜底" }
  }
}

function jsxString(value: string) {
  return JSON.stringify(String(value || ""))
}

function buildPhotoshopJsx(manifest: SmartLayerManifest, layerFiles: Array<{ layer: SmartLayer; relativePath: string }>) {
  const lines = [
    "#target photoshop",
    "app.displayDialogs = DialogModes.NO;",
    "var scriptFile = new File($.fileName);",
    "var projectDir = scriptFile.parent;",
    `var doc = app.documents.add(${manifest.canvas.width}, ${manifest.canvas.height}, 72, "Picset Smart Layer", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);`,
    "function resolveFile(relativePath) {",
    "  return new File(projectDir.fsName + '/' + relativePath);",
    "}",
    "function placeFile(relativePath, layerName) {",
    "  var file = resolveFile(relativePath);",
    "  if (!file.exists) {",
    "    alert('缺少图层文件：' + file.fsName);",
    "    return;",
    "  }",
    "  app.open(file);",
    "  var src = app.activeDocument;",
    "  src.activeLayer.name = layerName;",
    "  src.activeLayer.duplicate(doc, ElementPlacement.PLACEATEND);",
    "  src.close(SaveOptions.DONOTSAVECHANGES);",
    "  app.activeDocument = doc;",
    "  doc.activeLayer.name = layerName;",
    "}",
    "function setTextColor(hex) {",
    "  var color = new SolidColor();",
    "  hex = String(hex || '#111111').replace('#', '');",
    "  color.rgb.red = parseInt(hex.substring(0, 2), 16) || 0;",
    "  color.rgb.green = parseInt(hex.substring(2, 4), 16) || 0;",
    "  color.rgb.blue = parseInt(hex.substring(4, 6), 16) || 0;",
    "  return color;",
    "}",
    "function safeFontName(name) {",
    "  return String(name || 'ArialMT');",
    "}",
  ]

  for (const item of layerFiles) {
    if (item.layer.type !== "text") {
      lines.push(`placeFile(${jsxString(item.relativePath)}, ${jsxString(item.layer.name)});`)
    }
  }

  for (const layer of manifest.layers.filter((item) => item.type === "text")) {
    const style = layer.style || {}
    const fontSize = Math.max(8, Number(style.fontSize || style.size || Math.round(layer.height * 0.72) || 48))
    const color = String(style.color || "#111111")
    const fontFamily = String(style.fontFamily || style.font || "ArialMT")
    lines.push("var textLayer = doc.artLayers.add();")
    lines.push("textLayer.kind = LayerKind.TEXT;")
    lines.push(`textLayer.name = ${jsxString(layer.name)};`)
    lines.push(`textLayer.textItem.contents = ${jsxString(layer.text || layer.name)};`)
    lines.push(`textLayer.textItem.position = [${Math.round(layer.x)}, ${Math.round(layer.y + fontSize)}];`)
    lines.push(`textLayer.textItem.size = ${fontSize};`)
    lines.push(`textLayer.textItem.width = ${Math.max(1, Math.round(layer.width))};`)
    lines.push(`textLayer.textItem.color = setTextColor(${jsxString(color)});`)
    lines.push("try {")
    lines.push(`  textLayer.textItem.font = safeFontName(${jsxString(fontFamily)});`)
    lines.push("} catch (e) {}")
  }

  lines.push("var outputFile = new File(projectDir.fsName + '/output-editable.psd');")
  lines.push("var psdOptions = new PhotoshopSaveOptions();")
  lines.push("psdOptions.layers = true;")
  lines.push("doc.saveAs(outputFile, psdOptions, true, Extension.LOWERCASE);")
  lines.push("alert('已生成可编辑 PSD：' + outputFile.fsName);")
  return `${lines.join("\n")}\n`
}

function createZip(sourceDir: string, outputPath: string) {
  return new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    const child = spawn("zip", ["-qr", outputPath, "."], { cwd: sourceDir })
    const stderr: Buffer[] = []
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
    child.on("error", (error) => resolve({ ok: false, stderr: error.message }))
    child.on("close", (code) => {
      resolve({ ok: code === 0, stderr: Buffer.concat(stderr).toString("utf8") })
    })
  })
}

function runPsdAssembler(args: string[], cwd: string) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("python3", args, { cwd })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
    child.on("error", (error) => resolve({ ok: false, stdout: "", stderr: error.message }))
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      })
    })
  })
}

async function runSmartLayerJob(params: {
  jobId: string
  imageUrl: string
  origin: string
  body: any
}) {
  const body = params.body || {}
  const imageUrl = params.imageUrl
  const jobId = params.jobId
    const sourceBuffer = await readImageBuffer(imageUrl)
    const metadata = await sharp(sourceBuffer).metadata()
    const width = Math.round(clamp(Number(body?.naturalWidth || body?.width || metadata.width || 1024), 64, 8192))
    const height = Math.round(clamp(Number(body?.naturalHeight || body?.height || metadata.height || 1024), 64, 8192))
    const manifest = await analyzeImage({
      imageUrl,
      width,
      height,
      requestedModelId: String(body?.model || body?.textModelId || "").trim(),
    })

    const uploadRoot = path.resolve(process.cwd(), process.env.STUDIO_GENESIS_UPLOAD_DIR || "uploads")
    const outputDir = path.join(uploadRoot, "canvas-smart-layer", jobId)
    const editablePackageDir = path.join(outputDir, "editable-psd-package")
    const assetDir = path.join(editablePackageDir, "assets")
    const layerDir = path.join(outputDir, "psd_full_canvas_layers")
    await mkdir(assetDir, { recursive: true })
    await mkdir(layerDir, { recursive: true })

    const sourcePath = path.join(assetDir, "original_reference.png")
    await sharp(sourceBuffer)
      .resize(manifest.canvas.width, manifest.canvas.height, { fit: "cover" })
      .png()
      .toFile(sourcePath)

    const generationNotes: Array<Record<string, unknown>> = []
    const layerFiles: Array<{ layer: SmartLayer; filePath: string; relativePath: string }> = []
    for (const layer of manifest.layers) {
      const safeName = sanitizeFilename(layer.name || layer.id)
      const relativePath = `assets/${String(layer.zIndex).padStart(3, "0")}_${safeName}.png`
      const outputPath = path.join(editablePackageDir, relativePath)
      if (layer.type === "text") {
        generationNotes.push({ layer: layer.name, type: layer.type, generated: false, reason: "PSD 栅格文字由 image2psd 渲染；JSX 使用 Photoshop 原生文字层" })
        continue
      }
      if (layer.type === "background") {
        await saveFullCanvasImage({
          source: sourceBuffer,
          outputPath,
          canvasWidth: manifest.canvas.width,
          canvasHeight: manifest.canvas.height,
          layer: { ...layer, x: 0, y: 0, width: manifest.canvas.width, height: manifest.canvas.height },
          fit: "cover",
        })
        generationNotes.push({ layer: layer.name, type: layer.type, generated: false, reason: "保留原始背景/整图作为底层" })
      } else {
        const note = await generateElementPng({
          layer,
          referenceImageUrl: imageUrl,
          outputPath,
          sourceBuffer,
          canvasWidth: manifest.canvas.width,
          canvasHeight: manifest.canvas.height,
          imageModelId: String(body?.imageModelId || "").trim(),
        })
        generationNotes.push({ layer: layer.name, type: layer.type, ...note })
      }
      layerFiles.push({ layer, filePath: outputPath, relativePath })
    }

    const psdManifest = {
      canvas: {
        width: manifest.canvas.width,
        height: manifest.canvas.height,
        composite_background: manifest.canvas.background || "#ffffff",
      },
      output: "output.psd",
      preview: "output.preview.png",
      save_layers_dir: "psd_full_canvas_layers",
      zip_layers: "psd_full_canvas_layers.zip",
      layers: manifest.layers.map((layer) => {
        if (layer.type === "text") {
          const style = layer.style || {}
          return {
            name: layer.name,
            type: "text",
            text: layer.text || layer.name,
            x: layer.x,
            y: layer.y,
            font_size: Number(style.fontSize || style.size || Math.round(layer.height * 0.72) || 48),
            color: String(style.color || "#111111"),
            max_width: layer.width,
            opacity: Number(style.opacity || 1),
          }
        }
        const file = layerFiles.find((item) => item.layer.id === layer.id)
        return {
          name: layer.name,
          file: file ? path.relative(outputDir, file.filePath) : "editable-psd-package/assets/original_reference.png",
          x: 0,
          y: 0,
          fit: "none",
          remove_background: "none",
          opacity: Number(layer.style?.opacity || 1),
        }
      }),
    }

    const manifestPath = path.join(editablePackageDir, "manifest.json")
    const psdManifestPath = path.join(outputDir, "image2psd.manifest.json")
    const jsxPath = path.join(editablePackageDir, "run-in-photoshop.jsx")
    const notesPath = path.join(editablePackageDir, "process_notes.json")
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
    await writeFile(psdManifestPath, JSON.stringify(psdManifest, null, 2), "utf8")
    await writeFile(jsxPath, buildPhotoshopJsx(manifest, layerFiles), "utf8")
    await writeFile(notesPath, JSON.stringify({ jobId, notes: generationNotes }, null, 2), "utf8")
    await writeFile(
      path.join(editablePackageDir, "README.txt"),
      [
        "Picset Smart Layer Editable PSD Package",
        "",
        "1. Open Photoshop.",
        "2. Run File > Scripts > Browse, then select run-in-photoshop.jsx.",
        "3. The script will place PNG layers, create native editable text layers, and save output-editable.psd in this folder.",
        "",
        "Note: output.psd generated by the server is a raster fallback. output-editable.psd created by this JSX is the editable Photoshop result.",
      ].join("\n"),
      "utf8"
    )

    const scriptPath = path.resolve(process.cwd(), "vendor/bggg-creator-image2psd/scripts/image2psd.py")
    const psdResult = await runPsdAssembler(
      [
        scriptPath,
        "assemble",
        "--manifest",
        psdManifestPath,
        "--output",
        path.join(outputDir, "output.psd"),
        "--preview",
        path.join(outputDir, "output.preview.png"),
        "--save-layers",
        layerDir,
        "--zip-layers",
        path.join(outputDir, "psd_full_canvas_layers.zip"),
      ],
      outputDir
    )

    const packageZipResult = await createZip(editablePackageDir, path.join(outputDir, "editable-psd-package.zip"))

    const baseUrl = `/uploads/canvas-smart-layer/${jobId}`
    return {
      success: true,
      jobId,
      manifest,
      files: {
        psd: psdResult.ok ? `${baseUrl}/output.psd` : "",
        preview: psdResult.ok ? `${baseUrl}/output.preview.png` : "",
        editablePackage: packageZipResult.ok ? `${baseUrl}/editable-psd-package.zip` : "",
        jsx: `${baseUrl}/editable-psd-package/run-in-photoshop.jsx`,
        manifest: `${baseUrl}/editable-psd-package/manifest.json`,
        image2psdManifest: `${baseUrl}/image2psd.manifest.json`,
        layersZip: psdResult.ok ? `${baseUrl}/psd_full_canvas_layers.zip` : "",
        notes: `${baseUrl}/editable-psd-package/process_notes.json`,
      },
      psd: {
        ok: psdResult.ok,
        stdout: psdResult.stdout,
        stderr: psdResult.stderr,
      },
      editablePackage: {
        ok: packageZipResult.ok,
        stderr: packageZipResult.stderr,
      },
      notes: generationNotes,
    }

}

function updateSmartLayerJob(id: string, patch: Partial<SmartLayerJob>) {
  const current = smartLayerJobs.get(id)
  if (!current) return
  smartLayerJobs.set(id, { ...current, ...patch, updatedAt: Date.now() })
}

async function startSmartLayerJob(params: { jobId: string; imageUrl: string; origin: string; body: any }) {
  updateSmartLayerJob(params.jobId, { status: "running" })
  try {
    const result = await runSmartLayerJob(params)
    updateSmartLayerJob(params.jobId, { status: "succeeded", result })
  } catch (error: any) {
    console.error("[api/canvas-studio/smart-layer] job failed:", error)
    updateSmartLayerJob(params.jobId, { status: "failed", error: error?.message || "智能分层失败" })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const imageUrl = absolutizeUrl(String(body?.imageUrl || ""), request.nextUrl.origin)
    if (!imageUrl) {
      return NextResponse.json({ success: false, error: "缺少参考图片" }, { status: 400, headers: corsHeaders })
    }

    const jobId = randomUUID()
    smartLayerJobs.set(jobId, { id: jobId, status: "queued", createdAt: Date.now(), updatedAt: Date.now() })
    void startSmartLayerJob({ jobId, imageUrl, origin: request.nextUrl.origin, body })

    return NextResponse.json({ success: true, jobId, status: "queued" }, { headers: corsHeaders })
  } catch (error: any) {
    console.error("[api/canvas-studio/smart-layer] failed:", error)
    return NextResponse.json({ success: false, error: error?.message || "智能分层失败" }, { status: 500, headers: corsHeaders })
  }
}

export async function GET(request: NextRequest) {
  const jobId = String(request.nextUrl.searchParams.get("jobId") || "").trim()
  if (jobId) {
    const job = smartLayerJobs.get(jobId)
    if (!job) {
      return NextResponse.json({ success: false, error: "任务不存在" }, { status: 404, headers: corsHeaders })
    }
    return NextResponse.json(
      {
        success: true,
        jobId: job.id,
        status: job.status,
        result: job.result || null,
        error: job.error || "",
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
      { headers: corsHeaders }
    )
  }

  return NextResponse.json(
    {
      success: false,
      error: "请使用 POST 创建任务，或 GET 时传入 jobId 查询任务",
      required: ["imageUrl", "jobId"],
    },
    { status: 400, headers: corsHeaders }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
