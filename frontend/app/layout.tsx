import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Picset 商品详情页",
  description: "AI 商品详情页生成工具",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
