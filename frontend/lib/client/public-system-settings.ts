"use client"

export type PublicSystemSettings = {
  appName: string
  logoUrl: string
  xiaohongshuLogoUrl: string
}

const FALLBACK_PUBLIC_APP_NAME = "Ideart"

let cachedPublicSystemSettings: PublicSystemSettings | null = null
let pendingPublicSystemSettings: Promise<PublicSystemSettings> | null = null

export function normalizePublicAppName(value: unknown, fallback = FALLBACK_PUBLIC_APP_NAME) {
  return String(value || "").trim() || fallback
}

export function formatDesignPlatformName(appName: unknown) {
  const displayName = normalizePublicAppName(appName)
  return displayName.includes("设计平台") ? displayName : `${displayName}设计平台`
}

export function fetchCachedPublicSystemSettings(): Promise<PublicSystemSettings> {
  if (cachedPublicSystemSettings) return Promise.resolve(cachedPublicSystemSettings)
  if (pendingPublicSystemSettings) return pendingPublicSystemSettings

  pendingPublicSystemSettings = fetch("/api/system-settings/public", { cache: "no-store", credentials: "include" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`加载系统配置失败: ${response.status}`)
      }
      const data = await response.json().catch(() => ({}))
      const settings: PublicSystemSettings = {
        appName: normalizePublicAppName(data?.appName),
        logoUrl: String(data?.logoUrl || ""),
        xiaohongshuLogoUrl: String(data?.xiaohongshuLogoUrl || data?.logoUrl || ""),
      }
      cachedPublicSystemSettings = settings
      return settings
    })
    .finally(() => {
      pendingPublicSystemSettings = null
    })

  return pendingPublicSystemSettings
}
