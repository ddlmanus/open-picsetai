import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])

function extensionForType(type: string) {
  if (type === "image/png") return ".png"
  if (type === "image/webp") return ".webp"
  if (type === "image/gif") return ".gif"
  if (type === "image/avif") return ".avif"
  return ".jpg"
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少上传文件" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "仅支持 JPG、PNG、WebP、GIF 或 AVIF 图片" }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "图片不能超过 12MB" }, { status: 400 })
    }

    const uploadDir = path.resolve(process.cwd(), process.env.STUDIO_GENESIS_UPLOAD_DIR || "uploads")
    await mkdir(uploadDir, { recursive: true })

    const filename = `${randomUUID()}${extensionForType(file.type)}`
    const absolutePath = path.join(uploadDir, filename)
    const bytes = Buffer.from(await file.arrayBuffer())
    await writeFile(absolutePath, bytes)

    const url = `/uploads/${filename}`
    return NextResponse.json({ url, localUrl: url })
  } catch (error: any) {
    console.error("[api/upload] failed:", error)
    return NextResponse.json({ error: error?.message || "上传失败" }, { status: 500 })
  }
}
