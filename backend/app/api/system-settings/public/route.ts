import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    appName: process.env.PUBLIC_APP_NAME || "Picset",
    logoUrl: process.env.PUBLIC_LOGO_URL || "",
    xiaohongshuLogoUrl: process.env.PUBLIC_XIAOHONGSHU_LOGO_URL || process.env.PUBLIC_LOGO_URL || "",
  })
}
