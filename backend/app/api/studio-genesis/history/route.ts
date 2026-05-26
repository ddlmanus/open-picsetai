import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveSessionMerchantId } from "@/lib/admin-scope"
import { listStudioGenesisHistoryItems } from "@/lib/studio-genesis-history"
import { getLocalUserScope } from "@/lib/local-user"

export const dynamic = "force-dynamic"

async function getScope() {
  return getLocalUserScope()
}

export async function GET(request: NextRequest) {
  try {
    const scope = await getScope()
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const page = Number(request.nextUrl.searchParams.get("page") || 1)
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 24)
    const keyword = String(request.nextUrl.searchParams.get("keyword") || "")

    const result = await listStudioGenesisHistoryItems(scope, { page, pageSize, keyword })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[api/studio-genesis/history] GET failed:", error)
    return NextResponse.json({ error: "加载生图历史失败" }, { status: 500 })
  }
}
