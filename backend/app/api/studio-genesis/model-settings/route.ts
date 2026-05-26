import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveSessionMerchantId } from "@/lib/admin-scope"
import { listStudioGenesisModels } from "@/lib/studio-genesis-ai"
import { getLocalUserScope } from "@/lib/local-user"

export const dynamic = "force-dynamic"

export async function GET() {
  const scope = await getLocalUserScope()
  const merchantId = scope.merchantId
  const models = await listStudioGenesisModels(merchantId)
  return NextResponse.json(models)
}
