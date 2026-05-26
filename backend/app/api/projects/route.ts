import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST() {
  return NextResponse.json({
    id: randomUUID(),
  })
}
