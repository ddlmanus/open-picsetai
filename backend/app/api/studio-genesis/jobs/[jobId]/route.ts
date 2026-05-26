import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getStudioGenesisAnalysisJob } from "@/lib/studio-genesis-analysis-jobs"
import { getLocalUserScope } from "@/lib/local-user"

export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const scope = await getLocalUserScope()
    const userId = scope.userId

    const { jobId } = await context.params
    const job = getStudioGenesisAnalysisJob(jobId, userId)
    if (!job) {
      return NextResponse.json({ error: "任务不存在或无权访问" }, { status: 404 })
    }

    return NextResponse.json(job)
  } catch (error: any) {
    console.error("[api/studio-genesis/jobs/:jobId] failed:", error)
    return NextResponse.json({ error: error?.message || "查询任务状态失败" }, { status: 500 })
  }
}
