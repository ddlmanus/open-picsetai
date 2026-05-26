import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
}

async function readLocalUpload(url: string) {
  const input = String(url || "").trim()
  if (!input.startsWith("/uploads/")) return null
  const relative = input.slice("/uploads/".length).split("?")[0]
  const safeParts = relative.split("/").filter((part) => part && part !== "." && part !== "..")
  if (safeParts.length === 0) return null
  const uploadDir = path.resolve(process.cwd(), process.env.STUDIO_GENESIS_UPLOAD_DIR || "uploads")
  const filePath = path.resolve(uploadDir, ...safeParts)
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) return null
  const file = await readFile(filePath)
  return {
    file,
    contentType: CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
  }
}

export async function GET(request: NextRequest) {
  const rawUrl = String(request.nextUrl.searchParams.get("url") || "").trim()
  if (!rawUrl) {
    return new Response("Missing url", { status: 400 })
  }

  try {
    const local = await readLocalUpload(rawUrl)
    if (local) {
      return new Response(local.file, {
        headers: {
          "Content-Type": local.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      })
    }

    if (!/^https?:\/\//i.test(rawUrl)) {
      return new Response("Unsupported url", { status: 400 })
    }

    const upstream = await fetch(rawUrl, { cache: "no-store" })
    if (!upstream.ok) {
      return new Response("Proxy fetch failed", { status: upstream.status })
    }

    const headers = new Headers()
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/octet-stream")
    headers.set("Cache-Control", "public, max-age=3600")
    return new Response(upstream.body, { headers })
  } catch (error: any) {
    console.error("[api/image-proxy] failed:", error)
    return new Response(error?.message || "Proxy failed", { status: 500 })
  }
}
