import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveSessionMerchantId } from "@/lib/admin-scope"
import {
  deleteStudioGenesisHistoryItem,
  getStudioGenesisHistoryItem,
  updateStudioGenesisHistoryItem,
} from "@/lib/studio-genesis-history"
import { getLocalUserScope } from "@/lib/local-user"

export const dynamic = "force-dynamic"

async function getScope() {
  return getLocalUserScope()
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getScope()
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const params = await context.params
    const record = await getStudioGenesisHistoryItem(scope, params.id)
    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    }
    return NextResponse.json({ record })
  } catch (error) {
    console.error("[api/studio-genesis/history/[id]] GET failed:", error)
    return NextResponse.json({ error: "加载记录失败" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getScope()
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const params = await context.params
    const body = await request.json().catch(() => ({}))
    const record = await updateStudioGenesisHistoryItem(scope, params.id, {
      title: body?.title !== undefined ? String(body.title || "") : undefined,
      description: body?.description !== undefined ? String(body.description || "") : undefined,
      prompt: body?.prompt !== undefined ? String(body.prompt || "") : undefined,
      imageUrl: body?.imageUrl !== undefined ? String(body.imageUrl || "") : undefined,
      sourceImageUrl: body?.sourceImageUrl !== undefined ? String(body.sourceImageUrl || "") : undefined,
      model: body?.model !== undefined ? String(body.model || "") : undefined,
      provider: body?.provider !== undefined ? String(body.provider || "") : undefined,
    })

    if (!record) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    }

    return NextResponse.json({ record })
  } catch (error) {
    console.error("[api/studio-genesis/history/[id]] PATCH failed:", error)
    return NextResponse.json({ error: "更新记录失败" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getScope()
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const params = await context.params
    const ok = await deleteStudioGenesisHistoryItem(scope, params.id)
    if (!ok) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[api/studio-genesis/history/[id]] DELETE failed:", error)
    return NextResponse.json({ error: "删除记录失败" }, { status: 500 })
  }
}
