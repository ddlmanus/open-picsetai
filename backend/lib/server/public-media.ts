import { absolutizeWithPreferredOrigin } from "@/lib/server/public-url"

export async function ensurePublicImageUrl(
  url: string,
  options?: {
    requestOrigin?: string
    preferredDir?: string
    filenameHint?: string
    mirrorRemote?: boolean
    fetchTimeoutMs?: number
  }
) {
  return absolutizeWithPreferredOrigin(url, options?.requestOrigin)
}

export async function ensurePublicImageUrls(
  urls: string[],
  options?: {
    requestOrigin?: string
    max?: number
    preferredDir?: string
    filenameHint?: string
    mirrorRemote?: boolean
    fetchTimeoutMs?: number
  }
) {
  return (Array.isArray(urls) ? urls : [])
    .map((url) => absolutizeWithPreferredOrigin(url, options?.requestOrigin))
    .filter(Boolean)
    .slice(0, options?.max || urls.length)
}
