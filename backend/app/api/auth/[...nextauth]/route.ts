import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export function GET(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  return handleAuthCompat(request, context)
}

export function POST(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  return handleAuthCompat(request, context)
}

async function handleAuthCompat(
  _request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const params = await context.params
  const path = (params.nextauth || []).join("/")

  if (path === "session") {
    return NextResponse.json(null)
  }

  if (path === "_log") {
    return new Response(null, { status: 204 })
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 })
}
