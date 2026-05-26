const isAsciiWhitespaceCode = (code: number): boolean =>
    code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32

const isBase64CharCode = (code: number): boolean =>
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 43 || // +
    code === 47 || // /
    code === 61 // =

const stripAsciiWhitespace = (input: string): string => {
    let hasWhitespace = false
    for (let i = 0; i < input.length; i += 1) {
        if (isAsciiWhitespaceCode(input.charCodeAt(i))) {
            hasWhitespace = true
            break
        }
    }
    if (!hasWhitespace) return input
    const compact: string[] = []
    for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i)
        if (!isAsciiWhitespaceCode(code)) compact.push(input[i])
    }
    return compact.join('')
}

const hasBase64LikePrefix = (input: string, maxScan = 4096): boolean => {
    let seen = 0
    const scanLimit = Math.min(input.length, maxScan)
    for (let i = 0; i < scanLimit; i += 1) {
        const code = input.charCodeAt(i)
        if (isAsciiWhitespaceCode(code)) continue
        if (!isBase64CharCode(code)) return false
        seen += 1
    }
    return seen > 0
}

const safeDecodeURIComponent = (input: string): string => {
    try {
        return decodeURIComponent(input)
    } catch {
        return input
    }
}

const looksLikeDirectRenderableUrl = (input: string): boolean => {
    const value = String(input || '').trim()
    if (!value) return false
    if (value.startsWith('data:') || value.startsWith('blob:')) return true
    if (value.startsWith('//')) return true
    if (/^https?:\/\//i.test(value)) return true
    if (value.startsWith('/')) return true
    return false
}

const decodeNestedRenderableUrl = (rawUrl: string): string => {
    let current = String(rawUrl || '').trim()
    if (!current || !/%[0-9a-f]{2}/i.test(current)) return current

    for (let i = 0; i < 3; i += 1) {
        const decoded = safeDecodeURIComponent(current).trim()
        if (!decoded || decoded === current) break

        const decodedLooksRenderable = looksLikeDirectRenderableUrl(decoded)
        const currentLooksRenderable = looksLikeDirectRenderableUrl(current)

        if (!decodedLooksRenderable && currentLooksRenderable) break

        current = decoded

        if (
            decoded.startsWith('data:') ||
            decoded.startsWith('blob:') ||
            decoded.startsWith('/api/image-proxy?') ||
            decoded.startsWith('/uploads/') ||
            /^https?:\/\//i.test(decoded)
        ) {
            continue
        }
    }

    return current
}

export function shouldBypassImageProxy(rawUrl: string): boolean {
    const input = String(rawUrl || '').trim()
    if (!input) return false
    if (!/^https?:\/\//i.test(input)) return false

    try {
        const parsed = new URL(input)
        const host = String(parsed.hostname || '').trim().toLowerCase()
        if (!host) return false

        if (host === 'files.tapnow.top' && parsed.pathname.startsWith('/api/conversation/storage/uploads/')) return true

        // Same-origin absolute URLs should never be routed through the proxy.
        // (Proxy allowlist is for third-party assets; same-origin assets are already safe.)
        if (typeof window !== 'undefined') {
            const currentOrigin = String(window.location?.origin || '').trim()
            if (currentOrigin && parsed.origin === currentOrigin) return true
        }

        // In local development, prefer proxy to avoid CORS-tainted canvas and blocked fetches.
        if (typeof window !== 'undefined') {
            const localHost = String(window.location?.hostname || '').trim().toLowerCase()
            if (localHost === 'localhost' || localHost === '127.0.0.1') {
                return false
            }
        }

        const envSuffixes = String(process.env.NEXT_PUBLIC_IMAGE_PROXY_BYPASS_HOST_SUFFIXES || '').trim()
        if (envSuffixes) {
            const suffixes = envSuffixes
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
            for (const suffix of suffixes) {
                if (host === suffix || host.endsWith(`.${suffix}`)) return true
            }
        }

        if (host.endsWith('.oss-accelerate.aliyuncs.com')) return true
        if (host.endsWith('.oss-cn-beijing.aliyuncs.com')) return true
        if (host.endsWith('.alicdn.com')) return true

        if (host === 'cdn.midjourney.com') return true
        if (/(^|\.)midjourneycloud\.com$/i.test(host)) return true
        if (/(^|\.)redink\.top$/i.test(host)) return true

        return false
    } catch {
        return false
    }
}

function detectBareBase64ImageMime(rawUrl: string): string | null {
    const input = String(rawUrl || '').trim()
    if (!input || input.startsWith('data:') || input.startsWith('blob:')) return null
    if (/^https?:\/\//i.test(input)) return null

    // Most relative URLs in our app look like "/api/..." or "/uploads/...".
    // However, JPEG base64 very commonly starts with "/9j/...", which also begins with "/".
    // Treat only known relative-path prefixes as "definitely a path" and allow base64 detection otherwise.
    if (input.startsWith('/')) {
        const lower = input.toLowerCase()
        const pathLikePrefixes = [
            '/api/',
            '/uploads/',
            '/_next/',
            '/assets/',
            '/static/',
            '/images/',
            '/favicon',
        ]
        if (pathLikePrefixes.some((prefix) => lower.startsWith(prefix))) return null
    }

    if (input.length < 128) return null
    if (!hasBase64LikePrefix(input)) return null

    const compact = stripAsciiWhitespace(input)
    if (compact.startsWith('/9j/')) return 'image/jpeg'
    if (compact.startsWith('iVBORw0KGgo')) return 'image/png'
    if (compact.startsWith('R0lGOD')) return 'image/gif'
    if (compact.startsWith('UklGR')) return 'image/webp'
    return null
}

export function normalizeRenderableImageUrl(rawUrl: string): string {
    const input = decodeNestedRenderableUrl(String(rawUrl || '').trim())
    if (!input) return ''
    const mime = detectBareBase64ImageMime(input)
    if (!mime) return input
    return `data:${mime};base64,${stripAsciiWhitespace(input)}`
}

function inferProxyExtensionFromUrl(rawUrl: string): string {
    const input = normalizeRenderableImageUrl(rawUrl)
    if (!input) return '.jpg'

    try {
        const parsed = new URL(input)
        const pathname = String(parsed.pathname || '')
        const m = pathname.match(/\.(png|jpe?g|webp|avif|gif|svg|bmp)$/i)
        if (!m) return '.jpg'
        const ext = String(m[1] || '').toLowerCase()
        if (ext === 'jpg' || ext === 'jpeg') return '.jpg'
        if (ext === 'png') return '.png'
        if (ext === 'webp') return '.webp'
        if (ext === 'avif') return '.avif'
        if (ext === 'gif') return '.gif'
        if (ext === 'svg') return '.svg'
        if (ext === 'bmp') return '.bmp'
        return '.jpg'
    } catch {
        // Fallback best-effort (avoid throwing for malformed URLs).
        return '.jpg'
    }
}

function maybeRewriteInternalUploadsUrl(rawUrl: string): string {
    const input = normalizeRenderableImageUrl(rawUrl)
    if (!/^https?:\/\//i.test(input)) return input

    try {
        const parsed = new URL(input)
        const host = String(parsed.hostname || '').trim().toLowerCase()
        if (host === 'app.tapnow.ai' && parsed.pathname.startsWith('/api/conversation/storage/uploads/')) {
            parsed.hostname = 'files.tapnow.top'
            return parsed.toString()
        }
        if (!parsed.pathname.startsWith('/uploads/')) return input

        // If we ever stored an internal bind address in DB (0.0.0.0/127/localhost),
        // rewrite it to a same-origin relative path so the browser can load it.
        if (host === '0.0.0.0' || host === '127.0.0.1' || host === 'localhost') {
            return `${parsed.pathname}${parsed.search || ''}`
        }
        return input
    } catch {
        return input
    }
}

export function toImageProxyUrl(rawUrl: string): string {
    const input = maybeRewriteInternalUploadsUrl(rawUrl)
    if (!input) return ''
    if (input.startsWith('data:') || input.startsWith('blob:')) return input
    if (input.startsWith('/')) {
        if (/^\/uploads\/.+\.(bin|svg|heic|heif|tiff?)(?:$|[?#])/i.test(input)) {
            return `/api/image-proxy?url=${encodeURIComponent(input)}`
        }
        return input
    }
    if (!/^https?:\/\//i.test(input)) return input
    if (shouldBypassImageProxy(input)) return input
    // Proxy via our API to avoid CORS-tainted canvas and hotlink issues.
    // Note: endpoint is `/api/image-proxy` (no subpath). Keep it stable to avoid 404 + retry loops.
    return `/api/image-proxy?url=${encodeURIComponent(input)}`
}

export function toImageProxyUrlWithParams(rawUrl: string, params?: { w?: number | null }): string {
    const input = maybeRewriteInternalUploadsUrl(rawUrl)
    if (!input) return ''
    if (input.startsWith('data:') || input.startsWith('blob:')) return input

    const w = params?.w
    const wInt = typeof w === 'number' && Number.isFinite(w) ? Math.floor(w) : null

    if (input.startsWith('/')) {
        if (/^\/uploads\/.+\.(bin|svg|heic|heif|tiff?)(?:$|[?#])/i.test(input)) {
            const qs = new URLSearchParams()
            qs.set('url', input)
            if (wInt && wInt >= 16) {
                qs.set('w', String(Math.max(16, Math.min(4096, wInt))))
            }
            return `/api/image-proxy?${qs.toString()}`
        }
        return input
    }
    if (!/^https?:\/\//i.test(input)) return input
    if (shouldBypassImageProxy(input)) return input

    const qs = new URLSearchParams()
    qs.set('url', input)
    if (wInt && wInt >= 16) {
        qs.set('w', String(Math.max(16, Math.min(4096, wInt))))
    }
    return `/api/image-proxy?${qs.toString()}`
}

/**
 * Converts `/api/image-proxy?url=...` back into its underlying absolute URL.
 * If the input is not an image-proxy URL, returns the trimmed input as-is.
 */
export function unwrapImageProxyUrl(rawUrl: string): string {
    const trimmed = String(rawUrl || '').trim()
    if (!trimmed) return ''

    // Relative proxy path: /api/image-proxy?url=ENCODED
    if (trimmed.startsWith('/api/image-proxy?')) {
        try {
            const parsed = new URL(trimmed, 'http://localhost')
            const encoded = parsed.searchParams.get('url')
            if (!encoded) return trimmed
            try {
                return decodeURIComponent(encoded)
            } catch {
                return encoded
            }
        } catch {
            return trimmed
        }
    }

    // Absolute proxy URL: https://host/api/image-proxy?url=ENCODED
    try {
        const parsed = new URL(trimmed)
        if (parsed.pathname !== '/api/image-proxy') return trimmed
        const encoded = parsed.searchParams.get('url')
        if (!encoded) return trimmed
        try {
            return decodeURIComponent(encoded)
        } catch {
            return encoded
        }
    } catch {
        // not a URL
    }

    return trimmed
}
