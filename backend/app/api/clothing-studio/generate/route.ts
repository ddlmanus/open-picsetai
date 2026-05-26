import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST() {
  return NextResponse.json(
    {
      error:
        "SSE 批量生成接口已禁用，请使用 /api/clothing-studio/generate-image 创建任务并轮询 /api/clothing-studio/jobs/:jobId",
    },
    { status: 410 }
  )
}
