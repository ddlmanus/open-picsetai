import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST() {
  return NextResponse.json(
    {
      error:
        "SSE 批量精修接口已禁用，请使用 /api/refinement-studio/analyze、/api/refinement-studio/refine 创建任务并轮询 /api/refinement-studio/jobs/:jobId",
    },
    { status: 410 }
  )
}
