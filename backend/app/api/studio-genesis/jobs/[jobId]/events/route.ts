import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    { error: "事件流接口已停用，请改用任务状态轮询接口" },
    { status: 410 }
  )
}
