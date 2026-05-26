"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import {
  Image as ImageIcon,
  Layers3,
  PenTool,
  Shirt,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  fetchCachedPublicSystemSettings,
  normalizePublicAppName,
} from "@/lib/client/public-system-settings"

const PRODUCT_DETAIL_NAV_ITEMS = [
  { href: "/studio-genesis/workspace", match: ["/studio-genesis", "/studio-genesis/workspace"], label: "全品类商品图", icon: Layers3 },
  { href: "/aesthetic-mirror", match: ["/aesthetic-mirror"], label: "风格复刻", icon: ImageIcon },
  { href: "/clothing-studio", match: ["/clothing-studio"], label: "服装组图", icon: Shirt },
  { href: "/refinement-studio", match: ["/refinement-studio"], label: "图片精修", icon: WandSparkles },
  { href: "/knowledge-studio", match: ["/knowledge-studio"], label: "知识付费", icon: Sparkles },
  { href: "/canvas-studio", match: ["/canvas-studio"], label: "万能画布", icon: PenTool, badge: "Beta" },
] as const

function ProductDetailHeader() {
  const pathname = usePathname()
  const [siteName, setSiteName] = useState("Picset")

  useEffect(() => {
    let cancelled = false
    fetchCachedPublicSystemSettings()
      .then((settings) => {
        if (!cancelled) setSiteName(normalizePublicAppName(settings.appName, "Picset"))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <header className="w-full px-4 py-5 sm:px-6" role="banner">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Link className="flex shrink-0 items-center gap-3" aria-label="首页" href="/studio-genesis">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary shadow-sm">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="whitespace-nowrap text-lg font-extrabold tracking-tight text-foreground">{siteName}</span>
        </Link>

        <nav className="custom-scrollbar -mr-2 flex flex-1 items-center gap-1 overflow-x-auto px-1 py-1 md:justify-end" aria-label="商品详情页工具">
          {PRODUCT_DETAIL_NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary font-medium text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
                {"badge" in item ? (
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none",
                    active ? "bg-primary-foreground/15 text-primary-foreground" : "bg-amber-100 text-amber-700"
                  )}>
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

const PROMO_BANNER_DISMISSED_KEY = "picset:promo-banner:nova-img-2:dismissed"

function PromoBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(window.localStorage.getItem(PROMO_BANNER_DISMISSED_KEY) !== "1")
  }, [])

  const dismiss = () => {
    window.localStorage.setItem(PROMO_BANNER_DISMISSED_KEY, "1")
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="relative border-b border-lime-300 bg-[#E0FB71] px-4 py-2.5">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="flex flex-1 items-center justify-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-lime-900" />
          <p className="text-center text-sm font-medium text-lime-950">
            抢先体验新一代 <span className="font-bold">Nova IMG-2</span> 模型，限时积分优惠。
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-full p-1 text-lime-900 transition-colors hover:bg-lime-200/60"
          aria-label="关闭"
          onClick={dismiss}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default function ProductDetailShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background custom-scrollbar">
      <PromoBanner />
      <ProductDetailHeader />
      {children}
    </div>
  )
}
