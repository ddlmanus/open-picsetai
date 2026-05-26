import { normalizeRenderableImageUrl } from '@/lib/url/image-proxy-policy'

export function isLikelyImageAsset(input: string, filename?: string): boolean {
    const raw = normalizeRenderableImageUrl(input).toLowerCase()
    const name = String(filename || '').trim().toLowerCase()
    if (raw.startsWith('data:image/')) return true
    return /\.(png|jpe?g|webp|avif|gif|bmp|svg)(\?|#|$)/i.test(raw)
        || /\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(name)
}

function unwrapProxyLikeUrl(rawUrl: string): string {
    const input = String(rawUrl || '').trim()
    if (!input) return ''

    const extractInnerUrl = (queryString: string): string => {
        try {
            const params = new URLSearchParams(queryString)
            return params.get('url') || ''
        } catch {
            return ''
        }
    }

    if (input.startsWith('/api/image-proxy?')) {
        return extractInnerUrl(input.slice('/api/image-proxy?'.length)) || input
    }

    if (input.startsWith('/api/image-proxy/proxy')) {
        const queryIndex = input.indexOf('?')
        if (queryIndex >= 0) {
            return extractInnerUrl(input.slice(queryIndex + 1)) || input
        }
        return input
    }

    try {
        const parsed = new URL(input)
        if (parsed.pathname === '/api/image-proxy' || parsed.pathname.startsWith('/api/image-proxy/proxy')) {
            return parsed.searchParams.get('url') || input
        }
    } catch {
        return input
    }

    return input
}

function stripAliyunImageProcessIfPossible(rawUrl: string): string {
    const input = String(rawUrl || '').trim()
    if (!input || !/^https?:\/\//i.test(input)) return input

    try {
        const parsed = new URL(input)
        const host = String(parsed.hostname || '').trim().toLowerCase()
        if (!host.endsWith('.aliyuncs.com')) return input

        const queryKeys = Array.from(parsed.searchParams.keys()).map((key) => key.toLowerCase())
        const hasSignedQuery =
            queryKeys.includes('ossaccesskeyid') ||
            queryKeys.includes('signature') ||
            queryKeys.includes('x-oss-signature') ||
            queryKeys.includes('x-oss-credential')

        if (hasSignedQuery) return input

        if (parsed.searchParams.has('x-oss-process')) {
            parsed.searchParams.delete('x-oss-process')
        }

        return parsed.toString()
    } catch {
        return input
    }
}

function toSameOriginPathIfPossible(rawUrl: string): string {
    const input = String(rawUrl || '').trim()
    if (!input || !/^https?:\/\//i.test(input)) return input

    try {
        const parsed = new URL(input)
        if (typeof window !== 'undefined' && parsed.origin === window.location.origin) {
            return `${parsed.pathname}${parsed.search || ''}`
        }
        return input
    } catch {
        return input
    }
}

export function resolveImageDownloadUrl(rawUrl: string): string {
    const normalized = normalizeRenderableImageUrl(rawUrl)
    const unwrapped = unwrapProxyLikeUrl(normalized)
    const restored = stripAliyunImageProcessIfPossible(unwrapped)
    const input = toSameOriginPathIfPossible(restored)
    if (!input) return ''
    if (input.startsWith('data:') || input.startsWith('blob:') || input.startsWith('/')) return input
    if (/^https?:\/\//i.test(input)) {
        return `/api/image-proxy?url=${encodeURIComponent(input)}`
    }
    return input
}

export function triggerBrowserDownload(url: string, filename: string) {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
}

export async function fetchAndDownload(url: string, filename: string) {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Download fetch failed: ${response.status}`)
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
        triggerBrowserDownload(objectUrl, filename)
    } finally {
        URL.revokeObjectURL(objectUrl)
    }
}
