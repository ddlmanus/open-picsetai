import { NextResponse } from "next/server"
import { getLocalUserScope } from "@/lib/local-user"
import { listAestheticMirrorModels } from "@/lib/aesthetic-mirror-ai"

export const dynamic = "force-dynamic"

export async function GET() {
  const scope = await getLocalUserScope()
    const userId = scope.userId

  const merchantId = scope.merchantId
  const models = await listAestheticMirrorModels(merchantId)
  return NextResponse.json(models)
}
